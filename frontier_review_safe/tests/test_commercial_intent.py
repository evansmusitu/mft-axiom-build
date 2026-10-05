from __future__ import annotations

import unittest

from frontier_review_safe.commercial_intent import CommercialIntentQualifier, CommercialIntentRequest
from frontier_review_safe.core import FrontierSafetyError


class CommercialIntentTests(unittest.TestCase):
    def test_legacy_analytical_request_is_allowed_but_analysis_only(self):
        decision = CommercialIntentQualifier.qualify(
            CommercialIntentRequest("analysis.portfolio", True, "analyze portfolio risk")
        )
        self.assertEqual(decision["status"], "ALLOW")
        self.assertEqual(decision["classification"], "ANALYTICAL")
        self.assertEqual(decision["permitted_effects"], ("analysis_only",))
        self.assertEqual(len(decision["intent_sha256"]), 64)

    def test_structured_safe_analytical_effects_are_explicitly_bounded(self):
        decision = CommercialIntentQualifier.qualify(
            CommercialIntentRequest(
                "stress.portfolio", True, "stress the portfolio", effects=frozenset({"read", "stress_test", "explain"})
            )
        )
        self.assertEqual(decision["status"], "ALLOW")
        self.assertEqual(set(decision["permitted_effects"]), {"read", "stress_test", "explain"})

    def test_analytical_name_cannot_launder_trade_effect(self):
        decision = CommercialIntentQualifier.qualify(
            CommercialIntentRequest(
                "analysis.portfolio", True, "analyze then place the trade",
                effects=frozenset({"read", "investment_trade"}), consequential=True,
            )
        )
        self.assertEqual(decision["status"], "DENY")
        self.assertEqual(decision["reason"], "forbidden_public_effect")

    def test_analytical_action_with_operational_token_fails_closed(self):
        decision = CommercialIntentQualifier.qualify(
            CommercialIntentRequest("analysis.checkout", True, "analyze subscription options")
        )
        self.assertEqual(decision["status"], "DENY")
        self.assertEqual(decision["reason"], "public_side_effect_signal_detected")

    def test_exact_public_trade_transfer_checkout_and_ads_actions_are_denied(self):
        for action in (
            "investment.trade", "money.transfer", "crypto.transfer", "subscription.checkout", "ads.display"
        ):
            with self.subTest(action=action):
                self.assertEqual(
                    CommercialIntentQualifier.qualify(CommercialIntentRequest(action, True, "request", True))["status"],
                    "DENY",
                )

    def test_unknown_public_effect_fails_closed(self):
        decision = CommercialIntentQualifier.qualify(
            CommercialIntentRequest(
                "analysis.portfolio", True, "analyze", effects=frozenset({"read", "mystery_side_effect"})
            )
        )
        self.assertEqual(decision["status"], "DENY")
        self.assertEqual(decision["reason"], "unknown_public_effect_fail_closed")

    def test_private_consequential_intent_requires_review_not_automatic_allow(self):
        decision = CommercialIntentQualifier.qualify(
            CommercialIntentRequest(
                "operations.trade", False, "place trade", effects=frozenset({"investment_trade"}), consequential=True
            )
        )
        self.assertEqual(decision["status"], "REVIEW")
        self.assertEqual(decision["classification"], "PRIVATE_CONSEQUENTIAL")

    def test_obfuscated_or_noncanonical_action_is_denied(self):
        decision = CommercialIntentQualifier.qualify(
            CommercialIntentRequest("analysis.\u202echeckout", True, "analyze")
        )
        self.assertEqual(decision["status"], "DENY")
        self.assertEqual(decision["reason"], "invalid_intent_contract")

    def test_public_assertion_raises_for_any_non_allow_decision(self):
        with self.assertRaises(FrontierSafetyError):
            CommercialIntentQualifier.assert_public_safe(
                CommercialIntentRequest("subscription.checkout", True, "start checkout", True)
            )


if __name__ == "__main__":
    unittest.main(verbosity=2)
