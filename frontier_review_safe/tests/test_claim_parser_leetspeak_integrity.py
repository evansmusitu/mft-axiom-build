from __future__ import annotations

import unittest

from frontier_review_safe.external_validation import ClaimBoundary


CASE_SET_HASH = "a" * 64


class ClaimParserLeetspeakIntegrityTests(unittest.TestCase):
    def test_leetspeak_provider_names_are_still_bound(self):
        cases = {
            "better than 0penAI": {"openai"},
            "better than 0penA1": {"openai"},
            "better than Anthr0pic": {"anthropic"},
            "better than G00gle": {"google"},
            "better than M1crosoft": {"microsoft"},
        }
        for claim, expected in cases.items():
            with self.subTest(claim=claim):
                self.assertEqual(ClaimBoundary._named_frontier_providers(claim), expected)

    def test_leetspeak_superiority_wording_remains_broad(self):
        for claim in (
            "b3tter than OpenAI",
            "outp3rforms Google",
            "sup3rior to Anthropic",
        ):
            with self.subTest(claim=claim):
                self.assertTrue(ClaimBoundary._is_broad_claim(claim))

    def test_leetspeak_global_superlatives_remain_broad(self):
        for claim in (
            "world b3st",
            "gl0bal l3ader",
            "fr0ntier l3ading",
            "global 7op",
        ):
            with self.subTest(claim=claim):
                self.assertTrue(ClaimBoundary._is_broad_claim(claim))

    def test_leetspeak_named_superiority_cannot_downgrade_to_level5_scope(self):
        level5 = {
            "status": "PASS",
            "attestation_verified": True,
            "baseline_registry_verified": True,
        }
        result = ClaimBoundary._authorize_from_assessments(
            "b3tter than 0penAI",
            level5=level5,
            level6={"status": "FAIL", "attestation_verified": False},
            level7={"status": "FAIL", "attestation_verified": False},
            comparison_scope="declared sealed scope",
            benchmark_hash=CASE_SET_HASH,
            comparative_outcomes=(),
            required_provider_orgs=(),
        )
        self.assertEqual(result["status"], "DENY")
        self.assertEqual(result["max_evidence_level"], 5)
        self.assertEqual(result["reason"], "broad_frontier_claim_not_proven")

    def test_leetspeak_provider_substrings_still_do_not_false_match(self):
        for claim in (
            "0penAIr research system",
            "M1crosofted label",
            "G00gled benchmark result",
        ):
            with self.subTest(claim=claim):
                self.assertEqual(ClaimBoundary._named_frontier_providers(claim), set())


if __name__ == "__main__":
    unittest.main(verbosity=2)
