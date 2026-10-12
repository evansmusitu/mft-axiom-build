import unittest
from b14_live_agents import authorize_claim, Ledger, Forbidden

class B14GatewayTests(unittest.TestCase):
 def setUp(self):
  self.g={'schema':'axiom.trackb14.single-run.s2.v1','account_id':'93f395f5121954671f92fffa453d6b61',
          'model':'@cf/zai-org/glm-4.7-flash','utc_day':'2026-10-12','expires_at':2000,
          'no_production':True,'no_paid_plan_evidence':True,'max_calls_per_worker':8,
          'max_total_calls':16,'max_output_tokens':384,'workloads':['agent-a','agent-b']}
 def test_identity_and_short_lived(self):self.assertTrue(authorize_claim(self.g,when=1900,day='2026-10-12'))
 def test_expired_denied(self):
  with self.assertRaises(Forbidden):authorize_claim(self.g,when=2000,day='2026-10-12')
 def test_wrong_day_denied(self):
  with self.assertRaises(Forbidden):authorize_claim(self.g,when=1900,day='2026-10-13')
 def test_paid_cannot_sneak_in(self):
  self.g['no_paid_plan_evidence']=False
  with self.assertRaises(Forbidden):authorize_claim(self.g,when=1900,day='2026-10-12')
 def test_widened_budget_denied(self):
  self.g['max_total_calls']=17
  with self.assertRaises(Forbidden):authorize_claim(self.g,when=1900,day='2026-10-12')
 def test_per_worker_total_budget_enforced(self):
  l=Ledger()
  for i in range(8):self.assertEqual(l.admit('agent-a',self.g),i+1)
  with self.assertRaises(Forbidden):l.admit('agent-a',self.g)
  for i in range(8):self.assertEqual(l.admit('agent-b',self.g),i+1)
  with self.assertRaises(Forbidden):l.admit('agent-b',self.g)
  self.assertEqual(l.global_count,16)
 def test_invalid_worker_denied(self):
  with self.assertRaises(Forbidden):Ledger().admit('agent-c',self.g)
 def test_unknown_or_missing_restriction_denied(self):
  del self.g['no_production']
  with self.assertRaises(Forbidden):authorize_claim(self.g,when=1900,day='2026-10-12')
if __name__=='__main__':unittest.main()