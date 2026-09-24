from __future__ import annotations
import json
import unittest
from pathlib import Path

from multiplatform.providers.axiom import AxiomFrontierAdapter
from multiplatform.providers.anthropic import AnthropicAdapter
from multiplatform.providers.openai import OpenAIAdapter
from multiplatform.providers.contracts import Provider
from multiplatform.evaluation_runner import build

class InteropTests(unittest.TestCase):
    def test_provider_contract(self):
        self.assertEqual(Provider.ANTHROPIC.value, "anthropic")

    def test_axiom_blocks_production(self):
        with self.assertRaisesRegex(RuntimeError, "PRODUCTION_ENDPOINT_FORBIDDEN"):
            AxiomFrontierAdapter("https://mcp.mftintelligence.com/mcp")

    def test_axiom_requires_https(self):
        with self.assertRaisesRegex(RuntimeError, "FRONTIER_ENDPOINT_MUST_BE_HTTPS"):
            AxiomFrontierAdapter("http://staging.invalid/mcp")

    def test_openai_mcp_request_shape(self):
        payload=OpenAIAdapter(model="test-model").build_responses_mcp_request("sealed case","https://staging.invalid/mcp")
        self.assertEqual(payload["tools"][0]["type"],"mcp")
        self.assertEqual(payload["tools"][0]["server_label"],"axiom-frontier")

    def test_anthropic_request_shape(self):
        payload=AnthropicAdapter(model="test-model").build_mcp_request("sealed case","https://staging.invalid/mcp",["tool_a"])
        self.assertEqual(payload["mcp_servers"][0]["type"],"url")
        self.assertEqual(payload["tools"][0]["type"],"mcp_toolset")

    def test_case_manifest(self):
        manifest=build("fake","fake",[{"case_id":"Q01","passed":True,"output":372}],"multiplatform/cases/cases.jsonl")
        self.assertEqual(len(manifest["caseset_sha256"]),64)
        self.assertEqual(manifest["passed"],1)

    def test_mcpb_manifest_is_json(self):
        data=json.loads(Path("multiplatform/anthropic/mcpb/manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(data["manifest_version"],"0.3")
        self.assertEqual(data["server"]["type"],"node")
        self.assertEqual(data["server"]["mcp_config"]["command"],"node")

if __name__=="__main__":
    unittest.main()
