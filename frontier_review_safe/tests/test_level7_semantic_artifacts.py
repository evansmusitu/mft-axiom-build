from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import unittest

from frontier_review_safe.external_validation import LongitudinalRefreshRecord
from frontier_review_safe.longitudinal_artifacts import validate_longitudinal_artifact_bundle
from frontier_review_safe.tests.level7_semantic_fixture import (
    artifact_bundle_for,
    bind_semantic_record,
)


NOW = datetime(2026, 9, 12, 16, 30, tzinfo=timezone.utc).isoformat()
CANDIDATE = "d" * 40
CASE_SET = "a" * 64


def opaque_record() -> LongitudinalRefreshRecord:
    return LongitudinalRefreshRecord(
        refresh_id="semantic-refresh-1",
        executed_at=NOW,
        candidate_sha=CANDIDATE,
        case_set_hash=CASE_SET,
        baseline_registry_hash="b" * 64,
        retained_failure_corpus_hash="1" * 64,
        drift_report_hash="2" * 64,
        replacement_governance_hash="3" * 64,
        passed=True,
        provenance_type="independent_lab_record",
        executor_org="Independent Longitudinal Lab",
    )


class Level7SemanticArtifactTests(unittest.TestCase):
    def test_valid_semantic_bundle_matches_attested_refresh_hashes(self):
        record = bind_semantic_record(opaque_record())
        result = validate_longitudinal_artifact_bundle(record, artifact_bundle_for(record))
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["reasons"], [])

    def test_opaque_hashes_without_semantic_bundle_fail_closed(self):
        result = validate_longitudinal_artifact_bundle(opaque_record(), None)
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("longitudinal_semantic_artifact_bundle_missing", result["reasons"])

    def test_semantic_artifact_hash_mismatch_fails_closed(self):
        record = opaque_record()
        result = validate_longitudinal_artifact_bundle(record, artifact_bundle_for(record))
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("retained_failure_corpus_hash_mismatch", result["reasons"])
        self.assertIn("drift_report_hash_mismatch", result["reasons"])
        self.assertIn("replacement_governance_hash_mismatch", result["reasons"])

    def test_failure_corpus_candidate_mismatch_fails_closed(self):
        record = bind_semantic_record(opaque_record())
        bundle = artifact_bundle_for(record)
        bundle["retained_failure_corpus"]["candidate_sha"] = "e" * 40
        result = validate_longitudinal_artifact_bundle(record, bundle)
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("retained_failure_corpus_candidate_identity_mismatch", result["reasons"])

    def test_drift_report_must_bind_current_evidence_to_failure_corpus(self):
        record = bind_semantic_record(opaque_record())
        bundle = artifact_bundle_for(record)
        bundle["drift_report"]["current_evidence_hash"] = "f" * 64
        result = validate_longitudinal_artifact_bundle(record, bundle)
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("drift_report_current_evidence_not_bound_to_failure_corpus", result["reasons"])

    def test_replacement_governance_must_bind_both_semantic_inputs(self):
        record = bind_semantic_record(opaque_record())
        bundle = artifact_bundle_for(record)
        bundle["replacement_governance"]["evidence_hashes"] = [
            bundle["replacement_governance"]["evidence_hashes"][0]
        ]
        result = validate_longitudinal_artifact_bundle(record, bundle)
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("replacement_governance_drift_report_not_bound", result["reasons"])

    def test_semantic_contents_cannot_be_tampered_after_hash_binding(self):
        record = bind_semantic_record(opaque_record())
        bundle = artifact_bundle_for(record)
        tampered = deepcopy(bundle)
        tampered["drift_report"]["observations"][0]["current_value"] = 1.0
        result = validate_longitudinal_artifact_bundle(record, tampered)
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("drift_report_hash_mismatch", result["reasons"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
