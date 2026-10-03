import json
import unittest
from unittest.mock import patch
from connect.security import sign,verify,canonical_bytes
from connect.lineage import event
from connect.fabric import ConnectFabric
from connect.core import IntegrationGate
from connect.workflows import DurableWorkflowBoundary
from connect.axiom_gateway import AxiomGateway

class _FakeHttpResponse:
    def __init__(self, payload, status=200):
        self.payload=payload
        self.status=status
    def read(self):
        return json.dumps(self.payload).encode("utf-8")

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
    def test_axiom_gateway_binds_request_id_to_run_and_canonical_hash(self):
        seen=[]
        gateway=AxiomGateway(IntegrationGate(allowed=True,reason="qualified"),executor=lambda request: seen.append(request) or {"ok":True})
        result=gateway.execute({
            "operation":"arithmetic.evaluate",
            "args":{"expression":"0.54*10*0.62"},
            "run_id":"mining-q1",
            "canonical_sha256":"a"*64
        })
        self.assertEqual(result,{"ok":True})
        self.assertEqual(seen[0]["request_id"],"MUSITU-CONNECT-mining-q1-aaaaaaaaaaaaaaaa")
    def test_axiom_mcp_executor_forwards_oauth_and_connect_request_id(self):
        from connect.axiom_gateway import AxiomMcpExecutor
        response={
            "jsonrpc":"2.0",
            "id":"MUSITU-CONNECT-mining-q1-aaaaaaaaaaaaaaaa",
            "result":{
                "structuredContent":{
                    "operation":"arithmetic.evaluate",
                    "request_id":"MUSITU-CONNECT-mining-q1-aaaaaaaaaaaaaaaa",
                    "result":{"ok":True,"result":"3.348"}
                }
            }
        }
        with patch("urllib.request.urlopen",return_value=_FakeHttpResponse(response)) as call:
            executor=AxiomMcpExecutor("https://axiom.example/mcp","secret-token")
            result=executor({
                "operation":"arithmetic.evaluate",
                "args":{"expression":"0.54*10*0.62"},
                "run_id":"mining-q1",
                "canonical_sha256":"a"*64,
                "request_id":"MUSITU-CONNECT-mining-q1-aaaaaaaaaaaaaaaa"
            })
        request=call.call_args.args[0]
        body=json.loads(request.data.decode("utf-8"))
        self.assertEqual(request.get_header("Authorization"),"Bearer secret-token")
        self.assertEqual(request.get_header("X-musitu-request-id"),"MUSITU-CONNECT-mining-q1-aaaaaaaaaaaaaaaa")
        self.assertEqual(body["method"],"tools/call")
        self.assertEqual(body["params"]["name"],"musitu_axiom_execute")
        self.assertEqual(body["params"]["arguments"]["operation"],"arithmetic.evaluate")
        self.assertNotIn("secret-token",request.data.decode("utf-8"))
        self.assertEqual(result["result"]["result"],"3.348")
    def test_lineage_event_has_required_openlineage_shape(self):
        e=event(namespace="musitu.connect",job_name="test",run_id="r")
        self.assertEqual(e["eventType"],"COMPLETE")
        self.assertIn("run",e); self.assertIn("job",e); self.assertIn("eventTime",e)

if __name__=="__main__": unittest.main()
