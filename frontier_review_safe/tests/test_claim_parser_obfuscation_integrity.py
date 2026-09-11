from __future__ import annotations

import unittest

from frontier_review_safe.external_validation import ClaimBoundary


CASE_SET_HASH = "a" * 64


class ClaimParserObfuscationIntegrityTests(unittest.TestCase):
    def test_separator_obfuscated_frontier_provider_names_are_still_bound(self):
        cases = {
            "better than Open-AI": {"openai"},
            "better than O.p.e.n.A.I": {"openai"},
            "better than Anthro-pic": {"anthropic"},
            "better than Goo_gle": {"google"},
            "better than Micro soft": {"microsoft"},
        }
        for claim, expected in cases.items():
            with self.subTest(claim=claim):
                self.assertEqual(ClaimBoundary._named_frontier_providers(claim), expected)

    def test_provider_substrings_do_not_false_match(self):
        for claim in (
            "openair research system",
            "googled benchmark result",
            "anthropics paper",
            "microsofted label",
        ):
            with self.subTest(claim=claim):
                self.assertEqual(ClaimBoundary._named_frontier_providers(claim), set())

    def test_obfuscated_superiority_and_provider_wording_remains_broad(self):
        for claim in (
            "out-performs Open-AI",
            "be-ats Goo-gle",
            "a-head of Micro-soft",
            "superior-to Anthro-pic",
        ):
            with self.subTest(claim=claim):
                self.assertTrue(ClaimBoundary._is_broad_claim(claim))

    def test_obfuscated_global_superlative_wording_remains_broad(self):
        for claim in (
            "glo-bal lea-der",
            "wor-ld be-st",
            "front-ier lea-ding",
        ):
            with self.subTest(claim=claim):
                self.assertTrue(ClaimBoundary._is_broad_claim(claim))

    def test_obfuscated_named_superiority_cannot_downgrade_to_level5_scope(self):
        level5 = {
            "status": "PASS",
            "attestation_verified": True,
            "baseline_registry_verified": True,
        }
        result = ClaimBoundary._authorize_from_assessments(
            "out-performs Open-AI",
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


if __name__ == "__main__":
    unittest.main(verbosity=2)
