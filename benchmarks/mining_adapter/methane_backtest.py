from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from datetime import datetime, timedelta
from math import isfinite
from statistics import fmean, median
from typing import Any, Iterable, Mapping, Sequence

from benchmarks.mining_adapter.methane_prediction import PredictionExample, select_operating_threshold
from connect.mining_telemetry import MINING_TELEMETRY_SENSORS


_TARGET_METHANE=("MM263","MM264","MM256")
_NUMERIC_SENSORS=tuple(sensor for sensor in MINING_TELEMETRY_SENSORS if sensor!="F_SIDE")


@dataclass(frozen=True)
class MethaneBacktestSpec:
    schema: str="musitu.connect.mining.methane_backtest_spec.v1"
    dataset_id: str="yd7vw4c5mk"
    dataset_version: int=1
    doi: str="10.17632/yd7vw4c5mk.1"
    license: str="CC BY 4.0"
    warning_threshold: float=1.0
    history_seconds: int=600
    horizon_start_seconds: int=180
    horizon_end_seconds: int=360
    sample_stride_seconds: int=30
    fold_count: int=4
    development_fraction: float=0.80
    calibration_recall_target: float=0.95
    minimum_examples: int=100_000
    minimum_fold_test_positives: int=500
    minimum_test_recall: float=0.90
    minimum_test_precision: float=0.10
    minimum_f2_gain_fraction: float=0.05
    required_passing_folds: int=3
    threshold_update_examples: int=120
    threshold_window_examples: int=10_000
    minimum_online_positives: int=50
    minimum_source_rows: int=9_000_000

    def __post_init__(self) -> None:
        if self.dataset_id!="yd7vw4c5mk" or self.dataset_version!=1:
            raise ValueError("methane_backtest_dataset_identity_invalid")
        if self.doi!="10.17632/yd7vw4c5mk.1" or self.license!="CC BY 4.0":
            raise ValueError("methane_backtest_source_identity_invalid")
        if self.history_seconds < 1:
            raise ValueError("methane_backtest_history_invalid")
        if self.horizon_start_seconds < 1 or self.horizon_end_seconds<=self.horizon_start_seconds:
            raise ValueError("methane_backtest_horizon_invalid")
        if self.sample_stride_seconds < 1:
            raise ValueError("methane_backtest_stride_invalid")
        if self.fold_count < 2:
            raise ValueError("methane_backtest_fold_count_invalid")
        if not 0 < self.development_fraction < 1:
            raise ValueError("methane_backtest_development_fraction_invalid")
        if not self.minimum_test_recall < self.calibration_recall_target <= 1:
            raise ValueError("methane_backtest_calibration_recall_invalid")
        if self.minimum_examples < 1 or self.minimum_fold_test_positives < 1:
            raise ValueError("methane_backtest_minimum_counts_invalid")
        if not 0 < self.minimum_test_recall <= 1:
            raise ValueError("methane_backtest_recall_invalid")
        if not 0 < self.minimum_test_precision <= 1:
            raise ValueError("methane_backtest_precision_invalid")
        if self.minimum_f2_gain_fraction <= 0:
            raise ValueError("methane_backtest_f2_gain_invalid")
        if not 1 <= self.required_passing_folds <= self.fold_count:
            raise ValueError("methane_backtest_required_folds_invalid")
        if self.threshold_update_examples < 1:
            raise ValueError("methane_backtest_threshold_update_invalid")
        if self.threshold_window_examples < 2:
            raise ValueError("methane_backtest_threshold_window_invalid")
        if self.minimum_online_positives < 1:
            raise ValueError("methane_backtest_online_positives_invalid")
        if self.minimum_source_rows < 1:
            raise ValueError("methane_backtest_source_rows_invalid")


def _time(value: Any) -> datetime:
    text=str(value).strip()
    try:
        parsed=datetime.fromisoformat(text.replace("Z","+00:00"))
    except ValueError:
        raise ValueError("methane_backtest_event_time_invalid") from None
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError("methane_backtest_event_time_timezone_required")
    return parsed


