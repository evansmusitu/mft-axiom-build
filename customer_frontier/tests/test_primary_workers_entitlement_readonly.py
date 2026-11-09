import importlib.util,unittest
from pathlib import Path
p=Path(__file__).resolve().parents[1]/"qualification/primary_workers_entitlement_readonly.py"
spec=importlib.util.spec_from_file_location("primary_workers_entitlement",p)
subject=importlib.util.module_from_spec(spec);spec.loader.exec_module(subject)

class SubscriptionReadOnly(unittest.TestCase):
 def test_absent_or_malformed_provider_payload_denies_creation(self):
  for val in ({},{"result":[]},{"success":True,"result":{}},{"success":True,"result":[{}]*101}):
   x=subject.summarize(val)
   self.assertFalse(x['identity_database_creation_authorized'])
   self.assertFalse(x['release_authority'])
   self.assertNotEqual(x['status'],'SUBSCRIPTIONS_READ_NO_CREATE_AUTHORITY')
 def test_recognized_paid_subscription_still_is_not_create_permission(self):
  data={"success":True,"result":[{"id":"private-id","state":"Paid","price":5,
   "rate_plan":{"public_name":"Workers Paid","id":"fake"}}]}
  x=subject.summarize(data)
  self.assertEqual(x["status"],"SUBSCRIPTIONS_READ_NO_CREATE_AUTHORITY")
  self.assertTrue(x["workers_paid_subscription_observed"])
  self.assertFalse(x["identity_database_creation_authorized"])
  self.assertFalse(x["workers_plan_independently_qualified"])
  self.assertNotIn("private-id",str(x))
  self.assertNotIn("price",str(x))
 def test_other_products_do_not_claim_workers(self):
  x=subject.summarize({"success":True,"result":[{"state":"Paid","price":12,
   "rate_plan":{"public_name":"Business Zone","id":"biz"}}]})
  self.assertEqual(x["worker_named_count"],0)
  self.assertFalse(x["workers_paid_subscription_observed"])
 def test_no_network_or_provider_writes_in_testable_summarizer(self):
  x=subject.summarize({"success":True,"result":[]})
  self.assertEqual(x["only_method"],"GET")
  self.assertEqual(x["provider_writes"],0)
  self.assertEqual(x["cost_changing_operation"],False)
if __name__=="__main__":unittest.main()
