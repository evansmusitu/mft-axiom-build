from __future__ import annotations

from datetime import datetime, timedelta, timezone
import unittest

from frontier_review_safe.external_attestation import ExternalAttestationService
from frontier_review_safe.external_validation import (
    ExternalEvidenceGate,
    IndependentValidationRecord,
    LongitudinalRefreshRecord,
)


NOW = datetime(2026, 9, 11, 11, 45, tzinfo=timezone.utc)
CANDIDATE_SHA = "d" * 40
CASE_SET_HASH = "a" * 64
VALIDATION_SECRET = b"v" * 32
REFRESH_SECRET = b"r" * 32
VALIDATION_KEY = "chronology-validation-key"
REFRESH_KEY = "chronology-refresh-key"


def validation(name: str, at: datetime, hash_char: str) -> IndependentValidationRecord:
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
        issuer_org="Chronology Validation Evaluator",
        verifier_key_id=VALIDATION_KEY,
        provenance_type=record.provenance_type,
        issued_at=(NOW + timedelta(hours=3)).isoformat(),
        verifier_secret=VALIDATION_SECRET,
    )


def level6_with_latest_validation():
    level5 = {
        "status": "PASS",
        "attestation_verified": True,
        "baseline_registry_verified": True,
        "candidate_sha": CANDIDATE_SHA,
        "case_set_hash": CASE_SET_HASH,
        "provider_orgs": ["OpenAI", "Anthropic", "Google"],
    }
    first = validation("Independent Lab A", NOW, "8")
    latest = validation("Independent Lab B", NOW + timedelta(hours=2), "9")
    records = [first, latest]
    result = ExternalEvidenceGate.level6(
        level5,
        records,
        receipts=[validation_receipt(record) for record in records],
        verifier_secrets={VALIDATION_KEY: VALIDATION_SECRET},
        trusted_issuers={"Chronology Validation Evaluator": frozenset({VALIDATION_KEY})},
    )
    assert result["status"] == "PASS", result
    return result


def refresh(refresh_id: str, at: datetime, baseline_hash: str) -> LongitudinalRefreshRecord:
    return LongitudinalRefreshRecord(
        refresh_id=refresh_id,
        executed_at=at.isoformat(),
        candidate_sha=CANDIDATE_SHA,
        case_set_hash=CASE_SET_HASH,
        baseline_registry_hash=baseline_hash,
        retained_failure_corpus_hash="1" * 64,
        drift_report_hash="2" * 64,
        replacement_governance_hash="3" * 64,
        passed=True,
        provenance_type="independent_lab_record",
    )


def refresh_receipt(record: LongitudinalRefreshRecord):
    return ExternalAttestationService.issue(
        subject_type="longitudinal_refresh",
        subject_id=record.refresh_id,
        subject_hash=record.fingerprint,
        issuer_org="Chronology Longitudinal Evaluator",
        verifier_key_id=REFRESH_KEY,
        provenance_type=record.provenance_type,
        issued_at=(NOW + timedelta(days=100)).isoformat(),
        verifier_secret=REFRESH_SECRET,
    )


def evaluate(level6, records):
    return ExternalEvidenceGate.level7(
        level6,
        records,
        receipts=[refresh_receipt(record) for record in records],
        verifier_secrets={REFRESH_KEY: REFRESH_SECRET},
        trusted_issuers={"Chronology Longitudinal Evaluator": frozenset({REFRESH_KEY})},
    )


class Level7ValidationChronologyTests(unittest.TestCase):
    def test_level6_propagates_latest_bound_validation_instant_in_utc(self):
        level6 = level6_with_latest_validation()
        expected = (NOW + timedelta(hours=2)).isoformat()
        self.assertEqual(level6["latest_validation_at"], expected)

    def test_three_refreshes_that_predate_level6_validation_cannot_count(self):
        level6 = level6_with_latest_validation()
        cutoff = NOW + timedelta(hours=2)
        records = [
            refresh("r1", cutoff - timedelta(days=3), "4" * 64),
            refresh("r2", cutoff - timedelta(days=2), "5" * 64),
            refresh("r3", cutoff - timedelta(days=1), "4" * 64),
        ]
        result = evaluate(level6, records)
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("longitudinal_refresh_predates_level6_validation", result["reasons"])
        self.assertIn("insufficient_attested_longitudinal_refreshes", result["reasons"])
        self.assertEqual(result["refresh_count"], 0)

    def test_equal_recorded_instant_and_later_refreshes_are_not_temporally_reversed(self):
        level6 = level6_with_latest_validation()
        cutoff = NOW + timedelta(hours=2)
        records = [
            refresh("r1", cutoff, "4" * 64),
            refresh("r2", cutoff + timedelta(days=30), "5" * 64),
            refresh("r3", cutoff + timedelta(days=60), "4" * 64),
        ]
        result = evaluate(level6, records)
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["refresh_count"], 3)
        self.assertEqual(result["latest_validation_at"], cutoff.isoformat())

    def test_offset_alias_before_cutoff_is_compared_as_utc_instant(self):
        level6 = level6_with_latest_validation()
        cutoff = NOW + timedelta(hours=2)
        pre_at = (cutoff - timedelta(minutes=1)).astimezone(timezone(timedelta(hours=2)))
        records = [
            refresh("r1", pre_at, "4" * 64),
            refresh("r2", cutoff + timedelta(days=30), "5" * 64),
            refresh("r3", cutoff + timedelta(days=60), "4" * 64),
        ]
        result = evaluate(level6, records)
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("longitudinal_refresh_predates_level6_validation", result["reasons"])
        self.assertEqual(result["refresh_count"], 2)

    def test_predating_extra_does_not_poison_three_valid_later_refreshes(self):
        level6 = level6_with_latest_validation()
        cutoff = NOW + timedelta(hours=2)
        records = [
            refresh("r1", cutoff, "4" * 64),
            refresh("r2", cutoff + timedelta(days=30), "5" * 64),
            refresh("r3", cutoff + timedelta(days=60), "4" * 64),
            refresh("old-extra", cutoff - timedelta(days=1), "5" * 64),
        ]
        result = evaluate(level6, records)
        self.assertEqual(result["status"], "PASS")
        self.assertNotIn("longitudinal_refresh_predates_level6_validation", result["reasons"])
        self.assertEqual(result["refresh_count"], 3)


if __name__ == "__main__":
    unittest.main(verbosity=2)
