"""Offline frozen LightGBM inference on the EXACT four preregistered fold grids.

Scores only the predeclared feature-time sets; never fits, recalibrates, uploads
source data, changes production runtime, or grants independent-mine admission.
Public development-model checksums are pinned out of band. Neither a hash nor
a metric authenticates a source owner's rights, physical sensor equivalence,
incident ground truth, or when a private seal was first published.
"""
from __future__ import annotations

import argparse
from datetime import datetime
from math import isfinite
import json
from pathlib import Path
from typing import Any

from benchmarks.mining_adapter.external_source_preflight import _stream_source, _parsed_time
from benchmarks.mining_adapter.frozen_model_bundle import load_frozen_bundle, _sha256_file
from benchmarks.mining_adapter.independent_holdout_coverage import inspect_fold_coverage
from benchmarks.mining_adapter.independent_holdout_protocol import (
    FROZEN_MANIFEST_SHA, FROZEN_MODEL_SHA, FROZEN_THRESHOLD,
    verify_holdout_seal, _load_unique_json,
)
from benchmarks.mining_adapter.methane_backtest import (
    MethaneBacktestSpec, build_windowed_prediction_examples,
)
from benchmarks.mining_adapter.methane_prediction import binary_metrics


def _average_precision(scores: list[float], labels: list[bool]) -> float | None:
    """Tie-aware noninterpolated average precision; no threshold fitting."""
    positives = sum(labels)
    if not 0 < positives < len(labels):
        return None
    ranked = sorted(zip(scores, labels, strict=True), reverse=True)
    true_found = seen = 0
    ap = 0.0
    cursor = 0
    while cursor < len(ranked):
        score = ranked[cursor][0]
        end = cursor
        in_group = 0
        while end < len(ranked) and ranked[end][0] == score:
            in_group += int(ranked[end][1])
            end += 1
        seen += end-cursor
        true_found += in_group
        ap += (true_found / seen) * (in_group / positives)
        cursor = end
    return ap


