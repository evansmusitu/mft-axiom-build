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


def _f_side_features(value: Any) -> dict[str,float]:
    text=str(value).strip().casefold().strip("'\"")
    if text in {"left","l"}:
        return {"F_SIDE_left":1.0,"F_SIDE_right":0.0}
    if text in {"right","r"}:
        return {"F_SIDE_left":0.0,"F_SIDE_right":1.0}
    try:
        numeric=float(text)
    except ValueError:
        raise ValueError("methane_backtest_f_side_invalid") from None
    if not isfinite(numeric):
        raise ValueError("methane_backtest_f_side_invalid")
    if abs(numeric-1.0) <= 1e-12:
        return {"F_SIDE_left":1.0,"F_SIDE_right":0.0}
    if abs(numeric) <= 1e-12 or abs(numeric-0.5) <= 1e-12:
        return {"F_SIDE_left":0.0,"F_SIDE_right":1.0}
    raise ValueError("methane_backtest_f_side_invalid")


def _window_features(
    materialized: Sequence[tuple[int,Mapping[str,Any],datetime]],
    candidate_position: int,
    spec: MethaneBacktestSpec,
) -> dict[str,float]:
    candidate=materialized[candidate_position][1]
    features={sensor:_numeric(candidate,sensor) for sensor in _NUMERIC_SENSORS}
    features.update(_f_side_features(candidate.get("F_SIDE")))
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


class _RollingStats:
    def __init__(self, samples: int) -> None:
        if samples < 1:
            raise ValueError("methane_backtest_rolling_samples_invalid")
        self.samples=samples
        self.values: deque[tuple[int,float]]=deque()
        self.minimums: deque[tuple[int,float]]=deque()
        self.maximums: deque[tuple[int,float]]=deque()
        self.total=0.0

    def reset(self) -> None:
        self.values.clear()
        self.minimums.clear()
        self.maximums.clear()
        self.total=0.0

    def add(self, index: int, value: float) -> None:
        if len(self.values)==self.samples:
            _old_index,old_value=self.values.popleft()
            self.total -= old_value
        self.values.append((index,value))
        self.total += value

        while self.minimums and self.minimums[-1][1] >= value:
            self.minimums.pop()
        self.minimums.append((index,value))
        while self.maximums and self.maximums[-1][1] <= value:
            self.maximums.pop()
        self.maximums.append((index,value))

        earliest=index-self.samples+1
        while self.minimums and self.minimums[0][0] < earliest:
            self.minimums.popleft()
        while self.maximums and self.maximums[0][0] < earliest:
            self.maximums.popleft()

    @property
    def ready(self) -> bool:
        return len(self.values)==self.samples

    def summary(self) -> dict[str,float]:
        if not self.ready:
            raise RuntimeError("methane_backtest_rolling_not_ready")
        first=self.values[0][1]
        current=self.values[-1][1]
        return {
            "mean":self.total/self.samples,
            "min":self.minimums[0][1],
            "max":self.maximums[0][1],
            "delta":current-first,
        }


def _stream_features(
    candidate: Mapping[str,Any],
    stats: Mapping[tuple[str,int],_RollingStats],
    spec: MethaneBacktestSpec,
) -> dict[str,float]:
    features={sensor:_numeric(candidate,sensor) for sensor in _NUMERIC_SENSORS}
    features.update(_f_side_features(candidate.get("F_SIDE")))
    features["target_current_max"]=max(features[sensor] for sensor in _TARGET_METHANE)
    for sensor in _TARGET_METHANE:
        for width in (60,spec.history_seconds):
            summary=stats[(sensor,width)].summary()
            features[f"{sensor}_mean_{width}"]=summary["mean"]
            features[f"{sensor}_min_{width}"]=summary["min"]
            features[f"{sensor}_max_{width}"]=summary["max"]
            features[f"{sensor}_delta_{width}"]=summary["delta"]
    return features


