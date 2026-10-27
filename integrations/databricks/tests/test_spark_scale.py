import base64
import json
import unittest
from import_scale import import_scale
from databricks_scale_run import build_scale_submit, execute_scale


SAMPLE_SOURCE = b"# Databricks notebook source\nprint(123)\n"


class ScaleImportTests(unittest.TestCase):
    def test_no_overwrite_private_user_path(self):
        events=[]
        def api(method,path,payload=None,params=None):
            events.append((method,path,payload,params))
            if path.endswith("/Me"): return {"userName":"tester@example.com"}
            if path.endswith("/get-status"):
                if len([e for e in events if e[1].endswith("/get-status")])==1:
                    return None
                return {"object_type":"NOTEBOOK","language":"PYTHON","object_id":992}
            return {}
        result=import_scale(api,SAMPLE_SOURCE)
        self.assertEqual(result["object_id"],992)
        self.assertEqual([e[1] for e in events],[
            "/api/2.0/preview/scim/v2/Me",
            "/api/2.0/workspace/get-status",
            "/api/2.0/workspace/mkdirs",
            "/api/2.0/workspace/import",
            "/api/2.0/workspace/get-status",
        ])
        payload=events[3][2]
        self.assertFalse(payload["overwrite"])
        self.assertIn("MUSITU_AXIOM_PRIVATE_PILOT_20261027/02_musitu_axiom_spark_scale",payload["path"])

    def test_existing_scale_notebook_fails_without_write(self):
        calls=[]
        def api(method,path,payload=None,params=None):
            calls.append(method)
            return {"userName":"tester@example.com"} if path.endswith("/Me") else {"object_type":"NOTEBOOK"}
        with self.assertRaisesRegex(RuntimeError,"already exists"):
            import_scale(api,SAMPLE_SOURCE)
        self.assertTrue(all(method=="GET" for method in calls))


class ScaleRunTests(unittest.TestCase):
    def test_one_time_serverless_config(self):
        p=build_scale_submit("/Users/test@example.com/MUSITU_AXIOM_PRIVATE_PILOT_20261027/02_musitu_axiom_spark_scale")
        self.assertEqual(len(p["tasks"]),1)
        self.assertNotIn("new_cluster",json.dumps(p))
        self.assertEqual(p["tasks"][0]["max_retries"],0)
        self.assertGreater(p["timeout_seconds"],p["tasks"][0]["timeout_seconds"])
        self.assertTrue(p["idempotency_token"])

    def test_fails_closed_if_notebook_stats_wrong(self):
        calls=[]
        wrong=json.dumps({"results":[{"rows":100_000,"false_negatives":1},{"rows":1_000_000,"false_negatives":0}]})
        def api(method,path,payload=None,params=None):
            calls.append((method,path))
            if path.endswith("/Me"): return {"userName":"test@example.com"}
            if path.endswith("/get-status"): return {"object_type":"NOTEBOOK","language":"PYTHON","object_id":99}
            if path.endswith("/submit"): return {"run_id":300}
            if path.endswith("/runs/get"): return {"state":{"life_cycle_state":"TERMINATED","result_state":"SUCCESS"},"tasks":[{"run_id":301}]}
            if path.endswith("/get-output"): return {"notebook_output":{"result":wrong}}
            raise AssertionError(path)
        with self.assertRaises(RuntimeError):
            execute_scale(api,sleep=lambda _:None,max_polls=2)
        self.assertEqual(sum(path.endswith("/submit") for _,path in calls),1)

    def test_output_verification_detects_two_sizes(self):
        results=[{"rows":n,"planted_anomalies":((n-1)//17)+1,"detected_anomalies":((n-1)//17)+1,"false_negatives":0,"false_positives":0,"elapsed_seconds":1.25,"throughput_rows_per_sec":n/1.25} for n in (100_000,1_000_000)]
        payload=json.dumps({"results":results,"decimal_control_passed":True,"floating_point_drift_detected":True,"axiom_production_called":False,"evidence_sha256":"a"*64,"mlflow_status":"RECORDED","mlflow_run_id":"d"*32})
        def api(method,path,payload=None,params=None):
            if path.endswith("/Me"): return {"userName":"test@example.com"}
            if path.endswith("/get-status"): return {"object_type":"NOTEBOOK","language":"PYTHON","object_id":99}
            if path.endswith("/submit"): return {"run_id":300}
            if path.endswith("/runs/get"): return {"state":{"life_cycle_state":"TERMINATED","result_state":"SUCCESS"},"tasks":[{"run_id":301}]}
            if path.endswith("/get-output"): return {"notebook_output":{"result":payload}}
            raise AssertionError(path)
        rid,verified=execute_scale(api,sleep=lambda _:None,max_polls=2)
        self.assertEqual(rid,300)
        self.assertEqual(verified["results"][1]["rows"],1_000_000)


if __name__=="__main__":
    unittest.main()
