from __future__ import annotations

import unittest

from frontier_review_safe.external_validation import ClaimBoundary


HASH = "a" * 64
CANDIDATE_SHA = "d" * 40


def _level5_pass() -> dict[str, object]:
    return {
        "status": "PASS",
        "attestation_verified": True,
        "baseline_registry_verified": True,
        "provider_orgs": ["provider-a"],
        "run_ids": ["run-1"],
        "candidate_sha": CANDIDATE_SHA,
        "case_set_hash": HASH,
        "constraint_hash": "b" * 64,
        "run_receipt_hashes": {"run-1": "c" * 64},
    }


class ClaimBoundaryMalformedInputTests(unittest.TestCase):
    def test_non_string_requested_claim_is_denied_without_exception(self):
        result = ClaimBoundary.authorize(
            None,
            level5={},
            level6={},
            level7={},
            comparison_scope=None,
            benchmark_hash=None,
        )
        self.assertEqual(result["status"], "DENY")
        self.assertEqual(result["reason"], "invalid_requested_claim")

    def test_non_mapping_level5_assessment_is_denied_without_exception(self):
        result = ClaimBoundary.authorize(
            "scoped comparison",
            level5=None,
            level6={},
            level7={},
            comparison_scope=None,
            benchmark_hash=None,
        )
        self.assertEqual(result["status"], "DENY")
        self.assertEqual(result["reason"], "invalid_level5_assessment")

    def test_non_mapping_level6_assessment_is_denied_without_exception(self):
        result = ClaimBoundary.authorize(
            "scoped comparison",
            level5={},
            level6=None,
            level7={},
            comparison_scope=None,
            benchmark_hash=None,
        )
        self.assertEqual(result["status"], "DENY")
        self.assertEqual(result["reason"], "invalid_level6_assessment")

    def test_non_mapping_level7_assessment_is_denied_without_exception(self):
        result = ClaimBoundary.authorize(
            "scoped comparison",
            level5={},
            level6={},
            level7=None,
            comparison_scope=None,
            benchmark_hash=None,
        )
        self.assertEqual(result["status"], "DENY")
        self.assertEqual(result["reason"], "invalid_level7_assessment")

    def test_wrong_type_comparative_outcome_is_denied_without_exception(self):
        result = ClaimBoundary.authorize(
            "scoped comparison",
            level5=_level5_pass(),
            level6={"status": "FAIL", "attestation_verified": False},
            level7={"status": "FAIL", "attestation_verified": False},
            comparison_scope="sealed benchmark",
            benchmark_hash=HASH,
            comparative_outcomes=[object()],
        )
        self.assertEqual(result["status"], "DENY")
        self.assertEqual(result["reason"], "invalid_comparative_outcome")


if __name__ == "__main__":
    unittest.main(verbosity=2)
