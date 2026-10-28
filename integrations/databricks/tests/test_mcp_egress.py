import json
import unittest

from databricks_mcp_egress_run import build_job, verify_probe, execute_once

PATH = "/Users/test@example.com/MUSITU_AXIOM_PRIVATE_PILOT_20261027/05_musitu_axiom_mcp_egress"
REACHABLE = {
    "schema": "musitu.axiom.databricks.public-mcp-egress.v1",
    "initialize_http": 200,
    "initialize_supported": True,
    "tools_http": 200,
    "tools_count": 108,
    "approved_tools_visible": 3,
    "unrestricted_execute_advertised": True,
    "axiom_tool_calls_executed": 0,
    "axiom_authenticated": False,
    "status": "REACHABLE_PUBLIC_MCP",
}

class McpEgressTests(unittest.TestCase):
    def test_no_cluster_single_job_timeout(self):
        task = build_job(PATH)
        self.assertEqual(len(task["tasks"]), 1)
        self.assertEqual(task["tasks"][0]["max_retries"], 0)
        self.assertEqual(task["tasks"][0]["timeout_seconds"], 240)
        self.assertLess(task["tasks"][0]["timeout_seconds"], task["timeout_seconds"])
        self.assertNotIn("existing_cluster_id", json.dumps(task))
        self.assertNotIn("new_cluster", json.dumps(task))
        self.assertNotIn("schedule", json.dumps(task))
        self.assertTrue(task["idempotency_token"])
        with self.assertRaises(ValueError):
            build_job("/Shared/production/axiom_unrestricted")

    def test_pure_public_handshake_passes_without_auth(self):
        result = verify_probe(json.dumps(REACHABLE))
        self.assertTrue(result["initialize_supported"])
        self.assertEqual(result["axiom_tool_calls_executed"], 0)
        self.assertFalse(result["axiom_authenticated"])

    def test_denies_forged_mcp_execution_evidence(self):
        for field, value in [
            ("axiom_authenticated", True),
            ("axiom_tool_calls_executed", 1),
            ("schema", "wrong"),
            ("tools_count", -1),
            ("status", "RUN_COMPLETE"),
        ]:
            altered = dict(REACHABLE)
            altered[field] = value
            with self.subTest(field=field), self.assertRaises(RuntimeError):
                verify_probe(json.dumps(altered))

    def test_network_failure_is_reported_not_misrepresented(self):
        result=dict(REACHABLE)
        result.update({
            "status": "BLOCKED_OR_UNSUPPORTED",
            "initialize_http": 0,
            "initialize_supported": False,
            "tools_http": None,
            "tools_count": None,
            "approved_tools_visible": 0,
            "unrestricted_execute_advertised": None,
        })
        self.assertEqual(verify_probe(json.dumps(result))["status"], "BLOCKED_OR_UNSUPPORTED")

    def test_one_submitted_job_and_readback(self):
        requests=[]
        def api(method,path,payload=None,params=None):
            requests.append((method,path))
            if path.endswith("/Me"): return {"userName":"test@example.com"}
            if path.endswith("get-status"): return {"object_type":"NOTEBOOK","language":"PYTHON","object_id":123}
            if path.endswith("/submit"): return {"run_id":321}
            if path.endswith("/runs/get"): return {"state":{"life_cycle_state":"TERMINATED","result_state":"SUCCESS"},"tasks":[{"run_id":322}]}
            if path.endswith("/get-output"): return {"notebook_output":{"result":json.dumps(REACHABLE)}}
            raise AssertionError(path)
        rid,record=execute_once(api,sleep=lambda _:None,max_polls=2)
        self.assertEqual(rid,321)
        self.assertEqual(record["status"],"REACHABLE_PUBLIC_MCP")
        self.assertEqual(sum(path.endswith("/submit") for _,path in requests),1)

if __name__ == "__main__":
    unittest.main()
