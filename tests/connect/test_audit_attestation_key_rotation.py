"""Offline audit attestation key-rollover verification; disposable SQLite only.

Neither the old/new synthetic HMAC keys nor attestation bytes are published or
used with any hosted customer infrastructure. Independent custody is required.
"""
import tempfile
import unittest
from pathlib import Path

from connect import audit_attestation as attestation
from connect.core import CanonicalEnvelope
from connect.persistence import RunStore

OLD_KEY = b'synthetic-previous-audit-HMAC-key-20261108'
NEW_KEY = b'synthetic-successor-audit-HMAC-key-20261108'
WRONG_KEY = b'synthetic-unrelated-audit-HMAC-key-20261108'


class OfflineAuditKeyRolloverTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.store = RunStore(Path(directory.name) / 'offline.sqlite3')
        self.addCleanup(self.store.close)
        self.input = dict(
            run_id='offline-key-rollover', connector_name='synthetic-opcua',
            protocol='opcua',
            envelope=CanonicalEnvelope(
                contract='musitu.connect.canonical.v1', domain='mining',
                records=({'hazard': 'synthetic-only', 'exposure': 0.35},),
                source='fixture', provenance='normalized',
            ),
            lineage={'test': 'offline-key-rollover'},
            signature='synthetic-sealed-signature',
        )
        self.store.record_ingest_run(**self.input)
        self.old = self.issue(OLD_KEY)
        self.assertTrue(attestation.verify_audit_attestation(self.store, self.old, OLD_KEY))

    def issue(self, key):
        return attestation.issue_audit_attestation(self.store, self.input['run_id'], key)

    def verify(self, previous, successor, old_key=OLD_KEY, new_key=NEW_KEY):
        # The prior public API understands one key, not independently
        # authenticated earlier/later artifacts with different secrets.
        checker = getattr(attestation, 'verify_audit_attestation_key_rotation',
                          lambda *_args: False)
        return checker(self.store, previous, successor, old_key, new_key)

    def test_same_audit_tip_can_be_reauthenticated_under_distinct_new_key(self):
        successor = self.issue(NEW_KEY)
        self.assertNotEqual(self.old, successor)
        self.assertTrue(self.verify(self.old, successor))

    def test_new_key_artifact_can_extend_exact_old_key_anchored_prefix(self):
        self.store.append_audit_event(self.input['run_id'], 'PLAN_COMPUTED', {'value': 7})
        successor = self.issue(NEW_KEY)
        self.assertTrue(self.verify(self.old, successor))
        self.assertFalse(attestation.verify_audit_attestation(self.store, self.old, OLD_KEY))
        self.assertTrue(attestation.verify_audit_attestation(self.store, successor, NEW_KEY))

    def test_reusing_identical_secret_does_not_count_as_key_rotation(self):
        self.assertFalse(self.verify(self.old, self.old, OLD_KEY, OLD_KEY))

    def test_wrong_or_swapped_secrets_never_validate_key_rotation(self):
        successor = self.issue(NEW_KEY)
        self.assertFalse(self.verify(self.old, successor, OLD_KEY, WRONG_KEY))
        self.assertFalse(self.verify(self.old, successor, NEW_KEY, OLD_KEY))
        self.assertFalse(self.verify(self.old, successor, WRONG_KEY, NEW_KEY))
        self.assertFalse(self.verify(self.old, successor, b'weak', NEW_KEY))
        self.assertFalse(self.verify(self.old, successor, OLD_KEY, 'not-bytes'))

    def test_new_key_cannot_retroactively_sign_a_different_run(self):
        other = dict(self.input, run_id='other-offline-run')
        self.store.record_ingest_run(**other)
        another = attestation.issue_audit_attestation(self.store, other['run_id'], NEW_KEY)
        self.assertFalse(self.verify(self.old, another))

    def test_new_key_does_not_erase_old_history_anchor_after_a_fork(self):
        rid = self.input['run_id']
        self.store.connection.execute('DELETE FROM run_audit_heads WHERE run_id=?', (rid,))
        self.store.connection.execute('DELETE FROM run_audit WHERE run_id=?', (rid,))
        self.store.connection.execute('DELETE FROM connect_runs WHERE run_id=?', (rid,))
        self.store.connection.commit()
        self.store.record_ingest_run(**self.input)
        self.store.append_audit_event(rid, 'PLAN_COMPUTED', {'value': 7})
        successor = self.issue(NEW_KEY)
        self.assertTrue(attestation.verify_audit_attestation(self.store, successor, NEW_KEY))
        self.assertFalse(self.verify(self.old, successor))

    def test_new_artifact_must_match_current_live_database_state(self):
        successor = self.issue(NEW_KEY)
        self.store.append_audit_event(self.input['run_id'], 'PLAN_COMPUTED', {'value': 7})
        self.assertFalse(self.verify(self.old, successor))

    def test_preexisting_caller_transaction_is_not_modified_or_rolled_back(self):
        successor = self.issue(NEW_KEY)
        self.store.connection.execute('BEGIN')
        self.assertTrue(self.store.connection.in_transaction)
        self.assertFalse(self.verify(self.old, successor))
        self.assertTrue(self.store.connection.in_transaction)
        self.store.connection.rollback()

    def test_noncanonical_old_or_new_artifact_is_rejected(self):
        successor = self.issue(NEW_KEY)
        self.assertFalse(self.verify(self.old + b' ', successor))
        self.assertFalse(self.verify(self.old, successor + b' '))


if __name__ == '__main__':
    unittest.main()
