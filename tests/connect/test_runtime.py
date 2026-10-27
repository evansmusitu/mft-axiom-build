import unittest
from connect.runtime import ConnectRuntime
from connect.adapters import AdapterCatalog, AdapterContract
from connect.mining import normalize_mining_rows
from connect.fabric import ConnectFabric
from connect.core import IntegrationGate
from connect.axiom_gateway import AxiomGateway
from connect.security import SignedEnvelope, canonical_bytes, verify

class RuntimeTests(unittest.TestCase):
    def _runtime(self, *, allowed=False, executor=None):
        catalog=AdapterCatalog()
        catalog.register(AdapterContract(name="Mining Adapter",domain="mining",version="1.0.0",normalize=normalize_mining_rows))
        return ConnectRuntime(
            catalog=catalog,
            fabric=ConnectFabric(signing_secret=b"secret"),
            axiom=AxiomGateway(IntegrationGate(allowed=allowed,reason="qualified" if allowed else "blocked"),executor=executor)
        )

    def test_domain_adapter_runtime_preserves_gate_and_lineage(self):
        runtime=self._runtime()
        run=runtime.ingest(run_id="r1",connector_name="mining-source",domain="mining",adapter_name="Mining Adapter",records=[{"hazard":"Ground collapse","exposure":.5,"severity":10,"likelihood":.4,"cost":1000,"benefit":.1}])
        self.assertEqual(run.canonical.contract,"musitu.connect.canonical.v1")
        self.assertEqual(run.fabric.lineage["job"]["name"],"mining-source")
        with self.assertRaisesRegex(RuntimeError,"AXIOM_INTEGRATION_BLOCKED"):
            runtime.execute_downstream({"operation":"optimization.linear_program"})


    def test_fabric_signature_covers_normalized_canonical_records(self):
        runtime=self._runtime()
        run=runtime.ingest(
            run_id="normalized-signature",
            connector_name="mqtt-face-1",
            domain="mining",
            adapter_name="Mining Adapter",
            records=[{
                "hazard":"Ground collapse",
                "exposure":"0.54",
                "severity":"10",
                "likelihood":"0.62",
                "cost":"18000",
                "benefit":"0.34",
            }],
        )
        payload=canonical_bytes({
            "contract":run.canonical.contract,
            "domain":run.canonical.domain,
            "records":[dict(item) for item in run.canonical.records],
            "run_id":run.fabric.run_id,
        })
        self.assertTrue(verify(SignedEnvelope(payload,run.fabric.signature), b"secret"))

    def test_mining_risk_execution_derives_axiom_request_from_canonical_run(self):
        seen=[]
        runtime=self._runtime(allowed=True,executor=lambda request: seen.append(request) or {"result":{"result":"3.348"}})
        run=runtime.ingest(
            run_id="mining-q1",
            connector_name="opcua-stope-17",
            domain="mining",
            adapter_name="Mining Adapter",
            records=[{"hazard":"Ground collapse","exposure":.54,"severity":10,"likelihood":.62,"cost":1000,"benefit":.1}]
        )
        result=runtime.execute_mining_risk(run)
        self.assertEqual(result["result"]["result"],"3.348")
        request=seen[0]
        self.assertEqual(request["operation"],"arithmetic.evaluate")
        self.assertEqual(request["args"]["expression"],"0.54*10.0*0.62")
        self.assertEqual(request["run_id"],"mining-q1")
        self.assertEqual(len(request["canonical_sha256"]),64)
        self.assertEqual(request["request_id"],"MUSITU-CONNECT-mining-q1-"+request["canonical_sha256"][:16])

if __name__=="__main__": unittest.main()
