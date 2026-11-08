"""Offline persisted JSON integrity: reject duplicate keys and nonstandard values.

A SQLite writer must not be able to add ambiguous JSON syntax while retaining
hash-valid *decoded* values. Only disposable local database fixtures are used.
"""
import tempfile
import unittest
from pathlib import Path

from connect.core import CanonicalEnvelope
from connect.persistence import RunStore


class PersistedJSONFailClosedTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.store = RunStore(Path(directory.name) / 'local-ledger.sqlite3')
        self.addCleanup(self.store.close)
        self.store.record_ingest_run(
            run_id='synthetic-001', connector_name='synthetic-mqtt', protocol='mqtt',
            envelope=CanonicalEnvelope(
                contract='musitu.connect.canonical.v1', domain='mining',
                records=({'hazard': 'synthetic roof fall', 'severity': 3},),
                source='verified-sensor', provenance='normalized',
            ),
            lineage={'site': 'mine-a', 'nested': {'source': 'instrument-a'}},
            signature='synthetic-only',
        )
        self.assertTrue(self.store.verify_audit_chain('synthetic-001'))

    def _mutate_run_json(self, field, before, after):
        row = self.store.connection.execute(
            f'SELECT {field} FROM connect_runs WHERE run_id=?', ('synthetic-001',)
        ).fetchone()
        raw = row[field]
        self.assertIn(before, raw)
        updated = raw.replace(before, after, 1)
        self.assertNotEqual(updated, raw)
        self.store.connection.execute(
            f'UPDATE connect_runs SET {field}=? WHERE run_id=?',
            (updated, 'synthetic-001'),
        )
        self.store.connection.commit()

    def test_duplicate_envelope_source_key_cannot_preserve_valid_run(self):
        # Last-value-wins JSON decoding retains the original arithmetic digest.
        self._mutate_run_json('envelope_json', '"source":"verified-sensor"',
                              '"source":"forged-sensor","source":"verified-sensor"')
        with self.assertRaisesRegex(ValueError, 'AMBIGUOUS_STORED_JSON'):
            self.store.load_run('synthetic-001')
        self.assertFalse(self.store.verify_audit_chain('synthetic-001'))

    def test_duplicate_nested_lineage_key_cannot_preserve_valid_audit(self):
        # The original hash chain never included source lineage JSON directly.
        self._mutate_run_json('lineage_json', '"source":"instrument-a"',
                              '"source":"forged-instrument","source":"instrument-a"')
        with self.assertRaisesRegex(ValueError, 'AMBIGUOUS_STORED_JSON'):
            self.store.load_run('synthetic-001')
        self.assertFalse(self.store.verify_audit_chain('synthetic-001'))

    def test_duplicate_genesis_audit_field_cannot_preserve_valid_hash_chain(self):
        row = self.store.connection.execute(
            'SELECT payload_json FROM run_audit WHERE run_id=? AND event_index=0',
            ('synthetic-001',),
        ).fetchone()
        raw = row['payload_json']
        self.assertIn('"connector_name":"synthetic-mqtt"', raw)
        raw = raw.replace('"connector_name":"synthetic-mqtt"',
                          '"connector_name":"forged-mqtt","connector_name":"synthetic-mqtt"', 1)
        self.store.connection.execute(
            'UPDATE run_audit SET payload_json=? WHERE run_id=? AND event_index=0',
            (raw, 'synthetic-001'),
        )
        self.store.connection.commit()
        with self.assertRaisesRegex(ValueError, 'AMBIGUOUS_STORED_JSON'):
            self.store.audit_events('synthetic-001')
        self.assertFalse(self.store.verify_audit_chain('synthetic-001'))

    def test_nonstandard_nan_lineage_is_never_trusted(self):
        self._mutate_run_json('lineage_json', '"site":"mine-a"',
                              '"site":"mine-a","unmeasured":NaN')
        with self.assertRaisesRegex(ValueError, 'NONSTANDARD_STORED_JSON'):
            self.store.load_run('synthetic-001')
        self.assertFalse(self.store.verify_audit_chain('synthetic-001'))

    def test_nonstandard_infinity_audit_payload_is_rejected_before_use(self):
        row = self.store.connection.execute(
            'SELECT payload_json FROM run_audit WHERE run_id=? AND event_index=1',
            ('synthetic-001',),
        ).fetchone()
        raw = row['payload_json'].replace('"record_count":1',
                                           '"record_count":Infinity', 1)
        self.store.connection.execute(
            'UPDATE run_audit SET payload_json=? WHERE run_id=? AND event_index=1',
            (raw, 'synthetic-001'),
        )
        self.store.connection.commit()
        with self.assertRaisesRegex(ValueError, 'NONSTANDARD_STORED_JSON'):
            self.store.audit_events('synthetic-001')
        self.assertFalse(self.store.verify_audit_chain('synthetic-001'))


    def test_new_run_with_nonfinite_lineage_cannot_be_persisted(self):
        with self.assertRaises(ValueError):
            self.store.record_run(
                run_id='new-synthetic-run', connector_name='synthetic-mqtt',
                protocol='mqtt',
                envelope=CanonicalEnvelope(
                    contract='musitu.connect.canonical.v1', domain='mining',
                    records=({'hazard': 'synthetic'},), source='test',
                    provenance='normalized',
                ),
                lineage={'quality': float('nan')}, signature='synthetic-only',
            )
        self.assertIsNone(self.store.connection.execute(
            'SELECT 1 FROM connect_runs WHERE run_id=?', ('new-synthetic-run',),
        ).fetchone())

    def test_audit_append_with_nonfinite_payload_rejected_without_new_event(self):
        original = self.store.audit_events('synthetic-001')
        with self.assertRaises(ValueError):
            self.store.append_audit_event('synthetic-001', 'INVALID_SENSOR',
                                          {'quality': float('inf')})
        self.assertEqual(self.store.audit_events('synthetic-001'), original)
        self.assertTrue(self.store.verify_audit_chain('synthetic-001'))


if __name__ == '__main__':
    unittest.main()
