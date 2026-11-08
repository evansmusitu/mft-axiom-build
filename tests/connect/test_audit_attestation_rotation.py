"""Offline pinned HMAC audit snapshot progression; only disposable local SQLite.

A prior artifact and HMAC secret must be kept outside the audited DB. These
checks cannot establish custody, immutability, or independent timestamps.
"""
import json
import tempfile
import unittest
from pathlib import Path

from connect import audit_attestation as attestation
from connect.core import CanonicalEnvelope
from connect.persistence import RunStore

KEY = b'offline-audit-rotation-test-key-separate-20261108'
BAD_KEY = b'different-offline-audit-test-key-20261108'


class AuditAttestationRotationTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.store = RunStore(Path(directory.name) / 'isolated.sqlite3')
        self.addCleanup(self.store.close)
        self.input = {
            'run_id': 'synthetic-audit-rotation',
            'connector_name': 'offline-sensor',
            'protocol': 'opcua',
            'envelope': CanonicalEnvelope(
                contract='musitu.connect.canonical.v1',
                domain='mining',
                records=({'hazard': 'synthetic-only', 'exposure': 0.25},),
                source='synthetic-fixture', provenance='normalized',
            ),
            'lineage': {'job': {'name': 'offline-sensor'}},
            'signature': 'synthetic-signature-for-tests',
        }
        self.store.record_ingest_run(**self.input)
        self.first = attestation.issue_audit_attestation(self.store,
                                                         self.input['run_id'], KEY)
        self.assertTrue(attestation.verify_audit_attestation(self.store, self.first, KEY))

    def rotate(self, before, after, key=KEY):
        # The meaningful RED assertion is that a valid progression is not
        # accepted by the previous API (which had no rotation contract).
        verify = getattr(attestation, 'verify_audit_attestation_rotation',
                         lambda *args: False)
        return verify(self.store, before, after, key)

    def _advance(self):
        self.store.append_audit_event(self.input['run_id'], 'PLAN_COMPUTED',
                                      {'synthetic': 'one'})
        return attestation.issue_audit_attestation(self.store, self.input['run_id'], KEY)

    def test_valid_pinned_prefix_can_be_advanced_without_repinning_old_artifact(self):
        second = self._advance()
        self.assertFalse(attestation.verify_audit_attestation(self.store, self.first, KEY))
        self.assertTrue(self.rotate(self.first, second))
        self.assertTrue(self.store.verify_audit_chain(self.input['run_id']))

    def test_identical_current_attestation_is_valid_noop_rotation(self):
        self.assertTrue(self.rotate(self.first, self.first))

    def test_rollback_to_older_signed_artifact_is_not_accepted(self):
        second = self._advance()
        self.assertFalse(self.rotate(second, self.first))

    def test_bad_secret_or_noncanonical_old_artifact_is_rejected(self):
        second = self._advance()
        self.assertFalse(self.rotate(self.first, second, BAD_KEY))
        self.assertFalse(self.rotate(self.first + b' ', second))
        self.assertFalse(self.rotate(self.first.replace(b'{', b'{"run_id":"forged",', 1), second))

    def test_different_run_pinned_artifact_is_not_interchangeable(self):
        second = self._advance()
        other = dict(self.input)
        other['run_id'] = 'synthetic-other-run'
        self.store.record_ingest_run(**other)
        other_pinned = attestation.issue_audit_attestation(
            self.store, other['run_id'], KEY,
        )
        self.assertFalse(self.rotate(other_pinned, second))

    def test_signed_newer_snapshot_still_must_match_live_database(self):
        second = self._advance()
        self.store.append_audit_event(self.input['run_id'], 'DONE',
                                      {'synthetic': 'two'})
        self.assertFalse(self.rotate(self.first, second))

    def test_replaced_old_chain_prefix_cannot_pass_even_with_fresh_valid_signed_tip(self):
        # Simulates a local DB actor rewriting the first event and all links.
        # They can then issue a new signed tip if they also control the key,
        # but cannot make the old externally pinned hash match a new fork.
        self.store.connection.execute(
            'DELETE FROM run_audit_heads WHERE run_id=?', (self.input['run_id'],))
        self.store.connection.execute(
            'DELETE FROM run_audit WHERE run_id=?', (self.input['run_id'],))
        self.store.connection.execute(
            'DELETE FROM connect_runs WHERE run_id=?', (self.input['run_id'],))
        self.store.connection.commit()
        self.store.record_ingest_run(**self.input)
        second = self._advance()
        self.assertTrue(attestation.verify_audit_attestation(self.store, second, KEY))
        self.assertFalse(self.rotate(self.first, second))

    def test_transaction_owned_by_caller_must_not_be_rolled_back(self):
        second = self._advance()
        self.store.connection.execute('BEGIN')
        self.assertTrue(self.store.connection.in_transaction)
        self.assertFalse(self.rotate(self.first, second))
        self.assertTrue(self.store.connection.in_transaction)
        self.store.connection.rollback()


if __name__ == '__main__':
    unittest.main()
