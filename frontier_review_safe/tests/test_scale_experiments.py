from __future__ import annotations

import copy
import unittest

from frontier_review_safe.core import sha256
from frontier_review_safe.scale_experiments import (
    EXPECTED_NAMES,
    PROMOTION_STATUS,
    SCHEMA,
    validate_experimental_evidence,
)


class ScaleExperimentContractTests(unittest.TestCase):
    @staticmethod
    def _valid_evidence():
        evidence = {
            "schema": SCHEMA,
            "promotion_status": PROMOTION_STATUS,
            "experiments": [
                {
                    "name": name,
                    "units": 10,
                    "elapsed_ms": 1.0,
                    "throughput_per_sec": 10.0,
                    "peak_python_bytes": 100,
                    "budget_eligible": False,
                    "details": {},
                }
                for name in sorted(EXPECTED_NAMES)
            ],
        }
        evidence["evidence_sha256"] = sha256(evidence)
        return evidence

    def test_experimental_measurements_are_valid_but_never_budget_or_claim_authority(self):
        report = validate_experimental_evidence(self._valid_evidence())
        self.assertEqual(report["status"], "PASS")
        self.assertEqual(report["promotion_status"], PROMOTION_STATUS)
        self.assertFalse(report["budget_authorized"])
        self.assertFalse(report["claim_authorized"])

    def test_missing_workload_fails_closed(self):
        evidence = self._valid_evidence()
        evidence["experiments"].pop()
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


if __name__ == "__main__":
    unittest.main(verbosity=2)
