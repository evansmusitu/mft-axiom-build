from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from datetime import datetime, timedelta
from math import isfinite
from typing import Any, Iterable, Mapping, Sequence

from connect.mining_telemetry import MINING_TELEMETRY_SENSORS


_TARGET_METHANE=("MM263","MM264","MM256")
_NUMERIC_SENSORS=tuple(sensor for sensor in MINING_TELEMETRY_SENSORS if sensor!="F_SIDE")


@dataclass(frozen=True)
class MethanePredictionSpec:
    schema: str="musitu.connect.mining.methane_prediction_spec.v1"
    dataset_id: str="yd7vw4c5mk"
    dataset_version: int=1
    doi: str="10.17632/yd7vw4c5mk.1"
    license: str="CC BY 4.0"
    warning_threshold: float=1.0
    horizon_start_seconds: int=180
    horizon_end_seconds: int=360
    sample_stride_seconds: int=30
    train_fraction: float=0.60
    calibration_fraction: float=0.20
    minimum_examples: int=100_000
    minimum_test_positives: int=1_000
    minimum_test_recall: float=0.90
    minimum_test_precision: float=0.10
    minimum_f2_gain_fraction: float=0.05
    minimum_source_rows: int=9_000_000

    def __post_init__(self) -> None:
        if self.dataset_id!="yd7vw4c5mk" or self.dataset_version!=1:
            raise ValueError("methane_prediction_dataset_identity_invalid")
        if self.doi!="10.17632/yd7vw4c5mk.1":
            raise ValueError("methane_prediction_doi_invalid")
        if self.license!="CC BY 4.0":
            raise ValueError("methane_prediction_license_invalid")
        if self.warning_threshold <= 0:
            raise ValueError("methane_prediction_warning_threshold_invalid")
        if self.horizon_start_seconds < 1:
            raise ValueError("methane_prediction_horizon_start_invalid")
        if self.horizon_end_seconds <= self.horizon_start_seconds:
            raise ValueError("methane_prediction_horizon_end_invalid")
        if self.sample_stride_seconds < 1:
            raise ValueError("methane_prediction_stride_invalid")
        if not 0 < self.train_fraction < 1:
            raise ValueError("methane_prediction_train_fraction_invalid")
        if not 0 < self.calibration_fraction < 1:
            raise ValueError("methane_prediction_calibration_fraction_invalid")
        if self.train_fraction+self.calibration_fraction >= 1:
            raise ValueError("methane_prediction_split_fraction_invalid")
        if self.minimum_examples < 1 or self.minimum_test_positives < 1:
            raise ValueError("methane_prediction_minimum_counts_invalid")
        if not 0 < self.minimum_test_recall <= 1:
            raise ValueError("methane_prediction_recall_target_invalid")
        if not 0 < self.minimum_test_precision <= 1:
            raise ValueError("methane_prediction_precision_target_invalid")
        if self.minimum_f2_gain_fraction <= 0:
            raise ValueError("methane_prediction_f2_gain_invalid")
        if self.minimum_source_rows < 1:
            raise ValueError("methane_prediction_source_rows_invalid")


@dataclass(frozen=True)
class PredictionExample:
    feature_time: datetime
    label_window_end: datetime
    features: Mapping[str,float]
    label: bool


def _time(value: Any) -> datetime:
    text=str(value).strip()
    if not text:
        raise ValueError("methane_prediction_event_time_required")
    try:
        parsed=datetime.fromisoformat(text.replace("Z","+00:00"))
    except ValueError:
        raise ValueError("methane_prediction_event_time_invalid") from None
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError("methane_prediction_event_time_timezone_required")
    return parsed


def _features(row: Mapping[str,Any]) -> dict[str,float]:
    features={}
    for sensor in _NUMERIC_SENSORS:
        try:
            value=float(row[sensor])
        except (KeyError,TypeError,ValueError):
            raise ValueError(f"methane_prediction_feature_invalid:{sensor}") from None
        if not isfinite(value):
            raise ValueError(f"methane_prediction_feature_not_finite:{sensor}")
        features[sensor]=value
    features["target_current_max"]=max(features[name] for name in _TARGET_METHANE)
    return features


