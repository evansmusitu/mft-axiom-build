import json
import unittest
from import_parity import import_parity
from databricks_parity_run import build_parity_job, run_parity


class AxiomParityTransportTests(unittest.TestCase):
    def test_import_is_private_and_non_overwriting(self):
        events=[]
        def api(method,path,payload=None,params=None):
            events.append((method,path,payload,params))
            if path.endswith("/Me"):return {"userName":"test@example.com"}
            if path.endswith("/get-status"):
                if len([x for x in events if x[1].endswith("/get-status")])==1:
                    return None
                return {"object_type":"NOTEBOOK","language":"PYTHON","object_id":777}
            return {}
        result=import_parity(api,b"# Databricks notebook source\nprint(1)\n")
        self.assertEqual(result["object_id"],777)
        self.assertEqual(events[3][2]["overwrite"],False)
        self.assertIn("03_musitu_axiom_parity",events[3][2]["path"])

    def test_serverless_job_is_bounded(self):
        payload=build_parity_job("/Users/test@example.com/MUSITU_AXIOM_PRIVATE_PILOT_20261027/03_musitu_axiom_parity")
        self.assertEqual(len(payload["tasks"]),1)
        self.assertEqual(payload["tasks"][0]["max_retries"],0)
        self.assertTrue(payload["idempotency_token"])
        self.assertNotIn("new_cluster",json.dumps(payload))

    def test_success_requires_real_spark_and_contract_check(self):
        result={"total":14,"passed":14,"failed":0,"put_call_parity_passed":True,
                "invalid_option_parameter_rejected":True,"databricks_spark_aggregation":"VERIFIED",
                "live_axiom_mcp_called_from_databricks":False,"fixture_and_result_sha256":"e"*64}
        calls=[]
        def api(method,path,params=None,payload=None):
            calls.append((method,path))
            if path.endswith("/Me"):return {"userName":"test@example.com"}
            if path.endswith("/get-status"):return {"object_type":"NOTEBOOK","language":"PYTHON","object_id":777}
            if path.endswith("/submit"):return {"run_id":500}
            if path.endswith("/runs/get"):return {"state":{"life_cycle_state":"TERMINATED","result_state":"SUCCESS"},"tasks":[{"run_id":501}]}
            if path.endswith("/get-output"):return {"notebook_output":{"result":json.dumps(result)}}
            raise AssertionError(path)
        rid,output=run_parity(api,sleep=lambda _:None,max_polls=2)
        self.assertEqual(rid,500)
        self.assertEqual(output["passed"],14)

    def test_incorrect_parity_is_not_accepted(self):
        result={"total":14,"passed":13,"failed":1,"put_call_parity_passed":True,
                "invalid_option_parameter_rejected":True,"databricks_spark_aggregation":"VERIFIED",
                "live_axiom_mcp_called_from_databricks":False,"fixture_and_result_sha256":"e"*64}
        def api(method,path,params=None,payload=None):
            if path.endswith("/Me"):return {"userName":"test@example.com"}
            if path.endswith("/get-status"):return {"object_type":"NOTEBOOK","language":"PYTHON","object_id":777}
            if path.endswith("/submit"):return {"run_id":500}
            if path.endswith("/runs/get"):return {"state":{"life_cycle_state":"TERMINATED","result_state":"SUCCESS"},"tasks":[{"run_id":501}]}
            if path.endswith("/get-output"):return {"notebook_output":{"result":json.dumps(result)}}
        with self.assertRaises(RuntimeError):
            run_parity(api,sleep=lambda _:None,max_polls=2)


if __name__=="__main__":
    unittest.main()
