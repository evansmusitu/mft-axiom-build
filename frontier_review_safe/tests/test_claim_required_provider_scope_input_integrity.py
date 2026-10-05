from __future__ import annotations

import unittest

from frontier_review_safe.external_validation import ClaimBoundary, ComparativeOutcome


CASE_HASH = "a" * 64
CONSTRAINT_HASH = "b" * 64
RECEIPT_HASH = "c" * 64
CANDIDATE_SHA = "d" * 40


def _level5_pass() -> dict[str, object]:
    return {
        "status": "PASS",
        "attestation_verified": True,
        "baseline_registry_verified": True,
        "provider_orgs": ["provider-a"],
        "run_ids": ["run-1"],
        "candidate_sha": CANDIDATE_SHA,
        "case_set_hash": CASE_HASH,
        "constraint_hash": CONSTRAINT_HASH,
        "run_receipt_hashes": {"run-1": RECEIPT_HASH},
    }


def _positive_outcome() -> ComparativeOutcome:
    return ComparativeOutcome(
        provider_org="provider-a",
        external_run_id="run-1",
        candidate_sha=CANDIDATE_SHA,
        case_set_hash=CASE_HASH,
        constraint_hash=CONSTRAINT_HASH,
        external_result_hash="e" * 64,
        raw_external_evidence_hash="f" * 64,
        matched_cases=5,
        mean_delta=0.4,
        ci_low_delta=0.1,
        ci_high_delta=0.7,
        candidate_wins=5,
        baseline_wins=0,
        ties=0,
        attestation_receipt_hash=RECEIPT_HASH,
    )


class ClaimRequiredProviderScopeInputIntegrityTests(unittest.TestCase):
    def test_non_iterable_required_provider_scope_is_denied_without_exception(self):
        result = ClaimBoundary.authorize(
            "scoped comparison",
            level5=_level5_pass(),
            level6={"status": "FAIL", "attestation_verified": False},
            level7={"status": "FAIL", "attestation_verified": False},
            comparison_scope="sealed benchmark",
            benchmark_hash=CASE_HASH,
            comparative_outcomes=[_positive_outcome()],
            required_provider_orgs=None,
        )
        self.assertEqual(result["status"], "DENY")
        self.assertEqual(result["reason"], "invalid_required_provider_orgs")


if __name__ == "__main__":
    unittest.main(verbosity=2)
