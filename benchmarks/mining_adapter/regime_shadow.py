"""Causal, research-only regime-conditioned methane warning calibration.

Regime membership is determined *only* from the contemporaneously observed
methane concentration. Learned warnings never suppress the observed hard rule.
The supplied original-policy thresholds are already resolved-label-calibrated;
this experiment cannot change the official qualification or live policy.
"""
from __future__ import annotations

from collections import deque
from datetime import datetime
from math import isfinite
from typing import Any, Sequence

from benchmarks.mining_adapter.methane_backtest import select_augmented_operating_point
from benchmarks.mining_adapter.methane_prediction import PredictionExample


def regime_calibrated_shadow(
    *,
    calibration_examples: Sequence[PredictionExample],
    calibration_scores: Sequence[float],
    test_examples: Sequence[PredictionExample],
    test_scores: Sequence[float],
    global_thresholds: Sequence[float],
    warning_threshold: float,
    regime_boundary: float,
    minimum_recall: float,
    update_every_examples: int,
    window_examples: int,
    minimum_regime_positives: int,
) -> dict[str, Any]:
    """Shadow warnings using regime-local *resolved* outcomes only.

    Calibration samples are resolved before the first test prediction. Test
    outcomes cannot enter any regime window until the full label horizon has
    strictly ended. A regime that lacks enough positive AND negative examples
    falls back to the frozen original-policy threshold at that timestamp.
    """
    if (not calibration_examples or not test_examples
            or len(calibration_examples) != len(calibration_scores)
            or len(test_examples) != len(test_scores)
            or len(test_examples) != len(global_thresholds)):
        raise ValueError("regime_shadow_length_invalid")
    if (not all(isfinite(float(x)) for x in (warning_threshold, regime_boundary, minimum_recall))
            or not 0 < regime_boundary < warning_threshold
            or not 0 < minimum_recall <= 1
            or update_every_examples < 1 or window_examples < 2
            or minimum_regime_positives < 1):
        raise ValueError("regime_shadow_parameters_invalid")

    def order(examples: Sequence[PredictionExample], name: str) -> None:
        if any(examples[i].feature_time <= examples[i - 1].feature_time
               for i in range(1, len(examples))):
            raise ValueError(f"regime_shadow_{name}_order_invalid")
        if any(item.label_window_end <= item.feature_time for item in examples):
            raise ValueError("regime_shadow_label_window_invalid")

    order(calibration_examples, "calibration")
    order(test_examples, "test")
    if any(item.label_window_end >= test_examples[0].feature_time
           for item in calibration_examples):
        raise ValueError("regime_shadow_calibration_label_not_resolved")

    def record(item: PredictionExample, score: float) -> tuple[PredictionExample, float, float, str]:
        raw = float(item.features["target_current_max"])
        val = float(score)
        if not isfinite(raw) or not isfinite(val):
            raise ValueError("regime_shadow_value_not_finite")
        return (item, val, raw, "elevated" if raw >= regime_boundary else "low")

    calibration = [record(x, y) for x, y in zip(calibration_examples, calibration_scores, strict=True)]
    test = [record(x, y) for x, y in zip(test_examples, test_scores, strict=True)]
    frozen_thresholds = [float(t) for t in global_thresholds]
    if not all(isfinite(t) for t in frozen_thresholds):
        raise ValueError("regime_shadow_value_not_finite")

    pools: dict[str, deque[tuple[PredictionExample, float, float, str]]] = {
        "low": deque(maxlen=window_examples),
        "elevated": deque(maxlen=window_examples),
    }
    for row in calibration:
        pools[row[3]].append(row)
    thresholds: dict[str, float | None] = {"low": None, "elevated": None}
    resolved_cursor = 0
    predictions: list[bool] = []
    regimes: list[str] = []
    fallback = 0
    hard_warnings = 0
    audit: list[dict[str, Any]] = []
    updated = 0

    for index, (item, score, observed, regime) in enumerate(test):
        # Prefix-only cursor: future labels and even an exactly coincident
        # label-window end cannot be used for the current prediction.
        while resolved_cursor < index:
            previous = test[resolved_cursor]
            if previous[0].label_window_end >= item.feature_time:
                break
            pools[previous[3]].append(previous)
            resolved_cursor += 1

        if index % update_every_examples == 0:
            for name, pool in pools.items():
                positives = sum(bool(entry[0].label) for entry in pool)
                negatives = len(pool) - positives
                if positives < minimum_regime_positives or negatives < 1:
                    thresholds[name] = None
                    continue
                last_resolved = max(entry[0].label_window_end for entry in pool)
                # A failure is fatal, not silently converted to qualification.
                if last_resolved >= item.feature_time:
                    raise ValueError("regime_shadow_future_label_detected")
                fit = select_augmented_operating_point(
                    y_true=[entry[0].label for entry in pool],
                    scores=[entry[1] for entry in pool],
                    current_max=[entry[2] for entry in pool],
                    warning_threshold=warning_threshold,
                    minimum_recall=minimum_recall,
                )
                thresholds[name] = float(fit["threshold"])
                updated += 1
                audit.append({
                    "prediction_time": item.feature_time.isoformat(),
                    "latest_label_window_end_used": last_resolved.isoformat(),
                    "regime": name,
                    "calibration_examples": len(pool),
                    "calibration_positives": positives,
                    "selected_threshold": thresholds[name],
                    "calibration_recall_met": bool(fit["minimum_recall_met"]),
                })
        own_threshold = thresholds[regime]
        if own_threshold is None:
            fallback += 1
        hard_alert = observed >= warning_threshold
        hard_warnings += int(hard_alert)
        predictions.append(bool(hard_alert or score >= (
            frozen_thresholds[index] if own_threshold is None else own_threshold
        )))
        regimes.append(regime)

    return {
        "evaluation_role": "RESEARCH_ONLY_REGIME_CALIBRATION",
        "qualified_for_admission": False,
        "independent_validation": False,
        "predictions": predictions,
        "regimes": regimes,
        "fallback_predictions": fallback,
        "hard_warnings": hard_warnings,
        "threshold_updates": updated,
        "update_audit": audit,
        "leakage_safe": True,
        "policy": {
            "regime_boundary": regime_boundary,
            "minimum_recall_calibration_target": minimum_recall,
            "minimum_regime_positives": minimum_regime_positives,
            "window_examples": window_examples,
            "update_every_examples": update_every_examples,
            "fallback": "original_online_threshold",
            "hard_observed_warning": "never_suppressed",
        },
    }
