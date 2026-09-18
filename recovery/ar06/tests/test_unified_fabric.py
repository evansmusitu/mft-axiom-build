import unittest
from recovery.ar06.unified_fabric import ATOMIC_OPERATIONS,LANES,UnifiedToolFabric,UnboundCapabilityError,CapabilityPolicyError

CTX={'tenant_id':'t','project_id':'p','actor_id':'u','task_id':'task'}

class UnifiedFabricTests(unittest.TestCase):
    def test_exact_registry_lane_order_and_unbound_fail_closed(self):
        self.assertEqual(len(ATOMIC_OPERATIONS),74)
        self.assertEqual(len(set(ATOMIC_OPERATIONS)),74)
        self.assertEqual([order for _,order in LANES],list(range(1,11)))
        fabric=UnifiedToolFabric()
        with self.assertRaises(UnboundCapabilityError):
            fabric.invoke('arithmetic.evaluate',{'expression':'40+2'},CTX)
        with self.assertRaises(UnboundCapabilityError):
            fabric.invoke('browser.open',{'url':'https://example.test'},CTX)
        self.assertFalse(fabric.gate_state['ar06_gate_earned'])

    def test_one_invocation_receipt_contract_with_synthetic_safe_adapter(self):
        fabric=UnifiedToolFabric()
        fabric.bind('quantitative','synthetic-safe-quant',lambda cap,args,ctx:{'value':42,'synthetic_contract_test':True},production_proven=False)
        receipt=fabric.invoke('arithmetic.evaluate',{'expression':'40+2'},CTX)
        self.assertEqual(receipt['lane'],'quantitative')
        self.assertEqual(receipt['result']['value'],42)
        self.assertEqual(len(receipt['request_sha256']),64)
        self.assertEqual(len(receipt['receipt_sha256']),64)
        self.assertFalse(receipt['production_proven'])
        self.assertFalse(fabric.gate_state['ar06_gate_earned'])

    def test_external_adapter_needs_explicit_authority(self):
        fabric=UnifiedToolFabric()
        fabric.bind('research_source','synthetic-external',lambda cap,args,ctx:{'ok':True},external=True)
        with self.assertRaises(CapabilityPolicyError):
            fabric.invoke('research.search',{},CTX)
        self.assertTrue(fabric.invoke('research.search',{},dict(CTX,external_authorized=True))['result']['ok'])

if __name__=='__main__':
    unittest.main()
