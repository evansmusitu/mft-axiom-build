from __future__ import annotations

import unittest

from frontier_review_safe.external_validation import (
    ClaimBoundary,
    ComparativeOutcome,
    ExternalEvidenceGate,
    IndependentValidationRecord,
    _independence_organization_key,
    _organization_key,
)


CANDIDATE_SHA = "d" * 40
CASE_SET_HASH = "a" * 64
CONSTRAINT_HASH = "b" * 64


class OrganizationAttributionVsIndependenceTests(unittest.TestCase):
    def test_cross_script_alias_does_not_become_same_provider_attribution(self):
        self.assertNotEqual(_organization_key("OpenAI"), _organization_key("ОpenAI"))  # Cyrillic O

    def test_cross_script_alias_must_collapse_for_independence_checks(self):
        self.assertEqual(
            _independence_organization_key("OpenAI"),
            _independence_organization_key("ОpenAI"),  # Cyrillic O
        )

    def test_confusable_provider_cannot_inflate_level5_independent_provider_floor(self):
        level5 = {
            "status": "PASS",
            "attestation_verified": True,
            "baseline_registry_verified": True,
            "candidate_sha": CANDIDATE_SHA,
            "case_set_hash": CASE_SET_HASH,
            "constraint_hash": CONSTRAINT_HASH,
            "provider_orgs": ["OpenAI", "ОpenAI", "Other Org"],
            "run_ids": [],
            "run_receipt_hashes": {},
        }
        independent = {
            _independence_organization_key(provider)
            for provider in level5["provider_orgs"]
        }
        self.assertEqual(len(independent), 2)

    def test_confusable_provider_cannot_masquerade_as_level6_validator(self):
        level5 = {
            "status": "PASS",
            "attestation_verified": True,
            "baseline_registry_verified": True,
            "candidate_sha": CANDIDATE_SHA,
            "case_set_hash": CASE_SET_HASH,
            "provider_orgs": ["OpenAI", "Provider B", "Provider C"],
        }
        record = IndependentValidationRecord(
            validator_org="ОpenAI",  # Cyrillic O
            validated_at="2026-09-11T19:00:00+00:00",
            candidate_sha=CANDIDATE_SHA,
            case_set_hash=CASE_SET_HASH,
            reproduction_hash="9" * 64,
            passed=True,
            provenance_type="independent_lab_record",
        )
        # No receipt is needed to prove the validator must be rejected before attestation.
        result = ExternalEvidenceGate.level6(level5, [record])
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("validator_overlaps_level5_provider", result["reasons"])

    def test_spoofed_openai_name_cannot_satisfy_named_openai_claim_coverage(self):
        providers = ("ОpenAI", "anthropic", "google", "microsoft")  # Cyrillic O in first provider
        receipts = {f"run-{i}": f"{i + 30:064x}" for i in range(4)}
        level5 = {
            "status": "PASS",
            "attestation_verified": True,
            "baseline_registry_verified": True,
            "provider_orgs": list(providers),
            "run_ids": list(receipts),
            "candidate_sha": CANDIDATE_SHA,
            "case_set_hash": CASE_SET_HASH,
            "constraint_hash": CONSTRAINT_HASH,
            "run_receipt_hashes": receipts,
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
                mean_delta=0.1,
                ci_low_delta=0.02,
                ci_high_delta=0.18,
                candidate_wins=7,
                baseline_wins=2,
                ties=1,
                attestation_receipt_hash=receipts[f"run-{i}"],
            )
            for i, provider in enumerate(providers)
        )
        result = ClaimBoundary._authorize_from_assessments(
            "better than OpenAI",
            level5=level5,
            level6={"status": "PASS", "attestation_verified": True},
            level7={"status": "PASS", "attestation_verified": True},
            comparison_scope="sealed suite",
            benchmark_hash=CASE_SET_HASH,
            comparative_outcomes=outcomes,
            required_provider_orgs=providers,
        )
        self.assertEqual(result["status"], "DENY")
        self.assertEqual(result["reason"], "named_frontier_provider_not_positive")
        self.assertIn("openai", result["missing_named_provider_orgs"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
