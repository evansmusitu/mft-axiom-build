"""Live classifier and safety-boundary regressions for a research-only challenger."""
from datetime import datetime, timedelta, timezone
import importlib
import importlib.util
import unittest

from benchmarks.mining_adapter.methane_backtest import MethaneBacktestSpec
from benchmarks.mining_adapter.methane_prediction import PredictionExample


def samples(offset: int, n: int, *, all_negative: bool = False):
    base = datetime(2014, 3, 2, tzinfo=timezone.utc)
    return [PredictionExample(
        feature_time=base + timedelta(seconds=offset + i * 30),
        label_window_end=base + timedelta(seconds=offset + i * 30 + 360),
        features={"target_current_max": 0.2, "historical_signal": 0.9 if i % 5 == 0 else 0.02},
        label=not all_negative and i % 5 == 0,
    ) for i in range(n)]


@unittest.skipUnless(importlib.util.find_spec("catboost") is not None,
                     "optional CatBoost only installed in independent research CI")
class CatBoostChallengerTests(unittest.TestCase):
    def setUp(self):
        self.train = samples(0, 100)
        self.calibration = samples(4000, 65)
        self.test = samples(7000, 48)
        self.spec = MethaneBacktestSpec(minimum_online_positives=2)

    def evaluate(self, *, train=None, calibration=None, test=None, features=None):
        module = importlib.import_module("benchmarks.mining_adapter.catboost_challenger")
        return module.evaluate_challenger_fold(
            train=self.train if train is None else train,
            calibration=self.calibration if calibration is None else calibration,
            test=self.test if test is None else test,
            feature_names=["target_current_max", "historical_signal"] if features is None else features,
            spec=self.spec, fold_index=0,
        )

    def test_real_model_training_and_hard_observed_warning(self):
        self.assertIsNotNone(importlib.util.find_spec("benchmarks.mining_adapter.catboost_challenger"),
                             "CatBoost research contender must be independently implemented")
        self.test[0].features["target_current_max"] = 1.2
        report = self.evaluate()
        self.assertEqual(report["model_type"], "catboost.CatBoostClassifier")
        self.assertEqual(report["test_examples"], 48)
        self.assertEqual(report["test_positives"], 10)
        self.assertEqual(report["baseline"]["tp"], 1)
        self.assertTrue(report["hard_observed_warning_preserved"])
        self.assertTrue(report["online_recalibration_leakage_check"])
        self.assertEqual(report["model"]["tp"] + report["model"]["fn"], 10)
        self.assertGreaterEqual(report["model"]["average_precision"], 0)
        self.assertLessEqual(report["model"]["average_precision"], 1)

    def test_future_label_window_cannot_be_used_for_calibration(self):
        # A calibration label's future horizon overlaps the first test timestamp.
        with self.assertRaisesRegex(ValueError, "causal_fold_boundary_invalid"):
            self.evaluate(calibration=samples(5000, 60))

    def test_no_training_class_or_invalid_features_fail_closed(self):
        with self.assertRaisesRegex(ValueError, "challenger_training_classes_missing"):
            self.evaluate(train=samples(0, 100, all_negative=True))
        with self.assertRaisesRegex(ValueError, "challenger_feature_invalid"):
            self.evaluate(features=["target_current_max", "future_methane"])

    def test_test_time_order_is_strictly_increasing(self):
        with self.assertRaisesRegex(ValueError, "challenger_fold_order_invalid"):
            self.evaluate(test=list(reversed(self.test)))


if __name__ == "__main__":
    unittest.main()
