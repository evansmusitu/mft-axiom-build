from datetime import datetime, timedelta, timezone
import unittest

from benchmarks.mining_adapter.methane_prediction import PredictionExample
from benchmarks.mining_adapter.event_warning_metrics import analyze_warning_opportunities


def sample(second: int, label: bool = False, observed: float = 0.2) -> PredictionExample:
    base = datetime(2014, 3, 2, tzinfo=timezone.utc)
    return PredictionExample(
        feature_time=base + timedelta(seconds=second),
        label_window_end=base + timedelta(seconds=second + 360),
        features={"target_current_max": observed},
        label=label,
    )


class EventWarningMetricsTests(unittest.TestCase):
    def test_counts_overlapping_positive_windows_and_unmatched_alarm_runs(self):
        examples = [
            sample(0, True), sample(30, True),
            sample(60), sample(90, observed=1.2),
            sample(400, True), sample(430, True), sample(460),
        ]
        predictions = [True, False, True, True, False, False, True]
        report = analyze_warning_opportunities(
            examples=examples,
            predictions=predictions,
            warning_threshold=1.0,
            horizon_start_seconds=180,
            sample_stride_seconds=30,
        )
        self.assertEqual(report['evaluation_role'], 'RESEARCH_ONLY_POSITIVE_WINDOW_OPPORTUNITIES')
        self.assertFalse(report['qualified_for_admission'])
        self.assertEqual(report['positive_label_examples'], 4)
        self.assertEqual(report['overlap_connected_positive_window_groups'], 2)
        self.assertEqual(report['groups_with_at_least_one_warning'], 1)
        self.assertEqual(report['positive_window_group_recall'], 0.5)
        self.assertEqual(report['alarm_runs'], 3)
        self.assertEqual(report['unmatched_alarm_runs'], 2)
        self.assertEqual(report['false_alarm_samples'], 3)
        self.assertEqual(report['hard_observed_warning_samples'], 1)
        self.assertEqual(report['alerting_fraction'], 4 / 7)
        self.assertEqual(report['unmatched_runs_per_1000_eligible_samples'], 2000 / 7)

    def test_continuous_unmatched_alarms_are_counted_once_and_gaps_reset_runs(self):
        examples = [sample(0), sample(30), sample(180), sample(210)]
        metrics = analyze_warning_opportunities(
            examples=examples, predictions=[True] * 4,
            warning_threshold=1.0, horizon_start_seconds=180, sample_stride_seconds=30,
        )
        self.assertEqual(metrics['alarm_runs'], 2)
        self.assertEqual(metrics['unmatched_alarm_runs'], 2)
        self.assertEqual(metrics['overlap_connected_positive_window_groups'], 0)
        self.assertEqual(metrics['positive_window_group_recall'], 0.0)

    def test_missing_hard_warning_is_rejected_not_silently_counted(self):
        with self.assertRaisesRegex(ValueError, 'hard_warning_suppressed'):
            analyze_warning_opportunities(
                examples=[sample(0, observed=1.0)], predictions=[False],
                warning_threshold=1.0, horizon_start_seconds=180,
                sample_stride_seconds=30,
            )

    def test_invalid_order_or_shapes_rejected(self):
        kwargs = {'warning_threshold': 1.0, 'horizon_start_seconds': 180, 'sample_stride_seconds': 30}
        with self.assertRaisesRegex(ValueError, 'length_invalid'):
            analyze_warning_opportunities(examples=[sample(0)], predictions=[], **kwargs)
        with self.assertRaisesRegex(ValueError, 'order_invalid'):
            analyze_warning_opportunities(examples=[sample(30), sample(0)], predictions=[False, False], **kwargs)
        with self.assertRaisesRegex(ValueError, 'parameters_invalid'):
            analyze_warning_opportunities(examples=[sample(0)], predictions=[False],
                                          warning_threshold=0.0, horizon_start_seconds=180,
                                          sample_stride_seconds=30)


if __name__ == '__main__':
    unittest.main()
