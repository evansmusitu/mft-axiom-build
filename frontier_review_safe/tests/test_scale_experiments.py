from __future__ import annotations

import copy
import unittest

from frontier_review_safe.core import sha256
from frontier_review_safe.scale_experiments import (
    AUDIT_GROWTH_CHECKPOINTS,
    AUDIT_GROWTH_NAME,
    EXPECTED_NAMES,
    PROMOTION_STATUS,
    SCHEMA,
    validate_experimental_evidence,
)


class ScaleExperimentContractTests(unittest.TestCase):
    @staticmethod
    def _valid_evidence():
        experiments = []
        for name in sorted(EXPECTED_NAMES):
            details = {}
            units = 10
            if name == AUDIT_GROWTH_NAME:
                units = AUDIT_GROWTH_CHECKPOINTS[-1]
                details = {
                    "events": AUDIT_GROWTH_CHECKPOINTS[-1],
                    "checkpoint_serialized_bytes": {
                        "1000": 100_000,
                        "5000": 500_000,
                        "10000": 1_000_000,
                    },
                    "serialized_bytes": 1_000_000,
                    "bytes_per_event": 100.0,
                    "growth_ratio_10k_vs_1k": 10.0,
                    "chain_verified": True,
                    "ledger_fingerprint": "a" * 64,
                }
            experiments.append({
                "name": name,
                "units": units,
                "elapsed_ms": 1.0,
                "throughput_per_sec": 10.0,
                "peak_python_bytes": 100,
                "budget_eligible": False,
                "details": details,
            })
        evidence = {
            "schema": SCHEMA,
            "promotion_status": PROMOTION_STATUS,
            "experiments": experiments,
        }
        evidence["evidence_sha256"] = sha256(evidence)
        return evidence

    @staticmethod
    def _rehash(evidence):
        evidence.pop("evidence_sha256", None)
        evidence["evidence_sha256"] = sha256(evidence)
        return evidence

    def test_experimental_measurements_are_valid_but_never_budget_or_claim_authority(self):
        report = validate_experimental_evidence(self._valid_evidence())
        self.assertEqual(report["status"], "PASS")
        self.assertEqual(report["promotion_status"], PROMOTION_STATUS)
        self.assertEqual(report["experiment_count"], 5)
        self.assertFalse(report["budget_authorized"])
        self.assertFalse(report["claim_authorized"])

    def test_missing_workload_fails_closed(self):
        evidence = self._valid_evidence()
        evidence["experiments"].pop()
        report = validate_experimental_evidence(evidence)
        self.assertEqual(report["status"], "FAIL")
        self.assertIn("experiment_set_mismatch", report["reasons"])

    def test_duplicate_workload_name_cannot_fake_complete_experiment_set(self):
        evidence = self._valid_evidence()
        evidence["experiments"].append(copy.deepcopy(evidence["experiments"][0]))
        self._rehash(evidence)
        report = validate_experimental_evidence(evidence)
        self.assertEqual(report["status"], "FAIL")
        self.assertIn("experiment_set_mismatch", report["reasons"])

    def test_experiment_cannot_self_promote_into_budget_eligibility(self):
        evidence = copy.deepcopy(self._valid_evidence())
        evidence["experiments"][0]["budget_eligible"] = True
        report = validate_experimental_evidence(evidence)
        self.assertEqual(report["status"], "FAIL")
        self.assertIn("experiment_incorrectly_budget_eligible", report["reasons"])
        self.assertFalse(report["budget_authorized"])

    def test_promotion_status_cannot_be_laundered(self):
        evidence = self._valid_evidence()
        evidence["promotion_status"] = "PASS"
        report = validate_experimental_evidence(evidence)
        self.assertEqual(report["status"], "FAIL")
        self.assertIn("promotion_status_mismatch", report["reasons"])

    def test_tampered_measurement_cannot_reuse_old_evidence_hash(self):
        evidence = self._valid_evidence()
        evidence["experiments"][0]["elapsed_ms"] = 2.0
        report = validate_experimental_evidence(evidence)
        self.assertEqual(report["status"], "FAIL")
        self.assertIn("evidence_hash_mismatch", report["reasons"])
        self.assertFalse(report["budget_authorized"])
        self.assertFalse(report["claim_authorized"])

    def test_nonfinite_measurement_fails_even_with_fresh_hash(self):
        evidence = self._valid_evidence()
        evidence["experiments"][0]["elapsed_ms"] = "nan"
        self._rehash(evidence)
        report = validate_experimental_evidence(evidence)
        self.assertEqual(report["status"], "FAIL")
        self.assertIn("invalid_elapsed", report["reasons"])

    def test_audit_growth_requires_verified_monotonic_storage_evidence(self):
        evidence = self._valid_evidence()
        row = next(x for x in evidence["experiments"] if x["name"] == AUDIT_GROWTH_NAME)
        row["details"]["chain_verified"] = False
        row["details"]["checkpoint_serialized_bytes"]["5000"] = 50_000
        self._rehash(evidence)
        report = validate_experimental_evidence(evidence)
        self.assertEqual(report["status"], "FAIL")
        self.assertIn("audit_growth_details_invalid", report["reasons"])
        self.assertFalse(report["budget_authorized"])
        self.assertFalse(report["claim_authorized"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
