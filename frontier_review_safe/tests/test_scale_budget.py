from __future__ import annotations

from copy import deepcopy
import unittest

from frontier_review_safe.scale_budget import (
    BASELINE_CONTRACT, EXPECTED_DETAILS, EXPECTED_UNITS, contract_fingerprint,
    derived_budgets, gate,
)


class ScaleBudgetTests(unittest.TestCase):
    def evidence(self):
        rows = []
        for name, observed in BASELINE_CONTRACT["observed_worst"].items():
            rows.append({
                "name": name,
                "units": EXPECTED_UNITS[name],
                "elapsed_ms": observed["max_elapsed_ms"],
                "throughput_per_sec": observed["min_throughput_per_sec"],
                "peak_python_bytes": observed["max_peak_python_bytes"],
                "details": deepcopy(EXPECTED_DETAILS[name]),
            })
        return {
            "schema": "musitu.axiom.review-safe-scale-evidence.v1",
            "candidate_sha": "candidate",
            "environment": {
                "python": "3.12.14",
                "implementation": "CPython",
                "machine": "x86_64",
            },
            "benchmarks": rows,
            "evidence_sha256": "e" * 64,
        }

    def test_budget_is_mechanically_derived_from_recorded_baseline_policy(self):
        budgets = derived_budgets()
        self.assertEqual(budgets["temporal_evidence_graph_10k"]["max_elapsed_ms"], 10569)
        self.assertEqual(budgets["temporal_evidence_graph_10k"]["max_peak_python_bytes"], 25143598)
        self.assertEqual(budgets["temporal_evidence_graph_10k"]["min_throughput_per_sec"], 955)
        self.assertEqual(len(contract_fingerprint()), 64)
        self.assertEqual(BASELINE_CONTRACT["workflow_run_attempts"], 3)
        self.assertEqual(len(BASELINE_CONTRACT["evidence_sha256"]), 3)

    def test_recorded_baseline_shape_passes_provisional_internal_gate(self):
        report = gate(
            self.evidence(),
            workload_git_blob_sha=BASELINE_CONTRACT["workload_git_blob_sha"],
        )
        self.assertEqual(report["status"], "PASS")
        self.assertEqual(report["reasons"], [])

    def test_latency_memory_and_throughput_regressions_fail_closed(self):
        evidence = self.evidence()
        row = next(x for x in evidence["benchmarks"] if x["name"] == "decision_ledger_3k_events")
        budget = derived_budgets()["decision_ledger_3k_events"]
        row["elapsed_ms"] = budget["max_elapsed_ms"] + 1
        row["peak_python_bytes"] = budget["max_peak_python_bytes"] + 1
        row["throughput_per_sec"] = budget["min_throughput_per_sec"] - 1
        report = gate(evidence, workload_git_blob_sha=BASELINE_CONTRACT["workload_git_blob_sha"])
        self.assertEqual(report["status"], "FAIL")
        reasons = report["checks"]["decision_ledger_3k_events"]["reasons"]
        self.assertIn("elapsed_budget_exceeded", reasons)
        self.assertIn("memory_budget_exceeded", reasons)
        self.assertIn("throughput_budget_missed", reasons)

    def test_workload_change_or_smaller_declared_workload_requires_rebaseline(self):
        evidence = self.evidence()
        evidence["benchmarks"][0]["units"] -= 1
        report = gate(evidence, workload_git_blob_sha="0" * 40)
        self.assertEqual(report["status"], "FAIL")
        self.assertIn("workload_definition_changed_rebaseline_required", report["reasons"])
        self.assertTrue(any("workload_units_changed" in reason for reason in report["reasons"]))


if __name__ == "__main__":
    unittest.main(verbosity=2)
