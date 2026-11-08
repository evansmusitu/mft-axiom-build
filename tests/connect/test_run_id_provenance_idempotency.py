"""Offline idempotent run IDs cannot silently change Connect source provenance.

Uses only isolated local SQLite, with no hosted DB, customer identity or deployment.
"""
import tempfile
import unittest
from dataclasses import replace
from copy import deepcopy
from pathlib import Path

from connect.core import CanonicalEnvelope
from connect.persistence import RunStore
from connect.fabric import ConnectFabric


class RunIdProvenanceIdempotencyTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.store = RunStore(Path(directory.name) / "isolated-ledger.sqlite")
        self.addCleanup(self.store.close)
        self.envelope = CanonicalEnvelope(
            contract="musitu.connect.canonical.v1",
            domain="mining",
            records=({"hazard": "synthetic-only", "severity": 2},),
            source="source-one", provenance="normalized",
        )
        self.kwargs = {
            "run_id": "ingest-1", "connector_name": "mqtt-collector",
            "protocol": "mqtt", "signature": "synthetic-signature",
            "envelope": self.envelope,
            "lineage": {"site": "alpha", "nested": {"event": 17, "tags": ["a", "b"]}},
        }

    def _events(self):
        return self.store.audit_events("ingest-1")

    def test_same_run_id_with_changed_lineage_rejected_without_new_audit_event(self):
        self.store.record_ingest_run(**self.kwargs)
        before = self._events()
        changed = {**self.kwargs, "lineage": {"site": "beta", "nested": {"event": 17, "tags": ["a", "b"]}}}
        with self.assertRaisesRegex(ValueError, "run_id_conflict"):
            self.store.record_ingest_run(**changed)
        self.assertEqual(self._events(), before)
        self.assertTrue(self.store.verify_audit_chain("ingest-1"))

    def test_same_run_id_with_changed_source_or_provenance_rejected(self):
        self.store.record_ingest_run(**self.kwargs)
        before = self._events()
        for field, value in (("source", "source-two"), ("provenance", "unverified")):
            with self.subTest(field=field):
                changed = {**self.kwargs, "envelope": replace(self.envelope, **{field: value})}
                # Neither source nor provenance is in the signed arithmetic digest;
                # that is why replay must independently compare stored provenance.
                self.assertEqual(self.store.canonical_sha256("ingest-1", self.envelope),
                                 self.store.canonical_sha256("ingest-1", changed["envelope"]))
                with self.assertRaisesRegex(ValueError, "run_id_conflict"):
                    self.store.record_ingest_run(**changed)
                self.assertEqual(self._events(), before)
        self.assertTrue(self.store.verify_audit_chain("ingest-1"))

    def test_record_run_idempotency_rejects_lineage_drift(self):
        self.store.record_run(**self.kwargs)
        before = self._events()
        with self.assertRaisesRegex(ValueError, "run_id_conflict"):
            self.store.record_run(**{**self.kwargs, "lineage": {"site": "other"}})
        self.assertEqual(self._events(), before)

    def test_replayed_openlineage_event_with_new_event_time_remains_idempotent(self):
        # ConnectFabric.seal generates a fresh OpenLineage eventTime on every
        # invocation, even for an otherwise identical retried request.
        fabric = ConnectFabric(signing_secret=b'synthetic-only').seal(
            run_id='ingest-1', connector_name='mqtt-collector', envelope=self.envelope,
        )
        first = {**self.kwargs, "lineage": fabric.lineage, "signature": fabric.signature}
        self.store.record_ingest_run(**first)
        second_lineage = deepcopy(fabric.lineage)
        second_lineage['eventTime'] = '2026-11-08T09:41:11+00:00'
        self.assertNotEqual(second_lineage['eventTime'], first['lineage']['eventTime'])
        self.store.record_ingest_run(**{**first, "lineage": second_lineage})
        self.assertEqual(len(self._events()), 3)
        self.assertEqual(self.store.load_run('ingest-1').lineage, first['lineage'])
        self.assertTrue(self.store.verify_audit_chain('ingest-1'))

    def test_replayed_openlineage_job_or_inputs_change_is_not_a_time_only_retry(self):
        fabric = ConnectFabric(signing_secret=b'synthetic-only').seal(
            run_id='ingest-1', connector_name='mqtt-collector', envelope=self.envelope,
        )
        first = {**self.kwargs, 'lineage': fabric.lineage, 'signature': fabric.signature}
        self.store.record_ingest_run(**first)
        before = self._events()
        for part in ('job', 'inputs', 'run'):
            altered = deepcopy(fabric.lineage)
            altered['eventTime'] = '2026-11-08T09:42:00+00:00'
            if part == 'job':
                altered['job']['name'] = 'foreign-source'
            elif part == 'inputs':
                altered['inputs'] = [{'namespace': 'unverified', 'name': 'wrong'}]
            else:
                altered['run']['runId'] = 'some-other-run'
            with self.subTest(changed=part):
                with self.assertRaisesRegex(ValueError, 'run_id_conflict'):
                    self.store.record_ingest_run(**{**first, 'lineage': altered})
                self.assertEqual(self._events(), before)

    def test_time_only_exception_does_not_accept_malformed_or_untyped_lineage(self):
        fabric = ConnectFabric(signing_secret=b'synthetic-only').seal(
            run_id='ingest-1', connector_name='mqtt-collector', envelope=self.envelope,
        )
        first = {**self.kwargs, 'lineage': fabric.lineage, 'signature': fabric.signature}
        self.store.record_ingest_run(**first)
        before = self._events()
        for candidate in ('not-a-timestamp', '2026-11-08T09:41:00', 1731058860):
            changed = deepcopy(fabric.lineage)
            changed['eventTime'] = candidate
            with self.subTest(time=candidate):
                with self.assertRaisesRegex(ValueError, 'run_id_conflict'):
                    self.store.record_ingest_run(**{**first, 'lineage': changed})
        self.assertEqual(self._events(), before)

    def test_reordered_equivalent_lineage_is_allowed_and_retains_stored_origin(self):
        self.store.record_ingest_run(**self.kwargs)
        reordered = {"nested": {"tags": ["a", "b"], "event": 17}, "site": "alpha"}
        self.store.record_ingest_run(**{**self.kwargs, "lineage": reordered})
        self.assertEqual(len(self._events()), 3)
        self.assertEqual(self.store.load_run("ingest-1").lineage, self.kwargs["lineage"])
        self.assertTrue(self.store.verify_audit_chain("ingest-1"))


if __name__ == "__main__":
    unittest.main()
