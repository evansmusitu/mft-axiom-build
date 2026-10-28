import json
import unittest

from tracking30 import persist_verified_capture

SOURCE = {
    "total": 30, "passed": 30, "failed": 0,
    "invalid_option_parameter_rejected": True,
    "spark_aggregation": "VERIFIED",
    "live_axiom_called_from_databricks": False,
    "source_axiom_verified_field": "null",
    "max_abs_error": 1e-12,
    "operations": {
        "finance.npv": 10, "finance.black_scholes": 10,
        "finance.var_historical": 10,
    },
    "fixture_result_sha256": "a" * 64,
}


class CaptureTrackingTests(unittest.TestCase):
    def fake_apis(self, *, captured=None, duplicate=False):
        calls=[]
        def jobs(method,path,payload=None,params=None):
            calls.append(("jobs",method,path))
            if path.endswith("/runs/get"):
                return {"state":{"life_cycle_state":"TERMINATED","result_state":"SUCCESS"},"tasks":[{"run_id":1234}]}
            if path.endswith("/get-output"):
                return {"notebook_output":{"result":json.dumps(captured or SOURCE)}}
            raise AssertionError("Not allowlisted " + path)
        def tracking(method,path,payload=None,params=None):
            calls.append(("mlflow",method,path))
            if path.endswith("/Me"): return {"userName":"test@example.com"}
            if path.endswith("/get-by-name"): return {"experiment":{"experiment_id":"1"}} if duplicate else None
            if path.endswith("/experiments/create"): return {"experiment_id":"123"}
            if path.endswith("/runs/create"): return {"run":{"info":{"run_id":"abc123xyz"}}}
            if path.endswith("/runs/log-batch"): return {}
            if path.endswith("/runs/update"): return {}
            if path.endswith("/runs/get"):
                return {"run":{"info":{"run_id":"abc123xyz","status":"FINISHED"},"data":{"metrics":[{"key":x["key"],"value":x["value"]} for x in self.logged_metrics]}}}
            raise AssertionError(path)
        # Capture exact metrics set to the MLflow API without reimplementing equations
        def tracked(method,path,payload=None,params=None):
            if path.endswith("/runs/log-batch"):
                self.logged_metrics=payload["metrics"]
            return tracking(method,path,payload,params)
        return jobs,tracked,calls

    def test_run_is_read_back_with_exact_metric_values(self):
        jobs,mlflow,calls=self.fake_apis()
        value=persist_verified_capture(jobs,mlflow)
        self.assertEqual(value["metrics"]["passed_cases"],30)
        self.assertEqual(value["metrics"]["max_absolute_error"],1e-12)
        self.assertEqual(value["mlflow_run_id"],"abc123xyz")
        self.assertEqual(sum(method=="POST" and path.endswith("/experiments/create") for _,method,path in calls),1)

    def test_existing_experiment_prevents_duplicate_writes(self):
        jobs,mlflow,calls=self.fake_apis(duplicate=True)
        with self.assertRaisesRegex(RuntimeError,"already exists"):
            persist_verified_capture(jobs,mlflow)
        self.assertFalse(any(method=="POST" for _,method,_ in calls))

    def test_failed_databricks_verdict_prevents_mlflow_writes(self):
        invalid=dict(SOURCE);invalid["passed"]=29
        jobs,mlflow,calls=self.fake_apis(captured=invalid)
        with self.assertRaises(RuntimeError):
            persist_verified_capture(jobs,mlflow)
        self.assertFalse(any(method=="POST" for _,method,_ in calls))


if __name__=="__main__":
    unittest.main()
