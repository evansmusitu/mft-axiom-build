from __future__ import annotations

from copy import deepcopy
import math
import unittest

from frontier_review_safe.core import sha256
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
        evidence = {
            "schema": "musitu.axiom.review-safe-scale-evidence.v1",
            "candidate_sha": "candidate",
            "environment": {
                "python": "3.12.14",
                "implementation": "CPython",
                "machine": "x86_64",
            },
            "benchmarks": rows,
        }
        evidence["evidence_sha256"] = sha256(evidence)
        return evidence

    def test_budget_is_mechanically_derived_from_recorded_baseline_policy(self):
        budgets = derived_budgets()
        temporal = budgets["temporal_evidence_graph_10k"]
        self.assertEqual(temporal["max_elapsed_ms"], 10569)
        self.assertEqual(temporal["max_peak_python_bytes"], 25143598)
        self.assertEqual(temporal["min_throughput_per_sec"], 946.163)
        self.assertEqual(len(contract_fingerprint()), 64)
        self.assertEqual(BASELINE_CONTRACT["workflow_run_attempts"], 3)
        self.assertEqual(len(BASELINE_CONTRACT["evidence_sha256"]), 3)

    def test_latency_and_throughput_budgets_are_one_coherent_timing_envelope(self):
        for name, budget in derived_budgets().items():
            units = EXPECTED_UNITS[name]
            implied = round(units * 1000.0 / float(budget["max_elapsed_ms"]), 3)
            self.assertEqual(budget["min_throughput_per_sec"], implied, name)

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
        row["throughput_per_sec"] = round(
            EXPECTED_UNITS["decision_ledger_3k_events"] * 1000.0 / row["elapsed_ms"], 3
        )
        report = gate(evidence, workload_git_blob_sha=BASELINE_CONTRACT["workload_git_blob_sha"])
        self.assertEqual(report["status"], "FAIL")
        reasons = report["checks"]["decision_ledger_3k_events"]["reasons"]
        self.assertIn("elapsed_budget_exceeded", reasons)
        self.assertIn("memory_budget_exceeded", reasons)
        self.assertIn("throughput_budget_missed", reasons)
        self.assertNotIn("throughput_elapsed_measurement_inconsistent", reasons)

    def test_inconsistent_throughput_telemetry_fails_closed(self):
        evidence = self.evidence()
        row = next(x for x in evidence["benchmarks"] if x["name"] == "persistent_adaptation_100_releases")
        row["throughput_per_sec"] = 1.0
        report = gate(evidence, workload_git_blob_sha=BASELINE_CONTRACT["workload_git_blob_sha"])
        self.assertEqual(report["status"], "FAIL")
        self.assertIn(
            "throughput_elapsed_measurement_inconsistent",
            report["checks"]["persistent_adaptation_100_releases"]["reasons"],
        )

    def test_workload_change_or_smaller_declared_workload_requires_rebaseline(self):
        evidence = self.evidence()
        evidence["benchmarks"][0]["units"] -= 1
        report = gate(evidence, workload_git_blob_sha="0" * 40)
        self.assertEqual(report["status"], "FAIL")
        self.assertIn("workload_definition_changed_rebaseline_required", report["reasons"])
        self.assertTrue(any("workload_units_changed" in reason for reason in report["reasons"]))

    def test_tampered_measurement_cannot_reuse_old_evidence_hash(self):
        evidence = self.evidence()
        evidence["benchmarks"][0]["peak_python_bytes"] += 1
        report = gate(evidence, workload_git_blob_sha=BASELINE_CONTRACT["workload_git_blob_sha"])
        self.assertEqual(report["status"], "FAIL")
        self.assertIn("evidence_hash_mismatch", report["reasons"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
