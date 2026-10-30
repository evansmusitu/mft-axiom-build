import unittest
from multiplatform.orchestrator import AxiomFrontierOrchestrator, ProviderBinding, load_cases
from multiplatform.providers.contracts import Provider, InvocationResult
from frontier_v5.runtime.provider_fallback import ProviderDescriptor
from frontier_v5.runtime.circuit_breakers import CircuitBreakerFabric

class M:
    def __init__(self, pid):
        self.provider=Provider(pid); self.calls=0
        self.descriptor=ProviderDescriptor(pid,frozenset({"*"}),frozenset({"text"}),frozenset(),frozenset({"*"}),frozenset({"successful_execution"}),1.0,1000,1.0,True)
    def invoke(self, invocation):
        raise AssertionError("unexpected baseline invocation")
    def invoke_with_frontier_mcp(self, invocation, url):
        self.calls += 1
        return InvocationResult(self.provider, invocation.case_id, "ok", "372", latency_ms=5, usage={"total_tokens":10})

class TestMCPOrchestration(unittest.TestCase):
    def test_supported_adapter_uses_isolated_mcp_surface(self):
        a,b=M("openai"),M("anthropic")
        o=AxiomFrontierOrchestrator(
            {"openai":ProviderBinding(a,a.descriptor),"anthropic":ProviderBinding(b,b.descriptor)},
            CircuitBreakerFabric({
                "openai":__import__("frontier_v5.runtime.circuit_breakers",fromlist=["CircuitBreakerPolicy"]).CircuitBreakerPolicy(2,60,30,10,1,10,20,5,20),
                "anthropic":__import__("frontier_v5.runtime.circuit_breakers",fromlist=["CircuitBreakerPolicy"]).CircuitBreakerPolicy(2,60,30,10,1,10,20,5,20),
            })
        )
        case=load_cases("multiplatform/cases/cases.jsonl")[0]
        r=o.run_case(case,preferred_provider="openai",min_quality=.8,mcp_url="https://staging.example/mcp")
        self.assertEqual(r["status"],"accepted")
        self.assertEqual(r["provider"],"openai")
        self.assertEqual(a.calls,1)
        self.assertEqual(b.calls,0)

if __name__=="__main__":
    unittest.main()