def evaluate_exact_holdout_folds(*, source: Path, manifest_path: Path,
                                mapping_path: Path, seal_path: Path,
                                expected_protocol_sha256: str,
                                bundle_dir: Path) -> dict[str, Any]:
    source, manifest_path, mapping_path, seal_path, bundle_dir = (
        Path(p) for p in (source, manifest_path, mapping_path, seal_path, bundle_dir))
    inputs = (source, manifest_path, mapping_path, seal_path)
    if len({p.resolve() for p in inputs}) != len(inputs):
        raise ValueError('holdout_replay_inputs_must_be_distinct')

    # Exact chrono coverage is prerequisite, not a substituted performance
    # result. It scans and SHA-rechecks every source row and the pinned mapping.
    coverage = inspect_fold_coverage(
        source=source, manifest_path=manifest_path, mapping_path=mapping_path,
        seal_path=seal_path, expected_protocol_sha256=expected_protocol_sha256)
    if coverage['complete_fold_grids'] != 4:
        raise ValueError('holdout_replay_grid_incomplete')

    verify_holdout_seal(
        seal_path=seal_path, expected_protocol_sha256=expected_protocol_sha256)
    seal = _load_unique_json(seal_path.read_text(encoding='utf-8'))
    protocol = seal['protocol']
    bundle = load_frozen_bundle(
        bundle_dir, expected_manifest_sha256=FROZEN_MANIFEST_SHA)
    if (bundle.manifest_sha256 != FROZEN_MANIFEST_SHA
            or bundle.manifest['model_sha256'] != FROZEN_MODEL_SHA
            or bundle.manifest['score_threshold'] != FROZEN_THRESHOLD
            or bundle.manifest['warning_threshold'] != 1.0):
        raise ValueError('holdout_replay_frozen_model_identity_mismatch')

    model_files = [bundle_dir / p for p in (
        'manifest.json', 'model.txt', 'manifest.sha256')]
    initial_model_bytes = [_sha256_file(p) for p in model_files]
    source_digests = [_sha256_file(p) for p in inputs]
    if (source_digests[:3] != [
            coverage['source_sha256'], coverage['source_manifest_sha256'],
            coverage['mapping_sha256']]):
        raise ValueError('holdout_replay_inputs_changed')

    spec = MethaneBacktestSpec()
    folds = []
    for i, protocol_fold in enumerate(protocol['folds']):
        first = _parsed_time(protocol_fold['first_feature_time'])
        last = _parsed_time(protocol_fold['last_feature_time'])
        folds.append({
            'number': i+1, 'first': first, 'last': last,
            'labels': [], 'alerts': [], 'baseline': [], 'scores': [],
        })

    state = {'source_rows': 0, 'discontinuities': 0, 'first_time': None,
             'last_time': None, 'observed_hard_warning_rows': 0}
    batch = []
    def flush() -> None:
        if not batch:
            return
        scores = bundle.predict([item for _, item in batch])
        if len(scores) != len(batch):
            raise ValueError('holdout_replay_score_count_mismatch')
        for (fold_index, item), raw_score in zip(batch, scores, strict=True):
            score = float(raw_score)
            if not isfinite(score) or not 0 <= score <= 1:
                raise ValueError('holdout_replay_score_nonfinite_or_out_of_range')
            f = folds[fold_index]
            hard = float(item.features['target_current_max']) >= 1.0
            alert = hard or score >= FROZEN_THRESHOLD
            f['labels'].append(bool(item.label))
            f['alerts'].append(bool(alert))
            f['baseline'].append(bool(hard))
            f['scores'].append(score)
        batch.clear()

    position = 0
    feature_names = bundle.manifest['feature_names']
    for item in build_windowed_prediction_examples(_stream_source(source, state), spec):
        while position < len(folds) and item.feature_time > folds[position]['last']:
            position += 1
        if position >= len(folds):
            # Complete the entire source scan, including the unused tail.
            # Otherwise provenance and row-count checks would cover only
            # the prefix ending at the fourth declared evaluation fold.
            continue
        fold = folds[position]
        if fold['first'] <= item.feature_time <= fold['last']:
            if list(item.features) != feature_names:
                raise ValueError('holdout_replay_feature_schema_mismatch')
            batch.append((position, item))
            if len(batch) >= 512:
                flush()
    flush()

    # Must remain true throughout BOTH coverage and model scoring, not just
    # while reading metadata. The seal SHA alone is not an external timestamp.
    if ([_sha256_file(p) for p in inputs] != source_digests
            or [_sha256_file(p) for p in model_files] != initial_model_bytes
            or state['source_rows'] != coverage['source_rows']):
        raise ValueError('holdout_replay_inputs_changed')

    summaries = []
    for i, fold in enumerate(folds):
        original = coverage['folds'][i]
        labels, alerts, baseline = (
            fold['labels'], fold['alerts'], fold['baseline'])
        if (len(labels) != original['expected_feature_windows']
                or len(labels) != original['observed_on_grid_feature_windows']
                or sum(labels) != original['positive_future_label_windows']):
            raise ValueError('holdout_replay_coverage_changed')
        model = binary_metrics(labels, alerts)
        hard = binary_metrics(labels, baseline)
        ap = _average_precision(fold['scores'], labels)
        prevalence = sum(labels) / len(labels)
        model['average_precision'] = ap
        model['prevalence'] = prevalence
        model['f2_delta_vs_hard_warning'] = model['f2'] - hard['f2']
        support = bool(original['positive_window_support_threshold_met'])
        descriptive = bool(
            support and model['recall'] >= spec.minimum_test_recall
            and model['precision'] >= spec.minimum_test_precision
            and model['f2'] >= hard['f2'] * (1 + spec.minimum_f2_gain_fraction)
            and ap is not None and ap > prevalence)
        summaries.append({
            'fold': i+1, 'test_examples': len(labels),
            'positive_future_label_windows': sum(labels),
            'positive_support_threshold_met': support,
            'research_thresholds_met_descriptive_only': descriptive,
            'model': model, 'baseline': hard,
            'hard_observed_warning_suppressed': False,
            'positive_windows_are_independent_events': False,
            'production_admission': False,
        })

    return {
        'schema': 'musitu.axiom.independent_holdout_frozen_replay.v1',
        'status': 'RESEARCH_ONLY_NOT_ADMITTED',
        'protocol_sha256': expected_protocol_sha256,
        'source_sha256': coverage['source_sha256'],
        'source_manifest_sha256': coverage['source_manifest_sha256'],
        'mapping_sha256': coverage['mapping_sha256'],
        'model_manifest_sha256': FROZEN_MANIFEST_SHA,
        'model_sha256': FROZEN_MODEL_SHA,
        'frozen_score_threshold': FROZEN_THRESHOLD,
        'frozen_warning_threshold': spec.warning_threshold,
        'complete_fold_grids': coverage['complete_fold_grids'],
        'folds_with_positive_support': coverage['supported_folds'],
        'descriptive_folds_meeting_performance_thresholds': sum(
            f['research_thresholds_met_descriptive_only'] for f in summaries),
        'required_supported_folds': spec.required_passing_folds,
        'folds': summaries,
        'model_predictions_evaluated': True,
        'source_rows': coverage['source_rows'],
        'source_timestamp_discontinuities': coverage['source_timestamp_discontinuities'],
        'model_retrained': False,
        'threshold_recalibrated': False,
        'preregistration_predates_label_access_verified': False,
        'external_source_authenticated': False,
        'operational_safety_qualified': False,
        'original_four_fold_gate_satisfied': False,
        'independent_validation': False,
        'production_admission': False,
        'production_methane_prediction_qualified': False,
        'claim_policy': 'Preregistered-grid research metric descriptions only. Neither a private SHA seal nor synthetic CI establishes mine source independence, physical incidents, safety qualification, or production authorization.',
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=(
        'Score published research LightGBM on SHA-pinned private fold grids; '
        'never authorize production'))
    for name in ('source', 'manifest', 'mapping', 'seal', 'bundle', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--expected-protocol-sha256', required=True)
    args = parser.parse_args()
    inputs = (args.source, args.manifest, args.mapping, args.seal,
              args.bundle / 'model.txt', args.bundle / 'manifest.json',
              args.bundle / 'manifest.sha256')
    if (args.output.exists()
            or args.output.resolve() in {p.resolve() for p in inputs}):
        raise FileExistsError('holdout_replay_output_exists_or_input')
    report = evaluate_exact_holdout_folds(
        source=args.source, manifest_path=args.manifest, mapping_path=args.mapping,
        seal_path=args.seal, expected_protocol_sha256=args.expected_protocol_sha256,
        bundle_dir=args.bundle)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('x', encoding='utf-8') as out:
        out.write(json.dumps(report, indent=2, sort_keys=True, allow_nan=False)+'\n')
    print(json.dumps({
        'status': report['status'], 'complete_fold_grids': report['complete_fold_grids'],
        'model_predictions_evaluated': True, 'production_admission': False},
        sort_keys=True))


if __name__ == '__main__':
    main()
