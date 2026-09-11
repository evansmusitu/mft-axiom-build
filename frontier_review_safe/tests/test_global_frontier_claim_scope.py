from __future__ import annotations

import unittest

from frontier_review_safe.external_validation import ClaimBoundary, ComparativeOutcome


CANDIDATE_SHA = "d" * 40
CASE_SET_HASH = "a" * 64
CONSTRAINT_HASH = "b" * 64


def assessments(providers):
    receipt_hashes = {f"run-{i}": f"{i + 30:064x}" for i in range(len(providers))}
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


class GlobalFrontierClaimScopeTests(unittest.TestCase):
    def authorize(self, claim, providers, required=None):
        level5, level6, level7, outcomes = assessments(providers)
        return ClaimBoundary._authorize_from_assessments(
            claim,
            level5=level5,
            level6=level6,
            level7=level7,
            comparison_scope="declared sealed scope",
            benchmark_hash=CASE_SET_HASH,
            comparative_outcomes=outcomes,
            required_provider_orgs=providers if required is None else required,
        )

    def test_world_best_cannot_substitute_four_unrelated_positive_providers(self):
        providers = ("xAI", "Meta", "Mistral", "Cohere")
        result = self.authorize("world best", providers)
        self.assertEqual(result["status"], "DENY")
        self.assertEqual(result["reason"], "frontier_provider_coverage_incomplete")
        self.assertEqual(
            set(result["missing_frontier_provider_orgs"]),
            {"openai", "anthropic", "google", "microsoft"},
        )

    def test_global_claim_rejects_partial_frontier_substitution(self):
        providers = ("OpenAI", "Anthropic", "Google", "xAI")
        result = self.authorize("global frontier leader", providers)
        self.assertEqual(result["status"], "DENY")
        self.assertEqual(result["reason"], "frontier_provider_coverage_incomplete")
        self.assertEqual(result["missing_frontier_provider_orgs"], ["microsoft"])

    def test_generic_global_claim_internal_mechanics_require_all_frontier_providers(self):
        providers = ("OpenAI", "Anthropic", "Google", "Microsoft")
        result = self.authorize("world best", providers)
        self.assertEqual(result["status"], "ALLOW")
        self.assertEqual(
            set(result["frontier_provider_orgs"]),
            {"openai", "anthropic", "google", "microsoft"},
        )

    def test_specific_named_provider_comparison_does_not_expand_to_unmentioned_frontier_providers(self):
        providers = ("OpenAI", "xAI", "Meta", "Mistral")
        result = self.authorize("better than OpenAI", providers)
        self.assertEqual(result["status"], "ALLOW")
        self.assertEqual(result["named_provider_orgs"], ["openai"])

    def test_global_wording_plus_named_provider_still_requires_full_frontier_coverage(self):
        providers = ("OpenAI", "Anthropic", "Google", "xAI")
        result = self.authorize("world leading and better than OpenAI", providers)
        self.assertEqual(result["status"], "DENY")
        self.assertEqual(result["reason"], "frontier_provider_coverage_incomplete")
        self.assertEqual(result["missing_frontier_provider_orgs"], ["microsoft"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
