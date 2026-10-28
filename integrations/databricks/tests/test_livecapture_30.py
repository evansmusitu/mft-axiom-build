import json
import unittest

from databricks_livecapture_run import build_job, verify_result, execute


def correct():
    return {
        "total": 30, "passed": 30, "failed": 0,
        "invalid_option_parameter_rejected": True,
        "spark_aggregation": "VERIFIED",
        "live_axiom_called_from_databricks": False,
        "source_axiom_verified_field": "null",
        "max_abs_error": 2e-12,
        "operations": {
            "finance.npv": 10, "finance.black_scholes": 10, "finance.var_historical": 10
        },
        "fixture_result_sha256": "a" * 64,
    }


class LiveCaptureContractTests(unittest.TestCase):
    def test_serverless_job_one_shot_and_no_cluster(self):
        path = "/Users/test@example.com/MUSITU_AXIOM_PRIVATE_PILOT_20261027/04_musitu_axiom_livecapture_30"
        job = build_job(path)
        self.assertEqual(len(job["tasks"]), 1)
        self.assertEqual(job["tasks"][0]["max_retries"], 0)
        self.assertNotIn("new_cluster", json.dumps(job))
        self.assertNotIn("existing_cluster_id", json.dumps(job))
        self.assertLess(job["tasks"][0]["timeout_seconds"], job["timeout_seconds"])
        self.assertTrue(job["idempotency_token"])

    def test_reject_non_pilot_notebook(self):
        with self.assertRaises(ValueError):
            build_job("/Shared/production/01_musitu_axiom_selfcontained")

    def test_30_case_expected_evidence(self):
        self.assertEqual(verify_result(json.dumps(correct()))["passed"], 30)

    def test_mismatch_and_missing_sha_are_rejected(self):
        for key, value in [
            ("failed", 1), ("passed", 29),
            ("spark_aggregation", "OFFLINE_STD_LIB_ONLY"),
            ("live_axiom_called_from_databricks", True),
            ("max_abs_error", 1e-4),
            ("fixture_result_sha256", "bogus")
        ]:
            record = correct()
            record[key] = value
            with self.subTest(key=key):
                with self.assertRaises(RuntimeError):
                    verify_result(json.dumps(record))

    def test_only_one_submitted_job_and_verified_output(self):
        calls = []
        def api(method, path, payload=None, params=None):
            calls.append((method, path))
            if path.endswith("/Me"): return {"userName": "test@example.com"}
            if path.endswith("get-status"): return {"object_type": "NOTEBOOK", "language": "PYTHON"}
            if path.endswith("/submit"): return {"run_id": 123}
            if path.endswith("/runs/get"): return {
                "state": {"life_cycle_state": "TERMINATED", "result_state": "SUCCESS"},
                "tasks": [{"run_id": 456}]
            }
            if path.endswith("/get-output"): return {"notebook_output": {"result": json.dumps(correct())}}
            raise AssertionError("Unexpected API call " + path)
        job_id, verdict = execute(api, sleep=lambda _: None, max_polls=2)
        self.assertEqual(job_id, 123)
        self.assertEqual(verdict["passed"], 30)
        self.assertEqual(sum(path.endswith("/submit") for _, path in calls), 1)


if __name__ == "__main__":
    unittest.main()
