from __future__ import annotations

from datetime import datetime, timedelta, timezone
import unittest

from frontier_review_safe.external_attestation import ExternalAttestationService
from frontier_review_safe.external_validation import ExternalEvidenceGate, LongitudinalRefreshRecord
from frontier_review_safe.tests.level7_semantic_fixtures import level7_artifact_fields


NOW = datetime(2026, 9, 11, 11, 10, tzinfo=timezone.utc)
CANDIDATE_SHA = "d" * 40
CASE_SET_HASH = "a" * 64
SECRET = b"t" * 32
SECRETS = {"time-key": SECRET}
TRUST = {"Independent Time Validator": frozenset({"time-key"})}
LEVEL6 = {
    "status": "PASS",
    "attestation_verified": True,
    "candidate_sha": CANDIDATE_SHA,
    "case_set_hash": CASE_SET_HASH,
}


def refresh(refresh_id: str, executed_at: str, baseline_registry_hash: str) -> LongitudinalRefreshRecord:
    return LongitudinalRefreshRecord(
        refresh_id=refresh_id,
        executed_at=executed_at,
        candidate_sha=CANDIDATE_SHA,
        case_set_hash=CASE_SET_HASH,
        baseline_registry_hash=baseline_registry_hash,
        passed=True,
        provenance_type="independent_lab_record",
        executor_org="Independent Longitudinal Lab",
        **level7_artifact_fields(
            candidate_sha=CANDIDATE_SHA,
            case_set_hash=CASE_SET_HASH,
            baseline_registry_hash=baseline_registry_hash,
            generated_at=executed_at,
        ),
    )


def attest(record: LongitudinalRefreshRecord):
    return ExternalAttestationService.issue(
        subject_type="longitudinal_refresh",
        subject_id=record.refresh_id,
        subject_hash=record.fingerprint,
        issuer_org="Independent Time Validator",
        verifier_key_id="time-key",
        provenance_type=record.provenance_type,
        issued_at=record.executed_at,
        verifier_secret=SECRET,
    )


def evaluate(records):
    return ExternalEvidenceGate.level7(
        LEVEL6,
        records,
        receipts=[attest(record) for record in records],
        verifier_secrets=SECRETS,
        trusted_issuers=TRUST,
    )


class Level7LongitudinalTimeIntegrityTests(unittest.TestCase):
    def test_three_signed_refresh_ids_at_one_instant_are_not_longitudinal(self):
        timestamp = NOW.isoformat()
        records = [
            refresh("refresh-1", timestamp, "4" * 64),
            refresh("refresh-2", timestamp, "5" * 64),
            refresh("refresh-3", timestamp, "4" * 64),
        ]
        result = evaluate(records)
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("insufficient_distinct_longitudinal_refresh_times", result["reasons"])
        self.assertEqual(result["refresh_count"], 3)
        self.assertEqual(result["distinct_refresh_times"], 1)

    def test_equivalent_offset_timestamps_count_as_the_same_instant(self):
        records = [
            refresh("refresh-1", "2026-09-11T10:00:00+00:00", "4" * 64),
            refresh("refresh-2", "2026-09-11T12:00:00+02:00", "5" * 64),
            refresh("refresh-3", "2026-09-12T10:00:00+00:00", "4" * 64),
        ]
        result = evaluate(records)
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("insufficient_distinct_longitudinal_refresh_times", result["reasons"])
        self.assertEqual(result["distinct_refresh_times"], 2)

    def test_three_distinct_attested_instants_pass_longitudinal_mechanics(self):
        records = [
            refresh("refresh-1", (NOW + timedelta(days=0)).isoformat(), "4" * 64),
            refresh("refresh-2", (NOW + timedelta(days=30)).isoformat(), "5" * 64),
            refresh("refresh-3", (NOW + timedelta(days=60)).isoformat(), "4" * 64),
        ]
        result = evaluate(records)
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["refresh_count"], 3)
        self.assertEqual(result["distinct_refresh_times"], 3)
        self.assertTrue(result["attestation_verified"])
        self.assertTrue(result["semantic_artifacts_verified"])

    def test_duplicate_time_extra_does_not_poison_three_distinct_valid_refreshes(self):
        records = [
            refresh("refresh-1", (NOW + timedelta(days=0)).isoformat(), "4" * 64),
            refresh("refresh-2", (NOW + timedelta(days=30)).isoformat(), "5" * 64),
            refresh("refresh-3", (NOW + timedelta(days=60)).isoformat(), "4" * 64),
            refresh("refresh-extra", (NOW + timedelta(days=60)).isoformat(), "5" * 64),
        ]
        result = evaluate(records)
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["refresh_count"], 4)
        self.assertEqual(result["distinct_refresh_times"], 3)


if __name__ == "__main__":
    unittest.main(verbosity=2)
