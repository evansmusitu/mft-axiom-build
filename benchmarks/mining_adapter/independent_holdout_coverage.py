"""Offline exact-fold coverage audit against an externally pinned research seal.

This checks bytes, chronology and predeclared label-window support only.
The audit NEVER authenticates rights, physical events, reviewers or model skill,
and NEVER grants production methane prediction admission.
"""
from __future__ import annotations

import argparse
from datetime import timedelta
from hashlib import sha256
import hmac
import json
from pathlib import Path
from typing import Any

from benchmarks.mining_adapter.external_source_preflight import (
    _read_manifest, _parsed_time, _sha256_file, _stream_source,
)
from benchmarks.mining_adapter.independent_holdout_protocol import verify_holdout_seal, _load_unique_json
from benchmarks.mining_adapter.methane_backtest import MethaneBacktestSpec, build_windowed_prediction_examples


def inspect_fold_coverage(*, source: Path, manifest_path: Path, mapping_path: Path,
                          seal_path: Path, expected_protocol_sha256: str) -> dict[str, Any]:
    """Require a pinned protocol and exact coverage of all four fixed fold grids."""
    source, manifest_path, mapping_path, seal_path = map(
        Path, (source, manifest_path, mapping_path, seal_path))
    paths = [p.resolve() for p in (source, manifest_path, mapping_path, seal_path)]
    if len(set(paths)) != len(paths):
        raise ValueError('holdout_coverage_inputs_must_be_distinct')
    initial_seal_sha = _sha256_file(seal_path)
    verify_holdout_seal(seal_path=seal_path, expected_protocol_sha256=expected_protocol_sha256)
    # Do not separately verify the seal and then trust different bytes:
    # an attacker with local file access could temporarily swap valid-looking
    # fold definitions during parsing and restore the original by final SHA.
    sealed_bytes = seal_path.read_bytes()
    if not hmac.compare_digest(sha256(sealed_bytes).hexdigest(), initial_seal_sha):
        raise ValueError('holdout_coverage_seal_changed_after_verification')
    seal = _load_unique_json(sealed_bytes)
    protocol = seal['protocol']
    manifest, manifest_sha = _read_manifest(manifest_path)
    source_sha = _sha256_file(source)
    mapping_sha = _sha256_file(mapping_path)
    if not hmac.compare_digest(source_sha, manifest['source_sha256']) or not hmac.compare_digest(
            source_sha, protocol['canonical_source_sha256']):
        raise ValueError('holdout_coverage_source_pin_mismatch')
    if not hmac.compare_digest(mapping_sha, protocol['sensor_mapping_sha256']):
        raise ValueError('holdout_coverage_mapping_pin_mismatch')
    if (_parsed_time(manifest['declared_start_time']) != _parsed_time(protocol['source_start_time'])
            or _parsed_time(manifest['declared_end_time']) != _parsed_time(protocol['source_end_time'])):
        raise ValueError('holdout_coverage_source_span_pin_mismatch')

    spec = MethaneBacktestSpec()
    folds = []
    for fold in protocol['folds']:
        start, end = _parsed_time(fold['first_feature_time']), _parsed_time(fold['last_feature_time'])
        expected = int((end - start).total_seconds()) // spec.sample_stride_seconds + 1
        folds.append({'first': start, 'last': end, 'expected': expected,
                      'seen': set(), 'positive': 0, 'off_grid': False})

    state = {'source_rows': 0, 'discontinuities': 0, 'first_time': None,
             'last_time': None, 'observed_hard_warning_rows': 0}
    total = 0
    positive = 0
    for example in build_windowed_prediction_examples(_stream_source(source, state), spec):
        total += 1
        positive += int(bool(example.label))
        stamp = example.feature_time
        for fold in folds:
            if fold['first'] <= stamp <= fold['last']:
                offset = (stamp - fold['first']).total_seconds()
                if offset % spec.sample_stride_seconds != 0 or stamp in fold['seen']:
                    fold['off_grid'] = True
                else:
                    fold['seen'].add(stamp)
                    fold['positive'] += int(bool(example.label))
                break

    if (_sha256_file(source) != source_sha or _sha256_file(manifest_path) != manifest_sha
            or _sha256_file(mapping_path) != mapping_sha
            or _sha256_file(seal_path) != initial_seal_sha or
            state['source_rows'] != manifest['declared_source_rows'] or
            state['first_time'] != _parsed_time(manifest['declared_start_time']) or
            state['last_time'] != _parsed_time(manifest['declared_end_time'])):
        raise ValueError('holdout_coverage_input_changed_or_manifest_mismatch')
    audits = []
    for index, fold in enumerate(folds, 1):
        grid_complete = len(fold['seen']) == fold['expected'] and not fold['off_grid']
        supported = grid_complete and fold['positive'] >= spec.minimum_fold_test_positives
        audits.append({
            'fold': index, 'expected_feature_windows': fold['expected'],
            'observed_on_grid_feature_windows': len(fold['seen']),
            'grid_complete_no_extra_phase': grid_complete,
            'positive_future_label_windows': fold['positive'],
            'positive_window_support_threshold_met': supported,
            'positive_windows_are_independent_events': False,
            'qualification_role': 'DESCRIPTIVE_ONLY_NOT_MODEL_EVALUATION',
        })
    return {
        'schema': 'musitu.axiom.independent_holdout_fold_coverage.v1',
        'status': 'RESEARCH_ONLY_NOT_ADMITTED',
        'protocol_sha256': expected_protocol_sha256,
        'source_sha256': source_sha, 'source_manifest_sha256': manifest_sha,
        'mapping_sha256': mapping_sha,
        'source_rows': state['source_rows'],
        'source_timestamp_discontinuities': state['discontinuities'],
        'eligible_examples': total, 'positive_future_label_windows': positive,
        'folds': audits,
        'supported_folds': sum(f['positive_window_support_threshold_met'] for f in audits),
        'required_supported_folds': spec.required_passing_folds,
        'complete_fold_grids': sum(f['grid_complete_no_extra_phase'] for f in audits),
        'rights_and_independent_source_authenticated': False,
        'mapping_physical_equivalence_authenticated': False,
        'event_ground_truth_independently_reviewed': False,
        'preregistration_predates_label_access_verified': False,
        'model_predictions_evaluated': False,
        'frozen_forecast_gate_evaluated': False,
        'independent_validation': False, 'production_admission': False,
        'production_methane_prediction_qualified': False,
    }


def main() -> None:
    p = argparse.ArgumentParser(description='Private exact-fold holdout coverage audit: never admission')
    for name in ('source', 'manifest', 'mapping', 'seal'):
        p.add_argument('--' + name, required=True, type=Path)
    p.add_argument('--expected-protocol-sha256', required=True)
    p.add_argument('--output', required=True, type=Path)
    args = p.parse_args()
    inputs = {p.resolve() for p in (args.source, args.manifest, args.mapping, args.seal)}
    if args.output.resolve() in inputs or args.output.exists():
        raise FileExistsError('holdout_coverage_output_exists_or_input')
    result = inspect_fold_coverage(
        source=args.source, manifest_path=args.manifest, mapping_path=args.mapping,
        seal_path=args.seal, expected_protocol_sha256=args.expected_protocol_sha256)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('x', encoding='utf-8') as out:
        out.write(json.dumps(result, indent=2, sort_keys=True, allow_nan=False) + '\n')
    print(json.dumps({'status': result['status'], 'supported_folds': result['supported_folds'],
                      'production_admission': False}, sort_keys=True))


if __name__ == '__main__':
    main()
