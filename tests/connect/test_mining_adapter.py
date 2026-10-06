import asyncio
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
from connect.persistence import RunStore
from connect.runtime import ConnectRuntime
from connect.workflows import DurableWorkflowBoundary


ROW={
    "hazard":"Ground collapse",
    "exposure":0.54,
    "severity":10,
    "likelihood":0.62,
    "cost":18000,
    "benefit":0.34,
}


class _FakeMqttTransport:
    def __init__(self, payload: bytes):
        self.payload=payload
        self.topics=[]
    def receive(self, topic: str, timeout: float=5.0) -> bytes:
        self.topics.append((topic,timeout))
        return self.payload


class _FakeOpcUaTransport:
    def __init__(self, values):
        self.values=values
        self.nodes=[]
    async def read(self, node_id: str):
        self.nodes.append(node_id)
        return self.values[node_id]


class _FakeOpcUaBatchTransport:
    def __init__(self, values):
        self.values=values
        self.calls=[]
    async def read_many(self, node_ids):
        self.calls.append(tuple(node_ids))
        return [self.values[node_id] for node_id in node_ids]
    async def read(self, node_id):
        raise AssertionError("batch-capable transport must not open one session per node")


class MiningAdapterServiceTests(unittest.TestCase):
    def _service(self, path: Path, *, executor=None, workflow_calls=None):
        catalog=AdapterCatalog()
        catalog.register(AdapterContract(
            name="Mining Adapter", domain="mining", version="1.0.0",
            normalize=normalize_mining_rows,
        ))
        runtime=ConnectRuntime(
            catalog=catalog,
            fabric=ConnectFabric(signing_secret=b"test-signing-secret"),
            axiom=AxiomGateway(
                IntegrationGate(allowed=executor is not None, reason="test"),
                executor=executor,
            ),
        )
        store=RunStore(path)
        self.addCleanup(store.close)
        calls=workflow_calls if workflow_calls is not None else []
        workflow=DurableWorkflowBoundary(
            qualified=True,
            executor=lambda workflow_id, action: calls.append(workflow_id) or action(),
        )
        return MiningAdapterService(runtime=runtime, store=store, workflow=workflow)


    def test_ingestion_is_submitted_through_durable_workflow_boundary(self):
        with tempfile.TemporaryDirectory() as directory:
            calls=[]
            service=self._service(Path(directory)/"runs.sqlite3", workflow_calls=calls)
            service.ingest_mqtt_payload(
                run_id="workflow-r1", connector_name="broker",
                payload=json.dumps({"rows":[ROW]}).encode(),
            )
            self.assertEqual(calls,["mining-ingest:workflow-r1"])
            self.assertEqual(service.store.load_run("workflow-r1").protocol,"mqtt")

    def test_mqtt_ingestion_normalizes_persists_plans_and_replays(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/"runs.sqlite3"
            service=self._service(path)
            transport=_FakeMqttTransport(json.dumps({"rows":[ROW]}).encode())
            run=service.ingest_mqtt(
                run_id="mqtt-r1", connector_name="crusher-broker",
                transport=transport, topic="mine/site-a/hazards",
            )
            self.assertEqual(run.canonical.records[0]["severity"], 10.0)
            self.assertEqual(transport.topics[0][0], "mine/site-a/hazards")
            plan=service.plan("mqtt-r1", budget=18000)
            self.assertEqual(plan.selected, ("Ground collapse",))
            replay=service.replay("mqtt-r1")
            self.assertEqual(replay.envelope.records, run.canonical.records)
            self.assertTrue(replay.verify_signature(b"test-signing-secret"))
            event_types=[item.event_type for item in service.store.audit_events("mqtt-r1")]
            self.assertEqual(event_types, ["RUN_RECORDED","INGEST_COMPLETED","PLAN_COMPUTED","REPLAY_VERIFIED"])

    def test_mqtt_payload_has_bounded_size_and_strict_shape(self):
        with tempfile.TemporaryDirectory() as directory:
            service=self._service(Path(directory)/"runs.sqlite3")
            with self.assertRaisesRegex(ValueError,"mqtt_payload_too_large"):
                service.ingest_mqtt_payload(
                    run_id="mqtt-large", connector_name="broker", payload=b"x"*(1024*1024+1),
                )
            with self.assertRaisesRegex(ValueError,"mqtt_payload_invalid"):
                service.ingest_mqtt_payload(
                    run_id="mqtt-bad", connector_name="broker", payload=b'{"not_rows":true}',
                )

    def test_opcua_ingestion_reads_explicit_node_map_into_canonical_record(self):
        with tempfile.TemporaryDirectory() as directory:
            service=self._service(Path(directory)/"runs.sqlite3")
            values={f"ns=2;s={key}":value for key,value in ROW.items()}
            transport=_FakeOpcUaTransport(values)
            node_map={key:f"ns=2;s={key}" for key in ROW}
            run=asyncio.run(service.ingest_opcua(
                run_id="opc-r1", connector_name="stope-17",
                transport=transport, record_node_maps=[node_map],
            ))
            self.assertEqual(run.canonical.records[0]["hazard"],"Ground collapse")
            self.assertEqual(set(transport.nodes),set(node_map.values()))
            stored=service.store.load_run("opc-r1")
            self.assertEqual(stored.protocol,"opcua")


    def test_opcua_ingestion_uses_one_batch_session_per_record_when_available(self):
        with tempfile.TemporaryDirectory() as directory:
            service=self._service(Path(directory)/"runs.sqlite3")
            values={f"ns=2;s={key}":value for key,value in ROW.items()}
            transport=_FakeOpcUaBatchTransport(values)
            node_map={key:f"ns=2;s={key}" for key in ROW}
            run=asyncio.run(service.ingest_opcua(
                run_id="opc-batch", connector_name="stope-17",
                transport=transport, record_node_maps=[node_map],
            ))
            self.assertEqual(run.canonical.records[0]["severity"],10.0)
            self.assertEqual(len(transport.calls),1)
            self.assertEqual(set(transport.calls[0]),set(node_map.values()))

    def test_opcua_ingestion_batches_all_records_into_one_transport_read(self):
        with tempfile.TemporaryDirectory() as directory:
            service=self._service(Path(directory)/"runs.sqlite3")
            rows=[
                dict(ROW, hazard="Ground collapse"),
                dict(ROW, hazard="Vehicle collision", exposure=0.31, severity=8, likelihood=0.27),
            ]
            values={}
            maps=[]
            for index,row in enumerate(rows):
                mapping={}
                for key,value in row.items():
                    node_id=f"ns=2;s=r{index}.{key}"
                    mapping[key]=node_id
                    values[node_id]=value
                maps.append(mapping)
            transport=_FakeOpcUaBatchTransport(values)
            run=asyncio.run(service.ingest_opcua(
                run_id="opc-multi-batch",connector_name="field-opcua",
                transport=transport,record_node_maps=maps,
            ))
            self.assertEqual(len(run.canonical.records),2)
            self.assertEqual(len(transport.calls),1)
            self.assertEqual(len(transport.calls[0]),len(ROW)*2)

    def test_axiom_execution_from_replayed_run_is_audited_without_credentials(self):
        seen=[]
        def executor(request):
            seen.append(request)
            return {"ok":True,"request_id":request["request_id"],"result":{"result":"3.348"}}
        with tempfile.TemporaryDirectory() as directory:
            service=self._service(Path(directory)/"runs.sqlite3", executor=executor)
            service.ingest_mqtt_payload(
                run_id="risk-r1", connector_name="broker",
                payload=json.dumps({"rows":[ROW]}).encode(),
            )
            result=service.execute_risk("risk-r1")
            self.assertEqual(result["result"]["result"],"3.348")
            self.assertEqual(seen[0]["run_id"],"risk-r1")
            events=service.store.audit_events("risk-r1")
            self.assertEqual(events[-1].event_type,"AXIOM_EXECUTED")
            serialized=json.dumps(events[-1].payload)
            self.assertNotIn("authorization",serialized.lower())
            self.assertNotIn("bearer",serialized.lower())


if __name__ == "__main__":
    unittest.main()