def _numeric(row: Mapping[str,Any], sensor: str) -> float:
    try:
        value=float(row[sensor])
    except (KeyError,TypeError,ValueError):
        raise ValueError(f"methane_backtest_sensor_invalid:{sensor}") from None
    if not isfinite(value):
        raise ValueError(f"methane_backtest_sensor_not_finite:{sensor}")
    return value


def _window_features(
    materialized: Sequence[tuple[int,Mapping[str,Any],datetime]],
    candidate_position: int,
    spec: MethaneBacktestSpec,
) -> dict[str,float]:
    candidate=materialized[candidate_position][1]
    features={sensor:_numeric(candidate,sensor) for sensor in _NUMERIC_SENSORS}
    features["target_current_max"]=max(features[sensor] for sensor in _TARGET_METHANE)

    for sensor in _TARGET_METHANE:
        current=features[sensor]
        for width in (60,spec.history_seconds):
            start=candidate_position-width
            values=[_numeric(materialized[index][1],sensor) for index in range(start,candidate_position+1)]
            features[f"{sensor}_mean_{width}"]=fmean(values)
            features[f"{sensor}_min_{width}"]=min(values)
            features[f"{sensor}_max_{width}"]=max(values)
            features[f"{sensor}_delta_{width}"]=current-values[0]
    return features


def build_windowed_prediction_examples(
    rows: Iterable[Mapping[str,Any]],
    spec: MethaneBacktestSpec,
) -> Iterable[PredictionExample]:
    total_span=spec.history_seconds+spec.horizon_end_seconds+1
    candidate_position=spec.history_seconds
    window: deque[tuple[int,Mapping[str,Any],datetime]]=deque(maxlen=total_span)

    for source_index,raw in enumerate(rows):
        stamp=_time(raw.get("event_time"))
        window.append((source_index,raw,stamp))
        if len(window)<total_span:
            continue
        candidate_index,candidate,candidate_time=window[candidate_position]
        if candidate_index % spec.sample_stride_seconds != 0:
            continue

        history_time=window[0][2]
        future_start=window[candidate_position+spec.horizon_start_seconds][2]
        future_end=window[candidate_position+spec.horizon_end_seconds][2]
        if candidate_time-history_time != timedelta(seconds=spec.history_seconds):
            continue
        if future_start-candidate_time != timedelta(seconds=spec.horizon_start_seconds):
            continue
        if future_end-candidate_time != timedelta(seconds=spec.horizon_end_seconds):
            continue

        materialized=list(window)
        label=False
        for index in range(
            candidate_position+spec.horizon_start_seconds,
            candidate_position+spec.horizon_end_seconds+1,
        ):
            future=materialized[index][1]
            if max(_numeric(future,sensor) for sensor in _TARGET_METHANE) >= spec.warning_threshold:
                label=True
                break

        yield PredictionExample(
            feature_time=candidate_time,
            label_window_end=future_end,
            features=_window_features(materialized,candidate_position,spec),
            label=label,
        )


