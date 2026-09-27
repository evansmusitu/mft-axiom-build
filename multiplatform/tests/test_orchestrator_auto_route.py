import unittest
from multiplatform.orchestrator import AxiomFrontierOrchestrator, ProviderBinding, load_cases
from multiplatform.providers.contracts import Provider, InvocationResult
from frontier_v5.runtime.provider_fallback import ProviderDescriptor
from frontier_v5.runtime.circuit_breakers import CircuitBreakerFabric, CircuitBreakerPolicy

class F:
    def __init__(self,pid,quality,latency):
        self.provider=Provider(pid); self.calls=0
        self.descriptor=ProviderDescriptor(pid,frozenset({"*"}),frozenset({"text"}),frozenset(),frozenset({"*"}),frozenset({"successful_execution"}),quality,latency,1.0,True)
    def invoke(self,inv):
        self.calls+=1
        return InvocationResult(self.provider,inv.case_id,"ok","372",latency_ms=5,usage={"total_tokens":10})

class TestAutomaticRouting(unittest.TestCase):
    def test_axiom_selects_highest_quality_eligible_provider(self):
        p=__import__("frontier_v5.runtime.circuit_breakers",fromlist=["CircuitBreakerPolicy"])
        policy=p.CircuitBreakerPolicy(2,60,30,10,1,10,20,5,20)
        a=F("openai",0.8,100); b=F("google",0.95,200)
        o=AxiomFrontierOrchestrator(
            {"openai":ProviderBinding(a,a.descriptor),"google":ProviderBinding(b,b.descriptor)},
            CircuitBreakerFabric({"openai":policy,"google":policy}),
        )
        case=load_cases("multiplatform/cases/cases.jsonl")[0]
        r=o.run_case(case,min_quality=.75)
        self.assertEqual(r["provider"],"google")
        self.assertEqual(r["routing_feedback"]["routing_basis"],"quality_floor_then_latency_then_cost")
        self.assertEqual(b.calls,1)
        self.assertEqual(a.calls,0)

if __name__=="__main__":
    unittest.main()
