import json
import tempfile
import unittest
from pathlib import Path

from connect.adapters import AdapterCatalog, AdapterContract
from connect.axiom_gateway import AxiomGateway
from connect.core import IntegrationGate
from connect.fabric import ConnectFabric
from connect.mining import normalize_mining_rows
from connect.mining_adapter import MiningAdapterService
from connect.mining_telemetry import MINING_TELEMETRY_SENSORS, normalize_mining_telemetry_rows
from connect.persistence import RunStore
from connect.runtime import ConnectRuntime
from connect.workflows import DurableWorkflowBoundary


def telemetry_row():
    row={"event_time":"2014-03-02T00:00:00Z"}
    for index,name in enumerate(MINING_TELEMETRY_SENSORS):
        row[name]=float(index)
    row["MM263"]=0.7
    row["MM264"]=0.8
    row["MM256"]=0.9
    row["F_SIDE"]=0.5
    return row


class MiningTelemetryTests(unittest.TestCase):
    def _service(self, path: Path):
        catalog=AdapterCatalog()
        catalog.register(AdapterContract(
            name="Mining Adapter",domain="mining",version="1.0.0",
            normalize=normalize_mining_rows,
        ))
        catalog.register(AdapterContract(
            name="Mining Telemetry Adapter",domain="mining_telemetry",version="1.0.0",
            normalize=normalize_mining_telemetry_rows,
        ))
        runtime=ConnectRuntime(
            catalog=catalog,
            fabric=ConnectFabric(signing_secret=b"telemetry-test-secret"),
            axiom=AxiomGateway(IntegrationGate()),
        )
        store=RunStore(path)
        self.addCleanup(store.close)
        return MiningAdapterService(
            runtime=runtime,
            store=store,
            telemetry_adapter_name="Mining Telemetry Adapter",
            workflow=DurableWorkflowBoundary(
                qualified=True,
                executor=lambda _workflow_id, action: action(),
            ),
        )

    def test_normalizer_preserves_all_28_real_sensor_channels(self):
        envelope=normalize_mining_telemetry_rows([telemetry_row()])
        self.assertEqual(envelope.contract,"musitu.connect.mining.telemetry.v1")
        self.assertEqual(envelope.domain,"mining_telemetry")
        self.assertEqual(len(MINING_TELEMETRY_SENSORS),28)
        record=envelope.records[0]
        self.assertEqual(set(record),{"event_time",*MINING_TELEMETRY_SENSORS})
        self.assertEqual(record["MM263"],0.7)
        self.assertEqual(record["F_SIDE"],0.5)

    def test_normalizer_preserves_real_outliers_but_rejects_nonfinite_values(self):
        row=telemetry_row()
        row["MM263"]=30.0
        envelope=normalize_mining_telemetry_rows([row])
        self.assertEqual(envelope.records[0]["MM263"],30.0)

        bad=telemetry_row()
        bad["MM263"]=float("nan")
        with self.assertRaisesRegex(ValueError,"telemetry_value_not_finite:MM263"):
            normalize_mining_telemetry_rows([bad])

    def test_normalizer_requires_timezone_and_exact_sensor_schema(self):
        missing=telemetry_row()
        missing.pop("AN311")
        with self.assertRaisesRegex(ValueError,"telemetry_missing_fields:AN311"):
            normalize_mining_telemetry_rows([missing])

        unknown=telemetry_row()
        unknown["UNKNOWN"]=1
        with self.assertRaisesRegex(ValueError,"telemetry_unknown_fields:UNKNOWN"):
            normalize_mining_telemetry_rows([unknown])

        naive=telemetry_row()
        naive["event_time"]="2014-03-02T00:00:00"
        with self.assertRaisesRegex(ValueError,"telemetry_event_time_timezone_required"):
            normalize_mining_telemetry_rows([naive])

    def test_mqtt_telemetry_ingest_is_signed_durable_and_replayable(self):
        with tempfile.TemporaryDirectory() as directory:
            service=self._service(Path(directory)/"runs.sqlite3")
            run=service.ingest_telemetry_payload(
                run_id="telemetry-r1",
                connector_name="polish-longwall-public-telemetry",
                payload=json.dumps({"rows":[telemetry_row()]}).encode(),
            )
            self.assertEqual(run.canonical.domain,"mining_telemetry")
            stored=service.store.load_run("telemetry-r1")
            self.assertEqual(stored.protocol,"mqtt")
            self.assertEqual(stored.canonical_sha256,run.fabric.canonical_sha256)
            replay=service.replay("telemetry-r1")
            self.assertEqual(replay.envelope,run.canonical)
            self.assertTrue(replay.verify_signature(b"telemetry-test-secret"))
            self.assertTrue(service.store.verify_audit_chain("telemetry-r1"))

    def test_risk_planning_remains_blocked_for_telemetry_domain(self):
        with tempfile.TemporaryDirectory() as directory:
            service=self._service(Path(directory)/"runs.sqlite3")
            service.ingest_telemetry_payload(
                run_id="telemetry-r1",
                connector_name="polish-longwall-public-telemetry",
                payload=json.dumps({"rows":[telemetry_row()]}).encode(),
            )
            with self.assertRaisesRegex(ValueError,"domain_mismatch"):
                service.plan("telemetry-r1",budget=1000)


if __name__=="__main__":
    unittest.main()
