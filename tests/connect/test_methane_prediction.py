from datetime import datetime, timedelta, timezone
import unittest

from benchmarks.mining_adapter.methane_prediction import (
    MethanePredictionSpec,
    PredictionExample,
    binary_metrics,
    build_prediction_examples,
    evaluate_prediction_gate,
    select_operating_threshold,
    temporal_partitions,
)
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


class MethanePredictionTests(unittest.TestCase):
    def test_spec_is_bound_to_published_three_to_six_minute_task(self):
        spec=MethanePredictionSpec()
        self.assertEqual(spec.dataset_id,"yd7vw4c5mk")
        self.assertEqual(spec.doi,"10.17632/yd7vw4c5mk.1")
        self.assertEqual(spec.warning_threshold,1.0)
        self.assertEqual(spec.horizon_start_seconds,180)
        self.assertEqual(spec.horizon_end_seconds,360)
        self.assertEqual(spec.sample_stride_seconds,30)
        self.assertGreaterEqual(spec.minimum_test_recall,0.90)
        self.assertGreater(spec.minimum_f2_gain_fraction,0.0)

    def test_label_uses_only_future_three_to_six_minute_window(self):
        spec=MethanePredictionSpec(sample_stride_seconds=1)
        rows=[row(second) for second in range(500)]
        rows[250]=row(250,1.2)
        examples=list(build_prediction_examples(rows,spec))
        by_second={
            int((example.feature_time-datetime(2014,3,2,tzinfo=timezone.utc)).total_seconds()):example
            for example in examples
        }
        self.assertTrue(by_second[0].label)
        self.assertTrue(by_second[70].label)
        self.assertFalse(by_second[71].label)
        self.assertLess(by_second[0].features["target_current_max"],1.0)

    def test_examples_skip_timestamp_gaps_in_required_history_or_future(self):
        spec=MethanePredictionSpec(sample_stride_seconds=1)
        rows=[row(second) for second in range(500) if second!=200]
        examples=list(build_prediction_examples(rows,spec))
        feature_seconds={
            int((example.feature_time-datetime(2014,3,2,tzinfo=timezone.utc)).total_seconds())
            for example in examples
        }
        self.assertNotIn(0,feature_seconds)

    def test_temporal_partitions_purge_future_label_overlap(self):
        base=datetime(2014,3,2,tzinfo=timezone.utc)
        examples=[
            PredictionExample(
                feature_time=base+timedelta(seconds=index*30),
                label_window_end=base+timedelta(seconds=index*30+360),
                features={"x":float(index)},
                label=bool(index%2),
            )
            for index in range(100)
        ]
        parts=temporal_partitions(examples,MethanePredictionSpec())
        self.assertTrue(parts["train"])
        self.assertTrue(parts["calibration"])
        self.assertTrue(parts["test"])
        self.assertLess(
            max(item.label_window_end for item in parts["train"]),
            min(item.feature_time for item in parts["calibration"]),
        )
        self.assertLess(
            max(item.label_window_end for item in parts["calibration"]),
            min(item.feature_time for item in parts["test"]),
        )

    def test_operating_threshold_is_selected_on_calibration_for_high_recall(self):
        y=[1,1,1,0,0,0]
        scores=[.95,.8,.6,.55,.2,.1]
        result=select_operating_threshold(
            y,scores,minimum_recall=0.90,
        )
        self.assertGreaterEqual(result["metrics"]["recall"],0.90)
        self.assertEqual(result["threshold"],0.6)

    def test_gate_requires_leakage_safety_and_material_baseline_gain(self):
        spec=MethanePredictionSpec(
            minimum_examples=100,
            minimum_test_positives=10,
            minimum_test_recall=.90,
            minimum_test_precision=.10,
            minimum_f2_gain_fraction=.05,
        )
        report={
            "dataset_id":spec.dataset_id,
            "dataset_version":1,
            "doi":spec.doi,
            "license":"CC BY 4.0",
            "transport_source":"openml:42701",
            "source_sha256":"a"*64,
            "source_rows":9_199_930,
            "eligible_examples":1000,
            "train_examples":600,
            "calibration_examples":180,
            "test_examples":180,
            "test_positives":40,
            "temporal_leakage_check":True,
            "future_label_check":True,
            "baseline":binary_metrics([1]*40+[0]*140,[1]*20+[0]*160),
            "model":{
                **binary_metrics([1]*40+[0]*140,[1]*38+[0]*2+[1]*20+[0]*120),
                "average_precision":0.70,
                "threshold":0.42,
            },
            "credentials_used":False,
            "errors":[],
        }
        qualified=evaluate_prediction_gate(spec,report)
        self.assertTrue(qualified["predictive_signal_qualified"])
        self.assertEqual(qualified["gate"],"REAL_MINE_METHANE_PREDICTION_QUALIFIED")

        broken=dict(report)
        broken["temporal_leakage_check"]=False
        self.assertFalse(evaluate_prediction_gate(spec,broken)["predictive_signal_qualified"])


if __name__=="__main__":
    unittest.main()
