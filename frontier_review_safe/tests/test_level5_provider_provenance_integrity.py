from __future__ import annotations

from datetime import datetime, timedelta, timezone
import unittest

from frontier_review_safe.baseline_registry import BaselineRegistration, BaselineRegistry
from frontier_review_safe.external_attestation import ExternalAttestationService
from frontier_review_safe.external_execution import PROVIDER_EXECUTION_PROVENANCE
from frontier_review_safe.external_validation import ExternalEvidenceGate, ExternalRunRecord, LEVEL5_PROVIDER_PROVENANCE


NOW = datetime(2026, 9, 11, 15, 20, tzinfo=timezone.utc)
CANDIDATE_SHA = "d" * 40
CASE_SET_HASH = "a" * 64
CONSTRAINT_HASH = "b" * 64
PERMISSIONS_HASH = "c" * 64
CONFIGURATION_HASH = "6" * 64
ACCOUNT_SCOPE_HASH = "7" * 64
SECRET = b"p" * 32
KEY_ID = "provider-provenance-key"
ISSUER = "Independent Provider Evaluator"


def fixture(provenance_type: str):
    providers = ("Provider A", "Provider B", "Provider C")
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
    registry = BaselineRegistry(
        "musitu.axiom.baseline-registry.v1",
        "level5-provider-provenance-v1",
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
            provenance_type=provenance_type,
            authenticated=True,
            candidate_sha=CANDIDATE_SHA,
            candidate_environment_hash="f" * 64,
            metrics={"score": 0.9},
            configuration_hash=CONFIGURATION_HASH,
            account_scope_hash=ACCOUNT_SCOPE_HASH,
            baseline_registry_hash=registry.fingerprint,
            baseline_registration_id=registration.registration_id,
            baseline_registration_hash=registration.fingerprint,
        )
        for i, (provider, registration) in enumerate(zip(providers, registrations))
    )
    receipts = tuple(
        ExternalAttestationService.issue(
            subject_type="external_run",
            subject_id=run.run_id,
            subject_hash=run.fingerprint,
            issuer_org=ISSUER,
            verifier_key_id=KEY_ID,
            provenance_type=run.provenance_type,
            issued_at=run.executed_at,
            verifier_secret=SECRET,
        )
        for run in runs
    )
    return registry, runs, receipts


def evaluate(provenance_type: str):
    registry, runs, receipts = fixture(provenance_type)
    return ExternalEvidenceGate.level5(
        runs,
        receipts=receipts,
        verifier_secrets={KEY_ID: SECRET},
        trusted_issuers={ISSUER: frozenset({KEY_ID})},
        baseline_registry=registry,
    )


class Level5ProviderProvenanceIntegrityTests(unittest.TestCase):
    def test_level5_and_provider_execution_normalizer_share_exact_provenance_allowlist(self):
        self.assertEqual(LEVEL5_PROVIDER_PROVENANCE, PROVIDER_EXECUTION_PROVENANCE)
        self.assertEqual(LEVEL5_PROVIDER_PROVENANCE, frozenset({"provider_api_receipt", "provider_export"}))

    def test_independent_lab_record_cannot_masquerade_as_provider_execution(self):
        result = evaluate("independent_lab_record")
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("provider_execution_provenance_required", result["reasons"])
        self.assertIn("not_all_external_runs_attested_and_registered", result["reasons"])
        self.assertEqual(result["run_count"], 0)

    def test_provider_api_receipt_remains_valid_level5_provenance(self):
        result = evaluate("provider_api_receipt")
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["run_count"], 3)

    def test_provider_export_remains_valid_level5_provenance(self):
        result = evaluate("provider_export")
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["run_count"], 3)


if __name__ == "__main__":
    unittest.main(verbosity=2)
