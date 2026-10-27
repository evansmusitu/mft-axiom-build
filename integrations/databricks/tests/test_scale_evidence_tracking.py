import json
import unittest

from scale_evidence_tracking import persist_scale_evidence, RUN_ID


def response():
    results = []
    for n in (100_000, 1_000_000):
        anomalies = (n - 1) // 17 + 1
        results.append({
            "rows":n,"planted_anomalies":anomalies,"detected_anomalies":anomalies,
            "false_negatives":0,"false_positives":0,"elapsed_seconds":1.25,
            "throughput_rows_per_sec":n/1.25
        })
    return {"results":results,"axiom_production_called":False,
            "decimal_control_passed":True,"floating_point_drift_detected":True,
            "evidence_sha256":"a"*64,"mlflow_status":"UNAVAILABLE"}


class TrackingTests(unittest.TestCase):
    def test_invalid_run_refuses_mlflow_writes(self):
        writes=[]
        def jobs(method,path,params=None,payload=None):
            return {"state":{"life_cycle_state":"TERMINATED","result_state":"FAILED"}}
        def mlflow(method,path,payload=None,params=None):
            writes.append(path)
        with self.assertRaisesRegex(RuntimeError,"successful"):
            persist_scale_evidence(jobs,mlflow)
        self.assertEqual(writes,[])

    def test_success_records_source_metrics_in_new_experiment(self):
        written=[]
        saved={"run_id":"d"*32}
        def jobs(method,path,params=None,payload=None):
            if path.endswith("/runs/get"): return {"state":{"life_cycle_state":"TERMINATED","result_state":"SUCCESS"},"tasks":[{"run_id":456}]}
            if path.endswith("/get-output"): return {"notebook_output":{"result":json.dumps(response())}}
            raise AssertionError(path)
        def mlflow(method,path,payload=None,params=None):
            written.append((method,path,payload,params))
            if path.endswith("/Me"): return {"userName":"owner@example.com"}
            if path.endswith("/get-by-name"): return None
            if path.endswith("/experiments/create"): return {"experiment_id":"222"}
            if path.endswith("/runs/create"): return {"run":{"info":{"run_id":"d"*32}}}
            if path.endswith("/runs/log-batch"): return {}
            if path.endswith("/runs/update"): return {}
            if path.endswith("/runs/get"):
                return {"run":{"info":{"run_id":"d"*32,"status":"FINISHED"},"data":{
                    "metrics":[{"key":m["key"],"value":m["value"]} for m in next(x for x in written if x[1].endswith("/log-batch"))[2]["metrics"]]
                }}}
            raise AssertionError(path)
        result=persist_scale_evidence(jobs,mlflow)
        self.assertEqual(result["mlflow_run_id"],"d"*32)
        self.assertEqual(result["databricks_run_id"],RUN_ID)
        self.assertEqual(len([x for x in written if x[1].endswith("/runs/log-batch")]),1)

    def test_existing_experiment_prevents_duplicate_writes(self):
        def jobs(method,path,params=None,payload=None):
            if path.endswith("/runs/get"): return {"state":{"life_cycle_state":"TERMINATED","result_state":"SUCCESS"},"tasks":[{"run_id":456}]}
            if path.endswith("/get-output"): return {"notebook_output":{"result":json.dumps(response())}}
        writes=[]
        def mlflow(method,path,payload=None,params=None):
            writes.append(method)
            if path.endswith("/Me"): return {"userName":"owner@example.com"}
            return {"experiment":{"experiment_id":"222"}}
        with self.assertRaisesRegex(RuntimeError,"already exists"):
            persist_scale_evidence(jobs,mlflow)
        self.assertEqual(writes,["GET","GET"])


if __name__=="__main__":
    unittest.main()
