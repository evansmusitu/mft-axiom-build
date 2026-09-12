from __future__ import annotations

from datetime import datetime, timedelta, timezone
import unittest

from frontier_review_safe.baseline_registry import BaselineRegistration, BaselineRegistry
from frontier_review_safe.external_validation import (
    ClaimBoundary,
    ExternalEvidenceGate,
    ExternalRunRecord,
)


NOW = datetime(2026, 9, 11, 19, 15, tzinfo=timezone.utc)
CANDIDATE_SHA = "d" * 40
CASE_SET_HASH = "a" * 64
CONSTRAINT_HASH = "b" * 64


def level5_fixture():
    providers = ("Provider A", "Provider B", "Provider C")
    registrations = tuple(
        BaselineRegistration(
            registration_id=f"reg-{i}",
            provider_org=provider,
            provider_class="general_agent",
            product="agent",
            exact_version="v1",
            access_mode="api",
            registered_at=(NOW - timedelta(hours=1)).isoformat(),
            valid_until=(NOW + timedelta(days=30)).isoformat(),
            case_set_hash=CASE_SET_HASH,
            constraint_hash=CONSTRAINT_HASH,
            permissions_hash="c" * 64,
            configuration_hash="6" * 64,
            account_scope_hash="7" * 64,
            capabilities=("sealed_eval",),
        )
        for i, provider in enumerate(providers)
    )
    registry = BaselineRegistry(
        "musitu.axiom.baseline-registry.v1",
        "malformed-receipt-v1",
        (NOW - timedelta(hours=1)).isoformat(),
        registrations,
    )
    runs = tuple(
        ExternalRunRecord(
            run_id=f"run-{i}",
            provider_org=provider,
            product="agent",
            exact_version="v1",
            executed_at=NOW.isoformat(),
            access_mode="api",
            case_set_hash=CASE_SET_HASH,
            constraint_hash=CONSTRAINT_HASH,
            permissions_hash="c" * 64,
            result_hash="8" * 64,
            raw_evidence_hash=f"{i + 1:064x}",
            provenance_type="provider_api_receipt",
            authenticated=True,
            candidate_sha=CANDIDATE_SHA,
            candidate_environment_hash="9" * 64,
            metrics={"score": 0.8},
            configuration_hash="6" * 64,
            account_scope_hash="7" * 64,
            baseline_registry_hash=registry.fingerprint,
            baseline_registration_id=registration.registration_id,
            baseline_registration_hash=registration.fingerprint,
        )
        for i, (provider, registration) in enumerate(zip(providers, registrations))
    )
    return registry, runs


class MalformedAttestationReceiptFailClosedTests(unittest.TestCase):
    def test_level5_malformed_receipt_object_fails_without_raising(self):
        registry, runs = level5_fixture()
        result = ExternalEvidenceGate.level5(
            runs,
            receipts=[None],
            verifier_secrets={},
            trusted_issuers={},
            baseline_registry=registry,
        )
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("invalid_external_run_attestation_receipt", result["reasons"])

    def test_level6_malformed_receipt_object_fails_without_raising(self):
        level5 = {
            "status": "PASS",
            "attestation_verified": True,
            "baseline_registry_verified": True,
            "candidate_sha": CANDIDATE_SHA,
            "case_set_hash": CASE_SET_HASH,
            "provider_orgs": ["Provider A", "Provider B", "Provider C"],
        }
        result = ExternalEvidenceGate.level6(
            level5,
            [],
            receipts=[{"subject_type": "independent_validation"}],
            verifier_secrets={},
            trusted_issuers={},
        )
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("invalid_independent_validation_attestation_receipt", result["reasons"])

    def test_level7_malformed_receipt_object_fails_without_raising(self):
        level6 = {
            "status": "PASS",
            "attestation_verified": True,
            "candidate_sha": CANDIDATE_SHA,
            "case_set_hash": CASE_SET_HASH,
            "level5_provider_orgs": ["provider a", "provider b", "provider c"],
            "latest_validation_at": NOW.isoformat(),
        }
        result = ExternalEvidenceGate.level7(
            level6,
            [],
            receipts=["not-a-receipt"],
            verifier_secrets={},
            trusted_issuers={},
        )
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("invalid_longitudinal_refresh_attestation_receipt", result["reasons"])

    def test_verified_claim_malformed_receipt_denies_not_raises(self):
        registry, runs = level5_fixture()
        result = ClaimBoundary.authorize_verified(
            "outperformed registered baselines on sealed suite",
            runs=runs,
            run_receipts=[None],
            verifier_secrets={},
            trusted_issuers={},
            baseline_registry=registry,
            candidate_results=(),
            baseline_results_by_run={},
            comparison_scope="sealed suite",
            benchmark_hash=CASE_SET_HASH,
        )
        self.assertEqual(result["status"], "DENY")
        self.assertEqual(result["verified_evidence_levels"]["level5"], "FAIL")


if __name__ == "__main__":
    unittest.main(verbosity=2)
