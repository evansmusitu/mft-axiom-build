from __future__ import annotations

from datetime import datetime, timedelta, timezone
import unittest

from frontier_review_safe.baseline_registry import BaselineRegistration, BaselineRegistry
from frontier_review_safe.external_attestation import ExternalAttestationService
from frontier_review_safe.external_execution import ProviderBoundExternalRunRecord
from frontier_review_safe.external_validation import (
    ExternalEvidenceGate,
    IndependentValidationRecord,
    LongitudinalRefreshRecord,
)


NOW = datetime(2026, 9, 11, 16, 45, tzinfo=timezone.utc)
CANDIDATE_SHA = "d" * 40
CASE_SET_HASH = "a" * 64
CONSTRAINT_HASH = "b" * 64
PERMISSIONS_HASH = "c" * 64
CONFIGURATION_HASH = "6" * 64
ACCOUNT_SCOPE_HASH = "7" * 64


def registry(providers: tuple[str, ...]) -> BaselineRegistry:
    registrations = tuple(
        BaselineRegistration(
            registration_id=f"reg-{i}",
            provider_org=provider,
            provider_class="general_agent",
            product="agent",
            exact_version="v1",
            access_mode="api",
            registered_at=(NOW - timedelta(minutes=5)).isoformat(),
            valid_until=(NOW + timedelta(days=1)).isoformat(),
            case_set_hash=CASE_SET_HASH,
            constraint_hash=CONSTRAINT_HASH,
            permissions_hash=PERMISSIONS_HASH,
            configuration_hash=CONFIGURATION_HASH,
            account_scope_hash=ACCOUNT_SCOPE_HASH,
            capabilities=("sealed_eval",),
        )
        for i, provider in enumerate(providers)
    )
    return BaselineRegistry(
        "musitu.axiom.baseline-registry.v1",
        "unicode-compatibility-v1",
        (NOW - timedelta(minutes=5)).isoformat(),
        registrations,
    )


def run_for(registry_value: BaselineRegistry, index: int) -> ProviderBoundExternalRunRecord:
    registration = registry_value.registrations[index]
    return ProviderBoundExternalRunRecord(
        run_id=f"run-{index}",
        provider_org=registration.provider_org,
        product=registration.product,
        exact_version=registration.exact_version,
        executed_at=NOW.isoformat(),
        access_mode=registration.access_mode,
        case_set_hash=CASE_SET_HASH,
        constraint_hash=CONSTRAINT_HASH,
        permissions_hash=PERMISSIONS_HASH,
        result_hash=f"{index + 10:064x}",
        raw_evidence_hash=f"{index + 20:064x}",
        provenance_type="provider_api_receipt",
        authenticated=True,
        candidate_sha=CANDIDATE_SHA,
        candidate_environment_hash="f" * 64,
        metrics={"score": 0.9},
        configuration_hash=CONFIGURATION_HASH,
        account_scope_hash=ACCOUNT_SCOPE_HASH,
        baseline_registry_hash=registry_value.fingerprint,
        baseline_registration_id=registration.registration_id,
        baseline_registration_hash=registration.fingerprint,
        provider_receipt_hash=f"{index + 30:064x}",
        provider_request_id=f"request-{index}",
        provider_response_id=f"response-{index}",
    )


