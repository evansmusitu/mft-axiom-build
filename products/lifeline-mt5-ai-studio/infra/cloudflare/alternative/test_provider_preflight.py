"""Read-only preflight safety tests, using synthetic provider records only."""
import unittest,json
from provider_preflight import preflight,ProviderReadError
ACCOUNT="93f395f5121954671f92fffa453d6b61";BASE="/accounts/"+ACCOUNT
def ok(result):return {"success":True,"result":result}
class ReadOnlyPreflightTests(unittest.TestCase):
    def factory(self,d1=True,bad_owner=False,paid=False):
        seen=[]
        answers={
          BASE:(200,ok({"id":"different-account" if bad_owner else ACCOUNT})),
          BASE+"/d1/database?per_page=100": (200,{**ok([{"name":"DO_NOT_DISCLOSE-private-db","uuid":"DO_NOT_DISCLOSE-id"}]),
              "result_info":{"total_count":1,"count":1}}) if d1 else (403,{"message":"DO_NOT_DISCLOSE"}),
          BASE+"/subscriptions":(200,ok([{"id":"DO_NOT_DISCLOSE-id","price":5 if paid else 0,
              "rate_plan":{"id":"free","public_name":"Free Website Zone","scope":"zone"}}])),
          BASE+"/workers/scripts":(200,ok([{"id":"unrelated-secret-worker","other_data":"DO_NOT_DISCLOSE"}]))
        }
        def get(path):seen.append(path);return answers[path]
        return get,seen
    def test_exact_account_readonly_and_redacted(self):
        get,calls=self.factory()
        r=preflight(get)
        self.assertEqual(calls,[BASE,BASE+"/d1/database?per_page=100",BASE+"/subscriptions",BASE+"/workers/scripts"])
        self.assertTrue(r["exact_account_verified"])
        self.assertEqual(r["d1_list_read_status"],"authorized")
        self.assertEqual(r["d1_database_count"],1)
        self.assertFalse(r["provisioning_authorized"])
        self.assertFalse(r["workers_free_plan_verified"])
        self.assertFalse(r["hard_zero_dollar_spending_cap_verified"])
        self.assertNotIn("DO_NOT_DISCLOSE",json.dumps(r))
    def test_forbidden_d1_permission_does_not_mean_zero_databases(self):
        get,_=self.factory(d1=False);r=preflight(get)
        self.assertEqual(r["d1_list_read_status"],"permission_denied")
        self.assertIsNone(r["d1_database_count"])
    def test_foreign_account_denied_before_other_gets(self):
        get,calls=self.factory(bad_owner=True)
        with self.assertRaisesRegex(ProviderReadError,"account_not_verified"):preflight(get)
        self.assertEqual(calls,[BASE])
    def test_paid_zone_subscription_never_infers_free_workers(self):
        get,_=self.factory(paid=True);r=preflight(get)
        self.assertFalse(r["workers_free_plan_verified"])
        self.assertFalse(r["provisioning_authorized"])
    def test_partial_page_does_not_claim_complete_count(self):
        get,_=self.factory()
        def partial(path):
            status,body=get(path)
            if path.endswith("?per_page=100"):
                body={**body,"result_info":{"total_count":300,"count":1}}
            return status,body
        r=preflight(partial)
        self.assertEqual(r["d1_list_read_status"],"partial_page")
        self.assertIsNone(r["d1_database_count"])
    def test_invalid_d1_response_fails_closed(self):
        get,_=self.factory()
        def malformed(path):
            return (200,ok({"unexpected":"dict"})) if path.endswith("?per_page=100") else get(path)
        r=preflight(malformed)
        self.assertEqual(r["d1_list_read_status"],"unverified")
        self.assertIsNone(r["d1_database_count"])
    def test_no_free_numeric_slot_with_eleven_databases(self):
        get,_=self.factory()
        def full(path):
            code,body=get(path)
            if path.endswith("?per_page=100"):
                body={**body,"result":[{"name":"secret-other-project-"+str(i)} for i in range(11)],
                    "result_info":{"total_count":11,"count":11}}
            return code,body
        r=preflight(full)
        self.assertEqual(r["d1_database_count"],11)
        self.assertFalse(r["free_d1_numeric_slot_available"])
        self.assertFalse(r["provisioning_authorized"])
        self.assertNotIn("secret-other-project",str(r))
    def test_existing_candidate_name_reported_without_database_id(self):
        get,_=self.factory()
        def candidate(path):
            code,body=get(path)
            if path.endswith("?per_page=100"):
                body={**body,"result":[{"name":"lifeline-mt5-d1-isolated","uuid":"DO_NOT_DISCLOSE"}],
                    "result_info":{"total_count":1,"count":1}}
            return code,body
        r=preflight(candidate)
        self.assertTrue(r["candidate_db_name_exists"])
        self.assertFalse(r["provisioning_authorized"])
        self.assertNotIn("DO_NOT_DISCLOSE",str(r))

    def test_worker_list_observability_never_infers_free_plan(self):
        get,calls=self.factory()
        report=preflight(get)
        self.assertEqual(report["workers_script_list_read_status"],"authorized_snapshot")
        self.assertEqual(report["workers_script_count_observed"],1)
        self.assertIs(report["stateless_worker_name_observed"],False)
        self.assertIs(report["workers_free_plan_verified"],False)
        self.assertIs(report["provisioning_authorized"],False)
        self.assertNotIn("unrelated-secret-worker",json.dumps(report))
        self.assertEqual(calls[-1],BASE+"/workers/scripts")

    def test_target_worker_name_collision_detected_without_metadata(self):
        get,_=self.factory()
        def collided(path):
            if path==BASE+"/workers/scripts":
                return 200,ok([{"id":"lifeline-mt5-status-private-isolated", "content":"secret-worker-body"}])
            return get(path)
        report=preflight(collided)
        self.assertTrue(report["stateless_worker_name_observed"])
        self.assertFalse(report["provisioning_authorized"])
        self.assertNotIn("secret-worker-body",json.dumps(report))

    def test_worker_permission_denied_not_zero_scripts(self):
        get,_=self.factory()
        def denied(path):
            if path==BASE+"/workers/scripts":return 403,{"message":"secret"}
            return get(path)
        report=preflight(denied)
        self.assertEqual(report["workers_script_list_read_status"],"permission_denied")
        self.assertIsNone(report["workers_script_count_observed"])
        self.assertIsNone(report["stateless_worker_name_observed"])

    def test_malformed_worker_script_result_is_not_trusted(self):
        get,_=self.factory()
        def malformed(path):
            if path==BASE+"/workers/scripts":return 200,ok({"id":"bad"})
            return get(path)
        report=preflight(malformed)
        self.assertEqual(report["workers_script_list_read_status"],"unverified")
        self.assertIsNone(report["workers_script_count_observed"])
        self.assertFalse(report["workers_free_plan_verified"])

    def test_worker_error_leaves_d1_evidence_intact(self):
        get,_=self.factory()
        def crashes(path):
            if path==BASE+"/workers/scripts":raise RuntimeError("API token secret message")
            return get(path)
        report=preflight(crashes)
        self.assertEqual(report["d1_database_count"],1)
        self.assertEqual(report["workers_script_list_read_status"],"unverified")
        self.assertNotIn("secret message",json.dumps(report))

if __name__=="__main__":unittest.main()
