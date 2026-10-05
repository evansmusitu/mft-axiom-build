from __future__ import annotations

from datetime import datetime, timedelta, timezone
import unittest

from frontier_review_safe.external_attestation import ExternalAttestationService
from frontier_review_safe.external_validation import (
    ExternalEvidenceGate,
    IndependentValidationRecord,
    LongitudinalRefreshRecord,
)
from frontier_review_safe.tests.level7_semantic_fixtures import level7_artifact_fields


NOW = datetime(2026, 9, 11, 15, 0, tzinfo=timezone.utc)
CANDIDATE_SHA = "d" * 40
CASE_SET_HASH = "a" * 64
LEVEL5 = {
    "status": "PASS",
    "attestation_verified": True,
    "baseline_registry_verified": True,
    "candidate_sha": CANDIDATE_SHA,
    "case_set_hash": CASE_SET_HASH,
    "provider_orgs": ["OpenAI", "Anthropic", "Google"],
}


def validation(org: str, reproduction_char: str = "9") -> IndependentValidationRecord:
    return IndependentValidationRecord(
        validator_org=org,
        validated_at=NOW.isoformat(),
        candidate_sha=CANDIDATE_SHA,
        case_set_hash=CASE_SET_HASH,
        reproduction_hash=reproduction_char * 64,
        passed=True,
        provenance_type="independent_lab_record",
    )


def validation_receipt(record: IndependentValidationRecord, issuer_org: str, key_id: str, secret: bytes):
    return ExternalAttestationService.issue(
        subject_type="independent_validation",
        subject_id=record.fingerprint,
        subject_hash=record.fingerprint,
        issuer_org=issuer_org,
        verifier_key_id=key_id,
        provenance_type=record.provenance_type,
        issued_at=record.validated_at,
        verifier_secret=secret,
    )


def level6_for_refreshes():
    return {
        "status": "PASS",
        "attestation_verified": True,
        "candidate_sha": CANDIDATE_SHA,
        "case_set_hash": CASE_SET_HASH,
        "level5_provider_orgs": ["openai", "anthropic", "google"],
        "latest_validation_at": NOW.isoformat(),
    }


def refresh(refresh_id: str, day: int, baseline_hash: str, executor_org: str) -> LongitudinalRefreshRecord:
    executed_at = (NOW + timedelta(days=day)).isoformat()
    return LongitudinalRefreshRecord(
        refresh_id=refresh_id,
        executed_at=executed_at,
        candidate_sha=CANDIDATE_SHA,
        case_set_hash=CASE_SET_HASH,
        baseline_registry_hash=baseline_hash,
        passed=True,
        provenance_type="independent_lab_record",
        executor_org=executor_org,
        **level7_artifact_fields(
            candidate_sha=CANDIDATE_SHA,
            case_set_hash=CASE_SET_HASH,
            baseline_registry_hash=baseline_hash,
            generated_at=executed_at,
        ),
    )


def refresh_receipt(record: LongitudinalRefreshRecord, issuer_org: str, key_id: str, secret: bytes):
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


