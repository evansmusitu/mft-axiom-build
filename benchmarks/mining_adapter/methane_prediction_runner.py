#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path
from typing import Any, Iterator

ROOT=Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0,str(ROOT))

from benchmarks.mining_adapter.methane_prediction import (
    MethanePredictionSpec,
    binary_metrics,
    build_prediction_examples,
    evaluate_prediction_gate,
    select_operating_threshold,
    temporal_partitions,
)
from benchmarks.mining_adapter.polish_longwall_telemetry import (
    _arff_attributes_and_data,
    canonical_telemetry_row,
)


def _sha256_file(path: Path) -> str:
    digest=hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda:handle.read(1024*1024),b""):
            digest.update(chunk)
    return digest.hexdigest()


def _canonical_source_rows(path: Path, state: dict[str,Any]) -> Iterator[dict[str,Any]]:
    with path.open("r",encoding="utf-8",errors="strict",newline="") as stream:
        _attributes,rows=_arff_attributes_and_data(stream)
        for raw in rows:
            row=canonical_telemetry_row(raw)
            state["source_rows"] += 1
            if state["first_timestamp"] is None:
                state["first_timestamp"]=row["event_time"]
            state["last_timestamp"]=row["event_time"]
            yield row


def _matrix(examples, feature_names: list[str]):
    import numpy as np
    X=np.asarray(
        [[float(item.features[name]) for name in feature_names] for item in examples],
        dtype=np.float32,
    )
    y=np.asarray([1 if item.label else 0 for item in examples],dtype=np.uint8)
    return X,y


def _balanced_weights(y):
    import numpy as np
    positives=int(y.sum())
    negatives=int(len(y)-positives)
    if positives==0 or negatives==0:
        raise ValueError("methane_prediction_training_classes_required")
    positive_weight=len(y)/(2.0*positives)
    negative_weight=len(y)/(2.0*negatives)
    return np.where(y==1,positive_weight,negative_weight).astype(np.float64)


