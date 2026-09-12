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


NOW = datetime(2026, 9, 11, 12, 0, tzinfo=timezone.utc)
CANDIDATE_SHA = "d" * 40
CASE_SET_HASH = "a" * 64
CONSTRAINT_HASH = "b" * 64
PERMISSIONS_HASH = "c" * 64
SECRET = b"t" * 32
KEY_ID = "chronology-key"
ISSUER = "Independent Chronology Evaluator"
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


def level5_fixture(executed_at: str):
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
            valid_until=(NOW + timedelta(days=30)).isoformat(),
            case_set_hash=CASE_SET_HASH,
            constraint_hash=CONSTRAINT_HASH,
            permissions_hash=PERMISSIONS_HASH,
            configuration_hash="6" * 64,
            account_scope_hash="7" * 64,
            capabilities=("sealed_eval",),
        ))
    registry = BaselineRegistry(
        "musitu.axiom.baseline-registry.v1",
        "chronology-v1",
        (NOW - timedelta(hours=1)).isoformat(),
        tuple(registrations),
    )
    runs = []
    for i, (provider, registration) in enumerate(zip(providers, registrations)):
        runs.append(ProviderBoundExternalRunRecord(
            run_id=f"run-{i}",
            provider_org=provider,
            product="agent",
            exact_version="v1",
            executed_at=executed_at,
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
            provider_receipt_hash=f"{i + 30:064x}",
            provider_request_id=f"request-{i}",
            provider_response_id=f"response-{i}",
        ))
    return registry, runs


def validation(name: str, validated_at: str, hash_char: str):
    return IndependentValidationRecord(
        validator_org=name,
        validated_at=validated_at,
        candidate_sha=CANDIDATE_SHA,
        case_set_hash=CASE_SET_HASH,
        reproduction_hash=hash_char * 64,
        passed=True,
        provenance_type="independent_lab_record",
    )


def refresh(refresh_id: str, executed_at: str, baseline_char: str):
    return LongitudinalRefreshRecord(
        refresh_id=refresh_id,
        executed_at=executed_at,
        candidate_sha=CANDIDATE_SHA,
        case_set_hash=CASE_SET_HASH,
        baseline_registry_hash=baseline_char * 64,
        retained_failure_corpus_hash="1" * 64,
        drift_report_hash="2" * 64,
        replacement_governance_hash="3" * 64,
        passed=True,
        provenance_type="independent_lab_record",
        executor_org="Independent Longitudinal Lab",
    )