class ExternalProducerAttesterSeparationTests(unittest.TestCase):
    def test_level6_validator_cannot_self_attest_independent_reproduction(self):
        record = validation("Independent Lab")
        secret = b"v" * 32
        receipt = validation_receipt(record, "Independent Lab", "lab-key", secret)
        result = ExternalEvidenceGate.level6(
            LEVEL5,
            [record],
            receipts=[receipt],
            verifier_secrets={"lab-key": secret},
            trusted_issuers={"Independent Lab": frozenset({"lab-key"})},
        )
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("independent_validation_attester_overlaps_validator", result["reasons"])
        self.assertIn("no_attested_independent_end_to_end_reproduction", result["reasons"])
        self.assertEqual(result["validation_count"], 0)

    def test_level6_casefold_alias_cannot_self_attest(self):
        record = validation("Straße Lab")
        secret = b"c" * 32
        receipt = validation_receipt(record, "STRASSE LAB", "case-key", secret)
        result = ExternalEvidenceGate.level6(
            LEVEL5,
            [record],
            receipts=[receipt],
            verifier_secrets={"case-key": secret},
            trusted_issuers={"STRASSE LAB": frozenset({"case-key"})},
        )
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("independent_validation_attester_overlaps_validator", result["reasons"])

    def test_level6_separate_validator_and_attester_remain_valid(self):
        record = validation("Independent Lab")
        secret = b"e" * 32
        receipt = validation_receipt(record, "Independent Evaluator", "eval-key", secret)
        result = ExternalEvidenceGate.level6(
            LEVEL5,
            [record],
            receipts=[receipt],
            verifier_secrets={"eval-key": secret},
            trusted_issuers={"Independent Evaluator": frozenset({"eval-key"})},
        )
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["validation_count"], 1)

    def test_level7_executor_cannot_self_attest_refresh_set(self):
        records = [
            refresh("r1", 0, "4" * 64, "Independent Longitudinal Lab"),
            refresh("r2", 30, "5" * 64, "Independent Longitudinal Lab"),
            refresh("r3", 60, "4" * 64, "Independent Longitudinal Lab"),
        ]
        secret = b"r" * 32
        receipts = [
            refresh_receipt(record, "Independent Longitudinal Lab", "refresh-key", secret)
            for record in records
        ]
        result = ExternalEvidenceGate.level7(
            level6_for_refreshes(),
            records,
            receipts=receipts,
            verifier_secrets={"refresh-key": secret},
            trusted_issuers={"Independent Longitudinal Lab": frozenset({"refresh-key"})},
        )
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("longitudinal_refresh_attester_overlaps_executor", result["reasons"])
        self.assertIn("insufficient_attested_longitudinal_refreshes", result["reasons"])
        self.assertEqual(result["refresh_count"], 0)

    def test_level7_whitespace_alias_cannot_self_attest(self):
        records = [
            refresh("r1", 0, "4" * 64, "Independent  Lab"),
            refresh("r2", 30, "5" * 64, "Independent  Lab"),
            refresh("r3", 60, "4" * 64, "Independent  Lab"),
        ]
        secret = b"w" * 32
        receipts = [refresh_receipt(record, "Independent Lab", "space-key", secret) for record in records]
        result = ExternalEvidenceGate.level7(
            level6_for_refreshes(),
            records,
            receipts=receipts,
            verifier_secrets={"space-key": secret},
            trusted_issuers={"Independent Lab": frozenset({"space-key"})},
        )
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("longitudinal_refresh_attester_overlaps_executor", result["reasons"])

    def test_level7_separate_executor_and_attester_remain_valid(self):
        records = [
            refresh("r1", 0, "4" * 64, "Independent Longitudinal Lab"),
            refresh("r2", 30, "5" * 64, "Independent Longitudinal Lab"),
            refresh("r3", 60, "4" * 64, "Independent Longitudinal Lab"),
        ]
        secret = b"x" * 32
        receipts = [
            refresh_receipt(record, "Independent Longitudinal Evaluator", "external-key", secret)
            for record in records
        ]
        result = ExternalEvidenceGate.level7(
            level6_for_refreshes(),
            records,
            receipts=receipts,
            verifier_secrets={"external-key": secret},
            trusted_issuers={"Independent Longitudinal Evaluator": frozenset({"external-key"})},
        )
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["refresh_count"], 3)

    def test_self_attested_extra_does_not_poison_complete_independent_refresh_set(self):
        good = [
            refresh("r1", 0, "4" * 64, "Independent Longitudinal Lab"),
            refresh("r2", 30, "5" * 64, "Independent Longitudinal Lab"),
            refresh("r3", 60, "4" * 64, "Independent Longitudinal Lab"),
        ]
        extra = refresh("self-extra", 90, "5" * 64, "Self Lab")
        external_secret = b"e" * 32
        self_secret = b"s" * 32
        receipts = [
            refresh_receipt(record, "Independent Longitudinal Evaluator", "external-key", external_secret)
            for record in good
        ] + [refresh_receipt(extra, "Self Lab", "self-key", self_secret)]
        result = ExternalEvidenceGate.level7(
            level6_for_refreshes(),
            [*good, extra],
            receipts=receipts,
            verifier_secrets={"external-key": external_secret, "self-key": self_secret},
            trusted_issuers={
                "Independent Longitudinal Evaluator": frozenset({"external-key"}),
                "Self Lab": frozenset({"self-key"}),
            },
        )
        self.assertEqual(result["status"], "PASS")
        self.assertNotIn("longitudinal_refresh_attester_overlaps_executor", result["reasons"])
        self.assertEqual(result["refresh_count"], 3)


if __name__ == "__main__":
    unittest.main(verbosity=2)
