"""Fail-closed verification of the offline Connect run audit ledger.

Uses disposable local SQLite only; no hosted customer database or credentials.
"""
import json
import tempfile
import unittest
from pathlib import Path

from connect.core import CanonicalEnvelope
from connect.persistence import RunStore


class AuditChainFailClosedTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.store = RunStore(Path(self.directory.name) / 'run-ledger.sqlite')
        self.addCleanup(self.store.close)
        self.store.record_run(
            run_id='audit-r1', connector_name='opcua-face-a', protocol='opcua',
            envelope=CanonicalEnvelope(
                contract='musitu.connect.canonical.v1', domain='mining',
                records=({'hazard': 'synthetic only', 'exposure': 0.5},),
                source='mining-adapter', provenance='normalized',
            ),
            lineage={'run': {'runId': 'audit-r1'}}, signature='synthetic-test-only',
        )
        self.assertTrue(self.store.verify_audit_chain('audit-r1'))

    def test_deleted_audit_history_is_not_considered_valid(self):
        self.store.connection.execute('DELETE FROM run_audit WHERE run_id=?', ('audit-r1',))
        self.store.connection.commit()
        self.assertFalse(self.store.verify_audit_chain('audit-r1'))

    def test_unknown_run_id_is_not_considered_valid(self):
        self.assertFalse(self.store.verify_audit_chain('never-recorded'))

    def test_changed_connector_metadata_cannot_retain_valid_audit_status(self):
        self.store.connection.execute(
            'UPDATE connect_runs SET connector_name=? WHERE run_id=?',
            ('other-tenant-origin', 'audit-r1'),
        )
        self.store.connection.commit()
        # The run payload hash is unchanged; the initial RUN_RECORDED event
        # still attests the original connector, not the new metadata.
        self.assertFalse(self.store.verify_audit_chain('audit-r1'))

    def test_tampered_stored_envelope_invalidates_audit_verification(self):
        original = self.store.connection.execute(
            'SELECT envelope_json FROM connect_runs WHERE run_id=?', ('audit-r1',)
        ).fetchone()['envelope_json']
        tampered = json.loads(original)
        tampered['records'][0]['exposure'] = 0.9
        self.store.connection.execute(
            'UPDATE connect_runs SET envelope_json=? WHERE run_id=?',
            (json.dumps(tampered), 'audit-r1'),
        )
        self.store.connection.commit()
        self.assertFalse(self.store.verify_audit_chain('audit-r1'))

    def test_unparseable_audit_row_is_reported_as_invalid_not_success(self):
        self.store.connection.execute(
            'UPDATE run_audit SET payload_json=? WHERE run_id=? AND event_index=0',
            ('{', 'audit-r1'),
        )
        self.store.connection.commit()
        self.assertFalse(self.store.verify_audit_chain('audit-r1'))


if __name__ == '__main__':
    unittest.main()
