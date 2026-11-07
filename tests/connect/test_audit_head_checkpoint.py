"""Detect local Connect audit suffix truncation without external services.

All writes use a disposable local SQLite file. This is not a hosted D1,
Neon, production-authorization, or externally anchored audit test.
"""
import tempfile
import sqlite3
import unittest
from pathlib import Path

from connect.core import CanonicalEnvelope
from connect.persistence import RunStore


class AuditHeadCheckpointTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = Path(directory.name) / 'ledger.sqlite3'
        self.store = RunStore(self.path)
        self.addCleanup(self.store.close)
        self.args = {
            'run_id': 'checkpoint-run',
            'connector_name': 'synthetic-opcua',
            'protocol': 'opcua',
            'envelope': CanonicalEnvelope(
                contract='musitu.connect.canonical.v1',
                domain='mining',
                records=({'hazard': 'synthetic only', 'exposure': 0.5},),
                source='test-source', provenance='normalized',
            ),
            'lineage': {},
            'signature': 'synthetic-signature',
        }

    def _truncate_final_event(self):
        self.store.connection.execute(
            '''DELETE FROM run_audit
               WHERE run_id=? AND event_index=(
                   SELECT MAX(event_index) FROM run_audit WHERE run_id=?)''',
            ('checkpoint-run', 'checkpoint-run'),
        )
        self.store.connection.commit()

    def test_deleting_valid_final_audit_event_does_not_verify_as_shorter_chain(self):
        self.store.record_run(**self.args)
        self.store.append_audit_event('checkpoint-run', 'PLAN_COMPUTED', {'cost': 7})
        self.assertTrue(self.store.verify_audit_chain('checkpoint-run'))
        self._truncate_final_event()
        self.assertFalse(self.store.verify_audit_chain('checkpoint-run'))

    def test_truncated_ingest_history_cannot_be_extended_by_retry(self):
        self.store.record_ingest_run(**self.args)
        self.assertTrue(self.store.verify_audit_chain('checkpoint-run'))
        self._truncate_final_event()
        self.assertFalse(self.store.verify_audit_chain('checkpoint-run'))
        with self.assertRaisesRegex(RuntimeError, 'RUN_AUDIT_CHAIN_INVALID'):
            self.store.record_ingest_run(**self.args)
        count = self.store.connection.execute(
            'SELECT COUNT(*) FROM run_audit WHERE run_id=?', ('checkpoint-run',)
        ).fetchone()[0]
        self.assertEqual(count, 1)

    def test_missing_head_cannot_be_silently_recreated_on_reopen(self):
        self.store.record_ingest_run(**self.args)
        self.store.connection.execute(
            'DELETE FROM run_audit_heads WHERE run_id=?', ('checkpoint-run',),
        )
        self.store.connection.commit()
        self.store.close()
        self.store = RunStore(self.path)
        self.addCleanup(self.store.close)
        self.assertFalse(self.store.verify_audit_chain('checkpoint-run'))
        with self.assertRaisesRegex(RuntimeError, 'RUN_AUDIT_CHAIN_INVALID'):
            self.store.record_ingest_run(**self.args)

    def test_changed_terminal_checkpoint_invalidates_intact_hash_chain(self):
        self.store.record_run(**self.args)
        self.store.append_audit_event('checkpoint-run', 'PLAN_COMPUTED', {'cost': 7})
        self.store.connection.execute(
            'UPDATE run_audit_heads SET event_hash=? WHERE run_id=?',
            ('0' * 64, 'checkpoint-run'),
        )
        self.store.connection.commit()
        self.assertFalse(self.store.verify_audit_chain('checkpoint-run'))
        with self.assertRaisesRegex(RuntimeError, 'RUN_AUDIT_CHAIN_INVALID'):
            self.store.append_audit_event('checkpoint-run', 'DONE', {})
        self.assertEqual(len(self.store.audit_events('checkpoint-run')), 2)

    def test_initial_head_write_failure_rolls_back_entire_new_run(self):
        self.store.connection.execute("""CREATE TRIGGER deny_head BEFORE INSERT ON run_audit_heads
            BEGIN SELECT RAISE(ABORT, 'head write unavailable'); END""")
        with self.assertRaises(sqlite3.IntegrityError):
            self.store.record_ingest_run(**self.args)
        self.assertIsNone(self.store.connection.execute(
            'SELECT 1 FROM connect_runs WHERE run_id=?', ('checkpoint-run',)
        ).fetchone())
        self.assertEqual(self.store.connection.execute(
            'SELECT COUNT(*) FROM run_audit WHERE run_id=?', ('checkpoint-run',)
        ).fetchone()[0], 0)

    def test_head_update_failure_rolls_back_audit_append(self):
        self.store.record_run(**self.args)
        self.store.connection.execute("""CREATE TRIGGER deny_head_update BEFORE UPDATE ON run_audit_heads
            BEGIN SELECT RAISE(ABORT, 'head update unavailable'); END""")
        with self.assertRaises(sqlite3.IntegrityError):
            self.store.append_audit_event('checkpoint-run', 'PLAN_COMPUTED', {'cost': 7})
        self.assertEqual(len(self.store.audit_events('checkpoint-run')), 1)
        self.assertTrue(self.store.verify_audit_chain('checkpoint-run'))

    def test_valid_head_checkpoint_survives_reopen_and_allows_extension(self):
        self.store.record_ingest_run(**self.args)
        self.assertTrue(self.store.verify_audit_chain('checkpoint-run'))
        self.store.close()
        reopened = RunStore(self.path)
        self.addCleanup(reopened.close)
        self.store = reopened
        self.assertTrue(reopened.verify_audit_chain('checkpoint-run'))
        reopened.append_audit_event('checkpoint-run', 'PLAN_COMPUTED', {'cost': 7})
        self.assertTrue(reopened.verify_audit_chain('checkpoint-run'))
        self.assertEqual(len(reopened.audit_events('checkpoint-run')), 3)


if __name__ == '__main__':
    unittest.main()
