"""Isolated signed audit snapshots; no external publication or hosted database."""
import json
import tempfile
import unittest
from pathlib import Path

from connect.audit_attestation import issue_audit_attestation, verify_audit_attestation
from connect.core import CanonicalEnvelope
from connect.persistence import RunStore

SECRET = b'synthetic-test-key-only-32-byte-secret-2026'
OTHER_SECRET = b'other-synthetic-key-only-32-byte-key-2'


class OfflineAuditAttestationTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = Path(directory.name) / 'local.sqlite3'
        self.store = RunStore(self.path)
        self.addCleanup(self.store.close)
        self.store.record_ingest_run(
            run_id='synthetic-run', connector_name='synthetic-opcua', protocol='opcua',
            envelope=CanonicalEnvelope(
                contract='musitu.connect.canonical.v1', domain='mining',
                records=({'exposure': 0.2, 'hazard': 'synthetic-ground'},),
                source='synthetic-origin', provenance='normalized',
            ),
            lineage={'run': {'runId': 'synthetic-run'}, 'source': 'synthetic-site'},
            signature='synthetic-seal',
        )
        self.assertTrue(self.store.verify_audit_chain('synthetic-run'))

    def issue(self):
        return issue_audit_attestation(self.store, 'synthetic-run', SECRET)

    def valid(self, artifact):
        return verify_audit_attestation(self.store, artifact, SECRET)

    def test_valid_attestation_survives_reopen_without_disclosing_secret(self):
        artifact = self.issue()
        self.assertTrue(self.valid(artifact))
        self.assertNotIn(SECRET, artifact)
        self.store.close()
        self.store = RunStore(self.path)
        self.addCleanup(self.store.close)
        self.assertTrue(self.valid(artifact))

    def test_later_audit_append_invalidates_previous_pinned_snapshot(self):
        artifact = self.issue()
        self.store.append_audit_event('synthetic-run', 'PLAN_COMPUTED', {'synthetic': True})
        self.assertTrue(self.store.verify_audit_chain('synthetic-run'))
        self.assertFalse(self.valid(artifact))
        self.assertTrue(self.valid(self.issue()))

    def test_changed_lineage_rejected_even_when_local_chain_remains_valid(self):
        artifact = self.issue()
        self.store.connection.execute(
            'UPDATE connect_runs SET lineage_json=? WHERE run_id=?',
            ('{"run":{"runId":"synthetic-run"},"source":"forged-site"}', 'synthetic-run'),
        )
        self.store.connection.commit()
        self.assertTrue(self.store.verify_audit_chain('synthetic-run'))
        self.assertFalse(self.valid(artifact))

    def test_changed_source_and_signature_rejected_even_if_local_digest_is_unchanged(self):
        original = self.issue()
        row = self.store.connection.execute('SELECT envelope_json FROM connect_runs').fetchone()
        envelope = json.loads(row['envelope_json'])
        envelope['source'] = 'forged-origin'
        self.store.connection.execute(
            'UPDATE connect_runs SET envelope_json=?', (json.dumps(envelope),)
        )
        self.store.connection.commit()
        self.assertTrue(self.store.verify_audit_chain('synthetic-run'))
        self.assertFalse(self.valid(original))

    def test_stored_signature_swap_rejected_despite_intact_internal_chain(self):
        artifact = self.issue()
        self.store.connection.execute(
            'UPDATE connect_runs SET signature=? WHERE run_id=?',
            ('forged-signature', 'synthetic-run'),
        )
        self.store.connection.commit()
        self.assertTrue(self.store.verify_audit_chain('synthetic-run'))
        self.assertFalse(self.valid(artifact))

    def test_later_signed_checkpoint_detects_truncated_audit_history(self):
        self.store.append_audit_event('synthetic-run', 'PLAN_COMPUTED', {'synthetic': True})
        pinned_latest = self.issue()
        self.store.connection.execute(
            'DELETE FROM run_audit WHERE run_id=? AND event_index=2',
            ('synthetic-run',),
        )
        self.store.connection.commit()
        self.assertFalse(self.valid(pinned_latest))

    def test_uncommitted_caller_transaction_is_not_rolled_back(self):
        self.store.connection.execute('BEGIN')
        self.assertTrue(self.store.connection.in_transaction)
        with self.assertRaisesRegex(ValueError, 'AUDIT_INTEGRITY_INVALID'):
            self.issue()
        self.assertTrue(self.store.connection.in_transaction)
        self.store.connection.rollback()

    def test_new_secret_and_tampered_mac_never_verify(self):
        artifact = self.issue()
        self.assertFalse(verify_audit_attestation(self.store, artifact, OTHER_SECRET))
        altered = json.loads(artifact)
        altered['hmac_sha256'] = '0' * 64
        self.assertFalse(self.valid(json.dumps(altered, sort_keys=True, separators=(',', ':')).encode()))

    def test_duplicate_key_noncanonical_and_unknown_field_are_rejected(self):
        artifact = self.issue()
        self.assertFalse(self.valid(artifact + b' '))
        self.assertFalse(self.valid(artifact.replace(b'{', b'{"schema":"forged",', 1)))
        extra = json.loads(artifact)
        extra['extra'] = True
        self.assertFalse(self.valid(json.dumps(extra, sort_keys=True, separators=(',', ':')).encode()))

    def test_missing_audit_history_cannot_be_attested(self):
        self.store.connection.execute('DELETE FROM run_audit WHERE run_id=?', ('synthetic-run',))
        self.store.connection.commit()
        with self.assertRaisesRegex(ValueError, 'AUDIT_INTEGRITY_INVALID'):
            self.issue()

    def test_weak_or_missing_key_rejected_for_signing_and_verification(self):
        with self.assertRaisesRegex(ValueError, 'attestation_key'):
            issue_audit_attestation(self.store, 'synthetic-run', b'weak')
        self.assertFalse(verify_audit_attestation(self.store, self.issue(), b'weak'))

    def test_noncanonical_input_types_and_oversized_data_rejected(self):
        artifact = self.issue()
        self.assertFalse(self.valid({'attestation': artifact}))
        self.assertFalse(self.valid(b'{' + b'x' * 8192 + b'}'))
        self.assertFalse(self.valid(b'\xff'))


if __name__ == '__main__':
    unittest.main()
