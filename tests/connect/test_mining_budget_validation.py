"""Non-production Mining Adapter planner budget-integrity regressions.

The planner may not interpret non-finite financial budgets as valid authority
for selecting interventions. No model, mine, D1, or customer access is needed.
"""
import unittest

from connect.mining import normalize_mining_rows, optimize_interventions


class MiningPlannerBudgetValidationTests(unittest.TestCase):
    def setUp(self):
        self.envelope = normalize_mining_rows([{
            "hazard": "synthetic control",
            "exposure": 1.0,
            "severity": 10.0,
            "likelihood": 1.0,
            "cost": 5.0,
            "benefit": 0.2,
        }])

    def test_nonfinite_positive_or_unordered_budget_is_rejected(self):
        # NaN silently defeats ordering, while +Infinity removes the real
        # finite spend constraint. Both must fail closed before planning.
        for budget in (float("nan"), float("inf")):
            with self.subTest(budget=repr(budget)):
                with self.assertRaisesRegex(ValueError, "budget_must_be_finite"):
                    optimize_interventions(self.envelope, budget=budget)

    def test_normal_finite_budget_preserves_exact_planner_behavior(self):
        zero = optimize_interventions(self.envelope, budget=0)
        self.assertEqual(zero.spend, 0)
        self.assertEqual(zero.risk_reduction, 0)
        funded = optimize_interventions(self.envelope, budget=5)
        self.assertEqual(funded.selected, ("synthetic control",))
        self.assertEqual(funded.spend, 5.0)
        self.assertAlmostEqual(funded.risk_reduction, 2.0)


if __name__ == "__main__":
    unittest.main()
