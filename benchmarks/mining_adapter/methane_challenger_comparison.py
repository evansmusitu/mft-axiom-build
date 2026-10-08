"""Reproducible paired comparison of *spent* chronological methane research folds.

This reads already evaluated evidence; it never trains a model, calibrates a
threshold, or changes the production/admission gate. Matching aggregate fold
boundaries is evidence of a comparable split, NOT per-row prediction pairing.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from math import isfinite
from pathlib import Path
from statistics import median
from typing import Any, Mapping

SOURCE_SHA256 = "28e2eed4c4a314daa4319f656a09bb43d8acea603dcb906e31c98049c91a8fdc"
SOURCE_FIELDS = (
    "source_sha256", "source_rows", "eligible_examples", "dataset_id",
    "dataset_version", "doi", "license", "transport_source", "feature_count",
    "history_seconds", "horizon_start_seconds", "horizon_end_seconds",
)
FOLD_FIELDS = (
    "fold", "train_examples", "train_positives", "calibration_examples",
    "calibration_positives", "test_examples", "test_positives",
    "test_start", "test_end",
)
METRIC_NAMES = ("precision", "recall", "f2")


def _validate_confusion(scores: Mapping[str, Any], positives: int, examples: int) -> None:
    keys = ("tp", "tn", "fp", "fn")
    if not isinstance(scores, Mapping) or any(
        type(scores.get(k)) is not int or scores[k] < 0 for k in keys
    ):
        raise ValueError("research_comparison_confusion_invalid")
    tp, tn, fp, fn = (scores[k] for k in keys)
    if tp + fn != positives or tp + tn + fp + fn != examples:
        raise ValueError("research_comparison_confusion_invalid")
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    expected = {
        "precision": precision,
        "recall": recall,
        "f2": 5 * precision * recall / (4 * precision + recall)
        if 4 * precision + recall else 0.0,
    }
    for key in METRIC_NAMES:
        try:
            observed = float(scores[key])
        except (KeyError, TypeError, ValueError, OverflowError):
            raise ValueError("research_comparison_metric_mismatch") from None
        if not isfinite(observed) or abs(observed - expected[key]) > 1e-10:
            raise ValueError("research_comparison_metric_mismatch")


def compare_development_runs(
    reference: Mapping[str, Any], challenger: Mapping[str, Any]
) -> dict[str, Any]:
    """Fail closed unless the baseline and challenger use identical fold contracts."""
    if (challenger.get("status") != "RESEARCH_ONLY_NOT_ADMITTED"
            or challenger.get("production_admission") is not False
            or challenger.get("independent_validation") is not False):
        raise ValueError("research_comparison_admission_not_research_only")
    before = reference.get("execution")
    after = challenger.get("execution")
    if not isinstance(before, Mapping) or not isinstance(after, Mapping):
        raise ValueError("research_comparison_execution_missing")
    if any(before.get(k) != after.get(k) for k in SOURCE_FIELDS):
        raise ValueError("research_comparison_source_mismatch")
    if (before.get("source_sha256") != SOURCE_SHA256
            or before.get("dataset_id") != "yd7vw4c5mk"
            or before.get("dataset_version") != 1
            or before.get("doi") != "10.17632/yd7vw4c5mk.1"
            or before.get("license") != "CC BY 4.0"
            or before.get("transport_source") != "openml:42701"
            or not isinstance(before.get("source_rows"), int)
            or before["source_rows"] < 9_000_000):
        raise ValueError("research_comparison_unqualified_source")
    for run in (before, after):
        if run.get("credentials_used") is not False or run.get("errors") != []:
            raise ValueError("research_comparison_unsafe_run")
    a, b = before.get("folds"), after.get("folds")
    if not isinstance(a, list) or not isinstance(b, list) or len(a) != 4 or len(b) != 4:
        raise ValueError("research_comparison_fold_mismatch")
    diffs, result = [], []
    support = 0
    for index, (ref, cand) in enumerate(zip(a, b, strict=True)):
        if (not isinstance(ref, Mapping) or not isinstance(cand, Mapping)
                or any(ref.get(k) != cand.get(k) for k in FOLD_FIELDS)
                or ref.get("fold") != index):
            raise ValueError("research_comparison_fold_mismatch")
        for fold in (ref, cand):
            if (fold.get("temporal_leakage_check") is not True
                    or fold.get("online_recalibration_leakage_check") is not True):
                raise ValueError("research_comparison_temporal_check_missing")
            if any(type(fold.get(k)) is not int or fold[k] < 0
                   for k in ("train_examples", "calibration_examples", "test_examples", "test_positives")):
                raise ValueError("research_comparison_fold_mismatch")
            _validate_confusion(fold.get("model"),fold["test_positives"],fold["test_examples"])
            _validate_confusion(fold.get("baseline"),fold["test_positives"],fold["test_examples"])
        for k in ("tp", "tn", "fp", "fn"):
            if ref["baseline"][k] != cand["baseline"][k]:
                raise ValueError("research_comparison_persistence_mismatch")
        gain = cand["model"]["f2"] - ref["model"]["f2"]
        diffs.append(gain)
        support += int(ref["test_positives"] >= 500)
        result.append({
            "fold": index,
            "test_positives": ref["test_positives"],
            "minimum_test_positives": 500,
            "support_eligible": ref["test_positives"] >= 500,
            "reference_f2": ref["model"]["f2"],
            "challenger_f2": cand["model"]["f2"],
            "delta_f2": gain,
            "reference_precision": ref["model"]["precision"],
            "challenger_precision": cand["model"]["precision"],
            "reference_recall": ref["model"]["recall"],
            "challenger_recall": cand["model"]["recall"],
            "delta_false_positives": cand["model"]["fp"] - ref["model"]["fp"],
            "delta_true_positives": cand["model"]["tp"] - ref["model"]["tp"],
            "persistence_baseline_f2": ref["baseline"]["f2"],
        })
    return {
        "schema": "musitu.axiom.research.methane_challenger_comparison.v1",
        "status": "RESEARCH_ONLY_NOT_ADMITTED",
        "production_admission": False,
        "independent_validation": False,
        "row_level_paired_prediction_evidence": False,
        "source_sha256": SOURCE_SHA256,
        "source_rows": before["source_rows"],
        "eligible_examples": before["eligible_examples"],
        "support_eligible_folds": support,
        "required_passing_folds": 3,
        "support_blocks_qualification": support < 3,
        "reference_median_f2": median(x["model"]["f2"] for x in a),
        "challenger_median_f2": median(x["model"]["f2"] for x in b),
        "median_delta_f2": median(diffs),
        "folds": result,
        "claim_policy": "Development evidence only; no statistically independent test, mine-safety certification, or production authorization.",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Fail-closed side-by-side methane research comparison")
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--challenger", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    raw_before = args.reference.read_bytes()
    raw_after = args.challenger.read_bytes()
    report = compare_development_runs(json.loads(raw_before), json.loads(raw_after))
    report["provenance"] = {
        "reference_json_sha256": hashlib.sha256(raw_before).hexdigest(),
        "challenger_json_sha256": hashlib.sha256(raw_after).hexdigest(),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True)+"\n", encoding="utf-8")
    print(json.dumps({"status": report["status"], "support_blocks_qualification": report["support_blocks_qualification"], "median_delta_f2": report["median_delta_f2"]},sort_keys=True))


if __name__ == "__main__":
    main()
