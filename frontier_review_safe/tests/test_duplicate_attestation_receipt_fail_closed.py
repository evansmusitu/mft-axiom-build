from __future__ import annotations

from datetime import datetime, timedelta, timezone
import unittest

from frontier_review_safe.baseline_registry import BaselineRegistration, BaselineRegistry
from frontier_review_safe.external_attestation import ExternalAttestationService
from frontier_review_safe.external_validation import (
    ClaimBoundary,
    ExternalEvidenceGate,
    ExternalRunRecord,
    IndependentValidationRecord,
    LongitudinalRefreshRecord,
)


NOW = datetime(2026, 9, 11, 19, 0, tzinfo=timezone.utc)
CANDIDATE_SHA = "d" * 40
CASE_SET_HASH = "a" * 64
CONSTRAINT_HASH = "b" * 64
SECRET = b"d" * 32
KEY_ID = "duplicate-key"
ISSUER = "Independent Duplicate Evaluator"
SECRETS = {KEY_ID: SECRET}
TRUST = {ISSUER: frozenset({KEY_ID})}


def issue(subject_type: str, subject_id: str, subject_hash: str, provenance_type: str, issued_at: str):
    return ExternalAttestationService.issue(
        subject_type=subject_type,
        subject_id=subject_id,
        subject_hash=subject_hash,
        issuer_org=ISSUER,
        verifier_key_id=KEY_ID,
        provenance_type=provenance_type,
        issued_at=issued_at,
        verifier_secret=SECRET,
    )


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
        "duplicate-v1",
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
    receipts = [
        issue("external_run", run.run_id, run.fingerprint, run.provenance_type, run.executed_at)
        for run in runs
    ]
    return registry, runs, receipts


class DuplicateAttestationReceiptFailClosedTests(unittest.TestCase):
    def test_level5_duplicate_receipt_fails_without_raising(self):
        registry, runs, receipts = level5_fixture()
        result = ExternalEvidenceGate.level5(
            runs,
            receipts=[*receipts, receipts[0]],
            verifier_secrets=SECRETS,
            trusted_issuers=TRUST,
            baseline_registry=registry,
        )
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("duplicate_external_run_attestation_receipt", result["reasons"])

    def test_level6_duplicate_receipt_fails_without_raising(self):
        record = IndependentValidationRecord(
            validator_org="Independent Lab",
            validated_at=NOW.isoformat(),
            candidate_sha=CANDIDATE_SHA,
            case_set_hash=CASE_SET_HASH,
            reproduction_hash="9" * 64,
            passed=True,
            provenance_type="independent_lab_record",
        )
        receipt = issue(
            "independent_validation", record.fingerprint, record.fingerprint,
            record.provenance_type, record.validated_at,
        )
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
            [record],
            receipts=[receipt, receipt],
            verifier_secrets=SECRETS,
            trusted_issuers=TRUST,
        )
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("duplicate_independent_validation_attestation_receipt", result["reasons"])

    def test_level7_duplicate_receipt_fails_without_raising(self):
        level6 = {
            "status": "PASS",
            "attestation_verified": True,
            "candidate_sha": CANDIDATE_SHA,
            "case_set_hash": CASE_SET_HASH,
            "level5_provider_orgs": ["provider a", "provider b", "provider c"],
            "latest_validation_at": NOW.isoformat(),
        }
        records = [
            LongitudinalRefreshRecord(
                refresh_id=f"r{i}",
                executed_at=(NOW + timedelta(days=i + 1)).isoformat(),
                candidate_sha=CANDIDATE_SHA,
                case_set_hash=CASE_SET_HASH,
                baseline_registry_hash=("4" if i % 2 == 0 else "5") * 64,
                retained_failure_corpus_hash="1" * 64,
                drift_report_hash="2" * 64,
                replacement_governance_hash="3" * 64,
                passed=True,
                provenance_type="independent_lab_record",
                executor_org="Independent Longitudinal Lab",
            )
            for i in range(3)
        ]
        receipts = [
            issue("longitudinal_refresh", r.refresh_id, r.fingerprint, r.provenance_type, r.executed_at)
            for r in records
        ]
        result = ExternalEvidenceGate.level7(
            level6,
            records,
            receipts=[*receipts, receipts[0]],
            verifier_secrets=SECRETS,
            trusted_issuers=TRUST,
        )
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("duplicate_longitudinal_refresh_attestation_receipt", result["reasons"])

    def test_verified_claim_duplicate_external_receipt_denies_not_raises(self):
        registry, runs, receipts = level5_fixture()
        result = ClaimBoundary.authorize_verified(
            "outperformed registered baselines on sealed suite",
            runs=runs,
            run_receipts=[*receipts, receipts[0]],
            verifier_secrets=SECRETS,
            trusted_issuers=TRUST,
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
