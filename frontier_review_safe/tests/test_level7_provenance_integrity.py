from __future__ import annotations

from datetime import datetime, timedelta, timezone
import unittest

from frontier_review_safe.external_attestation import ExternalAttestationService
from frontier_review_safe.external_validation import ExternalEvidenceGate, LongitudinalRefreshRecord
from frontier_review_safe.tests.level7_semantic_fixtures import level7_artifact_fields


NOW = datetime(2026, 9, 11, 11, 25, tzinfo=timezone.utc)
CANDIDATE_SHA = "d" * 40
CASE_SET_HASH = "a" * 64
SECRET = b"p" * 32
SECRETS = {"provenance-key": SECRET}
TRUST = {"Independent Longitudinal Evaluator": frozenset({"provenance-key"})}
LEVEL6 = {
    "status": "PASS",
    "attestation_verified": True,
    "candidate_sha": CANDIDATE_SHA,
    "case_set_hash": CASE_SET_HASH,
}


def refresh(refresh_id: str, day: int, provenance_type: str, baseline_hash: str) -> LongitudinalRefreshRecord:
    executed_at = (NOW + timedelta(days=day)).isoformat()
    return LongitudinalRefreshRecord(
        refresh_id=refresh_id,
        executed_at=executed_at,
        candidate_sha=CANDIDATE_SHA,
        case_set_hash=CASE_SET_HASH,
        baseline_registry_hash=baseline_hash,
        passed=True,
        provenance_type=provenance_type,
        executor_org="Independent Longitudinal Lab",
        **level7_artifact_fields(
            candidate_sha=CANDIDATE_SHA,
            case_set_hash=CASE_SET_HASH,
            baseline_registry_hash=baseline_hash,
            generated_at=executed_at,
        ),
    )


def attest(record: LongitudinalRefreshRecord):
    return ExternalAttestationService.issue(
        subject_type="longitudinal_refresh",
        subject_id=record.refresh_id,
        subject_hash=record.fingerprint,
        issuer_org="Independent Longitudinal Evaluator",
        verifier_key_id="provenance-key",
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


class Level7ProvenanceIntegrityTests(unittest.TestCase):
    def test_provider_export_cannot_count_as_longitudinal_independent_refresh(self):
        records = [
            refresh("r1", 0, "provider_export", "4" * 64),
            refresh("r2", 30, "provider_export", "5" * 64),
            refresh("r3", 60, "provider_export", "4" * 64),
        ]
        result = evaluate(records)
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("longitudinal_refresh_provenance_required", result["reasons"])
        self.assertIn("insufficient_attested_longitudinal_refreshes", result["reasons"])
        self.assertEqual(result["refresh_count"], 0)

    def test_provider_api_receipt_cannot_count_as_longitudinal_independent_refresh(self):
        records = [
            refresh("r1", 0, "provider_api_receipt", "4" * 64),
            refresh("r2", 30, "provider_api_receipt", "5" * 64),
            refresh("r3", 60, "provider_api_receipt", "4" * 64),
        ]
        result = evaluate(records)
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("longitudinal_refresh_provenance_required", result["reasons"])
        self.assertEqual(result["refresh_count"], 0)

    def test_independent_lab_refreshes_remain_valid_mechanics(self):
        records = [
            refresh("r1", 0, "independent_lab_record", "4" * 64),
            refresh("r2", 30, "independent_lab_record", "5" * 64),
            refresh("r3", 60, "independent_lab_record", "4" * 64),
        ]
        result = evaluate(records)
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["refresh_count"], 3)
        self.assertEqual(result["distinct_refresh_times"], 3)
        self.assertEqual(result["refresh_executor_orgs"], ["independent longitudinal lab"])
        self.assertTrue(result["semantic_artifacts_verified"])

    def test_provider_origin_extra_does_not_poison_complete_independent_set(self):
        records = [
            refresh("r1", 0, "independent_lab_record", "4" * 64),
            refresh("r2", 30, "independent_lab_record", "5" * 64),
            refresh("r3", 60, "independent_lab_record", "4" * 64),
            refresh("provider-extra", 90, "provider_export", "5" * 64),
        ]
        result = evaluate(records)
        self.assertEqual(result["status"], "PASS")
        self.assertNotIn("longitudinal_refresh_provenance_required", result["reasons"])
        self.assertEqual(result["refresh_count"], 3)


if __name__ == "__main__":
    unittest.main(verbosity=2)
