from __future__ import annotations

import unittest

from frontier_review_safe.external_validation import ClaimBoundary, ComparativeOutcome


CANDIDATE_SHA = "d" * 40
CASE_SET_HASH = "a" * 64
CONSTRAINT_HASH = "b" * 64


def level5_and_outcomes():
    providers = ("provider-a", "provider-b", "provider-c")
    receipt_hashes = {f"run-{i}": f"{i + 30:064x}" for i in range(3)}
    level5 = {
        "status": "PASS",
        "attestation_verified": True,
        "baseline_registry_verified": True,
        "provider_orgs": list(providers),
        "run_ids": list(receipt_hashes),
        "candidate_sha": CANDIDATE_SHA,
        "case_set_hash": CASE_SET_HASH,
        "constraint_hash": CONSTRAINT_HASH,
        "run_receipt_hashes": receipt_hashes,
    }
    outcomes = tuple(
        ComparativeOutcome(
            provider_org=provider,
            external_run_id=f"run-{i}",
            candidate_sha=CANDIDATE_SHA,
            case_set_hash=CASE_SET_HASH,
            constraint_hash=CONSTRAINT_HASH,
            external_result_hash=f"{i + 40:064x}",
            raw_external_evidence_hash=f"{i + 50:064x}",
            matched_cases=10,
            mean_delta=0.10,
            ci_low_delta=0.02,
            ci_high_delta=0.18,
            candidate_wins=7,
            baseline_wins=2,
            ties=1,
            attestation_receipt_hash=receipt_hashes[f"run-{i}"],
        )
        for i, provider in enumerate(providers)
    )
    return level5, outcomes


class ClaimBenchmarkBindingTests(unittest.TestCase):
    def test_unrelated_benchmark_hash_cannot_be_laundered_into_claim_boundary(self):
        level5, outcomes = level5_and_outcomes()
        result = ClaimBoundary._authorize_from_assessments(
            "outperformed registered baselines on sealed suite",
            level5=level5,
            level6={"status": "FAIL", "attestation_verified": False},
            level7={"status": "FAIL", "attestation_verified": False},
            comparison_scope="sealed suite",
            benchmark_hash="f" * 64,
            comparative_outcomes=outcomes,
            required_provider_orgs=(),
        )
        self.assertEqual(result["status"], "DENY")
        self.assertEqual(result["max_evidence_level"], 5)
        self.assertEqual(result["reason"], "comparison_benchmark_hash_mismatch")

    def test_level5_case_set_hash_remains_valid_benchmark_identity(self):
        level5, outcomes = level5_and_outcomes()
        result = ClaimBoundary._authorize_from_assessments(
            "outperformed registered baselines on sealed suite",
            level5=level5,
            level6={"status": "FAIL", "attestation_verified": False},
            level7={"status": "FAIL", "attestation_verified": False},
            comparison_scope="sealed suite",
            benchmark_hash=CASE_SET_HASH,
            comparative_outcomes=outcomes,
            required_provider_orgs=(),
        )
        self.assertEqual(result["status"], "ALLOW")
        self.assertEqual(result["max_evidence_level"], 5)
        self.assertIn(CASE_SET_HASH, result["claim_boundary"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
