from __future__ import annotations

import unittest

from frontier_review_safe.external_validation import ClaimBoundary


CASE_SET_HASH = "a" * 64


class ClaimParserUnicodeCompatibilityTests(unittest.TestCase):
    def test_nfkc_compatibility_provider_names_are_still_bound(self):
        cases = {
            "better than ＯｐｅｎＡＩ": {"openai"},
            "better than 𝐀𝐧𝐭𝐡𝐫𝐨𝐩𝐢𝐜": {"anthropic"},
            "better than Ｇｏｏｇｌｅ": {"google"},
            "better than 𝑴𝒊𝒄𝒓𝒐𝒔𝒐𝒇𝒕": {"microsoft"},
        }
        for claim, expected in cases.items():
            with self.subTest(claim=claim):
                self.assertEqual(ClaimBoundary._named_frontier_providers(claim), expected)

    def test_nfkc_compatibility_superiority_wording_remains_broad(self):
        for claim in (
            "ｂｅｔｔｅｒ ｔｈａｎ ＯｐｅｎＡＩ",
            "𝐨𝐮𝐭𝐩𝐞𝐫𝐟𝐨𝐫𝐦𝐬 Ｇｏｏｇｌｅ",
            "𝒔𝒖𝒑𝒆𝒓𝒊𝒐𝒓 𝒕𝒐 𝐀𝐧𝐭𝐡𝐫𝐨𝐩𝐢𝐜",
        ):
            with self.subTest(claim=claim):
                self.assertTrue(ClaimBoundary._is_broad_claim(claim))

    def test_nfkc_compatibility_global_superlatives_remain_broad(self):
        for claim in (
            "ｗｏｒｌｄ ｂｅｓｔ",
            "𝐠𝐥𝐨𝐛𝐚𝐥 𝐥𝐞𝐚𝐝𝐞𝐫",
            "𝒇𝒓𝒐𝒏𝒕𝒊𝒆𝒓 𝒍𝒆𝒂𝒅𝒊𝒏𝒈",
        ):
            with self.subTest(claim=claim):
                self.assertTrue(ClaimBoundary._is_broad_claim(claim))

    def test_nfkc_named_superiority_cannot_downgrade_to_level5_scope(self):
        level5 = {
            "status": "PASS",
            "attestation_verified": True,
            "baseline_registry_verified": True,
        }
        result = ClaimBoundary._authorize_from_assessments(
            "𝐨𝐮𝐭𝐩𝐞𝐫𝐟𝐨𝐫𝐦𝐬 ＯｐｅｎＡＩ",
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
