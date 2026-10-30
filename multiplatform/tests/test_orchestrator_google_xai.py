import unittest
from multiplatform.orchestrator import AxiomFrontierOrchestrator, ProviderBinding, load_cases
from multiplatform.providers.contracts import Provider, InvocationResult
from frontier_v5.runtime.provider_fallback import ProviderDescriptor
from frontier_v5.runtime.circuit_breakers import CircuitBreakerFabric, CircuitBreakerPolicy

class F:
    def __init__(self,pid):
        self.provider=Provider(pid); self.calls=0
        self.descriptor=ProviderDescriptor(pid,frozenset({"*"}),frozenset({"text"}),frozenset(),frozenset({"*"}),frozenset({"successful_execution"}),1.0,1000,1.0,True)
    def invoke(self,inv): raise AssertionError("baseline path was selected")
    def invoke_with_frontier_mcp(self,inv,url):
        self.calls+=1
        return InvocationResult(self.provider,inv.case_id,"ok","372",latency_ms=5,usage={"total_tokens":10})

class TestControllerCoverage(unittest.TestCase):
    def test_google_and_xai_are_controller_eligible(self):
        policy=CircuitBreakerPolicy(2,60,30,10,1,10,20,5,20)
        g,x=F("google"),F("xai")
        o=AxiomFrontierOrchestrator(
            {"google":ProviderBinding(g,g.descriptor),"xai":ProviderBinding(x,x.descriptor)},
            CircuitBreakerFabric({"google":policy,"xai":policy}),
        )
        case=load_cases("multiplatform/cases/cases.jsonl")[0]
        r=o.run_case(case,preferred_provider="google",min_quality=.8,mcp_url="https://staging.example/mcp")
        self.assertEqual(r["provider"],"google")
        self.assertEqual(g.calls,1)
        self.assertEqual(x.calls,0)

if __name__=="__main__":
    unittest.main()
