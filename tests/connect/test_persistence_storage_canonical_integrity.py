"""Storage-only encoding may not alter MUSITU's signed canonical evidence.

The backing SQLite envelope is storage representation, not the signed payload.
This test exercises real full-synchronous persistence, replay and hash-chain
validation with reordered and Unicode fields. No hosted database is touched.
"""
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from connect.core import CanonicalEnvelope
from connect.persistence import RunStore
from connect.security import canonical_bytes, sign


class PersistenceStorageCanonicalIntegrityTests(unittest.TestCase):
    def test_unsorted_unicode_input_survives_reopen_with_original_signature_and_audit(self):
        envelope = CanonicalEnvelope(
            contract='musitu.connect.canonical.v1',
            domain='mining',
            records=(
                {'severity': 10.0, 'hazard': 'Éboulement / 塌方', 'cost': 1250.0,
                 'likelihood': 0.4, 'benefit': 0.2, 'exposure': 0.5,
                 'site': 'Zone C \\"北\\"'},
                {'benefit': 0.3, 'exposure': 0.8, 'hazard': 'roof-fall',
                 'likelihood': 0.6, 'cost': 300.0, 'severity': 9.0},
            ),
            source='mining-adapter',
            provenance='normalized',
        )
        run_id='synthetic-unicode-001'
        signing_secret=b'isolated-ci-signing-key'
        signed_payload=canonical_bytes({
            'contract': envelope.contract,
            'domain': envelope.domain,
            'records': [dict(r) for r in envelope.records],
            'run_id': run_id,
        })
        signature=sign(signed_payload, signing_secret).signature
        digest=hashlib.sha256(signed_payload).hexdigest()
        with tempfile.TemporaryDirectory() as directory:
            db=Path(directory)/'runs.sqlite'
            with RunStore(db) as store:
                stored=store.record_ingest_run(
                    run_id=run_id, connector_name='synthetic-mqtt', protocol='mqtt',
                    envelope=envelope, lineage={'job': {'name': 'synthetic-mqtt'}},
                    signature=signature, sealed_canonical_sha256=digest,
                )
                row=store.connection.execute(
                    'SELECT envelope_json FROM connect_runs WHERE run_id=?',
                    (run_id,),
                ).fetchone()
                self.assertIsNotNone(row)
                storage=json.loads(row['envelope_json'])
                self.assertEqual(storage['records'], list(envelope.records))
                self.assertEqual(storage['source'], 'mining-adapter')
                self.assertEqual(storage['provenance'], 'normalized')
                self.assertEqual(stored.canonical_sha256, digest)
                self.assertEqual(stored.signature, signature)
                self.assertTrue(store.verify_audit_chain(run_id))
                self.assertEqual([e.event_type for e in store.audit_events(run_id)],
                                 ['RUN_RECORDED','INGEST_COMPLETED'])
            with RunStore(db) as reopened:
                loaded=reopened.load_run(run_id)
                self.assertEqual(loaded.canonical_payload(), signed_payload)
                self.assertTrue(loaded.verify_signature(signing_secret))
                self.assertTrue(reopened.verify_audit_chain(run_id))
                self.assertEqual(loaded.envelope.records, envelope.records)

    def test_record_ingest_conflict_and_audit_tamper_remain_fail_closed(self):
        envelope=CanonicalEnvelope(
            contract='musitu.connect.canonical.v1',domain='mining',
            records=({'hazard': 'fault', 'cost': 5, 'severity': 9},),
        )
        with tempfile.TemporaryDirectory() as directory:
            with RunStore(Path(directory)/'runs.sqlite') as store:
                store.record_ingest_run(
                    run_id='r1', connector_name='synthetic', protocol='mqtt',
                    envelope=envelope, lineage={}, signature='synthetic-only',
                )
                with self.assertRaisesRegex(ValueError, 'run_id_conflict'):
                    store.record_ingest_run(
                        run_id='r1', connector_name='synthetic', protocol='mqtt',
                        envelope=CanonicalEnvelope(envelope.contract,envelope.domain,
                                                   ({'hazard':'tampered'},)),
                        lineage={},signature='synthetic-only',
                    )
                self.assertTrue(store.verify_audit_chain('r1'))
                store.connection.execute(
                    "UPDATE run_audit SET payload_json=? WHERE run_id=? AND event_index=0",
                    ('{}','r1'),
                )
                store.connection.commit()
                self.assertFalse(store.verify_audit_chain('r1'))


if __name__ == '__main__':
    unittest.main()
