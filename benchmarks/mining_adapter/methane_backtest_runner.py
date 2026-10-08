#!/usr/bin/env python3
from __future__ import annotations

import argparse
import gc
import hashlib
import json
import sys
import time
from pathlib import Path
from statistics import median
from typing import Any, Iterator

ROOT=Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0,str(ROOT))

from benchmarks.mining_adapter.methane_backtest import (
    MethaneBacktestSpec,
    build_windowed_prediction_examples,
    evaluate_backtest_gate,
    online_recalibrated_predictions,
    rolling_backtest_folds,
)
from benchmarks.mining_adapter.methane_prediction import binary_metrics
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


def _source_rows(path: Path, state: dict[str,Any]) -> Iterator[dict[str,Any]]:
    with path.open("r",encoding="utf-8",errors="strict",newline="") as stream:
        _attributes,rows=_arff_attributes_and_data(stream)
        for raw in rows:
            row=canonical_telemetry_row(raw)
            state["source_rows"] += 1
            if state["first_timestamp"] is None:
                state["first_timestamp"]=row["event_time"]
            state["last_timestamp"]=row["event_time"]
            yield row


def _matrix(examples, feature_names):
    import numpy as np
    X=np.asarray(
        [[float(item.features[name]) for name in feature_names] for item in examples],
        dtype=np.float32,
    )
    y=np.asarray([1 if item.label else 0 for item in examples],dtype=np.uint8)
    return X,y


def _weights(y):
    import numpy as np
    positives=int(y.sum())
    negatives=int(len(y)-positives)
    if positives==0 or negatives==0:
        raise ValueError("methane_backtest_training_classes_required")
    return np.where(
        y==1,
        len(y)/(2.0*positives),
        len(y)/(2.0*negatives),
    ).astype(np.float64)


