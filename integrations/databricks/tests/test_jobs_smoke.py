import unittest
from databricks_jobs import build_submit, execute_once, _validate_job_api_route


class LiveSmokeContractTests(unittest.TestCase):
    def test_serverless_payload_is_one_time_and_never_creates_a_cluster(self):
        result=build_submit("/Users/check@example.com/MUSITU_AXIOM_PRIVATE_PILOT_20261027/01_musitu_axiom_selfcontained")
        self.assertEqual(len(result["tasks"]),1)
        self.assertEqual(result["tasks"][0]["notebook_task"]["source"],"WORKSPACE")
        self.assertEqual(result["tasks"][0]["max_retries"],0)
        self.assertEqual(result["tasks"][0]["timeout_seconds"],600)
        self.assertEqual(result["timeout_seconds"],900)
        self.assertTrue(result["idempotency_token"])
        self.assertNotIn("new_cluster",str(result))
        self.assertNotIn("existing_cluster_id",str(result))
        self.assertNotIn("schedule",str(result))

    def test_terminal_success_does_not_submit_again(self):
        events=[]
        def api(method,path,payload=None,params=None):
            events.append((method,path))
            if path.endswith("/Me"): return {"userName":"check@example.com"}
            if path.endswith("/submit"): return {"run_id":321}
            if path.endswith("/runs/get"): return {"state":{"life_cycle_state":"TERMINATED","result_state":"SUCCESS"}}
            raise AssertionError("Unexpected API call")
        result=execute_once(api,sleep=lambda _:None,max_polls=3)
        self.assertEqual(result,321)
        self.assertEqual(sum(path.endswith("/submit") for _,path in events),1)

    def test_failed_run_never_claims_success(self):
        def api(method,path,payload=None,params=None):
            if path.endswith("/Me"): return {"userName":"check@example.com"}
            if path.endswith("/submit"): return {"run_id":321}
            if path.endswith("/runs/get"): return {"state":{"life_cycle_state":"TERMINATED","result_state":"FAILED"}}
        with self.assertRaisesRegex(RuntimeError,"FAILED"):
            execute_once(api,sleep=lambda _:None,max_polls=3)

    def test_timeout_is_explicit_failure(self):
        def api(method,path,payload=None,params=None):
            if path.endswith("/Me"): return {"userName":"check@example.com"}
            if path.endswith("/submit"): return {"run_id":321}
            if path.endswith("/runs/get"): return {"state":{"life_cycle_state":"RUNNING"}}
        with self.assertRaisesRegex(RuntimeError,"polling window"):
            execute_once(api,sleep=lambda _:None,max_polls=2)

    def test_reject_unknown_api_endpoints(self):
        for method,path in [("POST","/api/2.0/clusters/start"),("POST","/api/2.2/jobs/create"),("DELETE","/api/2.0/workspace/delete")]:
            with self.assertRaises(ValueError):
                _validate_job_api_route(method,path)

    def test_reject_unsafe_user_identity(self):
        def api(method,path,payload=None,params=None):
            return {"userName":"../../Shared"}
        with self.assertRaises(ValueError):
            execute_once(api,sleep=lambda _:None,max_polls=1)


if __name__=="__main__":
    unittest.main()
