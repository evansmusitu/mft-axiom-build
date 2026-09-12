from __future__ import annotations

from datetime import datetime, timedelta, timezone
import unittest

from frontier_review_safe.external_attestation import ExternalAttestationService
from frontier_review_safe.external_validation import (
    ExternalEvidenceGate,
    IndependentValidationRecord,
    LongitudinalRefreshRecord,
)
from frontier_review_safe.tests.level7_semantic_fixture import (
    bind_semantic_record,
    semantic_artifacts_for,
)


NOW = datetime(2026, 9, 11, 11, 35, tzinfo=timezone.utc)
CANDIDATE_SHA = "d" * 40
CASE_SET_HASH = "a" * 64
LEVEL5_PROVIDERS = ("OpenAI", "Anthropic", "Google")
VALIDATION_SECRET = b"v" * 32
VALIDATION_KEY = "validation-key"
EXTERNAL_REFRESH_SECRET = b"e" * 32
EXTERNAL_REFRESH_KEY = "external-refresh-key"
PROVIDER_SECRET = b"p" * 32
PROVIDER_KEY = "provider-refresh-key"


def level6_with_provider_scope():
    level5 = {
        "status": "PASS",
        "attestation_verified": True,
        "baseline_registry_verified": True,
        "candidate_sha": CANDIDATE_SHA,
        "case_set_hash": CASE_SET_HASH,
        "provider_orgs": list(LEVEL5_PROVIDERS),
    }
    validation = IndependentValidationRecord(
        validator_org="Independent Reproduction Lab",
        validated_at=NOW.isoformat(),
        candidate_sha=CANDIDATE_SHA,
        case_set_hash=CASE_SET_HASH,
        reproduction_hash="9" * 64,
        passed=True,
        provenance_type="independent_lab_record",
    )
    receipt = ExternalAttestationService.issue(
        subject_type="independent_validation",
        subject_id=validation.fingerprint,
        subject_hash=validation.fingerprint,
        issuer_org="Independent Validation Evaluator",
        verifier_key_id=VALIDATION_KEY,
        provenance_type=validation.provenance_type,
        issued_at=NOW.isoformat(),
        verifier_secret=VALIDATION_SECRET,
    )
    level6 = ExternalEvidenceGate.level6(
        level5,
        [validation],
        receipts=[receipt],
        verifier_secrets={VALIDATION_KEY: VALIDATION_SECRET},
        trusted_issuers={"Independent Validation Evaluator": frozenset({VALIDATION_KEY})},
    )
    assert level6["status"] == "PASS", level6
    return level6


def refresh(refresh_id: str, day: int, baseline_hash: str) -> LongitudinalRefreshRecord:
    return bind_semantic_record(LongitudinalRefreshRecord(
        refresh_id=refresh_id,
        executed_at=(NOW + timedelta(days=day)).isoformat(),
        candidate_sha=CANDIDATE_SHA,
        case_set_hash=CASE_SET_HASH,
        baseline_registry_hash=baseline_hash,
        retained_failure_corpus_hash="1" * 64,
        drift_report_hash="2" * 64,
        replacement_governance_hash="3" * 64,
        passed=True,
        provenance_type="independent_lab_record",
        executor_org="Independent Longitudinal Lab",
    ))


def attest(record: LongitudinalRefreshRecord, *, issuer_org: str, key_id: str, secret: bytes):
    return ExternalAttestationService.issue(
        subject_type="longitudinal_refresh",
        subject_id=record.refresh_id,
        subject_hash=record.fingerprint,
        issuer_org=issuer_org,
        verifier_key_id=key_id,
        provenance_type=record.provenance_type,
        issued_at=record.executed_at,
        verifier_secret=secret,
    )