def run(*, source: Path, spec: MethaneBacktestSpec) -> dict[str,Any]:
    import numpy as np
    import sklearn
    from sklearn.ensemble import HistGradientBoostingClassifier
    from sklearn.metrics import average_precision_score, roc_auc_score

    if not source.is_file():
        raise FileNotFoundError(source)
    source_sha=_sha256_file(source)
    state={"source_rows":0,"first_timestamp":None,"last_timestamp":None}

    build_started=time.perf_counter()
    examples=list(build_windowed_prediction_examples(_source_rows(source,state),spec))
    build_seconds=time.perf_counter()-build_started
    folds=rolling_backtest_folds(examples,spec)
    feature_names=list(examples[0].features)

    fold_reports=[]
    for fold in folds:
        train=fold["train"]
        calibration=fold["calibration"]
        test=fold["test"]
        leakage=(
            max(item.label_window_end for item in train)
            < min(item.feature_time for item in calibration)
            and max(item.label_window_end for item in calibration)
            < min(item.feature_time for item in test)
            and max(item.label_window_end for item in test)
            < fold["development_end"]
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
        model.fit(X_train,y_train,sample_weight=_weights(y_train))
        train_seconds=time.perf_counter()-train_started

        calibration_scores=model.predict_proba(X_cal)[:,1]

        score_started=time.perf_counter()
        scores=model.predict_proba(X_test)[:,1]
        score_seconds=time.perf_counter()-score_started
        online=online_recalibrated_predictions(
            calibration_examples=calibration,
            calibration_scores=calibration_scores.tolist(),
            test_examples=test,
            test_scores=scores.tolist(),
            warning_threshold=spec.warning_threshold,
            minimum_recall=spec.calibration_recall_target,
            update_every_examples=spec.threshold_update_examples,
            window_examples=spec.threshold_window_examples,
            minimum_online_positives=spec.minimum_online_positives,
        )
        predicted=np.asarray(online["predictions"],dtype=np.uint8)
        model_metrics=binary_metrics(y_test.tolist(),predicted.tolist())
        model_metrics["average_precision"]=float(average_precision_score(y_test,scores))
        model_metrics["roc_auc"]=float(roc_auc_score(y_test,scores))
        model_metrics["threshold"]=float(online["thresholds"][-1])
        model_metrics["initial_threshold"]=float(online["thresholds"][0])
        model_metrics["threshold_updates"]=int(online["threshold_updates"])

        current_index=feature_names.index("target_current_max")
        baseline_pred=(X_test[:,current_index]>=spec.warning_threshold).astype(np.uint8)
        baseline=binary_metrics(y_test.tolist(),baseline_pred.tolist())
        prevalence=float(y_test.mean())

        fold_reports.append({
            "fold":fold["fold"],
            "train_examples":len(train),
            "calibration_examples":len(calibration),
            "test_examples":len(test),
            "train_positives":int(y_train.sum()),
            "calibration_positives":int(y_cal.sum()),
            "test_positives":int(y_test.sum()),
            "test_prevalence":prevalence,
            "temporal_leakage_check":bool(leakage),
            "online_recalibration_leakage_check":bool(online["leakage_safe"]),
            "calibration_operating_point":online["initial_operating_point"],
            "online_threshold_updates":online["threshold_updates"],
            "online_initial_threshold":float(online["thresholds"][0]),
            "online_final_threshold":float(online["thresholds"][-1]),
            "online_update_audit":online["update_audit"],
            "baseline":baseline,
            "model":model_metrics,
            "model_train_seconds":train_seconds,
            "test_score_seconds":score_seconds,
            "test_start":min(item.feature_time for item in test).isoformat(),
            "test_end":max(item.feature_time for item in test).isoformat(),
        })

        del model,X_train,y_train,X_cal,y_cal,X_test,y_test
        gc.collect()

    report={
        "schema":"musitu.connect.mining.methane_backtest_execution.v1",
        "dataset_id":spec.dataset_id,
        "dataset_version":spec.dataset_version,
        "doi":spec.doi,
        "license":spec.license,
        "transport_source":"openml:42701",
        "source_sha256":source_sha,
        "source_rows":state["source_rows"],
        "first_timestamp":state["first_timestamp"],
        "last_timestamp":state["last_timestamp"],
        "eligible_examples":len(examples),
        "feature_count":len(feature_names),
        "feature_names":feature_names,
        "history_seconds":spec.history_seconds,
        "horizon_start_seconds":spec.horizon_start_seconds,
        "horizon_end_seconds":spec.horizon_end_seconds,
        "development_fraction":spec.development_fraction,
        "calibration_recall_target":spec.calibration_recall_target,
        "threshold_update_examples":spec.threshold_update_examples,
        "threshold_window_examples":spec.threshold_window_examples,
        "minimum_online_positives":spec.minimum_online_positives,
        "folds":fold_reports,
        "median_test_recall":median(item["model"]["recall"] for item in fold_reports),
        "median_test_precision":median(item["model"]["precision"] for item in fold_reports),
        "median_test_f2":median(item["model"]["f2"] for item in fold_reports),
        "median_baseline_f2":median(item["baseline"]["f2"] for item in fold_reports),
        "model_type":"sklearn.ensemble.HistGradientBoostingClassifier",
        "model_version":sklearn.__version__,
        "example_build_seconds":build_seconds,
        "credentials_used":False,
        "errors":[],
    }
    qualification=evaluate_backtest_gate(spec,report)
    return {
        "schema":"musitu.connect.mining.methane_backtest_evidence.v1",
        "spec":{
            "dataset_id":spec.dataset_id,
            "dataset_version":spec.dataset_version,
            "doi":spec.doi,
            "license":spec.license,
            "warning_threshold":spec.warning_threshold,
            "history_seconds":spec.history_seconds,
            "horizon_start_seconds":spec.horizon_start_seconds,
            "horizon_end_seconds":spec.horizon_end_seconds,
            "sample_stride_seconds":spec.sample_stride_seconds,
            "fold_count":spec.fold_count,
            "development_fraction":spec.development_fraction,
            "calibration_recall_target":spec.calibration_recall_target,
            "minimum_examples":spec.minimum_examples,
            "minimum_fold_test_positives":spec.minimum_fold_test_positives,
            "minimum_test_recall":spec.minimum_test_recall,
            "minimum_test_precision":spec.minimum_test_precision,
            "minimum_f2_gain_fraction":spec.minimum_f2_gain_fraction,
            "required_passing_folds":spec.required_passing_folds,
            "threshold_update_examples":spec.threshold_update_examples,
            "threshold_window_examples":spec.threshold_window_examples,
            "minimum_online_positives":spec.minimum_online_positives,
            "minimum_source_rows":spec.minimum_source_rows,
        },
        "execution":report,
        "qualification":qualification,
    }


def main() -> None:
    parser=argparse.ArgumentParser()
    parser.add_argument("--source",type=Path,required=True)
    parser.add_argument("--output",type=Path,required=True)
    args=parser.parse_args()
    evidence=run(source=args.source,spec=MethaneBacktestSpec())
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(evidence,indent=2,sort_keys=True)+"\n")
    print(json.dumps(evidence,indent=2,sort_keys=True))


if __name__=="__main__":
    main()
