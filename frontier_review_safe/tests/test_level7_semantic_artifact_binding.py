from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta, timezone
import json
import unittest

from frontier_review_safe.external_attestation import ExternalAttestationService
from frontier_review_safe.external_validation import ExternalEvidenceGate, LongitudinalRefreshRecord
from frontier_review_safe.longitudinal_binding import LongitudinalArtifactBundle, artifact_sha256
from frontier_review_safe.tests.level7_semantic_fixtures import level7_artifact_fields


NOW = datetime(2026, 9, 12, 17, 0, tzinfo=timezone.utc)
CANDIDATE_SHA = "d" * 40
CASE_SET_HASH = "a" * 64
SECRET = b"semantic-level7-verifier-secret!!"
KEY_ID = "semantic-level7-key"
ISSUER = "Independent Semantic Evaluator"
EXECUTOR = "Independent Longitudinal Lab"
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


def _canonical_json(value) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def valid_refresh(refresh_id: str, day: int, baseline_hash: str) -> LongitudinalRefreshRecord:
    executed_at = (NOW + timedelta(days=day)).isoformat()
    return LongitudinalRefreshRecord(
        refresh_id=refresh_id,
        executed_at=executed_at,
        candidate_sha=CANDIDATE_SHA,
        case_set_hash=CASE_SET_HASH,
        baseline_registry_hash=baseline_hash,
        passed=True,
        provenance_type="independent_lab_record",
        executor_org=EXECUTOR,
        **level7_artifact_fields(
            candidate_sha=CANDIDATE_SHA,
            case_set_hash=CASE_SET_HASH,
            baseline_registry_hash=baseline_hash,
            generated_at=executed_at,
        ),
    )


def opaque_refresh(refresh_id: str, day: int, baseline_hash: str) -> LongitudinalRefreshRecord:
    return LongitudinalRefreshRecord(
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
        executor_org=EXECUTOR,
    )


def attest(record: LongitudinalRefreshRecord):
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
        receipts=[attest(record) for record in records],
        verifier_secrets=SECRETS,
        trusted_issuers=TRUST,
    )


def valid_set():
    return [
        valid_refresh("r1", 1, "4" * 64),
        valid_refresh("r2", 31, "5" * 64),
        valid_refresh("r3", 61, "4" * 64),
    ]


class Level7SemanticArtifactBindingTests(unittest.TestCase):
    def test_hash_only_longitudinal_refreshes_cannot_pass_level7(self):
        records = [
            opaque_refresh("r1", 1, "4" * 64),
            opaque_refresh("r2", 31, "5" * 64),
            opaque_refresh("r3", 61, "4" * 64),
        ]
        result = evaluate(records)
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("longitudinal_semantic_artifacts_missing", result["reasons"])
        self.assertIn("insufficient_attested_longitudinal_refreshes", result["reasons"])
        self.assertEqual(result["refresh_count"], 0)
        self.assertFalse(result["semantic_artifacts_verified"])

    def test_complete_semantically_bound_refresh_set_passes(self):
        result = evaluate(valid_set())
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["refresh_count"], 3)
        self.assertTrue(result["semantic_artifacts_verified"])
        self.assertIsNotNone(result["semantic_evidence_sha256"])

    def test_declared_artifact_hash_must_match_exact_artifact_bytes(self):
        good = valid_set()[:2]
        bad = replace(valid_refresh("bad-hash", 61, "4" * 64), drift_report_hash="f" * 64)
        result = evaluate([*good, bad])
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("longitudinal_semantic_artifacts_invalid", result["reasons"])
        self.assertIn("drift_report_hash_mismatch", result["semantic_artifact_reasons"])
        self.assertEqual(result["refresh_count"], 2)

    def test_drift_report_semantics_cannot_be_faked_by_rehashing_invalid_content(self):
        good = valid_set()[:2]
        base = valid_refresh("bad-drift", 61, "4" * 64)
        bundle = base.artifact_bundle
        assert bundle is not None
        drift = json.loads(bundle.drift_report_json)
        drift["overall_status"] = "stable"
        drift_json = _canonical_json(drift)
        bad_bundle = LongitudinalArtifactBundle(
            retained_failure_corpus_json=bundle.retained_failure_corpus_json,
            drift_report_json=drift_json,
            replacement_governance_json=bundle.replacement_governance_json,
        )
        bad = replace(
            base,
            drift_report_hash=artifact_sha256(drift_json),
            artifact_bundle=bad_bundle,
        )
        result = evaluate([*good, bad])
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("longitudinal_semantic_artifacts_invalid", result["reasons"])
        self.assertIn("drift_report_overall_status_inconsistent", result["semantic_artifact_reasons"])

    def test_replacement_governance_requires_a_real_transition_for_replace(self):
        good = valid_set()[:2]
        base = valid_refresh("bad-governance", 61, "4" * 64)
        bundle = base.artifact_bundle
        assert bundle is not None
        governance = json.loads(bundle.replacement_governance_json)
        governance["decision"] = "replace"
        governance_json = _canonical_json(governance)
        bad_bundle = LongitudinalArtifactBundle(
            retained_failure_corpus_json=bundle.retained_failure_corpus_json,
            drift_report_json=bundle.drift_report_json,
            replacement_governance_json=governance_json,
        )
        bad = replace(
            base,
            replacement_governance_hash=artifact_sha256(governance_json),
            artifact_bundle=bad_bundle,
        )
        result = evaluate([*good, bad])
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("replacement_governance_transition_missing", result["semantic_artifact_reasons"])

    def test_invalid_semantic_extra_does_not_poison_complete_valid_set(self):
        good = valid_set()
        extra = opaque_refresh("opaque-extra", 91, "5" * 64)
        result = evaluate([*good, extra])
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["refresh_count"], 3)
        self.assertNotIn("longitudinal_semantic_artifacts_missing", result["reasons"])

    def test_raw_artifact_content_is_bound_into_refresh_fingerprint(self):
        record = valid_refresh("fingerprint", 1, "4" * 64)
        bundle = record.artifact_bundle
        assert bundle is not None
        changed_bundle = LongitudinalArtifactBundle(
            retained_failure_corpus_json=bundle.retained_failure_corpus_json + " ",
            drift_report_json=bundle.drift_report_json,
            replacement_governance_json=bundle.replacement_governance_json,
        )
        changed = replace(record, artifact_bundle=changed_bundle)
        self.assertNotEqual(record.fingerprint, changed.fingerprint)


if __name__ == "__main__":
    unittest.main(verbosity=2)
