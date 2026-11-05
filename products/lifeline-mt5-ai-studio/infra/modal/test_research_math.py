"""Research evaluator safety and deterministic acceptance."""
import unittest
from research_math import summarize, MAX_TRADES

class TestResearchMath(unittest.TestCase):
    def test_signed_sample(self):
        report=summarize(["120.00","-40.00","30.00","-10.00"])
        self.assertEqual(report["net_pnl"],"100.00")
        self.assertEqual(report["gross_profit"],"150.00")
        self.assertEqual(report["gross_loss"],"50.00")
        self.assertEqual(report["profit_factor"],"3.0000")
        self.assertEqual(report["win_rate_percent"],"50.00")
        self.assertEqual(report["max_drawdown"],"40.00")
        self.assertFalse(report["trading_enabled"])
    def test_no_loss_factor_not_infinity(self):
        report=summarize(["10","0"])
        self.assertIsNone(report["profit_factor"])
        self.assertEqual(report["break_even"],1)
    def test_all_losses_drawdown(self):
        report=summarize(["-5.50","-2.25"])
        self.assertEqual(report["max_drawdown"],"7.75")
        self.assertEqual(report["net_pnl"],"-7.75")
    def test_reject_empty(self):
        for x in ([],["1"]*(MAX_TRADES+1)):
            with self.assertRaises(ValueError):summarize(x)
    def test_reject_unsafe_types(self):
        for x in ([1.2],[True],[None],[{}],["NaN"],["Infinity"],["1e200"],["3.14159"],["01.00"],["-1000000000"]):
            with self.subTest(x=x),self.assertRaises(ValueError):summarize(x)
    def test_precision_preserved(self):
        self.assertEqual(summarize(["0.10","0.20","-0.30"])["net_pnl"],"0.00")

if __name__=="__main__":unittest.main()