class Level7AttestationIssuerIndependenceTests(unittest.TestCase):
    def test_level6_propagates_normalized_level5_provider_scope(self):
        level6 = level6_with_provider_scope()
        self.assertEqual(level6["level5_provider_orgs"], ["anthropic", "google", "openai"])

    def test_level5_provider_cannot_attest_longitudinal_refresh_set(self):
        level6 = level6_with_provider_scope()
        records = [
            refresh("r1", 1, "4" * 64),
            refresh("r2", 31, "5" * 64),
            refresh("r3", 61, "4" * 64),
        ]
        receipts = [
            attest(record, issuer_org="OpenAI", key_id=PROVIDER_KEY, secret=PROVIDER_SECRET)
            for record in records
        ]
        result = ExternalEvidenceGate.level7(
            level6,
            records,
            receipts=receipts,
            verifier_secrets={PROVIDER_KEY: PROVIDER_SECRET},
            trusted_issuers={"OpenAI": frozenset({PROVIDER_KEY})},
            semantic_artifacts=semantic_artifacts_for(records),
        )
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("longitudinal_refresh_attester_overlaps_level5_provider", result["reasons"])
        self.assertIn("insufficient_attested_longitudinal_refreshes", result["reasons"])
        self.assertEqual(result["refresh_count"], 0)

    def test_provider_case_alias_still_counts_as_attester_overlap(self):
        level6 = level6_with_provider_scope()
        records = [
            refresh("r1", 1, "4" * 64),
            refresh("r2", 31, "5" * 64),
            refresh("r3", 61, "4" * 64),
        ]
        receipts = [
            attest(record, issuer_org="openai", key_id=PROVIDER_KEY, secret=PROVIDER_SECRET)
            for record in records
        ]
        result = ExternalEvidenceGate.level7(
            level6,
            records,
            receipts=receipts,
            verifier_secrets={PROVIDER_KEY: PROVIDER_SECRET},
            trusted_issuers={"openai": frozenset({PROVIDER_KEY})},
            semantic_artifacts=semantic_artifacts_for(records),
        )
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("longitudinal_refresh_attester_overlaps_level5_provider", result["reasons"])

    def test_independent_longitudinal_attester_remains_valid(self):
        level6 = level6_with_provider_scope()
        records = [
            refresh("r1", 1, "4" * 64),
            refresh("r2", 31, "5" * 64),
            refresh("r3", 61, "4" * 64),
        ]
        receipts = [
            attest(
                record,
                issuer_org="Independent Longitudinal Evaluator",
                key_id=EXTERNAL_REFRESH_KEY,
                secret=EXTERNAL_REFRESH_SECRET,
            )
            for record in records
        ]
        result = ExternalEvidenceGate.level7(
            level6,
            records,
            receipts=receipts,
            verifier_secrets={EXTERNAL_REFRESH_KEY: EXTERNAL_REFRESH_SECRET},
            trusted_issuers={
                "Independent Longitudinal Evaluator": frozenset({EXTERNAL_REFRESH_KEY})
            },
            semantic_artifacts=semantic_artifacts_for(records),
        )
        self.assertEqual(result["status"], "PASS")
        self.assertTrue(result["semantic_artifacts_verified"])
        self.assertEqual(result["refresh_count"], 3)
        self.assertEqual(result["level5_provider_orgs"], ["anthropic", "google", "openai"])
        self.assertEqual(result["refresh_executor_orgs"], ["independent longitudinal lab"])

    def test_provider_attested_extra_does_not_poison_three_independent_refreshes(self):
        level6 = level6_with_provider_scope()
        good = [
            refresh("r1", 1, "4" * 64),
            refresh("r2", 31, "5" * 64),
            refresh("r3", 61, "4" * 64),
        ]
        extra = refresh("provider-extra", 91, "5" * 64)
        records = [*good, extra]
        receipts = [
            attest(
                record,
                issuer_org="Independent Longitudinal Evaluator",
                key_id=EXTERNAL_REFRESH_KEY,
                secret=EXTERNAL_REFRESH_SECRET,
            )
            for record in good
        ] + [
            attest(extra, issuer_org="OpenAI", key_id=PROVIDER_KEY, secret=PROVIDER_SECRET)
        ]
        result = ExternalEvidenceGate.level7(
            level6,
            records,
            receipts=receipts,
            verifier_secrets={
                EXTERNAL_REFRESH_KEY: EXTERNAL_REFRESH_SECRET,
                PROVIDER_KEY: PROVIDER_SECRET,
            },
            trusted_issuers={
                "Independent Longitudinal Evaluator": frozenset({EXTERNAL_REFRESH_KEY}),
                "OpenAI": frozenset({PROVIDER_KEY}),
            },
            semantic_artifacts=semantic_artifacts_for(records),
        )
        self.assertEqual(result["status"], "PASS")
        self.assertTrue(result["semantic_artifacts_verified"])
        self.assertNotIn("longitudinal_refresh_attester_overlaps_level5_provider", result["reasons"])
        self.assertEqual(result["refresh_count"], 3)


if __name__ == "__main__":
    unittest.main(verbosity=2)
