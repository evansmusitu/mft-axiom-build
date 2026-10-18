import unittest
from studio_scoped_securitylevel_skip import desired_rule,is_qualified_access,same_existing

class ScopedSkipTests(unittest.TestCase):
 def test_exact_host_and_only_one_security_product(self):
  rule=desired_rule()
  self.assertEqual(rule['expression'],'(http.host eq "studio.mftintelligence.com")')
  self.assertEqual(rule['action'],'skip')
  self.assertEqual(rule['action_parameters'],{'products':['securityLevel']})
  self.assertTrue(rule['logging']['enabled'])
  self.assertNotIn('bic',str(rule))

 def test_access_rejects_bypass_policies(self):
  app=[{'name':'MUSITU Studio Android Control','domain':'studio.mftintelligence.com','type':'self_hosted'}]
  dom=[{'hostname':'studio.mftintelligence.com','service':'musitu-studio-v02'}]
  cfg={'bindings':[{'type':'plain_text','name':'STUDIO_SESSION_ENABLED','text':'true'},
    {'type':'plain_text','name':'GPU_EXECUTION_APPROVED','text':'false'},
    {'type':'plain_text','name':'STUDIO_ACCESS_POLICY_AUD','text':'a'*64}]}
  allowed=[{'decision':'allow','include':[{'email':{'email':'person@example.test'}}]}]
  self.assertTrue(is_qualified_access(app,allowed,dom,cfg))
  self.assertFalse(is_qualified_access(app,allowed+[{'decision':'bypass','include':[]}],dom,cfg))
  self.assertFalse(is_qualified_access(app,[{'decision':'allow','include':[{'everyone':{}}]}],dom,cfg))

 def test_original_waf_rules_unchanged(self):
  old={'id':'axiom-rule','action':'block','expression':'http.host eq "axiom.example.com"','action_parameters':{}}
  self.assertTrue(same_existing([old],[old,desired_rule()]))
  self.assertFalse(same_existing([old],[dict(old,action='skip'),desired_rule()]))

if __name__=='__main__':unittest.main()
