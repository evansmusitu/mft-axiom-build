import unittest

from benchmarks.mining_adapter.benchmark import run_benchmark


class MiningBenchmarkTests(unittest.TestCase):
    def test_benchmark_is_deterministic_and_proves_objective_correctness(self):
        report=run_benchmark(scales=(8,16),warmups=1,repetitions=3,seed=20261006)
        self.assertEqual(report["schema"],"musitu.connect.mining.benchmark.v1")
        self.assertEqual(report["methodology"]["seed"],20261006)
        self.assertEqual(report["methodology"]["warmups"],1)
        self.assertEqual(report["methodology"]["repetitions"],3)
        self.assertEqual([item["records"] for item in report["optimization"]],[8,16])
        self.assertEqual([item["records"] for item in report["canonical_pipeline"]],[8,16])
        for item in report["canonical_pipeline"]:
            self.assertGreater(item["latency_ms"]["ingest"]["p50"],0)
            self.assertGreater(item["latency_ms"]["plan"]["p95"],0)
            self.assertGreater(item["latency_ms"]["replay"]["p99"],0)
            self.assertGreater(item["throughput_records_per_second"]["total_p50"],0)
            for phase in ("ingest","plan","replay","total"):
                self.assertEqual(len(item["raw_samples_ms"][phase]),3)
                self.assertTrue(all(value > 0 for value in item["raw_samples_ms"][phase]))
        for item in report["optimization"]:
            self.assertTrue(item["correctness"]["objective_matches_scipy_milp"])
            self.assertLessEqual(item["correctness"]["musitu_spend"],item["budget"]+1e-8)
            for implementation in ("musitu_exact","scipy_milp"):
                self.assertGreater(item["latency_ms"][implementation]["p50"],0)
                self.assertGreater(item["throughput_records_per_second"][implementation],0)
                self.assertEqual(len(item["raw_samples_ms"][implementation]),3)
                self.assertTrue(all(value > 0 for value in item["raw_samples_ms"][implementation]))
        operational=report["operational_complexity"]
        self.assertEqual(operational["comparison_status"],"NOT_COMPARABLE")
        self.assertGreater(operational["qualification_topology"]["compose_service_count"],0)
        self.assertGreater(operational["qualification_topology"]["python_dependency_count"],0)
        self.assertGreater(operational["qualification_topology"]["pinned_component_count"],0)


if __name__ == "__main__":
    unittest.main()
