"""Isolated, research-only LightGBM methane challenger (never production admission).

Uses exactly the existing source ingestion, chronology, feature windows, hard
observed warning, and online resolved-label threshold calibration contracts.
Never substitutes its development performance for independent validation.
"""
from __future__ import annotations

import argparse
import gc
import json
import time
from pathlib import Path
from statistics import median
from typing import Any, Sequence

ROOT = Path(__file__).resolve().parents[2]
if __name__ == "__main__":
    import sys
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))

from benchmarks.mining_adapter.methane_backtest import (
    MethaneBacktestSpec,
    build_windowed_prediction_examples,
    evaluate_backtest_gate,
    online_recalibrated_predictions,
    rolling_backtest_folds,
)
from benchmarks.mining_adapter.methane_backtest_runner import (
    _matrix,
    _sha256_file,
    _source_rows,
    _weights,
)
from benchmarks.mining_adapter.methane_prediction import PredictionExample, binary_metrics
from benchmarks.mining_adapter.regime_shadow import regime_calibrated_shadow

QUALIFIED_SHA256 = "28e2eed4c4a314daa4319f656a09bb43d8acea603dcb906e31c98049c91a8fdc"


def evaluate_challenger_fold(
    *,
    train: Sequence[PredictionExample],
    calibration: Sequence[PredictionExample],
    test: Sequence[PredictionExample],
    feature_names: Sequence[str],
    spec: MethaneBacktestSpec,
    fold_index: int,
) -> dict[str, Any]:
    """Train only before calibration, predict test chronologically, never use test labels in tuning."""
    import lightgbm
    import numpy as np
    import pandas as pd
    from sklearn.metrics import average_precision_score, roc_auc_score

    if not train or not calibration or not test:
        raise ValueError("challenger_fold_empty")
    if not feature_names or "target_current_max" not in feature_names or len(set(feature_names)) != len(feature_names):
        raise ValueError("challenger_feature_invalid")
    for examples in (train, calibration, test):
        if any(examples[i].feature_time >= examples[i + 1].feature_time for i in range(len(examples) - 1)):
            raise ValueError("challenger_fold_order_invalid")
        if any(not set(feature_names).issubset(example.features) for example in examples):
            raise ValueError("challenger_feature_invalid")
    leakage = (max(item.label_window_end for item in train) < calibration[0].feature_time
               and max(item.label_window_end for item in calibration) < test[0].feature_time)
    if not leakage:
        raise ValueError("causal_fold_boundary_invalid")

    X_train, y_train = _matrix(train, feature_names)
    X_cal, y_cal = _matrix(calibration, feature_names)
    X_test, y_test = _matrix(test, feature_names)
    if not all(np.isfinite(X).all() for X in (X_train, X_cal, X_test)):
        raise ValueError("challenger_feature_invalid_nonfinite")
    if len(np.unique(y_train)) != 2:
        raise ValueError("challenger_training_classes_missing")
    if len(np.unique(y_cal)) != 2 or len(np.unique(y_test)) != 2:
        raise ValueError("challenger_calibration_or_test_classes_missing")

    model = lightgbm.LGBMClassifier(
        n_estimators=180, learning_rate=0.05, num_leaves=31,
        min_child_samples=40, reg_lambda=1.0,
        random_state=20261008, n_jobs=2, verbosity=-1,
        deterministic=True, force_col_wise=True,
    )
    started = time.perf_counter()
    model.fit(pd.DataFrame(X_train, columns=feature_names), y_train, sample_weight=_weights(y_train))
    train_seconds = time.perf_counter() - started
    cal_scores = model.predict_proba(pd.DataFrame(X_cal, columns=feature_names))[:, 1]
    started = time.perf_counter()
    test_scores = model.predict_proba(pd.DataFrame(X_test, columns=feature_names))[:, 1]
    score_seconds = time.perf_counter() - started
    if not (np.isfinite(cal_scores).all() and np.isfinite(test_scores).all()):
        raise ValueError("challenger_scores_nonfinite")

    online = online_recalibrated_predictions(
        calibration_examples=calibration,
        calibration_scores=cal_scores.tolist(),
        test_examples=test,
        test_scores=test_scores.tolist(),
        warning_threshold=spec.warning_threshold,
        minimum_recall=spec.calibration_recall_target,
        update_every_examples=spec.threshold_update_examples,
        window_examples=spec.threshold_window_examples,
        minimum_online_positives=spec.minimum_online_positives,
    )
    predictions = np.asarray(online["predictions"], dtype=np.uint8)
    current = X_test[:, feature_names.index("target_current_max")]
    hard = current >= spec.warning_threshold
    if np.any(np.logical_and(hard, np.logical_not(predictions))):
        raise ValueError("challenger_hard_warning_suppressed")

    metrics = binary_metrics(y_test.tolist(), predictions.tolist())
    metrics["average_precision"] = float(average_precision_score(y_test, test_scores))
    metrics["roc_auc"] = float(roc_auc_score(y_test, test_scores))
    metrics["threshold"] = float(online["thresholds"][-1])
    metrics["initial_threshold"] = float(online["thresholds"][0])
    metrics["threshold_updates"] = int(online["threshold_updates"])
    persistence = binary_metrics(y_test.tolist(), hard.astype(np.uint8).tolist())

    # PREDECLARED research-only regime-conditioned online threshold candidate.
    # Original admission-policy predictions and metrics above remain unchanged.
    shadow = regime_calibrated_shadow(
        calibration_examples=calibration,
        calibration_scores=cal_scores.tolist(),
        test_examples=test,
        test_scores=test_scores.tolist(),
        global_thresholds=online["thresholds"],
        warning_threshold=spec.warning_threshold,
        regime_boundary=spec.warning_threshold / 2.0,
        minimum_recall=spec.calibration_recall_target,
        update_every_examples=spec.threshold_update_examples,
        window_examples=spec.threshold_window_examples,
        minimum_regime_positives=spec.minimum_online_positives,
    )
    if not shadow["leakage_safe"] or not all(
        not observed or alerted
        for observed, alerted in zip(hard, shadow["predictions"], strict=True)
    ):
        raise ValueError("research_regime_shadow_warning_or_causality_invalid")
    shadow_metrics = binary_metrics(y_test.tolist(), shadow["predictions"])
    shadow_summary = {
        key: value for key, value in shadow.items()
        if key not in ("predictions", "regimes")
    }
    shadow_summary["metrics"] = shadow_metrics
    shadow_summary["delta_f2_against_admission_policy"] = shadow_metrics["f2"] - metrics["f2"]
    shadow_summary["regime_example_counts"] = {
        regime: shadow["regimes"].count(regime) for regime in ("low", "elevated")
    }

    return {
        "fold": int(fold_index),
        "model_type": "lightgbm.LGBMClassifier",
        "model_version": lightgbm.__version__,
        "train_examples": len(train),
        "calibration_examples": len(calibration),
        "test_examples": len(test),
        "train_positives": int(y_train.sum()),
        "calibration_positives": int(y_cal.sum()),
        "test_positives": int(y_test.sum()),
        "test_prevalence": float(y_test.mean()),
        "temporal_leakage_check": True,
        "online_recalibration_leakage_check": bool(online["leakage_safe"]),
        "online_threshold_updates": int(online["threshold_updates"]),
        "hard_observed_warning_preserved": True,
        "baseline": persistence,
        "model": metrics,
        "research_only_regime_shadow": shadow_summary,
        "model_train_seconds": train_seconds,
        "test_score_seconds": score_seconds,
        "test_start": test[0].feature_time.isoformat(),
        "test_end": test[-1].feature_time.isoformat(),
    }


