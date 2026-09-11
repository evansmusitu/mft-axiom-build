from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import MappingProxyType
import unittest

from frontier_review_safe.baseline_registry import BaselineRegistration, BaselineRegistry
from frontier_review_safe.external_attestation import ExternalAttestationService
from frontier_review_safe.external_validation import (
    ExternalEvidenceGate,
    ExternalRunRecord,
    IndependentValidationRecord,
    LongitudinalRefreshRecord,
)


NOW = datetime(2026, 9, 11, 12, 30, tzinfo=timezone.utc)
NOW_S = NOW.isoformat()
CANDIDATE_SHA = "d" * 40
CASE_SET_HASH = "a" * 64
CONSTRAINT_HASH = "b" * 64
PERMISSIONS_HASH = "c" * 64
SECRET = b"g" * 32
KEY_ID = "gate-key"
ISSUER = "Independent Gate Evaluator"
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
    registrations = []
    for i, provider in enumerate(providers):
        registrations.append(BaselineRegistration(
            registration_id=f"reg-{i}",
            provider_org=provider,
            provider_class="general_agent",
            product="agent",
            exact_version="v1",
            access_mode="api",
            registered_at=(NOW - timedelta(hours=1)).isoformat(),
            valid_until=(NOW + timedelta(days=1)).isoformat(),
            case_set_hash=CASE_SET_HASH,
            constraint_hash=CONSTRAINT_HASH,
            permissions_hash=PERMISSIONS_HASH,
            configuration_hash="6" * 64,
            account_scope_hash="7" * 64,
            capabilities=("sealed_eval",),
        ))
    registry = BaselineRegistry(
        "musitu.axiom.baseline-registry.v1",
        "gate-mapping-v1",
        (NOW - timedelta(hours=1)).isoformat(),
        tuple(registrations),
    )
    runs = []
    for i, (provider, registration) in enumerate(zip(providers, registrations)):
        runs.append(ExternalRunRecord(
            run_id=f"run-{i}",
            provider_org=provider,
            product="agent",
            exact_version="v1",
            executed_at=NOW_S,
            access_mode="api",
            case_set_hash=CASE_SET_HASH,
            constraint_hash=CONSTRAINT_HASH,
            permissions_hash=PERMISSIONS_HASH,
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
        ))
    receipts = [
        issue("external_run", run.run_id, run.fingerprint, run.provenance_type, run.executed_at)
        for run in runs
    ]
    return registry, runs, receipts


def level5_summary():
    return {
        "status": "PASS",
        "attestation_verified": True,
        "baseline_registry_verified": True,
        "candidate_sha": CANDIDATE_SHA,
        "case_set_hash": CASE_SET_HASH,
        "provider_orgs": ["Provider A", "Provider B", "Provider C"],
    }


def level6_summary():
    return {
        "status": "PASS",
        "attestation_verified": True,
        "candidate_sha": CANDIDATE_SHA,
        "case_set_hash": CASE_SET_HASH,
        "level5_provider_orgs": ["provider a", "provider b", "provider c"],
        "latest_validation_at": NOW_S,
    }


class ExternalAttestationGateMappingIntegrityTests(unittest.TestCase):
    def test_level5_iterable_pair_stores_are_rejected_not_silently_coerced(self):
        registry, runs, receipts = level5_fixture()
        result = ExternalEvidenceGate.level5(
            runs,
            receipts=receipts,
            verifier_secrets=[(KEY_ID, SECRET)],
            trusted_issuers=[(ISSUER, frozenset({KEY_ID}))],
            baseline_registry=registry,
        )
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("external_verifier_secret_store_invalid", result["reasons"])
        self.assertIn("external_attestation_trust_root_invalid", result["reasons"])

    def test_level5_malformed_string_stores_fail_without_raising(self):
        registry, runs, receipts = level5_fixture()
        result = ExternalEvidenceGate.level5(
            runs,
            receipts=receipts,
            verifier_secrets="gate-key",
            trusted_issuers="Independent Gate Evaluator",
            baseline_registry=registry,
        )
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("external_verifier_secret_store_invalid", result["reasons"])
        self.assertIn("external_attestation_trust_root_invalid", result["reasons"])

    def test_level6_iterable_pair_stores_fail_explicitly(self):
        record = IndependentValidationRecord(
            "Independent Lab", NOW_S, CANDIDATE_SHA, CASE_SET_HASH,
            "8" * 64, True, "independent_lab_record",
        )
        receipt = issue(
            "independent_validation", record.fingerprint, record.fingerprint,
            record.provenance_type, record.validated_at,
        )
        result = ExternalEvidenceGate.level6(
            level5_summary(), [record], receipts=[receipt],
            verifier_secrets=[(KEY_ID, SECRET)],
            trusted_issuers=[(ISSUER, frozenset({KEY_ID}))],
        )
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("external_verifier_secret_store_invalid", result["reasons"])
        self.assertIn("external_attestation_trust_root_invalid", result["reasons"])

    def test_level7_iterable_pair_stores_fail_explicitly(self):
        refreshes = [
            LongitudinalRefreshRecord(
                f"r{i}", (NOW + timedelta(days=i * 30)).isoformat(), CANDIDATE_SHA,
                CASE_SET_HASH, ("4" if i % 2 == 0 else "5") * 64,
                "1" * 64, "2" * 64, "3" * 64, True,
            )
            for i in range(3)
        ]
        receipts = [
            issue("longitudinal_refresh", r.refresh_id, r.fingerprint, r.provenance_type, r.executed_at)
            for r in refreshes
        ]
        result = ExternalEvidenceGate.level7(
            level6_summary(), refreshes, receipts=receipts,
            verifier_secrets=[(KEY_ID, SECRET)],
            trusted_issuers=[(ISSUER, frozenset({KEY_ID}))],
        )
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("external_verifier_secret_store_invalid", result["reasons"])
        self.assertIn("external_attestation_trust_root_invalid", result["reasons"])

    def test_level5_read_only_mapping_implementations_remain_valid(self):
        registry, runs, receipts = level5_fixture()
        result = ExternalEvidenceGate.level5(
            runs,
            receipts=receipts,
            verifier_secrets=MappingProxyType(SECRETS),
            trusted_issuers=MappingProxyType(TRUST),
            baseline_registry=registry,
        )
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["run_count"], 3)

    def test_omitted_optional_stores_remain_structurally_backward_compatible(self):
        registry, runs, receipts = level5_fixture()
        result = ExternalEvidenceGate.level5(
            runs,
            receipts=receipts,
            verifier_secrets=None,
            trusted_issuers=None,
            baseline_registry=registry,
        )
        self.assertEqual(result["status"], "FAIL")
        self.assertNotIn("external_verifier_secret_store_invalid", result["reasons"])
        self.assertNotIn("external_attestation_trust_root_invalid", result["reasons"])
        self.assertIn("external_verifier_secret_unavailable", result["reasons"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
