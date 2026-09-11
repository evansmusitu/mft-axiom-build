from __future__ import annotations

import unittest

from frontier_review_safe.external_validation import ClaimBoundary, ComparativeOutcome


CANDIDATE_SHA = "d" * 40
CASE_SET_HASH = "a" * 64
CONSTRAINT_HASH = "b" * 64


def assessments(providers):
    receipt_hashes = {f"run-{i}": f"{i + 10:064x}" for i in range(len(providers))}
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
    level6 = {"status": "PASS", "attestation_verified": True}
    level7 = {"status": "PASS", "attestation_verified": True}
    outcomes = [
        ComparativeOutcome(
            provider_org=provider,
            external_run_id=f"run-{i}",
            candidate_sha=CANDIDATE_SHA,
            case_set_hash=CASE_SET_HASH,
            constraint_hash=CONSTRAINT_HASH,
            external_result_hash="c" * 64,
            raw_external_evidence_hash="e" * 64,
            matched_cases=10,
            mean_delta=.10,
            ci_low_delta=.02,
            ci_high_delta=.18,
            candidate_wins=7,
            baseline_wins=2,
            ties=1,
            attestation_receipt_hash=receipt_hashes[f"run-{i}"],
        )
        for i, provider in enumerate(providers)
    ]
    return level5, level6, level7, outcomes


class NamedProviderClaimBindingTests(unittest.TestCase):
    def test_named_provider_is_extracted_as_exact_normalized_word(self):
        self.assertEqual(ClaimBoundary._named_frontier_providers("Better than OpenAI and Google."), {"openai", "google"})
        self.assertEqual(ClaimBoundary._named_frontier_providers("openair research system"), set())

    def test_named_openai_claim_cannot_use_four_other_positive_providers(self):
        providers = ("Anthropic", "Google", "Microsoft", "xAI")
        level5, level6, level7, outcomes = assessments(providers)
        result = ClaimBoundary._authorize_from_assessments(
            "better than OpenAI",
            level5=level5,
            level6=level6,
            level7=level7,
            comparison_scope="declared sealed scope",
            benchmark_hash=CASE_SET_HASH,
            comparative_outcomes=outcomes,
            required_provider_orgs=providers,
        )
        self.assertEqual(result["status"], "DENY")
        self.assertEqual(result["reason"], "named_frontier_provider_not_positive")
        self.assertEqual(result["missing_named_provider_orgs"], ["openai"])

    def test_named_provider_can_only_pass_internal_mechanics_when_it_is_positive(self):
        providers = ("OpenAI", "Anthropic", "Google", "Microsoft")
        level5, level6, level7, outcomes = assessments(providers)
        result = ClaimBoundary._authorize_from_assessments(
            "better than OpenAI",
            level5=level5,
            level6=level6,
            level7=level7,
            comparison_scope="declared sealed scope",
            benchmark_hash=CASE_SET_HASH,
            comparative_outcomes=outcomes,
            required_provider_orgs=providers,
        )
        self.assertEqual(result["status"], "ALLOW")
        self.assertEqual(result["named_provider_orgs"], ["openai"])

    def test_public_summary_api_still_cannot_turn_internal_mechanics_into_claim_authority(self):
        providers = ("OpenAI", "Anthropic", "Google", "Microsoft")
        level5, level6, level7, outcomes = assessments(providers)
        result = ClaimBoundary.authorize(
            "better than OpenAI",
            level5=level5,
            level6=level6,
            level7=level7,
            comparison_scope="declared sealed scope",
            benchmark_hash=CASE_SET_HASH,
            comparative_outcomes=outcomes,
            required_provider_orgs=providers,
        )
        self.assertEqual(result["status"], "DENY")
        self.assertEqual(result["reason"], "verified_external_evidence_required")


if __name__ == "__main__":
    unittest.main(verbosity=2)
