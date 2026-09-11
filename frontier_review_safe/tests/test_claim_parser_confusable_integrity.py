from __future__ import annotations

import unittest

from frontier_review_safe.external_validation import ClaimBoundary


CASE_SET_HASH = "a" * 64


class ClaimParserConfusableIntegrityTests(unittest.TestCase):
    def test_cross_script_confusable_provider_names_are_still_bound(self):
        cases = {
            "better than ОpenAI": {"openai"},  # Cyrillic O
            "better than OpenAΙ": {"openai"},  # Greek Iota
            "better than Anthrоpic": {"anthropic"},  # Cyrillic o
            "better than Micrоsoft": {"microsoft"},  # Cyrillic o
        }
        for claim, expected in cases.items():
            with self.subTest(claim=claim):
                self.assertEqual(ClaimBoundary._named_frontier_providers(claim), expected)

    def test_cross_script_confusable_superiority_wording_remains_broad(self):
        for claim in (
            "bеtter than OpenAI",  # Cyrillic e
            "оutperforms Google",  # Cyrillic o
            "superiоr to Anthropic",  # Cyrillic o
        ):
            with self.subTest(claim=claim):
                self.assertTrue(ClaimBoundary._is_broad_claim(claim))

    def test_cross_script_confusable_global_superlatives_remain_broad(self):
        for claim in (
            "world bеst",  # Cyrillic e
            "glоbal leader",  # Cyrillic o
            "frоntier leading",  # Cyrillic o
        ):
            with self.subTest(claim=claim):
                self.assertTrue(ClaimBoundary._is_broad_claim(claim))

    def test_confusable_named_superiority_cannot_downgrade_to_level5_scope(self):
        level5 = {
            "status": "PASS",
            "attestation_verified": True,
            "baseline_registry_verified": True,
        }
        result = ClaimBoundary._authorize_from_assessments(
            "bеtter than ОpenAI",
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

    def test_confusable_provider_substrings_still_do_not_false_match(self):
        for claim in (
            "ОpenAIr research system",
            "Micrоsofted label",
        ):
            with self.subTest(claim=claim):
                self.assertEqual(ClaimBoundary._named_frontier_providers(claim), set())


if __name__ == "__main__":
    unittest.main(verbosity=2)