def build_windowed_prediction_examples(
    rows: Iterable[Mapping[str,Any]],
    spec: MethaneBacktestSpec,
) -> Iterable[PredictionExample]:
    """Build exact history features and future-only labels in one streaming pass.

    State resets on every timestamp discontinuity, so no history or target
    window can silently span a missing/duplicate/out-of-order source second.
    The future label at t is the exact maximum over t+180..t+360 (inclusive).
    """
    widths=tuple(dict.fromkeys((60,spec.history_seconds)))
    stats={
        (sensor,width):_RollingStats(width+1)
        for sensor in _TARGET_METHANE
        for width in widths
    }
    future_stats=_RollingStats(
        spec.horizon_end_seconds-spec.horizon_start_seconds+1
    )
    pending: dict[int,tuple[datetime,datetime,Mapping[str,float]]]={}
    previous_time: datetime | None=None

    def reset_segment() -> None:
        for window in stats.values():
            window.reset()
        future_stats.reset()
        pending.clear()

    for source_index,raw in enumerate(rows):
        stamp=_time(raw.get("event_time"))
        if previous_time is not None and stamp-previous_time != timedelta(seconds=1):
            reset_segment()
        previous_time=stamp

        target_values={sensor:_numeric(raw,sensor) for sensor in _TARGET_METHANE}
        for sensor,value in target_values.items():
            for width in widths:
                stats[(sensor,width)].add(source_index,value)
        future_stats.add(source_index,max(target_values.values()))

        ready_candidate=pending.pop(source_index,None)
        if ready_candidate is not None:
            feature_time,label_window_end,features=ready_candidate
            if not future_stats.ready:
                raise RuntimeError("methane_backtest_future_window_not_ready")
            yield PredictionExample(
                feature_time=feature_time,
                label_window_end=label_window_end,
                features=features,
                label=future_stats.summary()["max"]>=spec.warning_threshold,
            )

        history_ready=all(
            stats[(sensor,spec.history_seconds)].ready
            for sensor in _TARGET_METHANE
        )
        if not history_ready or source_index % spec.sample_stride_seconds != 0:
            continue

        features=_stream_features(raw,stats,spec)
        pending[source_index+spec.horizon_end_seconds]=(
            stamp,
            stamp+timedelta(seconds=spec.horizon_end_seconds),
            features,
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



def select_augmented_operating_point(
    *,
    y_true: Sequence[int|bool],
    scores: Sequence[float],
    current_max: Sequence[float],
    warning_threshold: float,
    minimum_recall: float,
) -> dict[str,Any]:
    """Select a score threshold while preserving the mine's hard warning rule.

    A prediction is positive when methane is already at/above the operational
    warning threshold OR the learned score crosses the calibrated early-warning
    threshold. The learned model can therefore add earlier warnings but can
    never suppress an observed hard-threshold warning.
    """
    from benchmarks.mining_adapter.methane_prediction import binary_metrics

    if len(y_true)!=len(scores) or len(y_true)!=len(current_max) or not y_true:
        raise ValueError("methane_backtest_augmented_length_invalid")
    if warning_threshold <= 0:
        raise ValueError("methane_backtest_warning_threshold_invalid")
    if not 0 < minimum_recall <= 1:
        raise ValueError("methane_backtest_augmented_recall_invalid")

    clean_scores=[]
    clean_current=[]
    for score,current in zip(scores,current_max,strict=True):
        score_value=float(score)
        current_value=float(current)
        if not isfinite(score_value) or not isfinite(current_value):
            raise ValueError("methane_backtest_augmented_value_not_finite")
        clean_scores.append(score_value)
        clean_current.append(current_value)

    hard=[value>=warning_threshold for value in clean_current]
    candidates=sorted(set(clean_scores),reverse=True)
    results=[]
    for threshold in candidates:
        predicted=[
            hard_alert or score>=threshold
            for hard_alert,score in zip(hard,clean_scores,strict=True)
        ]
        metrics=binary_metrics(y_true,predicted)
        results.append({
            "threshold":threshold,
            "metrics":metrics,
            "predictions":predicted,
        })
    feasible=[
        result for result in results
        if float(result["metrics"]["recall"])>=minimum_recall
    ]
    pool=feasible or results
    chosen=max(
        pool,
        key=lambda item:(
            item["metrics"]["precision"],
            item["metrics"]["f2"],
            item["threshold"],
        ),
    )
    return {
        **chosen,
        "minimum_recall_requested":minimum_recall,
        "minimum_recall_met":chosen["metrics"]["recall"]>=minimum_recall,
        "hard_warning_threshold":warning_threshold,
    }


def online_recalibrated_predictions(
    *,
    calibration_examples: Sequence[PredictionExample],
    calibration_scores: Sequence[float],
    test_examples: Sequence[PredictionExample],
    test_scores: Sequence[float],
    warning_threshold: float,
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
    operating=select_augmented_operating_point(
        y_true=[label for _,label,_ in initial_window],
        scores=[score for _,_,score in initial_window],
        current_max=[float(item.features["target_current_max"]) for item,_,_ in initial_window],
        warning_threshold=warning_threshold,
        minimum_recall=minimum_recall,
    )
    initial_operating_point={
        key:value for key,value in operating.items() if key!="predictions"
    }
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
                operating=select_augmented_operating_point(
                    y_true=[label for _,label,_ in pool],
                    scores=[score for _,_,score in pool],
                    current_max=[float(item.features["target_current_max"]) for item,_,_ in pool],
                    warning_threshold=warning_threshold,
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

        predictions.append(
            float(current.features["target_current_max"])>=warning_threshold
            or float(current_score)>=threshold
        )
        thresholds.append(threshold)

    return {
        "predictions":predictions,
        "thresholds":thresholds,
        "initial_operating_point":initial_operating_point,
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
