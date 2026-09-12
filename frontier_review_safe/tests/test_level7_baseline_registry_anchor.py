from __future__ import annotations

from datetime import datetime, timedelta, timezone
import unittest

from frontier_review_safe.external_attestation import ExternalAttestationService
from frontier_review_safe.external_validation import ExternalEvidenceGate, LongitudinalRefreshRecord
from frontier_review_safe.tests.level7_semantic_fixtures import level7_artifact_fields


NOW = datetime(2026, 9, 11, 17, 15, tzinfo=timezone.utc)
CANDIDATE_SHA = "d" * 40
CASE_SET_HASH = "a" * 64
LEVEL5_REGISTRY_HASH = "9" * 64
SECRET = b"l" * 32
KEY_ID = "baseline-anchor-key"
ISSUER = "Independent Longitudinal Evaluator"


LEVEL6 = {
    "status": "PASS",
    "attestation_verified": True,
    "candidate_sha": CANDIDATE_SHA,
    "case_set_hash": CASE_SET_HASH,
    "baseline_registry_hash": LEVEL5_REGISTRY_HASH,
    "level5_provider_orgs": ["OpenAI", "Anthropic", "Google"],
    "latest_validation_at": NOW.isoformat(),
}


def refresh(
    refresh_id: str,
    day: int,
    baseline_hash: str,
    *,
    before_hash: str | None = None,
) -> LongitudinalRefreshRecord:
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
            governance_before_hash=before_hash,
        ),
    )


def receipt(record: LongitudinalRefreshRecord):
    return ExternalAttestationService.issue(
        subject_type="longitudinal_refresh",
        subject_id=record.refresh_id,
        subject_hash=record.fingerprint,
        issuer_org=ISSUER,
        verifier_key_id=KEY_ID,
        provenance_type=record.provenance_type,
        issued_at=record.executed_at,
        verifier_secret=SECRET,
    )


def evaluate(records):
    return ExternalEvidenceGate.level7(
        LEVEL6,
        records,
        receipts=[receipt(record) for record in records],
        verifier_secrets={KEY_ID: SECRET},
        trusted_issuers={ISSUER: frozenset({KEY_ID})},
    )


class Level7BaselineRegistryAnchorTests(unittest.TestCase):
    def test_two_arbitrary_registry_hashes_cannot_impersonate_a_baseline_refresh_chain(self):
        records = [
            refresh("r1", 0, "4" * 64),
            refresh("r2", 30, "5" * 64),
            refresh("r3", 60, "4" * 64),
        ]
        result = evaluate(records)
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("level5_baseline_registry_not_anchored", result["reasons"])
        self.assertEqual(result["refresh_count"], 3)

    def test_verified_level5_registry_plus_distinct_refresh_registry_is_anchored(self):
        replacement_hash = "5" * 64
        records = [
            refresh("r1", 0, LEVEL5_REGISTRY_HASH, before_hash=LEVEL5_REGISTRY_HASH),
            refresh("r2", 30, replacement_hash, before_hash=LEVEL5_REGISTRY_HASH),
            refresh("r3", 60, LEVEL5_REGISTRY_HASH, before_hash=replacement_hash),
        ]
        result = evaluate(records)
        self.assertEqual(result["status"], "PASS")
        self.assertNotIn("level5_baseline_registry_not_anchored", result["reasons"])
        self.assertNotIn("baselines_not_refreshed", result["reasons"])
        self.assertTrue(result["semantic_artifacts_verified"])
        self.assertTrue(result["governance_chain_verified"])
        self.assertEqual(result["governance_chain_refresh_ids"], ["r1", "r2", "r3"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
