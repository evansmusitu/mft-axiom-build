import unittest
from b13_account_usage_probe import ReadDenied, ACCOUNT, json_request, validate_subscription_data,validate_graphql_usage

class GateTests(unittest.TestCase):
 def setUp(self):
  self.acct={'success':True,'result':{'id':ACCOUNT}}
  self.sub={'success':True,'result':[], 'result_info':{'total_count':0}}
 def test_empty_subscription_not_claimed_free(self):
  self.assertFalse(validate_subscription_data(self.acct,self.sub)['free_plan_certified'])
 def test_paid_plan_fail_closed(self):
  self.sub['result']=[{'rate_plan':{'id':'workers_paid'}}]
  with self.assertRaises(ReadDenied):validate_subscription_data(self.acct,self.sub)
 def test_partial_page_fail_closed(self):
  self.sub['result_info']['total_count']=5
  with self.assertRaises(ReadDenied):validate_subscription_data(self.acct,self.sub)
 def test_account_mismatch(self):
  self.acct['result']['id']='wrong'
  with self.assertRaises(ReadDenied):validate_subscription_data(self.acct,self.sub)
 def test_valid_sample_only_advisory(self):
  obj={'data':{'viewer':{'accounts':[{'aiInferenceAdaptiveGroups':[{'count':6,'sum':{'totalNeurons':123.25}}]}]}}}
  r=validate_graphql_usage(obj)
  self.assertEqual(r['observed_neurons'],123.25)
  self.assertEqual(r['actual_remaining_free_allocation'],'NOT_CERTIFIED')
 def test_empty_results_deny(self):
  with self.assertRaises(ReadDenied):validate_graphql_usage({'data':{'viewer':{'accounts':[{'aiInferenceAdaptiveGroups':[]}]}}})
 def test_null_neurons_deny(self):
  with self.assertRaises(ReadDenied):validate_graphql_usage({'data':{'viewer':{'accounts':[{'aiInferenceAdaptiveGroups':[{'count':1,'sum':{'totalNeurons':None}}]}]}}})
 def test_graphql_errors_deny(self):
  with self.assertRaises(ReadDenied):validate_graphql_usage({'errors':[{'message':'forbidden'}]})
 def test_unapproved_path_no_request(self):
  with self.assertRaises(ReadDenied):json_request('test','/accounts/'+ACCOUNT+'/ai/run/'+('@cf/zai-org/glm-4.7-flash'))
if __name__=='__main__':unittest.main()