import copy
import unittest
import pr77_synthetic_crosscustomer_denials_20261108 as a

def fakes(tamper=None):
 history=[]
 first={'seen':0}
 catalogue=[{'type':'table','name':'synthetic_%02d'%i} for i in range(31)]
 def fetch(kind):
  history.append(kind)
  if kind=='target_metadata':return {'uuid':a.TARGET,'name':'axiom-pr77-synthetic-only-20261108'}
  if kind=='preserved_metadata':return {'uuid':a.PRESERVED,'name':'axiom-disposable-dr-target-20261108'}
  if kind=='catalog':
   first['seen']+=1
   if first['seen']==2 and tamper=='schema_drift':return catalogue[:-1]
   return catalogue
  if kind=='counts':
   if tamper=='row_drift' and first['seen']==2:
    result=copy.deepcopy(a.EXPECTED);result['token_link_b']=1
    return [result]
   return [copy.deepcopy(a.EXPECTED)]
  if kind in ('token','code'):
   if tamper==kind+'_accepted':return 200,{'success':True,'result':[{'success':True}]}
   if tamper==kind+'_network':return 503,{'success':False,'errors':[]}
   return 200,{'success':False,'errors':[{'message':a.ATTACKS[kind][1]}]}
  raise AssertionError('Unknown method: '+kind)
 return fetch,history

class SyntheticIsolation(unittest.TestCase):
 def test_two_reviewed_trigger_denials_and_zero_residue(self):
  fetch,calls=fakes()
  out=a.observe(fetch)
  self.assertEqual(out['status'],'TWO_CROSSCUSTOMER_PR77_TRIGGER_DENIALS_NO_RESIDUE_PASS')
  self.assertEqual(out['confirmed_denial_types'],['token','code'])
  self.assertEqual(calls,['target_metadata','preserved_metadata','catalog','counts','token','code','catalog','counts'])
  self.assertTrue(out['synthetic_state_unchanged'])
  self.assertFalse(out['production_oauth_modified'])
  self.assertFalse(out['production_tenant_isolation_qualified'])
  self.assertFalse(out['release_authority'])
 def test_a_successful_forbidden_insert_can_never_be_qualified(self):
  f,_=fakes('token_accepted')
  with self.assertRaises(a.Reject):a.observe(f)
 def test_failed_provider_network_does_not_fake_denial(self):
  f,_=fakes('code_network')
  with self.assertRaisesRegex(a.Reject,'DENIAL_PROVIDER_HTTP_UNQUALIFIED'):a.observe(f)
 def test_new_schema_after_attack_blocks_qualification(self):
  f,_=fakes('schema_drift')
  with self.assertRaisesRegex(a.Reject,'CATALOG_CHANGED_AFTER_DENIAL'):a.observe(f)
 def test_insert_residue_after_attack_blocks_qualification(self):
  f,_=fakes('row_drift')
  with self.assertRaisesRegex(a.Reject,'SYNTHETIC_BASELINE_DRIFT'):a.observe(f)
 def test_readonly_baseline_outside_expected_scope_blocks_attack(self):
  f,calls=fakes()
  def tamper(kind):
   if kind=='counts':return [{'tables':9}]
   return f(kind)
  with self.assertRaisesRegex(a.Reject,'SYNTHETIC_COUNTS_SHAPE_UNQUALIFIED'):a.observe(tamper)
  self.assertNotIn('token',calls)
 def test_attacks_are_exactly_two_fake_crosscustomer_links_only(self):
  self.assertEqual(set(a.ATTACKS),{'code','token'})
  for value in a.ATTACKS.values():
   self.assertIn('customer-a',value[0])
   self.assertNotIn('DELETE FROM',value[0].upper())
   self.assertNotIn('DROP TABLE',value[0].upper())
  self.assertNotEqual(a.TARGET,a.PRESERVED)
  self.assertEqual(a.PLAN_SHA,'6946e796539e6787033e20f1d0afdcb5259a130ca77be6e3c5afb60b5dc9888a')

if __name__=='__main__':unittest.main()
