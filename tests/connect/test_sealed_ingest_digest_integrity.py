"""Isolated SQLite regression for pre-commit verification of sealed ingest digest.

No hosted database, customer credentials, production Worker, or methane model.
"""
import tempfile
import unittest
from pathlib import Path

from connect.core import CanonicalEnvelope
from connect.persistence import RunStore


class SealedIngestDigestIntegrityTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.store = RunStore(Path(directory.name) / 'sealed-ingest.sqlite')
        self.addCleanup(self.store.close)
        self.envelope = CanonicalEnvelope(
            contract='musitu.connect.canonical.v1',
            domain='mining',
            records=({'hazard': 'synthetic-rockfall', 'severity': 4},),
            source='synthetic-test-origin', provenance='normalized',
        )
        self.input = {
            'run_id': 'synthetic-run-1',
            'connector_name': 'synthetic-adapter',
            'protocol': 'mqtt',
            'envelope': self.envelope,
            'lineage': {'source': 'synthetic-only'},
            'signature': 'synthetic-only-no-production-key',
        }

    def _counts(self):
        conn = self.store.connection
        return tuple(conn.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0]
                     for table in ('connect_runs', 'run_audit', 'run_audit_heads'))

    def test_incorrect_well_formed_sealed_digest_rejected_before_any_ledger_write(self):
        genuine = self.store.canonical_sha256(self.input['run_id'], self.envelope)
        altered = ('0' if genuine[0] != '0' else '1') + genuine[1:]
        self.assertEqual(self._counts(), (0, 0, 0))
        with self.assertRaisesRegex(ValueError, 'sealed_canonical_sha256_mismatch'):
            self.store.record_ingest_run(**self.input, sealed_canonical_sha256=altered)
        self.assertEqual(self._counts(), (0, 0, 0))

    def test_post_seal_record_change_cannot_be_persisted_under_original_digest(self):
        original_digest = self.store.canonical_sha256(self.input['run_id'], self.envelope)
        self.envelope.records[0]['severity'] = 9
        with self.assertRaisesRegex(ValueError, 'sealed_canonical_sha256_mismatch'):
            self.store.record_ingest_run(**self.input, sealed_canonical_sha256=original_digest)
        self.assertEqual(self._counts(), (0, 0, 0))

    def test_matching_sealed_digest_preserves_normal_ingest_and_verified_audit(self):
        digest = self.store.canonical_sha256(self.input['run_id'], self.envelope)
        stored = self.store.record_ingest_run(**self.input, sealed_canonical_sha256=digest)
        self.assertEqual(stored.canonical_sha256, digest)
        self.assertEqual(self._counts(), (1, 2, 1))
        self.assertTrue(self.store.verify_audit_chain(self.input['run_id']))
        self.assertEqual(self.store.load_run(self.input['run_id']).canonical_sha256, digest)


if __name__ == '__main__':
    unittest.main()
