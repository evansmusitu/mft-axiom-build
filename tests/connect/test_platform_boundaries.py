import unittest
from connect.security import sign,verify,canonical_bytes
from connect.lineage import event
from connect.fabric import ConnectFabric
from connect.core import IntegrationGate
from connect.workflows import DurableWorkflowBoundary
from connect.axiom_gateway import AxiomGateway

class PlatformBoundaryTests(unittest.TestCase):
    def test_signed_canonical_payload_roundtrips(self):
        payload=canonical_bytes({"b":2,"a":1})
        signed=sign(payload,b"secret")
        self.assertTrue(verify(signed,b"secret"))
        self.assertFalse(verify(signed,b"wrong"))
    def test_fabric_emits_canonical_and_lineage_evidence(self):
        fabric=ConnectFabric(signing_secret=b"secret")
        run=fabric.ingest(run_id="r1",connector_name="Mining Adapter",domain="mining",records=[{"x":1}])
        self.assertEqual(run.envelope.contract,"musitu.connect.canonical.v1")
        self.assertEqual(run.lineage["job"]["namespace"],"musitu.connect")
        self.assertTrue(run.signature)
    def test_workflow_boundary_fails_closed_until_qualified(self):
        with self.assertRaisesRegex(RuntimeError,"WORKFLOW_ENGINE_NOT_QUALIFIED"):
            DurableWorkflowBoundary().submit("w1",lambda:"unsafe-inline")
    def test_axiom_gateway_fails_closed(self):
        with self.assertRaisesRegex(RuntimeError,"AXIOM_INTEGRATION_BLOCKED"):
            AxiomGateway(IntegrationGate()).execute({"operation":"algebra_simplify"})
    def test_lineage_event_has_required_openlineage_shape(self):
        e=event(namespace="musitu.connect",job_name="test",run_id="r")
        self.assertEqual(e["eventType"],"COMPLETE")
        self.assertIn("run",e); self.assertIn("job",e); self.assertIn("eventTime",e)

if __name__=="__main__": unittest.main()
