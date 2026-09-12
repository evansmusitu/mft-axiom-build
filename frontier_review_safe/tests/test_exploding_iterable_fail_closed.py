from __future__ import annotations

from datetime import datetime, timedelta, timezone
import unittest

from frontier_review_safe.baseline_registry import BaselineRegistration, BaselineRegistry
from frontier_review_safe.external_validation import ClaimBoundary, ComparativeOutcome, ExternalEvidenceGate


CASE_HASH = "a" * 64
CONSTRAINT_HASH = "b" * 64
RECEIPT_HASH = "c" * 64
CANDIDATE_SHA = "d" * 40
NOW = datetime(2026, 9, 12, 5, 30, tzinfo=timezone.utc)


class ExplodingIterable:
    def __iter__(self):
        raise RuntimeError("iteration failed")


def _registry() -> BaselineRegistry:
    registration = BaselineRegistration(
        registration_id="reg-1",
        provider_org="Provider A",
        provider_class="general_agent",
        product="agent",
        exact_version="v1",
        access_mode="api",
        registered_at=(NOW - timedelta(minutes=5)).isoformat(),
        valid_until=(NOW + timedelta(days=1)).isoformat(),
        case_set_hash=CASE_HASH,
        constraint_hash=CONSTRAINT_HASH,
        permissions_hash="e" * 64,
        configuration_hash="f" * 64,
        account_scope_hash="1" * 64,
    )
    return BaselineRegistry(
        "musitu.axiom.baseline-registry.v1",
        "iterable-integrity-v1",
        NOW.isoformat(),
        (registration,),
    )


def _level5_pass(**overrides):
    data = {
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
    data.update(overrides)
    return data


def _positive_outcome() -> ComparativeOutcome:
    return ComparativeOutcome(
        provider_org="provider-a",
        external_run_id="run-1",
        candidate_sha=CANDIDATE_SHA,
        case_set_hash=CASE_HASH,
        constraint_hash=CONSTRAINT_HASH,
        external_result_hash="2" * 64,
        raw_external_evidence_hash="3" * 64,
        matched_cases=5,
        mean_delta=0.4,
        ci_low_delta=0.1,
        ci_high_delta=0.7,
        candidate_wins=5,
        baseline_wins=0,
        ties=0,
        attestation_receipt_hash=RECEIPT_HASH,
    )


class ExplodingIterableFailClosedTests(unittest.TestCase):
    def test_level5_required_provider_classes_exploding_iterable_fails_closed(self):
        result = ExternalEvidenceGate.level5([], required_provider_classes=ExplodingIterable())
        self.assertEqual(result["status"], "FAIL")
        self.assertEqual(result["reason"], "invalid_required_provider_classes")

    def test_level6_provider_orgs_exploding_iterable_fails_closed(self):
        result = ExternalEvidenceGate.level6({"provider_orgs": ExplodingIterable()}, [])
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("invalid_level5_provider_orgs", result["reasons"])

    def test_level7_provider_orgs_exploding_iterable_fails_closed(self):
        result = ExternalEvidenceGate.level7({"level5_provider_orgs": ExplodingIterable()}, [])
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("invalid_level6_provider_orgs", result["reasons"])

    def test_claim_level5_provider_orgs_exploding_iterable_is_denied(self):
        result = ClaimBoundary.authorize(
            "scoped comparison",
            level5=_level5_pass(provider_orgs=ExplodingIterable()),
            level6={"status": "FAIL"},
            level7={"status": "FAIL"},
            comparison_scope="sealed benchmark",
            benchmark_hash=CASE_HASH,
        )
        self.assertEqual(result["status"], "DENY")
        self.assertEqual(result["reason"], "invalid_level5_provider_orgs")

    def test_claim_required_provider_scope_exploding_iterable_is_denied(self):
        result = ClaimBoundary.authorize(
            "scoped comparison",
            level5=_level5_pass(),
            level6={"status": "FAIL"},
            level7={"status": "FAIL"},
            comparison_scope="sealed benchmark",
            benchmark_hash=CASE_HASH,
            comparative_outcomes=[_positive_outcome()],
            required_provider_orgs=ExplodingIterable(),
        )
        self.assertEqual(result["status"], "DENY")
        self.assertEqual(result["reason"], "invalid_required_provider_orgs")

    def test_baseline_coverage_exploding_requirement_iterables_fail_closed(self):
        registry = _registry()
        orgs = registry.coverage(required_provider_orgs=ExplodingIterable())
        self.assertEqual(orgs["status"], "FAIL")
        self.assertIn("invalid_required_provider_orgs", orgs["reasons"])
        classes = registry.coverage(required_provider_classes=ExplodingIterable())
        self.assertEqual(classes["status"], "FAIL")
        self.assertIn("invalid_required_provider_classes", classes["reasons"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
