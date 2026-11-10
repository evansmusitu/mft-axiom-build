import importlib.util
from pathlib import Path
import unittest

path=Path(__file__).resolve().parents[1]/"qualification/canonical_d1_recovery_readonly.py"
spec=importlib.util.spec_from_file_location("canonical_readonly",path)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def catalog():
    names=[m.SESSION_D1]+[f"0000000{i:01d}-1111-4111-8111-222222222222" for i in range(10)]
    return {"success":True,"result":[{"uuid":db,"name":"database_"+str(i)} for i,db in enumerate(names)],
            "result_info":{"page":1,"count":11,"total_count":11}}
def rows(*names,changed=False):
    return {"success":True,"result":[{
      "success":True,"meta":{"changed_db":changed,"changes":int(changed),"rows_written":0},
      "results":[{"name":n} for n in names]}]}

class CanonicalReadback(unittest.TestCase):
    def test_approved_exact_11_source_d1_and_pagination_only(self):
        records=m.inspect_inventory(catalog())
        self.assertEqual(len(records),11)
        for override in ({"total_count":12},{"count":False},{"page":2}):
            fake=catalog();fake["result_info"].update(override)
            with self.assertRaises(m.Unqualified):m.inspect_inventory(fake)
    def test_names_only_zero_write_and_no_private_records(self):
        self.assertEqual(m.inspect_schema_result(rows("identities","memberships")),frozenset(("identities","memberships")))
        with self.assertRaises(m.Unqualified):m.inspect_schema_result(rows("identities",changed=True))
        with self.assertRaises(m.Unqualified):m.inspect_schema_result(rows("customer_email"))
        with self.assertRaises(m.Unqualified):m.inspect_schema_result(rows("identities","identities"))
    def test_canonical_link_ownership_never_inferred_from_four_table_names(self):
        inv=m.inspect_inventory(catalog())
        rowsets={x["uuid"]:frozenset() for x in inv}
        rowsets[m.SESSION_D1]=m.CANONICAL_CORE
        r=m.classify(inv,rowsets,[{"id":m.STAGING_WORKER},{"id":"musitu-axiom-zitadel-private"}])
        self.assertTrue(r["session_database_has_canonical_table_names"])
        self.assertEqual(r["canonical_schema_name_candidate_count"],1)
        self.assertFalse(r["customer_uuid_ownership_verified"])
        self.assertFalse(r["historical_session_database_reuse_authorized"])
        self.assertFalse(r["release_authority"])
        self.assertFalse(r["provider_bookmark_retrieved"])
    def test_candidate_in_separate_db_does_not_mean_session_db_has_customer_data(self):
        inv=m.inspect_inventory(catalog())
        rowsets={x["uuid"]:frozenset() for x in inv}
        rowsets[inv[1]["uuid"]]=m.CANONICAL_CORE
        summary=m.classify(inv,rowsets,[{"id":m.STAGING_WORKER}])
        self.assertFalse(summary["session_database_has_canonical_table_names"])
        self.assertEqual(summary["canonical_schema_name_candidates"][0]["database_uuid"],inv[1]["uuid"])
    def test_duplicate_worker_inventory_or_missing_stage_does_not_qualify(self):
        inv=m.inspect_inventory(catalog());sets={x["uuid"]:frozenset() for x in inv}
        for workers in ([],[{"id":m.STAGING_WORKER},{"id":m.STAGING_WORKER}],[{"id":"unknown"}]):
            with self.assertRaises(m.Unqualified):m.classify(inv,sets,workers)

if __name__=="__main__":unittest.main()
