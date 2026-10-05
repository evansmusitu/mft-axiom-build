from __future__ import annotations

import unittest

from frontier_review_safe.external_validation import ClaimBoundary, ExternalEvidenceGate


HASH = "a" * 64
CANDIDATE_SHA = "d" * 40


def _level5_pass(**overrides):
    value = {
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
    value.update(overrides)
    return value


class MalformedNestedAssessmentTests(unittest.TestCase):
    def test_level6_non_iterable_provider_orgs_fails_closed_without_exception(self):
        result = ExternalEvidenceGate.level6(_level5_pass(provider_orgs=None), [])
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("invalid_level5_provider_orgs", result["reasons"])
        self.assertFalse(result["attestation_verified"])

    def test_level7_non_iterable_level5_provider_orgs_fails_closed_without_exception(self):
        level6 = {
            "status": "PASS",
            "attestation_verified": True,
            "candidate_sha": CANDIDATE_SHA,
            "case_set_hash": HASH,
            "level5_provider_orgs": None,
        }
        result = ExternalEvidenceGate.level7(level6, [])
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("invalid_level6_provider_orgs", result["reasons"])
        self.assertFalse(result["attestation_verified"])

    def test_claim_boundary_non_iterable_level5_provider_orgs_is_denied_without_exception(self):
        result = ClaimBoundary.authorize(
            "scoped comparison",
            level5=_level5_pass(provider_orgs=None),
            level6={"status": "FAIL", "attestation_verified": False},
            level7={"status": "FAIL", "attestation_verified": False},
            comparison_scope="sealed benchmark",
            benchmark_hash=HASH,
        )
        self.assertEqual(result["status"], "DENY")
        self.assertEqual(result["reason"], "invalid_level5_provider_orgs")

    def test_claim_boundary_non_iterable_level5_run_ids_is_denied_without_exception(self):
        result = ClaimBoundary.authorize(
            "scoped comparison",
            level5=_level5_pass(run_ids=None),
            level6={"status": "FAIL", "attestation_verified": False},
            level7={"status": "FAIL", "attestation_verified": False},
            comparison_scope="sealed benchmark",
            benchmark_hash=HASH,
        )
        self.assertEqual(result["status"], "DENY")
        self.assertEqual(result["reason"], "invalid_level5_run_ids")

    def test_claim_boundary_non_mapping_level5_receipt_hashes_is_denied_without_exception(self):
        result = ClaimBoundary.authorize(
            "scoped comparison",
            level5=_level5_pass(run_receipt_hashes=None),
            level6={"status": "FAIL", "attestation_verified": False},
            level7={"status": "FAIL", "attestation_verified": False},
            comparison_scope="sealed benchmark",
            benchmark_hash=HASH,
        )
        self.assertEqual(result["status"], "DENY")
        self.assertEqual(result["reason"], "invalid_level5_run_receipt_hashes")


if __name__ == "__main__":
    unittest.main(verbosity=2)