class ExternalAttestationEventChronologyTests(unittest.TestCase):
    def test_level5_receipt_cannot_predate_provider_execution(self):
        event_at = (NOW + timedelta(hours=1)).isoformat()
        registry, runs = level5_fixture(event_at)
        receipts = [
            issue("external_run", run.run_id, run.fingerprint, run.provenance_type, NOW.isoformat())
            for run in runs
        ]
        result = ExternalEvidenceGate.level5(
            runs,
            receipts=receipts,
            verifier_secrets=SECRETS,
            trusted_issuers=TRUST,
            baseline_registry=registry,
        )
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("external_run_attestation_predates_execution", result["reasons"])
        self.assertIn("not_all_external_runs_attested_and_registered", result["reasons"])
        self.assertEqual(result["run_count"], 0)

    def test_level5_receipt_at_exact_execution_instant_is_valid(self):
        event_at = (NOW + timedelta(hours=1)).isoformat()
        registry, runs = level5_fixture(event_at)
        receipts = [
            issue("external_run", run.run_id, run.fingerprint, run.provenance_type, event_at)
            for run in runs
        ]
        result = ExternalEvidenceGate.level5(
            runs,
            receipts=receipts,
            verifier_secrets=SECRETS,
            trusted_issuers=TRUST,
            baseline_registry=registry,
        )
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["run_count"], 3)

    def test_level6_receipt_cannot_predate_validation_event(self):
        event_at = (NOW + timedelta(hours=1)).isoformat()
        record = validation("Independent Lab A", event_at, "8")
        receipt = issue(
            "independent_validation", record.fingerprint, record.fingerprint,
            record.provenance_type, NOW.isoformat(),
        )
        level5 = {
            "status": "PASS", "attestation_verified": True,
            "baseline_registry_verified": True, "candidate_sha": CANDIDATE_SHA,
            "case_set_hash": CASE_SET_HASH,
            "provider_orgs": ["Provider A", "Provider B", "Provider C"],
        }
        result = ExternalEvidenceGate.level6(
            level5, [record], receipts=[receipt], verifier_secrets=SECRETS,
            trusted_issuers=TRUST,
        )
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("independent_validation_attestation_predates_validation", result["reasons"])
        self.assertIn("no_attested_independent_end_to_end_reproduction", result["reasons"])
        self.assertEqual(result["validation_count"], 0)

    def test_level6_predating_extra_does_not_poison_valid_reproduction(self):
        event_at = NOW + timedelta(hours=1)
        good = validation("Independent Lab Good", event_at.isoformat(), "8")
        old = validation("Independent Lab Old", (event_at + timedelta(minutes=1)).isoformat(), "9")
        receipts = [
            issue("independent_validation", good.fingerprint, good.fingerprint, good.provenance_type, good.validated_at),
            issue("independent_validation", old.fingerprint, old.fingerprint, old.provenance_type, NOW.isoformat()),
        ]
        level5 = {
            "status": "PASS", "attestation_verified": True,
            "baseline_registry_verified": True, "candidate_sha": CANDIDATE_SHA,
            "case_set_hash": CASE_SET_HASH,
            "provider_orgs": ["Provider A", "Provider B", "Provider C"],
        }
        result = ExternalEvidenceGate.level6(
            level5, [good, old], receipts=receipts, verifier_secrets=SECRETS,
            trusted_issuers=TRUST,
        )
        self.assertEqual(result["status"], "PASS")
        self.assertNotIn("independent_validation_attestation_predates_validation", result["reasons"])
        self.assertEqual(result["validation_count"], 1)

    def test_level7_receipts_cannot_predate_refresh_events_using_utc_instants(self):
        event_times = [NOW + timedelta(days=i + 1) for i in range(3)]
        records = [
            refresh(f"r{i}", at.astimezone(timezone(timedelta(hours=2))).isoformat(), "4" if i % 2 == 0 else "5")
            for i, at in enumerate(event_times)
        ]
        receipts = [
            issue(
                "longitudinal_refresh", record.refresh_id, record.fingerprint,
                record.provenance_type, (event_times[i] - timedelta(minutes=1)).isoformat(),
            )
            for i, record in enumerate(records)
        ]
        level6 = {
            "status": "PASS", "attestation_verified": True,
            "candidate_sha": CANDIDATE_SHA, "case_set_hash": CASE_SET_HASH,
        }
        result = ExternalEvidenceGate.level7(
            level6, records, receipts=receipts, verifier_secrets=SECRETS,
            trusted_issuers=TRUST,
        )
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("longitudinal_refresh_attestation_predates_execution", result["reasons"])
        self.assertIn("insufficient_attested_longitudinal_refreshes", result["reasons"])
        self.assertEqual(result["refresh_count"], 0)

    def test_level7_predating_extra_does_not_poison_three_valid_refreshes(self):
        good = [
            refresh("r1", (NOW + timedelta(days=1)).isoformat(), "4"),
            refresh("r2", (NOW + timedelta(days=31)).isoformat(), "5"),
            refresh("r3", (NOW + timedelta(days=61)).isoformat(), "4"),
        ]
        extra = refresh("old-extra", (NOW + timedelta(days=91)).isoformat(), "5")
        receipts = [
            issue("longitudinal_refresh", record.refresh_id, record.fingerprint, record.provenance_type, record.executed_at)
            for record in good
        ] + [
            issue("longitudinal_refresh", extra.refresh_id, extra.fingerprint, extra.provenance_type, NOW.isoformat())
        ]
        level6 = {
            "status": "PASS", "attestation_verified": True,
            "candidate_sha": CANDIDATE_SHA, "case_set_hash": CASE_SET_HASH,
        }
        result = ExternalEvidenceGate.level7(
            level6, [*good, extra], receipts=receipts, verifier_secrets=SECRETS,
            trusted_issuers=TRUST,
        )
        self.assertEqual(result["status"], "PASS")
        self.assertNotIn("longitudinal_refresh_attestation_predates_execution", result["reasons"])
        self.assertEqual(result["refresh_count"], 3)


if __name__ == "__main__":
    unittest.main(verbosity=2)
