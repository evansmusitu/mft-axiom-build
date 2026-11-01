"""Research-only warning-opportunity diagnostics; NOT incident/safety certification.

Ground-truth binary labels represent future exceedance WINDOWS, not unique
hazardous events. The grouping below counts overlapping positive windows and
contiguous predicted alarm runs solely to diagnose repetition/alert burden.
It MUST NOT replace the established per-sample methane admission gate.
"""

from __future__ import annotations

from datetime import timedelta
from math import isfinite
from typing import Any, Sequence

from benchmarks.mining_adapter.methane_prediction import PredictionExample


def analyze_warning_opportunities(
    *,
    examples: Sequence[PredictionExample],
    predictions: Sequence[bool],
    warning_threshold: float,
    horizon_start_seconds: int,
    sample_stride_seconds: int,
) -> dict[str, Any]:
    """Audit forecast-positive window groups and unmatched alert episodes.

    All truth labels are used *after* predictions are fixed. These results
    describe spent evaluation data, cannot tune a deployed alert threshold,
    and do not establish true mine incident counts or alarm safety.
    """
    if not examples or len(examples) != len(predictions):
        raise ValueError("methane_event_opportunity_length_invalid")
    if (not isfinite(float(warning_threshold)) or warning_threshold <= 0
            or horizon_start_seconds < 1 or sample_stride_seconds < 1):
        raise ValueError("methane_event_opportunity_parameters_invalid")

    prior_time = None
    group_end = None
    group_has_warning = False
    positive_groups = 0
    detected_groups = 0
    positive_examples = 0

    alarm_run_open = False
    alarm_run_contains_positive_window = False
    alarm_runs = 0
    unmatched_runs = 0
    alarm_samples = 0
    false_alarm_samples = 0
    hard_warning_samples = 0

    def finish_alarm_run() -> None:
        nonlocal alarm_run_open, alarm_run_contains_positive_window
        nonlocal alarm_runs, unmatched_runs
        if not alarm_run_open:
            return
        alarm_runs += 1
        if not alarm_run_contains_positive_window:
            unmatched_runs += 1
        alarm_run_open = False
        alarm_run_contains_positive_window = False

    for item, prediction in zip(examples, predictions, strict=True):
        if prior_time is not None:
            delta = (item.feature_time - prior_time).total_seconds()
            if delta <= 0:
                raise ValueError("methane_event_opportunity_order_invalid")
            if delta != sample_stride_seconds:
                finish_alarm_run()
        prior_time = item.feature_time

        try:
            observed = float(item.features["target_current_max"])
        except (KeyError, TypeError, ValueError, OverflowError):
            raise ValueError("methane_event_opportunity_observed_value_invalid") from None
        if not isfinite(observed):
            raise ValueError("methane_event_opportunity_observed_value_invalid")
        hard_warning = observed >= warning_threshold
        warned = bool(prediction)
        if hard_warning:
            hard_warning_samples += 1
            if not warned:
                raise ValueError("methane_event_opportunity_hard_warning_suppressed")

        if item.label:
            positive_examples += 1
            start = item.feature_time + timedelta(seconds=horizon_start_seconds)
            end = item.label_window_end
            if start > end:
                raise ValueError("methane_event_opportunity_label_window_invalid")
            if group_end is None or start > group_end:
                if group_end is not None and group_has_warning:
                    detected_groups += 1
                positive_groups += 1
                group_has_warning = False
                group_end = end
            else:
                group_end = max(group_end, end)
            group_has_warning = group_has_warning or warned

        if warned:
            alarm_samples += 1
            if not item.label:
                false_alarm_samples += 1
            if not alarm_run_open:
                alarm_run_open = True
                alarm_run_contains_positive_window = False
            alarm_run_contains_positive_window |= bool(item.label)
        else:
            finish_alarm_run()

    finish_alarm_run()
    if group_end is not None and group_has_warning:
        detected_groups += 1

    return {
        "evaluation_role": "RESEARCH_ONLY_POSITIVE_WINDOW_OPPORTUNITIES",
        "qualified_for_admission": False,
        "not_unique_mine_incidents": True,
        "eligible_examples": len(examples),
        "positive_label_examples": positive_examples,
        "overlap_connected_positive_window_groups": positive_groups,
        "groups_with_at_least_one_warning": detected_groups,
        "positive_window_group_recall": detected_groups / positive_groups if positive_groups else 0.0,
        "alarm_runs": alarm_runs,
        "unmatched_alarm_runs": unmatched_runs,
        "false_alarm_samples": false_alarm_samples,
        "hard_observed_warning_samples": hard_warning_samples,
        "alerting_fraction": alarm_samples / len(examples),
        "unmatched_runs_per_1000_eligible_samples": unmatched_runs * 1000 / len(examples),
    }
