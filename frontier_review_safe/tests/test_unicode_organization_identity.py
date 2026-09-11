from __future__ import annotations

from datetime import datetime, timedelta, timezone
import unittest

from frontier_review_safe.baseline_registry import BaselineRegistration, BaselineRegistry
from frontier_review_safe.external_attestation import ExternalAttestationService
from frontier_review_safe.external_validation import (
    ExternalEvidenceGate,
    ExternalRunRecord,
    IndependentValidationRecord,
    LongitudinalRefreshRecord,
)


NOW = datetime(2026, 9, 11, 13, 20, tzinfo=timezone.utc)
CANDIDATE_SHA = "d" * 40
CASE_SET_HASH = "a" * 64
CONSTRAINT_HASH = "b" * 64
PERMISSIONS_HASH = "c" * 64
CONFIGURATION_HASH = "6" * 64
ACCOUNT_SCOPE_HASH = "7" * 64
ENVIRONMENT_HASH = "f" * 64


def registry_and_runs(providers: tuple[str, ...]):
    registrations = tuple(
        BaselineRegistration(
            registration_id=f"reg-{i}",
            provider_org=provider,
            provider_class="general_agent",
            product="agent",
            exact_version="v1",
            access_mode="api",
            registered_at=(NOW - timedelta(minutes=5)).isoformat(),
            valid_until=(NOW + timedelta(days=30)).isoformat(),
            case_set_hash=CASE_SET_HASH,
            constraint_hash=CONSTRAINT_HASH,
            permissions_hash=PERMISSIONS_HASH,
            configuration_hash=CONFIGURATION_HASH,
            account_scope_hash=ACCOUNT_SCOPE_HASH,
            capabilities=("sealed_eval",),
        )
        for i, provider in enumerate(providers)
    )
    registry = BaselineRegistry(
        "musitu.axiom.baseline-registry.v1",
        "unicode-casefold-v1",
        (NOW - timedelta(minutes=5)).isoformat(),
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
            permissions_hash=PERMISSIONS_HASH,
            result_hash=f"{i + 10:064x}",
            raw_evidence_hash=f"{i + 20:064x}",
            provenance_type="provider_api_receipt",
            authenticated=True,
            candidate_sha=CANDIDATE_SHA,
            candidate_environment_hash=ENVIRONMENT_HASH,
            metrics={"score": 0.9},
            configuration_hash=CONFIGURATION_HASH,
            account_scope_hash=ACCOUNT_SCOPE_HASH,
            baseline_registry_hash=registry.fingerprint,
            baseline_registration_id=registration.registration_id,
            baseline_registration_hash=registration.fingerprint,
        )
        for i, (provider, registration) in enumerate(zip(providers, registrations))
    )
    return registry, runs


def receipt(subject_type: str, subject_id: str, subject_hash: str, *, issuer: str, key: str, secret: bytes, issued_at: str):
    return ExternalAttestationService.issue(
        subject_type=subject_type,
        subject_id=subject_id,
        subject_hash=subject_hash,
        issuer_org=issuer,
        verifier_key_id=key,
        provenance_type="independent_lab_record" if subject_type != "external_run" else "provider_api_receipt",
        issued_at=issued_at,
        verifier_secret=secret,
    )


class UnicodeOrganizationIdentityTests(unittest.TestCase):
    def test_registry_casefold_aliases_collapse_to_one_provider(self):
        registry, _ = registry_and_runs(("Straße Labs", "STRASSE LABS"))
        report = registry.coverage()
        self.assertEqual(report["status"], "PASS")
        self.assertEqual(report["provider_orgs"], ["strasse labs"])
        required = registry.coverage(required_provider_orgs=("STRASSE Labs",))
        self.assertEqual(required["status"], "PASS")
        self.assertEqual(required["missing_provider_orgs"], [])

    def test_casefold_aliases_cannot_inflate_level5_provider_floor(self):
        providers = ("Straße Labs", "STRASSE LABS", "Other Org")
        registry, runs = registry_and_runs(providers)
        secret = b"i" * 32
        receipts = [
            receipt("external_run", run.run_id, run.fingerprint, issuer="Independent Evaluator", key="ind-key", secret=secret, issued_at=NOW.isoformat())
            for run in runs
        ]
        result = ExternalEvidenceGate.level5(
            runs,
            receipts=receipts,
            verifier_secrets={"ind-key": secret},
            trusted_issuers={"Independent Evaluator": frozenset({"ind-key"})},
            baseline_registry=registry,
        )
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("insufficient_independent_providers", result["reasons"])
        self.assertEqual(result["provider_orgs"], ["other org", "strasse labs"])

    def test_casefold_alias_provider_cannot_masquerade_as_independent_level5_attester(self):
        providers = ("STRASSE Labs", "Other B", "Other C")
        registry, runs = registry_and_runs(providers)
        secret = b"s" * 32
        receipts = [
            receipt("external_run", run.run_id, run.fingerprint, issuer="Straße Labs", key="alias-key", secret=secret, issued_at=NOW.isoformat())
            for run in runs
        ]
        result = ExternalEvidenceGate.level5(
            runs,
            receipts=receipts,
            verifier_secrets={"alias-key": secret},
            trusted_issuers={"Straße Labs": frozenset({"alias-key"})},
            baseline_registry=registry,
        )
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("external_attestation_issuer_overlaps_level5_provider", result["reasons"])
        self.assertEqual(result["run_count"], 0)

    def test_casefold_alias_provider_cannot_masquerade_as_level6_validator(self):
        level5 = {
            "status": "PASS",
            "attestation_verified": True,
            "baseline_registry_verified": True,
            "candidate_sha": CANDIDATE_SHA,
            "case_set_hash": CASE_SET_HASH,
            "provider_orgs": ["STRASSE Labs", "Other B", "Other C"],
        }
        validation = IndependentValidationRecord(
            validator_org="Straße Labs",
            validated_at=NOW.isoformat(),
            candidate_sha=CANDIDATE_SHA,
            case_set_hash=CASE_SET_HASH,
            reproduction_hash="9" * 64,
            passed=True,
            provenance_type="independent_lab_record",
        )
        secret = b"v" * 32
        signed = receipt(
            "independent_validation",
            validation.fingerprint,
            validation.fingerprint,
            issuer="Independent Witness",
            key="witness-key",
            secret=secret,
            issued_at=NOW.isoformat(),
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

    def test_casefold_alias_provider_cannot_attest_level7_refreshes(self):
        level6 = {
            "status": "PASS",
            "attestation_verified": True,
            "candidate_sha": CANDIDATE_SHA,
            "case_set_hash": CASE_SET_HASH,
            "level5_provider_orgs": ["STRASSE Labs", "Other B", "Other C"],
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
                executor_org="Independent Longitudinal Lab",
            )
            for i in range(3)
        )
        secret = b"r" * 32
        receipts = tuple(
            receipt(
                "longitudinal_refresh",
                refresh.refresh_id,
                refresh.fingerprint,
                issuer="Straße Labs",
                key="refresh-key",
                secret=secret,
                issued_at=refresh.executed_at,
            )
            for refresh in refreshes
        )
        result = ExternalEvidenceGate.level7(
            level6,
            refreshes,
            receipts=receipts,
            verifier_secrets={"refresh-key": secret},
            trusted_issuers={"Straße Labs": frozenset({"refresh-key"})},
        )
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("longitudinal_refresh_attester_overlaps_level5_provider", result["reasons"])
        self.assertEqual(result["refresh_count"], 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
