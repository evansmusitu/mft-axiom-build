import unittest

from qualification.mining_adapter_qualify import evaluate


class MiningQualificationTests(unittest.TestCase):
    def _e2e(self):
        names=[
            "mqtt_to_canonical_persistence","opcua_to_canonical_persistence",
            "workflow_runtime_boundary","canonical_integrity_and_lineage","arrow_parquet_duckdb_postgis",
            "optimization","axiom_boundary","security_negative_validation",
            "opentelemetry_otlp","temporal_worker_recovery",
            "persistence_restart_replay","audit_chain","audit_tamper_detection",
        ]
        return {
            "schema":"musitu.connect.mining_adapter_e2e.v1",
            "all_passed":True,
            "runtime_seconds":8.0,
            "results":[{"name":name,"status":"PASS","detail":{}} for name in names],
            "evidence":{"credentials_published":False,"audit_chain_verified":True},
        }

    def _benchmark(self):
        return {
            "schema":"musitu.connect.mining.benchmark.v1",
            "runtime":{"peak_rss_kib":12345,"scipy":"1.18.1"},
            "cost":{"monetary_cost":"NOT_COMPARABLE"},
            "optimization":[{
                "records":256,
                "correctness":{"objective_matches_scipy_milp":True},
                "latency_ms":{
                    "musitu_exact":{"p50":1.0,"p95":2.0,"p99":3.0},
                    "scipy_milp":{"p50":5.0,"p95":6.0,"p99":7.0},
                },
                "throughput_records_per_second":{"musitu_exact":256000.0,"scipy_milp":51200.0},
            }],
        }

    def _baseline_catalog(self):
        return {"baselines":[
            {"name":"HighByte Intelligence Hub","version":"4.5.2"},
            {"name":"DuckDB","version":"1.5.6"},
            {"name":"OpenTelemetry Collector","version":"0.162.0"},
            {"name":"Temporal","version":"server 1.32.0 / Python SDK 1.34.0"},
        ]}

    def test_complete_evidence_passes_and_commercial_performance_remains_not_comparable(self):
        report=evaluate(
            pre=self._e2e(),
            post=self._e2e(),
            benchmark=self._benchmark(),
            live_guard={"passed":True},
            production_gate={"tests":{
                "production_runtime_axiom_execution":"PASS",
                "production_runtime_usage_ledger_correlation":"PASS",
                "observability_alerting_slo":"PASS_SYNTHETIC_CANARY_SIGNAL",
            }},
            baseline_catalog=self._baseline_catalog(),
        )
        self.assertTrue(report["all_passed"])
        self.assertTrue(all(item["status"]=="PASS" for item in report["capabilities"]))
        outcomes={item["baseline"]:item["outcome"] for item in report["baseline_outcomes"]}
        self.assertEqual(outcomes["Azure IoT Operations"],"NOT_COMPARABLE")
        self.assertEqual(outcomes["HighByte Intelligence Hub"],"NOT_COMPARABLE")
        self.assertEqual(outcomes["SciPy 1.18.1 MILP @ 256 records"],"WIN")

    def test_stale_scipy_baseline_fails_closed(self):
        benchmark=self._benchmark()
        benchmark["runtime"]["scipy"]="1.17.0"
        report=evaluate(
            pre=self._e2e(),post=self._e2e(),benchmark=benchmark,
            live_guard={"passed":True},production_gate={"tests":{
                "production_runtime_axiom_execution":"PASS",
                "production_runtime_usage_ledger_correlation":"PASS",
                "observability_alerting_slo":"PASS_SYNTHETIC_CANARY_SIGNAL",
            }},baseline_catalog=self._baseline_catalog(),
        )
        self.assertFalse(report["all_passed"])
        failed={item["id"] for item in report["capabilities"] if item["status"]=="FAIL"}
        self.assertIn("optimization.current_scipy_baseline",failed)

    def test_stale_current_baseline_catalog_fails_closed(self):
        catalog=self._baseline_catalog()
        catalog["baselines"][0]["version"]="4.3.4"
        report=evaluate(
            pre=self._e2e(),post=self._e2e(),benchmark=self._benchmark(),
            live_guard={"passed":True},production_gate={"tests":{
                "production_runtime_axiom_execution":"PASS",
                "production_runtime_usage_ledger_correlation":"PASS",
                "observability_alerting_slo":"PASS_SYNTHETIC_CANARY_SIGNAL",
            }},baseline_catalog=catalog,
        )
        self.assertFalse(report["all_passed"])
        failed={item["id"] for item in report["capabilities"] if item["status"]=="FAIL"}
        self.assertIn("baseline.catalog_freshness",failed)

    def test_missing_post_recovery_evidence_fails_closed(self):
        report=evaluate(
            pre=self._e2e(),post={},benchmark=self._benchmark(),
            live_guard={"passed":True},production_gate={"tests":{}},baseline_catalog=self._baseline_catalog(),
        )
        self.assertFalse(report["all_passed"])
        failed={item["id"] for item in report["capabilities"] if item["status"]=="FAIL"}
        self.assertIn("recovery.composed_after_restart",failed)


if __name__=="__main__": unittest.main()