def build_prediction_examples(
    rows: Iterable[Mapping[str,Any]],
    spec: MethanePredictionSpec,
) -> Iterable[PredictionExample]:
    """Build future-only labels from a one-second telemetry stream.

    A candidate at time t is emitted only when the source has exact one-second
    coverage through t + horizon_end. This fail-closed rule prevents a missing
    source row from silently changing the meaning of a 180–360 second label.
    """
    span=spec.horizon_end_seconds+1
    window: deque[tuple[int,Mapping[str,Any],datetime]]=deque(maxlen=span)
    for source_index,raw in enumerate(rows):
        stamp=_time(raw.get("event_time"))
        window.append((source_index,raw,stamp))
        if len(window)<span:
            continue

        candidate_index,candidate,candidate_time=window[0]
        if candidate_index % spec.sample_stride_seconds != 0:
            continue

        start_index=spec.horizon_start_seconds
        end_index=spec.horizon_end_seconds
        future_start_time=window[start_index][2]
        future_end_time=window[end_index][2]
        if future_start_time-candidate_time != timedelta(seconds=spec.horizon_start_seconds):
            continue
        if future_end_time-candidate_time != timedelta(seconds=spec.horizon_end_seconds):
            continue

        label=False
        for _,future,_ in list(window)[start_index:end_index+1]:
            try:
                peak=max(float(future[name]) for name in _TARGET_METHANE)
            except (KeyError,TypeError,ValueError):
                raise ValueError("methane_prediction_target_invalid") from None
            if not isfinite(peak):
                raise ValueError("methane_prediction_target_not_finite")
            if peak >= spec.warning_threshold:
                label=True
                break

        yield PredictionExample(
            feature_time=candidate_time,
            label_window_end=future_end_time,
            features=_features(candidate),
            label=label,
        )


def temporal_partitions(
    examples: Sequence[PredictionExample],
    spec: MethanePredictionSpec,
) -> dict[str,list[PredictionExample]]:
    ordered=sorted(examples,key=lambda item:item.feature_time)
    if len(ordered)<3:
        raise ValueError("methane_prediction_examples_insufficient")

    calibration_index=max(1,min(len(ordered)-2,int(len(ordered)*spec.train_fraction)))
    test_index=max(
        calibration_index+1,
        min(len(ordered)-1,int(len(ordered)*(spec.train_fraction+spec.calibration_fraction))),
    )
    calibration_start=ordered[calibration_index].feature_time
    test_start=ordered[test_index].feature_time

    train=[
        item for item in ordered[:calibration_index]
        if item.label_window_end < calibration_start
    ]
    calibration=[
        item for item in ordered[calibration_index:test_index]
        if item.label_window_end < test_start
    ]
    test=list(ordered[test_index:])
    if not train or not calibration or not test:
        raise ValueError("methane_prediction_partition_empty")
    return {"train":train,"calibration":calibration,"test":test}


def binary_metrics(y_true: Sequence[int|bool], y_pred: Sequence[int|bool]) -> dict[str,float|int]:
    if len(y_true)!=len(y_pred) or not y_true:
        raise ValueError("binary_metrics_length_invalid")
    tp=tn=fp=fn=0
    for truth,prediction in zip(y_true,y_pred,strict=True):
        t=bool(truth); p=bool(prediction)
        if t and p: tp += 1
        elif t and not p: fn += 1
        elif not t and p: fp += 1
        else: tn += 1
    precision=tp/(tp+fp) if tp+fp else 0.0
    recall=tp/(tp+fn) if tp+fn else 0.0
    specificity=tn/(tn+fp) if tn+fp else 0.0
    f1=(2*precision*recall/(precision+recall)) if precision+recall else 0.0
    beta2=4.0
    f2=((1+beta2)*precision*recall/(beta2*precision+recall)) if beta2*precision+recall else 0.0
    return {
        "tp":tp,"tn":tn,"fp":fp,"fn":fn,
        "precision":precision,"recall":recall,"specificity":specificity,
        "f1":f1,"f2":f2,
    }


