from __future__ import annotations

import unittest

from frontier_review_safe import commercial_intent, controls


class CommercialIntentExportIntegrityTests(unittest.TestCase):
    def test_controls_exports_canonical_structured_intent_types(self):
        self.assertIs(controls.CommercialIntentRequest, commercial_intent.CommercialIntentRequest)
        self.assertIs(controls.CommercialIntentQualifier, commercial_intent.CommercialIntentQualifier)

    def test_legacy_controls_import_cannot_launder_public_trade_as_analysis(self):
        decision = controls.CommercialIntentQualifier.qualify(
            controls.CommercialIntentRequest(
                "analysis.portfolio", True, "analyze then place trade", True,
                effects=frozenset({"read", "investment_trade"}),
            )
        )
        self.assertEqual(decision["status"], "DENY")


if __name__ == "__main__":
    unittest.main(verbosity=2)
