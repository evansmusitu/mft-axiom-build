from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta, timezone
import unittest

from frontier_review_safe.external_attestation import ExternalAttestationService
from frontier_review_safe.external_validation import ExternalEvidenceGate, LongitudinalRefreshRecord
from frontier_review_safe.tests.level7_semantic_fixtures import level7_artifact_fields


NOW = datetime(2026, 9, 11, 16, 30, tzinfo=timezone.utc)
CANDIDATE_SHA = "d" * 40
CASE_SET_HASH = "a" * 64
SECRET = b"n" * 32
KEY_ID = "level7-nonpoison-key"
ISSUER = "Independent Longitudinal Evaluator"
SECRETS = {KEY_ID: SECRET}
TRUST = {ISSUER: frozenset({KEY_ID})}
LEVEL6 = {
    "status": "PASS",
    "attestation_verified": True,
    "candidate_sha": CANDIDATE_SHA,
    "case_set_hash": CASE_SET_HASH,
    "level5_provider_orgs": ["OpenAI", "Anthropic", "Google"],
    "latest_validation_at": NOW.isoformat(),
}


def refresh(refresh_id: str, day: int, baseline_hash: str) -> LongitudinalRefreshRecord:
    executed_at = (NOW + timedelta(days=day)).isoformat()
    return LongitudinalRefreshRecord(
        refresh_id=refresh_id,
        executed_at=executed_at,
        candidate_sha=CANDIDATE_SHA,
        case_set_hash=CASE_SET_HASH,
        baseline_registry_hash=baseline_hash,
        passed=True,
        provenance_type="independent_lab_record",
        executor_org="Independent Longitudinal Lab",
        **level7_artifact_fields(
            candidate_sha=CANDIDATE_SHA,
            case_set_hash=CASE_SET_HASH,
            baseline_registry_hash=baseline_hash,
            generated_at=executed_at,
        ),
    )


def attest(record: LongitudinalRefreshRecord, *, provenance_type: str | None = None):
    return ExternalAttestationService.issue(
        subject_type="longitudinal_refresh",
        subject_id=record.refresh_id,
        subject_hash=record.fingerprint,
        issuer_org=ISSUER,
        verifier_key_id=KEY_ID,
        provenance_type=provenance_type or record.provenance_type,
        issued_at=record.executed_at,
        verifier_secret=SECRET,
    )


def good_records():
    return [
        refresh("r1", 0, "4" * 64),
        refresh("r2", 30, "5" * 64),
        refresh("r3", 60, "4" * 64),
    ]


def evaluate(records, receipts):
    return ExternalEvidenceGate.level7(
        LEVEL6,
        records,
        receipts=receipts,
        verifier_secrets=SECRETS,
        trusted_issuers=TRUST,
    )


class Level7InvalidExtraNonPoisoningTests(unittest.TestCase):
    def test_identity_mismatch_extra_does_not_poison_complete_valid_set(self):
        good = good_records()
        extra = replace(refresh("wrong-identity-extra", 90, "5" * 64), candidate_sha="e" * 40)
        records = [*good, extra]
        result = evaluate(records, [attest(record) for record in records])
        self.assertEqual(result["status"], "PASS")
        self.assertNotIn("longitudinal_refresh_identity_mismatch", result["reasons"])
        self.assertEqual(result["refresh_count"], 3)

    def test_identity_mismatch_is_reported_when_valid_floor_is_not_met(self):
        good = good_records()[:2]
        extra = replace(refresh("wrong-identity", 60, "4" * 64), case_set_hash="b" * 64)
        records = [*good, extra]
        result = evaluate(records, [attest(record) for record in records])
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("longitudinal_refresh_identity_mismatch", result["reasons"])
        self.assertIn("insufficient_attested_longitudinal_refreshes", result["reasons"])
        self.assertEqual(result["refresh_count"], 2)

    def test_receipt_provenance_mismatch_extra_does_not_poison_complete_valid_set(self):
        good = good_records()
        extra = refresh("wrong-provenance-extra", 90, "5" * 64)
        records = [*good, extra]
        receipts = [attest(record) for record in good] + [attest(extra, provenance_type="provider_export")]
        result = evaluate(records, receipts)
        self.assertEqual(result["status"], "PASS")
        self.assertNotIn("longitudinal_refresh_provenance_type_mismatch", result["reasons"])
        self.assertEqual(result["refresh_count"], 3)

    def test_receipt_provenance_mismatch_is_reported_when_valid_floor_is_not_met(self):
        good = good_records()[:2]
        extra = refresh("wrong-provenance", 60, "4" * 64)
        records = [*good, extra]
        receipts = [attest(record) for record in good] + [attest(extra, provenance_type="provider_export")]
        result = evaluate(records, receipts)
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("longitudinal_refresh_provenance_type_mismatch", result["reasons"])
        self.assertIn("insufficient_attested_longitudinal_refreshes", result["reasons"])
        self.assertEqual(result["refresh_count"], 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