def select_operating_threshold(
    y_true: Sequence[int|bool],
    scores: Sequence[float],
    *,
    minimum_recall: float,
) -> dict[str,Any]:
    if len(y_true)!=len(scores) or not y_true:
        raise ValueError("methane_prediction_calibration_length_invalid")
    if not 0 < minimum_recall <= 1:
        raise ValueError("methane_prediction_minimum_recall_invalid")
    clean=[]
    for score in scores:
        value=float(score)
        if not isfinite(value):
            raise ValueError("methane_prediction_score_not_finite")
        clean.append(value)

    candidates=sorted(set(clean),reverse=True)
    feasible=[]
    all_results=[]
    for threshold in candidates:
        predicted=[score>=threshold for score in clean]
        metrics=binary_metrics(y_true,predicted)
        result={"threshold":threshold,"metrics":metrics}
        all_results.append(result)
        if metrics["recall"] >= minimum_recall:
            feasible.append(result)
    pool=feasible or all_results
    # Safety first: among thresholds meeting recall, maximize precision, then F2,
    # then choose the highest threshold to minimize unnecessary alarms.
    chosen=max(
        pool,
        key=lambda item:(
            item["metrics"]["precision"],
            item["metrics"]["f2"],
            item["threshold"],
        ),
    )
    return {
        "threshold":chosen["threshold"],
        "metrics":chosen["metrics"],
        "minimum_recall_requested":minimum_recall,
        "minimum_recall_met":chosen["metrics"]["recall"]>=minimum_recall,
    }


def _sha256(value: Any) -> bool:
    return (
        isinstance(value,str)
        and len(value)==64
        and all(ch in "0123456789abcdef" for ch in value.casefold())
    )


def evaluate_prediction_gate(
    spec: MethanePredictionSpec,
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
    )
    examples_ok=(
        int(report.get("eligible_examples") or 0)>=spec.minimum_examples
        and int(report.get("train_examples") or 0)>0
        and int(report.get("calibration_examples") or 0)>0
        and int(report.get("test_examples") or 0)>0
        and int(report.get("test_positives") or 0)>=spec.minimum_test_positives
    )
    leakage_ok=(
        report.get("temporal_leakage_check") is True
        and report.get("future_label_check") is True
    )
    baseline=report.get("baseline") or {}
    model=report.get("model") or {}
    baseline_f2=float(baseline.get("f2") or 0.0)
    model_f2=float(model.get("f2") or 0.0)
    test_examples=int(report.get("test_examples") or 0)
    test_positives=int(report.get("test_positives") or 0)
    prevalence=test_positives/test_examples if test_examples else 0.0
    performance_ok=(
        float(model.get("recall") or 0.0)>=spec.minimum_test_recall
        and float(model.get("precision") or 0.0)>=spec.minimum_test_precision
        and model_f2 >= baseline_f2*(1.0+spec.minimum_f2_gain_fraction)
        and float(model.get("average_precision") or 0.0)>prevalence
        and 0.0 <= float(model.get("threshold") or -1.0) <= 1.0
    )
    safe=report.get("credentials_used") is False and report.get("errors")==[]
    qualified=source_ok and examples_ok and leakage_ok and performance_ok and safe
    return {
        "schema":"musitu.connect.mining.methane_prediction_qualification.v1",
        "predictive_signal_qualified":qualified,
        "gate":"REAL_MINE_METHANE_PREDICTION_QUALIFIED" if qualified else "REAL_MINE_METHANE_PREDICTION_FAILED",
        "checks":{
            "verified_source_binding":"PASS" if source_ok else "FAIL",
            "chronological_sample_scale":"PASS" if examples_ok else "FAIL",
            "future_only_purged_split":"PASS" if leakage_ok else "FAIL",
            "holdout_recall_precision_and_baseline_gain":"PASS" if performance_ok else "FAIL",
            "no_credentials_or_hidden_errors":"PASS" if safe else "FAIL",
        },
        "requirements":{
            "minimum_test_recall":spec.minimum_test_recall,
            "minimum_test_precision":spec.minimum_test_precision,
            "minimum_f2_gain_fraction":spec.minimum_f2_gain_fraction,
        },
        "claim_policy":{
            "scope":"Prediction evidence applies only to the published 3–6 minute methane-threshold task on this public dataset and this temporal split.",
            "safety_certification":"PROHIBITED: predictive benchmark evidence is not mine-safety certification.",
            "customer_deployment":"PROHIBITED: this public-data benchmark is not a MUSITU customer deployment.",
            "economic_value":"PROHIBITED: predictive discrimination does not prove intervention economics.",
        },
    }