def run(*, source: Path, spec: MethaneBacktestSpec) -> dict[str, Any]:
    """Full historical research comparison; independent safety certification is prohibited."""
    import lightgbm
    if not source.is_file():
        raise FileNotFoundError(source)
    digest = _sha256_file(source)
    if digest != QUALIFIED_SHA256:
        raise ValueError("challenger_qualified_source_sha256_mismatch")
    state: dict[str, Any] = {"source_rows": 0, "first_timestamp": None, "last_timestamp": None}
    examples = list(build_windowed_prediction_examples(_source_rows(source, state), spec))
    if not examples:
        raise ValueError("challenger_examples_empty")
    features = list(examples[0].features)
    folds = rolling_backtest_folds(examples, spec)
    reports = []
    for fold in folds:
        result = evaluate_challenger_fold(
            train=fold["train"], calibration=fold["calibration"],
            test=fold["test"], feature_names=features,
            spec=spec, fold_index=fold["fold"],
        )
        if fold["test"][-1].label_window_end >= fold["development_end"]:
            raise ValueError("challenger_test_outside_development_region")
        reports.append(result)
        gc.collect()
    execution = {
        "dataset_id": spec.dataset_id,
        "dataset_version": spec.dataset_version,
        "doi": spec.doi,
        "license": spec.license,
        "transport_source": "openml:42701",
        "source_sha256": digest,
        "source_rows": state["source_rows"],
        "eligible_examples": len(examples),
        "feature_count": len(features),
        "history_seconds": spec.history_seconds,
        "horizon_start_seconds": spec.horizon_start_seconds,
        "horizon_end_seconds": spec.horizon_end_seconds,
        "folds": reports,
        "credentials_used": False,
        "errors": [],
    }
    gate = evaluate_backtest_gate(spec, execution)
    return {
        "schema": "musitu.axiom.predictive.lightgbm_challenger.v1",
        "status": "RESEARCH_ONLY_NOT_ADMITTED",
        "production_admission": False,
        "independent_validation": False,
        "source_sha256": digest,
        "model_type": "lightgbm.LGBMClassifier",
        "model_version": lightgbm.__version__,
        "comparison": {
            "median_challenger_recall": median(f["model"]["recall"] for f in reports),
            "median_challenger_precision": median(f["model"]["precision"] for f in reports),
            "median_challenger_f2": median(f["model"]["f2"] for f in reports),
            "median_persistence_f2": median(f["baseline"]["f2"] for f in reports),
        },
        "execution": execution,
        "existing_gate_diagnostic_only": gate,
        "restrictions": [
            "DEVELOPMENT_FOLDS_ALREADY_SPENT",
            "NOT_INDEPENDENT_VALIDATION",
            "NOT_MINE_SAFETY_CERTIFICATION",
            "NO_PRODUCTION_OR_CUSTOMER_DEPLOYMENT_AUTHORITY",
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Research-only LightGBM methane challenger")
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    evidence = run(source=args.source, spec=MethaneBacktestSpec())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(evidence, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": evidence["status"], "comparison": evidence["comparison"],
                      "gate": evidence["existing_gate_diagnostic_only"]["gate"]}, sort_keys=True))


if __name__ == "__main__":
    main()
