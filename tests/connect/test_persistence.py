import sqlite3
import tempfile
import unittest
from pathlib import Path

from connect.core import CanonicalEnvelope
from connect.persistence import RunStore


class RunStoreTests(unittest.TestCase):
    def _envelope(self):
        return CanonicalEnvelope(
            contract="musitu.connect.canonical.v1",
            domain="mining",
            records=({
                "hazard": "Ground collapse",
                "exposure": 0.54,
                "severity": 10.0,
                "likelihood": 0.62,
                "cost": 18000.0,
                "benefit": 0.34,
            },),
            source="mining-adapter",
            provenance="normalized",
        )

    def test_run_survives_process_reopen_and_replays_exact_canonical_payload(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/"runs.sqlite3"
            store=RunStore(path)
            created=store.record_run(
                run_id="mining-r1",
                connector_name="opcua-stope-17",
                protocol="opcua",
                envelope=self._envelope(),
                lineage={"run":{"runId":"mining-r1"}},
                signature="abc123",
            )
            store.close()

            reopened=RunStore(path)
            self.addCleanup(reopened.close)
            loaded=reopened.load_run("mining-r1")
            self.assertEqual(loaded.canonical_sha256, created.canonical_sha256)
            self.assertEqual(loaded.envelope, self._envelope())
            self.assertEqual(loaded.connector_name, "opcua-stope-17")
            self.assertEqual(loaded.protocol, "opcua")
            self.assertEqual(reopened.audit_events("mining-r1")[0].event_type, "RUN_RECORDED")
            self.assertTrue(reopened.verify_audit_chain("mining-r1"))


    def test_ingest_persistence_is_atomic_and_preserves_exact_audit_chain(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/"runs.sqlite3"
            store=RunStore(path)
            self.addCleanup(store.close)
            stored=store.record_ingest_run(
                run_id="mining-fast-r1",
                connector_name="mqtt-face-1",
                protocol="mqtt",
                envelope=self._envelope(),
                lineage={"run":{"runId":"mining-fast-r1"}},
                signature="sig",
            )
            self.assertEqual(stored.run_id,"mining-fast-r1")
            events=store.audit_events("mining-fast-r1")
            self.assertEqual(
                [event.event_type for event in events],
                ["RUN_RECORDED","INGEST_COMPLETED"],
            )
            self.assertEqual(events[1].payload["canonical_sha256"],stored.canonical_sha256)
            self.assertEqual(events[1].payload["record_count"],1)
            self.assertEqual(events[1].payload["protocol"],"mqtt")
            self.assertTrue(store.verify_audit_chain("mining-fast-r1"))

            store.close()
            reopened=RunStore(path)
            self.addCleanup(reopened.close)
            loaded=reopened.load_run("mining-fast-r1")
            self.assertEqual(loaded.envelope,self._envelope())
            self.assertTrue(reopened.verify_audit_chain("mining-fast-r1"))

    def test_idempotent_ingest_keeps_single_run_record_and_appends_completion(self):
        with tempfile.TemporaryDirectory() as directory:
            store=RunStore(Path(directory)/"runs.sqlite3")
            self.addCleanup(store.close)
            for _ in range(2):
                store.record_ingest_run(
                    run_id="mining-fast-r1",
                    connector_name="mqtt-face-1",
                    protocol="mqtt",
                    envelope=self._envelope(),
                    lineage={},
                    signature="sig",
                )
            events=store.audit_events("mining-fast-r1")
            self.assertEqual(
                [event.event_type for event in events],
                ["RUN_RECORDED","INGEST_COMPLETED","INGEST_COMPLETED"],
            )
            self.assertTrue(store.verify_audit_chain("mining-fast-r1"))

    def test_same_run_id_is_idempotent_only_for_identical_canonical_content(self):
        with tempfile.TemporaryDirectory() as directory:
            store=RunStore(Path(directory)/"runs.sqlite3")
            self.addCleanup(store.close)
            first=store.record_run(
                run_id="mining-r1", connector_name="mqtt-face-1", protocol="mqtt",
                envelope=self._envelope(), lineage={}, signature="sig",
            )
            second=store.record_run(
                run_id="mining-r1", connector_name="mqtt-face-1", protocol="mqtt",
                envelope=self._envelope(), lineage={}, signature="sig",
            )
            self.assertEqual(second.canonical_sha256, first.canonical_sha256)
            changed=CanonicalEnvelope(
                contract=self._envelope().contract,
                domain="mining",
                records=({**self._envelope().records[0], "severity": 9.0},),
                source=self._envelope().source,
                provenance=self._envelope().provenance,
            )
            with self.assertRaisesRegex(ValueError, "run_id_conflict"):
                store.record_run(
                    run_id="mining-r1", connector_name="mqtt-face-1", protocol="mqtt",
                    envelope=changed, lineage={}, signature="different",
                )

    def test_store_can_be_used_by_protocol_worker_thread(self):
        from concurrent.futures import ThreadPoolExecutor

        with tempfile.TemporaryDirectory() as directory:
            store=RunStore(Path(directory)/"runs.sqlite3")
            self.addCleanup(store.close)

            def write_from_protocol_thread():
                return store.record_run(
                    run_id="mining-threaded",
                    connector_name="mqtt-broker",
                    protocol="mqtt",
                    envelope=self._envelope(),
                    lineage={"run":{"runId":"mining-threaded"}},
                    signature="sig",
                )

            with ThreadPoolExecutor(max_workers=1) as executor:
                created=executor.submit(write_from_protocol_thread).result(timeout=5)

            self.assertEqual(created.run_id, "mining-threaded")
            self.assertTrue(store.verify_audit_chain("mining-threaded"))

    def test_audit_chain_detects_database_tampering(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/"runs.sqlite3"
            store=RunStore(path)
            store.record_run(
                run_id="mining-r1", connector_name="mqtt-face-1", protocol="mqtt",
                envelope=self._envelope(), lineage={}, signature="sig",
            )
            store.append_audit_event("mining-r1", "PLAN_COMPUTED", {"spend": 18000})
            self.assertTrue(store.verify_audit_chain("mining-r1"))
            store.close()
            connection=sqlite3.connect(path)
            try:
                connection.execute(
                    "UPDATE run_audit SET payload_json=? WHERE run_id=? AND event_type=?",
                    ('{"spend":1}', "mining-r1", "PLAN_COMPUTED"),
                )
                connection.commit()
            finally:
                connection.close()
            reopened=RunStore(path)
            self.addCleanup(reopened.close)
            self.assertFalse(reopened.verify_audit_chain("mining-r1"))


if __name__ == "__main__":
    unittest.main()
