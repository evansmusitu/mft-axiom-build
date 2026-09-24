from __future__ import annotations
import unittest
from multiplatform.providers.axiom import AxiomFrontierAdapter
from multiplatform.providers.anthropic import AnthropicAdapter
from multiplatform.providers.contracts import Provider
from multiplatform.evaluation_runner import build
class InteropTests(unittest.TestCase):
    def test_provider_contract(self): self.assertEqual(Provider.ANTHROPIC.value,"anthropic")
    def test_axiom_blocks_production(self):
        with self.assertRaisesRegex(RuntimeError,"PRODUCTION_ENDPOINT_FORBIDDEN"): AxiomFrontierAdapter("https://mcp.mftintelligence.com/mcp")
    def test_axiom_requires_https(self):
        with self.assertRaisesRegex(RuntimeError,"FRONTIER_ENDPOINT_MUST_BE_HTTPS"): AxiomFrontierAdapter("http://staging.invalid/mcp")
    def test_anthropic_request_shape(self):
        payload=AnthropicAdapter(model="test-model").build_mcp_request("https://staging.invalid/mcp",["tool_a"])
        self.assertEqual(payload["mcp_servers"][0]["type"],"url"); self.assertEqual(payload["tools"][0]["type"],"mcp_toolset")
    def test_case_manifest(self):
        manifest=build("fake","fake",[{"case_id":"Q01","passed":True,"output":372}],"multiplatform/cases/cases.jsonl")
        self.assertEqual(len(manifest["caseset_sha256"]),64); self.assertEqual(manifest["passed"],1)
if __name__=="__main__": unittest.main()
