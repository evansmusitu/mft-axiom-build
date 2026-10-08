from datetime import datetime, timedelta, timezone
import unittest
import importlib.util

from benchmarks.mining_adapter.methane_backtest import MethaneBacktestSpec
from benchmarks.mining_adapter.methane_prediction import PredictionExample
from benchmarks.mining_adapter.lightgbm_challenger import evaluate_challenger_fold


def examples(offset, count, period=7):
    base = datetime(2014, 3, 2, tzinfo=timezone.utc)
    result = []
    for i in range(count):
        label = i % period == 0
        value = 0.8 if label else 0.05
        result.append(PredictionExample(
            feature_time=base + timedelta(seconds=offset + i * 30),
            label_window_end=base + timedelta(seconds=offset + i * 30 + 360),
            features={"target_current_max": 0.2, "causal_signal": value},
            label=label,
        ))
    return result


@unittest.skipUnless(importlib.util.find_spec("lightgbm") is not None,
                     "optional LightGBM is installed in the separate research workflow")
class LightGBMChallengerTests(unittest.TestCase):
    def setUp(self):
        self.train = examples(0, 100, period=5)
        self.calibration = examples(4000, 65, period=5)
        self.test = examples(7000, 48, period=5)
        self.spec = MethaneBacktestSpec(minimum_online_positives=2)

    def test_real_lightgbm_trains_and_preserves_hard_warning(self):
        self.test[0].features["target_current_max"] = 1.2
        result = evaluate_challenger_fold(
            train=self.train, calibration=self.calibration, test=self.test,
            feature_names=["target_current_max", "causal_signal"],
            spec=self.spec, fold_index=0,
        )
        self.assertEqual(result["fold"], 0)
        self.assertEqual(result["test_examples"], 48)
        self.assertEqual(result["test_positives"], 10)
        self.assertTrue(result["temporal_leakage_check"])
        self.assertTrue(result["online_recalibration_leakage_check"])
        self.assertEqual(result["model_type"], "lightgbm.LGBMClassifier")
        self.assertEqual(result["baseline"]["fp"], 0)
        self.assertGreaterEqual(result["model"]["tp"] + result["model"]["fp"], 1)
        self.assertEqual(result["model"]["tp"]+result["model"]["fn"],10)
        self.assertGreaterEqual(result["model"]["average_precision"],0.0)
        self.assertLessEqual(result["model"]["average_precision"],1.0)

    def test_leakage_purging_is_mandatory(self):
        self.calibration = examples(2800, 40)
        with self.assertRaisesRegex(ValueError, "causal_fold_boundary_invalid"):
            evaluate_challenger_fold(
                train=self.train, calibration=self.calibration, test=self.test,
                feature_names=["target_current_max", "causal_signal"],
                spec=self.spec, fold_index=0,
            )

    def test_disallows_missing_classes_and_feature_mismatch(self):
        no_positive = examples(0, 100, period=10000)[1:]
        with self.assertRaisesRegex(ValueError, "challenger_training_classes_missing"):
            evaluate_challenger_fold(
                train=no_positive, calibration=self.calibration, test=self.test,
                feature_names=["target_current_max", "causal_signal"],
                spec=self.spec, fold_index=0,
            )
        with self.assertRaisesRegex((ValueError, KeyError), "challenger_feature_invalid"):
            evaluate_challenger_fold(
                train=self.train, calibration=self.calibration, test=self.test,
                feature_names=["target_current_max", "future_unsafe"],
                spec=self.spec, fold_index=0,
            )


if __name__ == "__main__":
    unittest.main()
