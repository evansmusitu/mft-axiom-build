import unittest
from multiplatform.providers.contracts import Invocation, Provider
from multiplatform.providers.google import GoogleGeminiAdapter
from multiplatform.providers.xai import XAIAdapter

class TestProviderExpansion(unittest.TestCase):
    def test_google_contract(self):
        inv=Invocation("Q01",Provider.GOOGLE,None,{},metadata={"prompt":"hello"})
        body=GoogleGeminiAdapter(model="test-model")._payload(inv,"https://staging.example/mcp")
        self.assertEqual(body["tools"][0]["type"],"mcp_server")
        self.assertEqual(body["tools"][0]["name"],"axiom_frontier")

    def test_xai_contract(self):
        inv=Invocation("Q01",Provider.XAI,None,{},metadata={"prompt":"hello"})
        body=XAIAdapter(model="test-model")._payload(inv,"https://staging.example/mcp")
        self.assertEqual(body["tools"][0]["type"],"mcp")
        self.assertEqual(body["tools"][0]["server_label"],"axiom_frontier")

if __name__=="__main__":
    unittest.main()