class UnicodeCompatibilityOrganizationIdentityTests(unittest.TestCase):
    def test_nfkc_aliases_cannot_inflate_registry_provider_coverage(self):
        value = registry(("ＯｐｅｎＡＩ", "OpenAI", "Other Org"))
        report = value.coverage()
        self.assertEqual(report["provider_orgs"], ["openai", "other org"])

    def test_nfkc_aliases_cannot_inflate_level5_provider_floor(self):
        value = registry(("ＯｐｅｎＡＩ", "OpenAI", "Other Org"))
        runs = tuple(run_for(value, i) for i in range(3))
        secret = b"i" * 32
        receipts = tuple(
            ExternalAttestationService.issue(
                subject_type="external_run",
                subject_id=run.run_id,
                subject_hash=run.fingerprint,
                issuer_org="Independent Evaluator",
                verifier_key_id="ind-key",
                provenance_type=run.provenance_type,
                issued_at=run.executed_at,
                verifier_secret=secret,
            )
            for run in runs
        )
        result = ExternalEvidenceGate.level5(
            runs,
            receipts=receipts,
            verifier_secrets={"ind-key": secret},
            trusted_issuers={"Independent Evaluator": frozenset({"ind-key"})},
            baseline_registry=value,
        )
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("insufficient_independent_providers", result["reasons"])
        self.assertEqual(result["provider_orgs"], ["openai", "other org"])

    def test_nfkc_provider_alias_cannot_masquerade_as_level5_attester(self):
        value = registry(("OpenAI", "Other B", "Other C"))
        runs = tuple(run_for(value, i) for i in range(3))
        secret = b"a" * 32
        receipts = tuple(
            ExternalAttestationService.issue(
                subject_type="external_run",
                subject_id=run.run_id,
                subject_hash=run.fingerprint,
                issuer_org="ＯｐｅｎＡＩ",
                verifier_key_id="alias-key",
                provenance_type=run.provenance_type,
                issued_at=run.executed_at,
                verifier_secret=secret,
            )
            for run in runs
        )
        result = ExternalEvidenceGate.level5(
            runs,
            receipts=receipts,
            verifier_secrets={"alias-key": secret},
            trusted_issuers={"ＯｐｅｎＡＩ": frozenset({"alias-key"})},
            baseline_registry=value,
        )
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("external_attestation_issuer_overlaps_level5_provider", result["reasons"])
        self.assertEqual(result["run_count"], 0)

    def test_nfkc_provider_alias_cannot_masquerade_as_level6_validator(self):
        level5 = {
            "status": "PASS",
            "attestation_verified": True,
            "baseline_registry_verified": True,
            "candidate_sha": CANDIDATE_SHA,
            "case_set_hash": CASE_SET_HASH,
            "provider_orgs": ["OpenAI", "Other B", "Other C"],
            "latest_external_run_at": NOW.isoformat(),
        }
        validation = IndependentValidationRecord(
            validator_org="ＯｐｅｎＡＩ",
            validated_at=NOW.isoformat(),
            candidate_sha=CANDIDATE_SHA,
            case_set_hash=CASE_SET_HASH,
            reproduction_hash="9" * 64,
            passed=True,
            provenance_type="independent_lab_record",
        )
        secret = b"v" * 32
        signed = ExternalAttestationService.issue(
            subject_type="independent_validation",
            subject_id=validation.fingerprint,
            subject_hash=validation.fingerprint,
            issuer_org="Independent Witness",
            verifier_key_id="witness-key",
            provenance_type=validation.provenance_type,
            issued_at=NOW.isoformat(),
            verifier_secret=secret,
        )
        result = ExternalEvidenceGate.level6(
            level5,
            (validation,),
            receipts=(signed,),
            verifier_secrets={"witness-key": secret},
            trusted_issuers={"Independent Witness": frozenset({"witness-key"})},
        )
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("validator_overlaps_level5_provider", result["reasons"])
        self.assertEqual(result["validation_count"], 0)

    def test_nfkc_provider_alias_cannot_masquerade_as_level7_executor(self):
        level6 = {
            "status": "PASS",
            "attestation_verified": True,
            "candidate_sha": CANDIDATE_SHA,
            "case_set_hash": CASE_SET_HASH,
            "level5_provider_orgs": ["OpenAI", "Other B", "Other C"],
            "latest_validation_at": NOW.isoformat(),
        }
        refreshes = tuple(
            LongitudinalRefreshRecord(
                refresh_id=f"refresh-{i}",
                executed_at=(NOW + timedelta(days=i)).isoformat(),
                candidate_sha=CANDIDATE_SHA,
                case_set_hash=CASE_SET_HASH,
                baseline_registry_hash=("1" if i < 2 else "2") * 64,
                retained_failure_corpus_hash="3" * 64,
                drift_report_hash="4" * 64,
                replacement_governance_hash="5" * 64,
                passed=True,
                provenance_type="independent_lab_record",
                executor_org="ＯｐｅｎＡＩ",
            )
            for i in range(3)
        )
        secret = b"r" * 32
        receipts = tuple(
            ExternalAttestationService.issue(
                subject_type="longitudinal_refresh",
                subject_id=refresh.refresh_id,
                subject_hash=refresh.fingerprint,
                issuer_org="Independent Longitudinal Evaluator",
                verifier_key_id="refresh-key",
                provenance_type=refresh.provenance_type,
                issued_at=refresh.executed_at,
                verifier_secret=secret,
            )
            for refresh in refreshes
        )
        result = ExternalEvidenceGate.level7(
            level6,
            refreshes,
            receipts=receipts,
            verifier_secrets={"refresh-key": secret},
            trusted_issuers={"Independent Longitudinal Evaluator": frozenset({"refresh-key"})},
        )
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("longitudinal_refresh_executor_overlaps_level5_provider", result["reasons"])
        self.assertEqual(result["refresh_count"], 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
