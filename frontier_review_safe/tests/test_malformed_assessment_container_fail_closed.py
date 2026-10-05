from __future__ import annotations

import unittest

from frontier_review_safe.external_validation import ExternalEvidenceGate, ExternalRunRecord


HASH = "a" * 64
CANDIDATE_SHA = "d" * 40


def _run() -> ExternalRunRecord:
    return ExternalRunRecord(
        run_id="run-1",
        provider_org="Provider A",
        product="Product A",
        exact_version="1.0",
        executed_at="2026-09-12T04:00:00+00:00",
        access_mode="api",
        case_set_hash=HASH,
        constraint_hash=HASH,
        permissions_hash=HASH,
        result_hash=HASH,
        raw_evidence_hash=HASH,
        provenance_type="provider_api_receipt",
        authenticated=True,
        candidate_sha=CANDIDATE_SHA,
        candidate_environment_hash=HASH,
        metrics={"score": 1.0},
    )


class MalformedAssessmentContainerTests(unittest.TestCase):
    def test_level5_wrong_type_baseline_registry_fails_closed_without_exception(self):
        result = ExternalEvidenceGate.level5([_run()], baseline_registry=object())
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("invalid_baseline_registry", result["reasons"])

    def test_level6_non_mapping_level5_assessment_fails_closed_without_exception(self):
        result = ExternalEvidenceGate.level6(None, [])
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("invalid_level5_assessment", result["reasons"])
        self.assertFalse(result["attestation_verified"])

    def test_level7_non_mapping_level6_assessment_fails_closed_without_exception(self):
        result = ExternalEvidenceGate.level7(None, [])
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("invalid_level6_assessment", result["reasons"])
        self.assertFalse(result["attestation_verified"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
