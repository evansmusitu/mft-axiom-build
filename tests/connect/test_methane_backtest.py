from datetime import datetime, timedelta, timezone
import unittest

from benchmarks.mining_adapter.methane_backtest import (
    MethaneBacktestSpec,
    build_windowed_prediction_examples,
    evaluate_backtest_gate,
    online_recalibrated_predictions,
    rolling_backtest_folds,
)
from benchmarks.mining_adapter.methane_prediction import PredictionExample, binary_metrics
from connect.mining_telemetry import MINING_TELEMETRY_SENSORS


def row(second: int, methane: float=0.2):
    stamp=datetime(2014,3,2,tzinfo=timezone.utc)+timedelta(seconds=second)
    item={"event_time":stamp.isoformat(timespec="seconds").replace("+00:00","Z")}
    for index,name in enumerate(MINING_TELEMETRY_SENSORS):
        item[name]="right" if name=="F_SIDE" else float(index)/10.0
    item["MM263"]=methane
    item["MM264"]=0.2
    item["MM256"]=0.2
    return item


class MethaneBacktestTests(unittest.TestCase):
    def test_spec_locks_history_future_and_development_region(self):
        spec=MethaneBacktestSpec()
        self.assertEqual(spec.history_seconds,600)
        self.assertEqual(spec.horizon_start_seconds,180)
        self.assertEqual(spec.horizon_end_seconds,360)
        self.assertEqual(spec.fold_count,4)
        self.assertEqual(spec.development_fraction,0.80)
        self.assertEqual(spec.calibration_recall_target,0.95)
        self.assertEqual(spec.minimum_test_recall,0.90)
        self.assertEqual(spec.required_passing_folds,3)
        self.assertEqual(spec.threshold_update_examples,120)
        self.assertEqual(spec.threshold_window_examples,10000)
        self.assertGreaterEqual(spec.minimum_online_positives,50)

    def test_window_features_use_only_past_and_present(self):
        spec=MethaneBacktestSpec(sample_stride_seconds=1)
        rows=[row(second,0.2+second/1000.0) for second in range(1200)]
        rows[900]=row(900,1.2)
        examples=list(build_windowed_prediction_examples(rows,spec))
        base=datetime(2014,3,2,tzinfo=timezone.utc)
        by_second={
            int((item.feature_time-base).total_seconds()):item
            for item in examples
        }
        item=by_second[600]
        self.assertTrue(item.label)
        self.assertAlmostEqual(item.features["MM263_delta_60"],0.06,places=9)
        self.assertAlmostEqual(item.features["MM263_delta_600"],0.60,places=9)
        self.assertLess(item.features["MM263_max_60"],1.0)
        self.assertLess(item.features["target_current_max"],1.0)

    def test_window_examples_fail_closed_across_timestamp_gap(self):
        spec=MethaneBacktestSpec(sample_stride_seconds=1)
        rows=[row(second) for second in range(1200) if second!=100]
        examples=list(build_windowed_prediction_examples(rows,spec))
        base=datetime(2014,3,2,tzinfo=timezone.utc)
        feature_seconds={
            int((item.feature_time-base).total_seconds()) for item in examples
        }
        self.assertNotIn(600,feature_seconds)

    def test_rolling_folds_purge_train_calibration_test_boundaries(self):
        spec=MethaneBacktestSpec()
        rows=[row(second) for second in range(20_000)]
        examples=list(build_windowed_prediction_examples(rows,spec))
        folds=rolling_backtest_folds(examples,spec)
        self.assertEqual(len(folds),4)
        for fold in folds:
            self.assertTrue(fold["train"])
            self.assertTrue(fold["calibration"])
            self.assertTrue(fold["test"])
            self.assertLess(
                max(item.label_window_end for item in fold["train"]),
                min(item.feature_time for item in fold["calibration"]),
            )
            self.assertLess(
                max(item.label_window_end for item in fold["calibration"]),
                min(item.feature_time for item in fold["test"]),
            )
            self.assertLess(
                max(item.label_window_end for item in fold["test"]),
                fold["development_end"],
            )


    def test_online_recalibration_uses_only_fully_resolved_prior_labels(self):
        base=datetime(2014,3,2,tzinfo=timezone.utc)
        calibration=[
            PredictionExample(
                feature_time=base-timedelta(seconds=1200-index*60),
                label_window_end=base-timedelta(seconds=840-index*60),
                features={"x":float(index)},
                label=index<4,
            )
            for index in range(8)
        ]
        calibration_scores=[.95,.9,.85,.8,.4,.3,.2,.1]
        test=[
            PredictionExample(
                feature_time=base+timedelta(seconds=index*60),
                label_window_end=base+timedelta(seconds=index*60+360),
                features={"x":float(index)},
                label=index in {0,1,2,7,8,9},
            )
            for index in range(12)
        ]
        test_scores=[.25,.22,.20,.1,.08,.07,.06,.24,.23,.21,.09,.05]
        result=online_recalibrated_predictions(
            calibration_examples=calibration,
            calibration_scores=calibration_scores,
            test_examples=test,
            test_scores=test_scores,
            minimum_recall=.90,
            update_every_examples=1,
            window_examples=4,
            minimum_online_positives=1,
        )
        self.assertEqual(len(result["predictions"]),len(test))
        self.assertTrue(result["leakage_safe"])
        self.assertGreater(result["threshold_updates"],1)
        for audit in result["update_audit"]:
            if audit["latest_label_window_end_used"] is not None:
                self.assertLess(
                    datetime.fromisoformat(audit["latest_label_window_end_used"]),
                    datetime.fromisoformat(audit["prediction_time"]),
                )
        self.assertLess(result["thresholds"][-1],result["thresholds"][0])

    def test_backtest_gate_requires_three_of_four_strong_folds(self):
        spec=MethaneBacktestSpec(
            minimum_examples=100,
            minimum_fold_test_positives=5,
        )
        good_model={
            **binary_metrics([1]*20+[0]*80,[1]*19+[0]+[1]*10+[0]*70),
            "average_precision":0.70,
        }
        baseline=binary_metrics([1]*20+[0]*80,[1]*7+[0]*93)
        folds=[]
        for index in range(4):
            model=dict(good_model)
            if index==3:
                model["recall"]=0.85
            folds.append({
                "fold":index,
                "train_examples":300,
                "calibration_examples":100,
                "test_examples":100,
                "test_positives":20,
                "test_prevalence":0.20,
                "temporal_leakage_check":True,
                "online_recalibration_leakage_check":True,
                "baseline":baseline,
                "model":model,
            })
        report={
            "dataset_id":spec.dataset_id,
            "dataset_version":1,
            "doi":spec.doi,
            "license":"CC BY 4.0",
            "transport_source":"openml:42701",
            "source_sha256":"a"*64,
            "source_rows":9_199_930,
            "eligible_examples":1000,
            "folds":folds,
            "credentials_used":False,
            "errors":[],
        }
        result=evaluate_backtest_gate(spec,report)
        self.assertTrue(result["backtest_qualified"])
        self.assertEqual(result["gate"],"REAL_MINE_METHANE_BACKTEST_QUALIFIED")
        self.assertEqual(result["passing_folds"],3)

        report["folds"][0]["temporal_leakage_check"]=False
        result=evaluate_backtest_gate(spec,report)
        self.assertFalse(result["backtest_qualified"])

        report["folds"][0]["temporal_leakage_check"]=True
        report["folds"][0]["online_recalibration_leakage_check"]=False
        result=evaluate_backtest_gate(spec,report)
        self.assertFalse(result["backtest_qualified"])


if __name__=="__main__":
    unittest.main()
