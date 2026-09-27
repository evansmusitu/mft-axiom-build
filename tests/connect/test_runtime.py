import unittest
from connect.runtime import ConnectRuntime
from connect.adapters import AdapterCatalog, AdapterContract
from connect.mining import normalize_mining_rows
from connect.fabric import ConnectFabric
from connect.core import IntegrationGate
from connect.axiom_gateway import AxiomGateway

class RuntimeTests(unittest.TestCase):
    def test_domain_adapter_runtime_preserves_gate_and_lineage(self):
        catalog=AdapterCatalog()
        catalog.register(AdapterContract(name="Mining Adapter",domain="mining",version="1.0.0",normalize=normalize_mining_rows))
        runtime=ConnectRuntime(catalog=catalog,fabric=ConnectFabric(signing_secret=b"secret"),axiom=AxiomGateway(IntegrationGate()))
        run=runtime.ingest(run_id="r1",connector_name="mining-source",domain="mining",adapter_name="Mining Adapter",records=[{"hazard":"Ground collapse","exposure":.5,"severity":10,"likelihood":.4,"cost":1000,"benefit":.1}])
        self.assertEqual(run.canonical.contract,"musitu.connect.canonical.v1")
        self.assertEqual(run.fabric.lineage["job"]["name"],"mining-source")
        with self.assertRaisesRegex(RuntimeError,"AXIOM_INTEGRATION_BLOCKED"):
            runtime.execute_downstream({"operation":"optimization.linear_program"})
if __name__=="__main__": unittest.main()