def rolling_backtest_folds(
    examples: Sequence[PredictionExample],
    spec: MethaneBacktestSpec,
) -> list[dict[str,Any]]:
    ordered=sorted(examples,key=lambda item:item.feature_time)
    if len(ordered)<spec.fold_count*10:
        raise ValueError("methane_backtest_examples_insufficient")

    development_count=int(len(ordered)*spec.development_fraction)
    segment_count=spec.fold_count+4
    segment=max(1,development_count//segment_count)
    if segment*segment_count > development_count:
        raise ValueError("methane_backtest_segment_invalid")

    folds=[]
    for fold_index in range(spec.fold_count):
        train_end=(3+fold_index)*segment
        calibration_end=train_end+segment
        test_end=calibration_end+segment
        if test_end>development_count:
            raise ValueError("methane_backtest_fold_outside_development_region")

        calibration_start_time=ordered[train_end].feature_time
        test_start_time=ordered[calibration_end].feature_time
        development_end=ordered[test_end].feature_time

        train=[
            item for item in ordered[:train_end]
            if item.label_window_end < calibration_start_time
        ]
        calibration=[
            item for item in ordered[train_end:calibration_end]
            if item.label_window_end < test_start_time
        ]
        test=[
            item for item in ordered[calibration_end:test_end]
            if item.label_window_end < development_end
        ]
        if not train or not calibration or not test:
            raise ValueError("methane_backtest_fold_empty")
        folds.append({
            "fold":fold_index,
            "train":train,
            "calibration":calibration,
            "test":test,
            "development_end":development_end,
        })
    return folds



def online_recalibrated_predictions(
    *,
    calibration_examples: Sequence[PredictionExample],
    calibration_scores: Sequence[float],
    test_examples: Sequence[PredictionExample],
    test_scores: Sequence[float],
    minimum_recall: float,
    update_every_examples: int,
    window_examples: int,
    minimum_online_positives: int,
) -> dict[str,Any]:
    """Sequentially recalibrate an alert threshold using only resolved labels.

    Test labels enter the calibration window only after their complete future
    outcome window has elapsed. This simulates an online deployment where a
    3–6 minute forecast becomes fully observable six minutes after prediction.
    """
    if len(calibration_examples)!=len(calibration_scores) or not calibration_examples:
        raise ValueError("methane_backtest_online_calibration_length_invalid")
    if len(test_examples)!=len(test_scores) or not test_examples:
        raise ValueError("methane_backtest_online_test_length_invalid")
    if update_every_examples < 1 or window_examples < 2 or minimum_online_positives < 1:
        raise ValueError("methane_backtest_online_parameters_invalid")

    ordered_cal=list(zip(calibration_examples,calibration_scores,strict=True))
    ordered_test=list(zip(test_examples,test_scores,strict=True))
    if any(
        ordered_test[index][0].feature_time < ordered_test[index-1][0].feature_time
        for index in range(1,len(ordered_test))
    ):
        raise ValueError("methane_backtest_online_test_order_invalid")

    labeled=[
        (item,bool(item.label),float(score))
        for item,score in ordered_cal
    ]
    initial_window=labeled[-window_examples:]
    if sum(1 for _,label,_ in initial_window if label) < minimum_online_positives:
        initial_window=labeled
    operating=select_operating_threshold(
        [label for _,label,_ in initial_window],
        [score for _,_,score in initial_window],
        minimum_recall=minimum_recall,
    )
    threshold=float(operating["threshold"])

    predictions=[]
    thresholds=[]
    update_audit=[]
    resolved_cursor=0
    online_labeled=[]
    leakage_safe=True

    for index,(current,current_score) in enumerate(ordered_test):
        while resolved_cursor < index:
            prior,prior_score=ordered_test[resolved_cursor]
            if prior.label_window_end >= current.feature_time:
                break
            online_labeled.append((prior,bool(prior.label),float(prior_score)))
            resolved_cursor += 1

        if index % update_every_examples == 0:
            pool=(labeled+online_labeled)[-window_examples:]
            positives=sum(1 for _,label,_ in pool if label)
            if positives >= minimum_online_positives:
                latest=max((item.label_window_end for item,_,_ in pool),default=None)
                if latest is not None and latest >= current.feature_time:
                    leakage_safe=False
                operating=select_operating_threshold(
                    [label for _,label,_ in pool],
                    [score for _,_,score in pool],
                    minimum_recall=minimum_recall,
                )
                threshold=float(operating["threshold"])
                update_audit.append({
                    "prediction_time":current.feature_time.isoformat(),
                    "latest_label_window_end_used":None if latest is None else latest.isoformat(),
                    "labeled_examples":len(pool),
                    "positive_examples":positives,
                    "threshold":threshold,
                })

        predictions.append(float(current_score)>=threshold)
        thresholds.append(threshold)

    return {
        "predictions":predictions,
        "thresholds":thresholds,
        "threshold_updates":len(update_audit),
        "update_audit":update_audit,
        "leakage_safe":leakage_safe,
    }


def _sha256(value: Any) -> bool:
    return (
        isinstance(value,str)
        and len(value)==64
        and all(ch in "0123456789abcdef" for ch in value.casefold())
    )


def evaluate_backtest_gate(
    spec: MethaneBacktestSpec,
    report: Mapping[str,Any],
) -> dict[str,Any]:
    source_ok=(
        report.get("dataset_id")==spec.dataset_id
        and int(report.get("dataset_version") or 0)==spec.dataset_version
        and report.get("doi")==spec.doi
        and report.get("license")==spec.license
        and report.get("transport_source")=="openml:42701"
        and _sha256(report.get("source_sha256"))
        and int(report.get("source_rows") or 0)>=spec.minimum_source_rows
        and int(report.get("eligible_examples") or 0)>=spec.minimum_examples
    )
    folds=report.get("folds")
    structure_ok=isinstance(folds,list) and len(folds)==spec.fold_count
    passing=0
    recalls=[]
    if structure_ok:
        for fold in folds:
            leakage=(
                fold.get("temporal_leakage_check") is True
                and fold.get("online_recalibration_leakage_check") is True
            )
            test_examples=int(fold.get("test_examples") or 0)
            positives=int(fold.get("test_positives") or 0)
            baseline=fold.get("baseline") or {}
            model=fold.get("model") or {}
            prevalence=float(fold.get("test_prevalence") or 0.0)
            recall=float(model.get("recall") or 0.0)
            precision=float(model.get("precision") or 0.0)
            f2=float(model.get("f2") or 0.0)
            baseline_f2=float(baseline.get("f2") or 0.0)
            ap=float(model.get("average_precision") or 0.0)
            fold_pass=(
                leakage
                and test_examples>0
                and positives>=spec.minimum_fold_test_positives
                and recall>=spec.minimum_test_recall
                and precision>=spec.minimum_test_precision
                and f2>=baseline_f2*(1.0+spec.minimum_f2_gain_fraction)
                and ap>prevalence
            )
            if fold_pass:
                passing += 1
            recalls.append(recall)
        structure_ok = structure_ok and all(
            fold.get("temporal_leakage_check") is True
            and fold.get("online_recalibration_leakage_check") is True
            for fold in folds
        )
    median_recall=median(recalls) if recalls else 0.0
    performance_ok=(
        passing>=spec.required_passing_folds
        and median_recall>=spec.minimum_test_recall
    )
    safe=report.get("credentials_used") is False and report.get("errors")==[]
    qualified=source_ok and structure_ok and performance_ok and safe
    return {
        "schema":"musitu.connect.mining.methane_backtest_qualification.v1",
        "backtest_qualified":qualified,
        "gate":"REAL_MINE_METHANE_BACKTEST_QUALIFIED" if qualified else "REAL_MINE_METHANE_BACKTEST_FAILED",
        "passing_folds":passing,
        "required_passing_folds":spec.required_passing_folds,
        "median_test_recall":median_recall,
        "checks":{
            "verified_source_and_example_scale":"PASS" if source_ok else "FAIL",
            "rolling_temporal_purge":"PASS" if structure_ok else "FAIL",
            "repeated_holdout_performance":"PASS" if performance_ok else "FAIL",
            "no_credentials_or_hidden_errors":"PASS" if safe else "FAIL",
        },
        "claim_policy":{
            "validation_level":"DEVELOPMENT_BACKTEST: these folds are chronological and leakage-purged but are not a new independent mine or pristine final holdout.",
            "original_holdout":"The previously observed 80–100% holdout remains spent and must not be relabeled as untouched.",
            "safety_certification":"PROHIBITED: forecasting backtest evidence is not mine-safety certification.",
            "customer_deployment":"PROHIBITED: this remains public-data development evidence, not a MUSITU customer deployment.",
        },
    }
