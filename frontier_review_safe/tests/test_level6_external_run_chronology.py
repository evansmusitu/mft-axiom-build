from __future__ import annotations

from datetime import datetime, timedelta, timezone
import unittest

from frontier_review_safe.baseline_registry import BaselineRegistration, BaselineRegistry
from frontier_review_safe.external_attestation import ExternalAttestationService
from frontier_review_safe.external_execution import ProviderBoundExternalRunRecord
from frontier_review_safe.external_validation import ExternalEvidenceGate, IndependentValidationRecord


BASE = datetime(2026, 9, 11, 12, 0, tzinfo=timezone.utc)
CANDIDATE_SHA = "d" * 40
CASE_SET_HASH = "a" * 64
CONSTRAINT_HASH = "b" * 64
PERMISSIONS_HASH = "c" * 64
CONFIGURATION_HASH = "6" * 64
ACCOUNT_SCOPE_HASH = "7" * 64
ENVIRONMENT_HASH = "f" * 64
RUN_KEY = "level5-run-key"
RUN_SECRET = b"r" * 32
VALIDATION_KEY = "level6-validation-key"
VALIDATION_SECRET = b"v" * 32
RUN_ISSUER = "Independent Run Evaluator"
VALIDATION_ISSUER = "Independent Validation Witness"


def level5_with_latest_run():
    providers = ("OpenAI", "Anthropic", "Google")
    run_instants = (
        BASE,
        BASE + timedelta(hours=1),
        (BASE + timedelta(hours=2)).astimezone(timezone(timedelta(hours=2))),
    )
    registrations = tuple(
        BaselineRegistration(
            registration_id=f"reg-{i}",
            provider_org=provider,
            provider_class="general_agent",
            product="agent",
            exact_version="v1",
            access_mode="api",
            registered_at=(BASE - timedelta(hours=1)).isoformat(),
            valid_until=(BASE + timedelta(days=30)).isoformat(),
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
        "level5-level6-chronology-v1",
        (BASE - timedelta(hours=1)).isoformat(),
        registrations,
    )
    runs = tuple(
        ProviderBoundExternalRunRecord(
            run_id=f"run-{i}",
            provider_org=provider,
            product="agent",
            exact_version="v1",
            executed_at=at.isoformat(),
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
            provider_receipt_hash=f"{i + 30:064x}",
            provider_request_id=f"request-{i}",
            provider_response_id=f"response-{i}",
        )
        for i, (provider, at, registration) in enumerate(zip(providers, run_instants, registrations))
    )
    receipts = tuple(
        ExternalAttestationService.issue(
            subject_type="external_run",
            subject_id=run.run_id,
            subject_hash=run.fingerprint,
            issuer_org=RUN_ISSUER,
            verifier_key_id=RUN_KEY,
            provenance_type=run.provenance_type,
            issued_at=(BASE + timedelta(hours=3)).isoformat(),
            verifier_secret=RUN_SECRET,
        )
        for run in runs
    )
    level5 = ExternalEvidenceGate.level5(
        runs,
        receipts=receipts,
        verifier_secrets={RUN_KEY: RUN_SECRET},
        trusted_issuers={RUN_ISSUER: frozenset({RUN_KEY})},
        baseline_registry=registry,
    )
    assert level5["status"] == "PASS", level5
    return level5


def validation(name: str, at: datetime, hash_char: str = "9") -> IndependentValidationRecord:
    return IndependentValidationRecord(
        validator_org=name,
        validated_at=at.isoformat(),
        candidate_sha=CANDIDATE_SHA,
        case_set_hash=CASE_SET_HASH,
        reproduction_hash=hash_char * 64,
        passed=True,
        provenance_type="independent_lab_record",
    )


def validation_receipt(record: IndependentValidationRecord):
    return ExternalAttestationService.issue(
        subject_type="independent_validation",
        subject_id=record.fingerprint,
        subject_hash=record.fingerprint,
        issuer_org=VALIDATION_ISSUER,
        verifier_key_id=VALIDATION_KEY,
        provenance_type=record.provenance_type,
        issued_at=(BASE + timedelta(days=1)).isoformat(),
        verifier_secret=VALIDATION_SECRET,
    )


def evaluate(level5, records):
    return ExternalEvidenceGate.level6(
        level5,
        records,
        receipts=[validation_receipt(record) for record in records],
        verifier_secrets={VALIDATION_KEY: VALIDATION_SECRET},
        trusted_issuers={VALIDATION_ISSUER: frozenset({VALIDATION_KEY})},
    )


class Level6ExternalRunChronologyTests(unittest.TestCase):
    def test_level5_propagates_latest_verified_external_run_instant_in_utc(self):
        level5 = level5_with_latest_run()
        self.assertEqual(level5["latest_external_run_at"], (BASE + timedelta(hours=2)).isoformat())

    def test_validation_strictly_before_latest_level5_run_cannot_count(self):
        level5 = level5_with_latest_run()
        record = validation("Independent Lab", BASE + timedelta(hours=1, minutes=59))
        result = evaluate(level5, (record,))
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("independent_validation_predates_level5_external_run", result["reasons"])
        self.assertIn("no_attested_independent_end_to_end_reproduction", result["reasons"])
        self.assertEqual(result["validation_count"], 0)

    def test_validation_at_exact_latest_run_instant_is_not_reversed(self):
        level5 = level5_with_latest_run()
        cutoff = BASE + timedelta(hours=2)
        record = validation("Independent Lab", cutoff)
        result = evaluate(level5, (record,))
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["latest_external_run_at"], cutoff.isoformat())
        self.assertEqual(result["validation_count"], 1)

    def test_offset_alias_before_latest_run_is_compared_as_utc_instant(self):
        level5 = level5_with_latest_run()
        cutoff = BASE + timedelta(hours=2)
        pre = (cutoff - timedelta(minutes=1)).astimezone(timezone(timedelta(hours=3)))
        record = validation("Independent Lab", pre)
        result = evaluate(level5, (record,))
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("independent_validation_predates_level5_external_run", result["reasons"])
        self.assertEqual(result["validation_count"], 0)

    def test_predating_extra_does_not_poison_valid_later_reproduction(self):
        level5 = level5_with_latest_run()
        cutoff = BASE + timedelta(hours=2)
        records = (
            validation("Old Lab", cutoff - timedelta(minutes=1), "8"),
            validation("Current Lab", cutoff + timedelta(minutes=1), "9"),
        )
        result = evaluate(level5, records)
        self.assertEqual(result["status"], "PASS")
        self.assertNotIn("independent_validation_predates_level5_external_run", result["reasons"])
        self.assertEqual(result["validation_count"], 1)
        self.assertEqual(result["validators"], ["Current Lab"])

    def test_malformed_explicit_level5_run_cutoff_fails_closed(self):
        level5 = level5_with_latest_run()
        level5["latest_external_run_at"] = "not-a-timestamp"
        record = validation("Independent Lab", BASE + timedelta(hours=3))
        result = evaluate(level5, (record,))
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("level5_external_run_time_invalid", result["reasons"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