def run(*, source: Path, spec: MethanePredictionSpec) -> dict[str,Any]:
    import numpy as np
    import sklearn
    from sklearn.ensemble import HistGradientBoostingClassifier
    from sklearn.metrics import average_precision_score, roc_auc_score

    if not source.is_file():
        raise FileNotFoundError(source)
    source_sha=_sha256_file(source)
    state={"source_rows":0,"first_timestamp":None,"last_timestamp":None}
    errors=[]

    build_started=time.perf_counter()
    examples=list(build_prediction_examples(_canonical_source_rows(source,state),spec))
    build_seconds=time.perf_counter()-build_started
    parts=temporal_partitions(examples,spec)
    feature_names=list(examples[0].features)

    train=parts["train"]
    calibration=parts["calibration"]
    test=parts["test"]
    temporal_leakage_check=(
        max(item.label_window_end for item in train)
        < min(item.feature_time for item in calibration)
        and max(item.label_window_end for item in calibration)
        < min(item.feature_time for item in test)
    )
    future_label_check=all(
        (item.label_window_end-item.feature_time).total_seconds()==spec.horizon_end_seconds
        for item in examples
    )

    X_train,y_train=_matrix(train,feature_names)
    X_cal,y_cal=_matrix(calibration,feature_names)
    X_test,y_test=_matrix(test,feature_names)

    train_started=time.perf_counter()
    model=HistGradientBoostingClassifier(
        learning_rate=0.08,
        max_iter=180,
        max_leaf_nodes=31,
        min_samples_leaf=40,
        l2_regularization=1.0,
        max_bins=255,
        early_stopping=False,
        random_state=20261007,
    )
    model.fit(X_train,y_train,sample_weight=_balanced_weights(y_train))
    train_seconds=time.perf_counter()-train_started

    calibration_scores=model.predict_proba(X_cal)[:,1]
    operating=select_operating_threshold(
        y_cal.tolist(),
        calibration_scores.tolist(),
        minimum_recall=spec.minimum_test_recall,
    )
    threshold=float(operating["threshold"])

    score_started=time.perf_counter()
    test_scores=model.predict_proba(X_test)[:,1]
    score_seconds=time.perf_counter()-score_started
    test_predictions=(test_scores>=threshold).astype(np.uint8)
    model_metrics=binary_metrics(y_test.tolist(),test_predictions.tolist())
    model_metrics["average_precision"]=float(average_precision_score(y_test,test_scores))
    model_metrics["roc_auc"]=float(roc_auc_score(y_test,test_scores))
    model_metrics["threshold"]=threshold

    current_max_index=feature_names.index("target_current_max")
    baseline_predictions=(X_test[:,current_max_index]>=spec.warning_threshold).astype(np.uint8)
    baseline_metrics=binary_metrics(y_test.tolist(),baseline_predictions.tolist())

    report={
        "schema":"musitu.connect.mining.methane_prediction_execution.v1",
        "dataset_id":spec.dataset_id,
        "dataset_version":spec.dataset_version,
        "doi":spec.doi,
        "license":spec.license,
        "transport_source":"openml:42701",
        "source_sha256":source_sha,
        "source_rows":state["source_rows"],
        "first_timestamp":state["first_timestamp"],
        "last_timestamp":state["last_timestamp"],
        "feature_count":len(feature_names),
        "feature_names":feature_names,
        "eligible_examples":len(examples),
        "train_examples":len(train),
        "calibration_examples":len(calibration),
        "test_examples":len(test),
        "train_positives":int(y_train.sum()),
        "calibration_positives":int(y_cal.sum()),
        "test_positives":int(y_test.sum()),
        "test_prevalence":float(y_test.mean()),
        "horizon_start_seconds":spec.horizon_start_seconds,
        "horizon_end_seconds":spec.horizon_end_seconds,
        "sample_stride_seconds":spec.sample_stride_seconds,
        "temporal_leakage_check":bool(temporal_leakage_check),
        "future_label_check":bool(future_label_check),
        "calibration_operating_point":operating,
        "baseline":baseline_metrics,
        "model":model_metrics,
        "model_type":"sklearn.ensemble.HistGradientBoostingClassifier",
        "model_version":sklearn.__version__,
        "model_parameters":{
            "learning_rate":0.08,
            "max_iter":180,
            "max_leaf_nodes":31,
            "min_samples_leaf":40,
            "l2_regularization":1.0,
            "max_bins":255,
            "early_stopping":False,
            "random_state":20261007,
            "class_weighting":"balanced_sample_weight",
        },
        "example_build_seconds":build_seconds,
        "model_train_seconds":train_seconds,
        "test_score_seconds":score_seconds,
        "credentials_used":False,
        "errors":errors,
    }
    qualification=evaluate_prediction_gate(spec,report)
    return {
        "schema":"musitu.connect.mining.methane_prediction_evidence.v1",
        "spec":{
            "dataset_id":spec.dataset_id,
            "dataset_version":spec.dataset_version,
            "doi":spec.doi,
            "license":spec.license,
            "warning_threshold":spec.warning_threshold,
            "horizon_start_seconds":spec.horizon_start_seconds,
            "horizon_end_seconds":spec.horizon_end_seconds,
            "sample_stride_seconds":spec.sample_stride_seconds,
            "train_fraction":spec.train_fraction,
            "calibration_fraction":spec.calibration_fraction,
            "minimum_examples":spec.minimum_examples,
            "minimum_test_positives":spec.minimum_test_positives,
            "minimum_test_recall":spec.minimum_test_recall,
            "minimum_test_precision":spec.minimum_test_precision,
            "minimum_f2_gain_fraction":spec.minimum_f2_gain_fraction,
            "minimum_source_rows":spec.minimum_source_rows,
        },
        "execution":report,
        "qualification":qualification,
    }


def main() -> None:
    parser=argparse.ArgumentParser()
    parser.add_argument("--source",type=Path,required=True)
    parser.add_argument("--output",type=Path,required=True)
    parser.add_argument("--minimum-test-recall",type=float,default=0.90)
    parser.add_argument("--minimum-test-precision",type=float,default=0.10)
    parser.add_argument("--minimum-f2-gain-fraction",type=float,default=0.05)
    args=parser.parse_args()
    spec=MethanePredictionSpec(
        minimum_test_recall=args.minimum_test_recall,
        minimum_test_precision=args.minimum_test_precision,
        minimum_f2_gain_fraction=args.minimum_f2_gain_fraction,
    )
    evidence=run(source=args.source,spec=spec)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(evidence,indent=2,sort_keys=True)+"\n")
    print(json.dumps(evidence,indent=2,sort_keys=True))


if __name__=="__main__":
    main()
