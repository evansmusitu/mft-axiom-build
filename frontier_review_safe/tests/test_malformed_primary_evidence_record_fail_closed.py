from __future__ import annotations

import unittest

from frontier_review_safe.external_validation import ExternalEvidenceGate


CANDIDATE_SHA = "d" * 40
CASE_SET_HASH = "a" * 64


class MalformedPrimaryEvidenceRecordTests(unittest.TestCase):
    def test_level5_wrong_type_run_fails_closed_without_exception(self):
        result = ExternalEvidenceGate.level5([None])
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("invalid_external_run_record", result["reasons"])

    def test_level6_wrong_type_validation_fails_closed_without_exception(self):
        level5 = {
            "status": "PASS",
            "attestation_verified": True,
            "baseline_registry_verified": True,
            "candidate_sha": CANDIDATE_SHA,
            "case_set_hash": CASE_SET_HASH,
            "provider_orgs": ["OpenAI", "Anthropic", "Google"],
        }
        result = ExternalEvidenceGate.level6(level5, [None])
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("invalid_independent_validation_record", result["reasons"])
        self.assertEqual(result["validation_count"], 0)

    def test_level7_wrong_type_refresh_fails_closed_without_exception(self):
        level6 = {
            "status": "PASS",
            "attestation_verified": True,
            "candidate_sha": CANDIDATE_SHA,
            "case_set_hash": CASE_SET_HASH,
            "level5_provider_orgs": ["OpenAI", "Anthropic", "Google"],
        }
        result = ExternalEvidenceGate.level7(level6, [None])
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("invalid_longitudinal_refresh_record", result["reasons"])
        self.assertEqual(result["refresh_count"], 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
