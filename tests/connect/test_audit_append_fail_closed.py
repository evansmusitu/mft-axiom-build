"""Fail closed on corrupted durable Connect audit history before later writes.

All fixtures use a disposable local SQLite database; no hosted infrastructure.
"""
import tempfile
import unittest
from pathlib import Path

from connect.core import CanonicalEnvelope
from connect.persistence import RunStore


class AuditAppendFailClosedTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.store = RunStore(Path(directory.name) / 'audit.sqlite3')
        self.addCleanup(self.store.close)
        self.envelope = CanonicalEnvelope(
            contract='musitu.connect.canonical.v1',
            domain='mining',
            records=({'hazard': 'synthetic test only', 'exposure': 0.5},),
            source='synthetic-test',
            provenance='normalized',
        )
        self.run_args = {
            'run_id': 'audit-r2',
            'connector_name': 'test-opcua',
            'protocol': 'opcua',
            'envelope': self.envelope,
            'lineage': {},
            'signature': 'synthetic-test-only',
        }

    def _event_count(self):
        return self.store.connection.execute(
            'SELECT count(*) FROM run_audit WHERE run_id=?', ('audit-r2',)
        ).fetchone()[0]

    def _corrupt_genesis(self):
        self.store.connection.execute(
            "UPDATE run_audit SET payload_json=? WHERE run_id=? AND event_index=0",
            ('{"unauthorized":true}', 'audit-r2'),
        )
        self.store.connection.commit()
        self.assertFalse(self.store.verify_audit_chain('audit-r2'))

    def test_append_rejects_corrupt_history_without_adding_an_event(self):
        self.store.record_run(**self.run_args)
        self.store.append_audit_event('audit-r2', 'READ_COMPLETED', {'row_count': 1})
        self._corrupt_genesis()
        count = self._event_count()
        with self.assertRaisesRegex(RuntimeError, 'RUN_AUDIT_CHAIN_INVALID'):
            self.store.append_audit_event('audit-r2', 'PLAN_COMPUTED', {'risk': 3})
        self.assertEqual(self._event_count(), count)

    def test_append_rejects_deleted_history_without_restarting_chain(self):
        self.store.record_run(**self.run_args)
        self.store.connection.execute('DELETE FROM run_audit WHERE run_id=?', ('audit-r2',))
        self.store.connection.commit()
        self.assertFalse(self.store.verify_audit_chain('audit-r2'))
        with self.assertRaisesRegex(RuntimeError, 'RUN_AUDIT_CHAIN_INVALID'):
            self.store.append_audit_event('audit-r2', 'PLAN_COMPUTED', {'risk': 3})
        self.assertEqual(self._event_count(), 0)

    def test_idempotent_ingest_does_not_extend_corrupted_history(self):
        self.store.record_ingest_run(**self.run_args)
        self._corrupt_genesis()
        count = self._event_count()
        with self.assertRaisesRegex(RuntimeError, 'RUN_AUDIT_CHAIN_INVALID'):
            self.store.record_ingest_run(**self.run_args)
        self.assertEqual(self._event_count(), count)

    def test_idempotent_record_run_does_not_silently_accept_corrupt_history(self):
        self.store.record_run(**self.run_args)
        self._corrupt_genesis()
        with self.assertRaisesRegex(RuntimeError, 'RUN_AUDIT_CHAIN_INVALID'):
            self.store.record_run(**self.run_args)
        self.assertEqual(self._event_count(), 1)

    def test_healthy_history_still_allows_audited_append_and_idempotent_ingest(self):
        self.store.record_ingest_run(**self.run_args)
        self.store.append_audit_event('audit-r2', 'PLAN_COMPUTED', {'risk': 3})
        self.store.record_ingest_run(**self.run_args)
        self.assertEqual(self._event_count(), 4)
        self.assertTrue(self.store.verify_audit_chain('audit-r2'))


if __name__ == '__main__':
    unittest.main()
