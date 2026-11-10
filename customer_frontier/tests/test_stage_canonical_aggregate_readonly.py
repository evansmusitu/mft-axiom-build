import importlib.util
from pathlib import Path
import unittest

file=Path(__file__).resolve().parents[1]/"qualification/stage_canonical_aggregate_readonly.py"
spec=importlib.util.spec_from_file_location("canonical_aggregate_readonly",file)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def response(items, *,changed=False,rows_written=0):
 return {"success":True,"result":[{"success":True,"results":[items],
  "meta":{"changed_db":False,"changes":int(changed),"rows_written":rows_written}}]}

def fixture():
 return {"totals":{"identities":3,"tenants":2,"memberships":3,"canonical_links":1,"flows":2,"sessions":2},
 "active":{"active_tenants":1,"active_memberships":2,
 "active_canonical_links":1,"unexpired_active_sessions":0},
 "linked":{"active_joined_links":1},
 "fk":{"foreign_key_violations":0}}

class CanonicalAggregate(unittest.TestCase):
 def test_exact_allowlisted_aggregate_without_any_customer_values(self):
  inputs=fixture()
  out={k:m.check_counts(k,response(v)) for k,v in inputs.items()}
  r=m.check_consistency(out)
  self.assertEqual(r["status"],"AGGREGATES_OBSERVED_NOT_OWNERSHIP")
  self.assertEqual(r["counts"],inputs)
  self.assertFalse(r["individual_customer_uuid_ownership_verified"])
  self.assertFalse(r["reuse_authorized"])
  self.assertFalse(r["release_authority"])
  self.assertFalse(r["physical_owner_mfa_completed"])
 def test_forbid_changes_personal_rows_and_extra_columns(self):
  for bad in (response({"identities":1},changed=True),response({"identities":1},rows_written=1),
              response({"identities":1,"email":"hidden"})):
   with self.assertRaises(m.Refuse):m.check_counts("totals",bad)
 def test_inconsistent_foreign_counts_fail_closed(self):
  args=fixture();args["linked"]["active_joined_links"]=2
  with self.assertRaisesRegex(m.Refuse,"INCONSISTENT"):m.check_consistency(args)
 def test_non_numeric_bool_and_negative_values_rejected(self):
  p=fixture()["fk"]
  for val in (True,-1,"0"):
   with self.assertRaisesRegex(m.Refuse,"COUNT_RESULT_INVALID"):
    m.check_counts("fk",response({"foreign_key_violations":val}))
 def test_sql_is_frozen_count_only_and_no_client_supplied_identity(self):
  self.assertEqual(len(m.QUERIES),4)
  for query in m.QUERIES.values():
   self.assertTrue(query.lstrip().startswith("SELECT "))
   self.assertNotIn("SELECT *",query)
   for forbidden in ("INSERT ","UPDATE ","DELETE ","CREATE ","DROP ","ATTACH ","DETACH "):
    self.assertNotIn(forbidden,query.upper())
if __name__=="__main__":unittest.main()
