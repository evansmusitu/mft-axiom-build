"""Read-only, privacy-preserving intake preflight for *candidate* external mine data.

This checks source bytes, canonical telemetry, chronology, feature and future
label coverage. Rights and mine independence are DECLARED, not independently
proven; no model predictions are evaluated and nothing can grant admission.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import datetime, timedelta
from math import isfinite
from pathlib import Path
from typing import Any, Iterator, Mapping

from benchmarks.mining_adapter.methane_backtest import (
    MethaneBacktestSpec,
    build_windowed_prediction_examples,
)
from connect.mining_telemetry import MINING_TELEMETRY_SENSORS

SCHEMA = 'musitu.axiom.external_source_manifest.v1'
FORMAT = 'canonical_mining_telemetry_ndjson.v1'
PUBLIC_DEV_SHA = '28e2eed4c4a314daa4319f656a09bb43d8acea603dcb906e31c98049c91a8fdc'
NUMERIC_SENSORS = tuple(k for k in MINING_TELEMETRY_SENSORS if k != 'F_SIDE')
ROW_FIELDS = frozenset(('event_time',) + MINING_TELEMETRY_SENSORS)
HEX_SHA = re.compile(r'[0-9a-f]{64}\Z')


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def _parsed_time(value: Any) -> datetime:
    if not isinstance(value, str):
        raise ValueError('external_source_timestamp_invalid')
    try:
        result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        raise ValueError('external_source_timestamp_invalid') from None
    if result.tzinfo is None or result.utcoffset() is None:
        raise ValueError('external_source_timestamp_timezone_required')
    return result


def _read_manifest(path: Path) -> tuple[Mapping[str, Any], str]:
    raw = path.read_bytes()
    try:
        manifest = json.loads(raw)
    except (ValueError, UnicodeError):
        raise ValueError('external_source_manifest_invalid') from None
    if not isinstance(manifest, dict) or manifest.get('schema') != SCHEMA or manifest.get('source_format') != FORMAT:
        raise ValueError('external_source_manifest_invalid')
    declared_sha = manifest.get('source_sha256')
    if not isinstance(declared_sha, str) or not HEX_SHA.fullmatch(declared_sha):
        raise ValueError('external_source_sha256_invalid')
    if declared_sha == PUBLIC_DEV_SHA:
        raise ValueError('external_source_is_known_development_dataset')
    if (manifest.get('source_collection_id') in ('yd7vw4c5mk', 'openml:42701')
            or manifest.get('site_id') in ('yd7vw4c5mk', 'openml:42701')):
        raise ValueError('external_source_is_known_development_dataset')
    for field in ('site_id', 'source_collection_id', 'rights_basis', 'authorization_reference', 'provenance_reference'):
        if not isinstance(manifest.get(field), str) or not manifest[field].strip():
            raise ValueError('external_source_declarations_incomplete')
    n = manifest.get('declared_source_rows')
    if type(n) is not int or n < 1:
        raise ValueError('external_source_declared_source_rows_invalid')
    start, end = _parsed_time(manifest.get('declared_start_time')), _parsed_time(manifest.get('declared_end_time'))
    if start >= end:
        raise ValueError('external_source_declared_time_span_invalid')
    return manifest, hashlib.sha256(raw).hexdigest()


def _validate_row(row: Any) -> None:
    if not isinstance(row, dict) or set(row) != ROW_FIELDS:
        raise ValueError('external_source_schema_invalid')
    for name in NUMERIC_SENSORS:
        value = row[name]
        if type(value) not in (float, int):
            raise ValueError('external_source_sensor_invalid')
        if not isfinite(value):
            raise ValueError('external_source_sensor_not_finite')
    side = str(row['F_SIDE']).strip().casefold()
    if side not in ('left', 'right', 'l', 'r', '0', '0.5', '1'):
        raise ValueError('external_source_sensor_invalid')


def _stream_source(source: Path, state: dict[str, Any]) -> Iterator[dict[str, Any]]:
    previous = None
    with source.open('r', encoding='utf-8', errors='strict') as f:
        for line in f:
            if not line.strip():
                raise ValueError('external_source_schema_invalid')
            try:
                row = json.loads(line)
            except (ValueError, UnicodeError):
                raise ValueError('external_source_schema_invalid') from None
            _validate_row(row)
            time = _parsed_time(row['event_time'])
            if previous is not None:
                if time <= previous:
                    raise ValueError('external_source_timestamp_order_invalid')
                if time - previous != timedelta(seconds=1):
                    state['discontinuities'] += 1
            else:
                state['first_time'] = time
            previous = time
            state['last_time'] = time
            state['source_rows'] += 1
            if max(float(row[x]) for x in ('MM263', 'MM264', 'MM256')) >= 1.0:
                state['observed_hard_warning_rows'] += 1
            yield row


def inspect_external_source(*, source: Path, manifest_path: Path) -> dict[str, Any]:
    """Check externally supplied telemetry without any model execution or admission.

    Source and manifest remain local. Only nonidentifying aggregate counts are
    returned; permissions, origin and independence are NOT authenticated.
    """
    source = Path(source)
    manifest_path = Path(manifest_path)
    if source.resolve() == manifest_path.resolve():
        raise ValueError('external_source_paths_must_be_distinct')
    manifest, manifest_sha = _read_manifest(manifest_path)
    digest = _sha256_file(source)
    if digest != manifest['source_sha256']:
        raise ValueError('external_source_sha256_mismatch')
    state = {'source_rows': 0, 'discontinuities': 0, 'first_time': None,
             'last_time': None, 'observed_hard_warning_rows': 0}
    spec = MethaneBacktestSpec()
    # The source is streamed; only the eligible 30-second-stride label metadata
    # (not industrial telemetry records or model features) is retained.
    examples = [(e.feature_time, e.label_window_end, e.label) for e in
                build_windowed_prediction_examples(_stream_source(source, state), spec)]
    # Check for a source mutation between the two reads (data might be external).
    if _sha256_file(source) != digest:
        raise ValueError('external_source_modified_during_scan')
    if state['source_rows'] != manifest['declared_source_rows']:
        raise ValueError('external_source_declared_source_rows_mismatch')
    if (state['first_time'] != _parsed_time(manifest['declared_start_time'])
            or state['last_time'] != _parsed_time(manifest['declared_end_time'])):
        raise ValueError('external_source_declared_time_span_mismatch')
    if not examples:
        raise ValueError('external_source_no_complete_forecast_windows')

    total = len(examples)
    positives = sum(label for _, _, label in examples)
    # Group overlapping future-label windows only. These are NOT actual mine
    # incidents, independently verified events, or qualification folds.
    overlap_groups = 0
    prior_end = None
    for stamp, end, label in examples:
        if not label:
            continue
        start = stamp + timedelta(seconds=spec.horizon_start_seconds)
        if prior_end is None or start > prior_end:
            overlap_groups += 1
        prior_end = max(prior_end, end) if prior_end else end
    blocks = []
    for i in range(4):
        sample = examples[i * total // 4 : (i + 1) * total // 4]
        positive_count = sum(label for _, _, label in sample)
        blocks.append({
            'block': i,
            'validation_role': 'DESCRIPTIVE_ONLY',
            'eligible_examples': len(sample),
            'positive_label_examples': positive_count,
            'support_at_least_500': positive_count >= spec.minimum_fold_test_positives,
            'start_feature_time': sample[0][0].isoformat() if sample else None,
            'end_feature_time': sample[-1][0].isoformat() if sample else None,
        })
    return {
        'schema': 'musitu.axiom.external_source_preflight.v1',
        'status': 'RESEARCH_INTAKE_ONLY_NOT_ADMITTED',
        'source_integrity': 'HASH_AND_SCHEMA_VERIFIED',
        'provenance_status': 'DECLARATIONS_ONLY_NOT_INDEPENDENTLY_VERIFIED',
        'source_sha256': digest,
        'manifest_sha256': manifest_sha,
        'source_rows': state['source_rows'],
        'source_timestamp_discontinuities': state['discontinuities'],
        'observed_hard_warning_rows': state['observed_hard_warning_rows'],
        'eligible_examples': total,
        'positive_label_examples': positives,
        'positive_window_overlap_groups': overlap_groups,
        'overlap_groups_are_unique_incidents': False,
        'chronological_support_blocks': blocks,
        'support_blocks_are_original_qualification_folds': False,
        'required_passing_folds': spec.required_passing_folds,
        'model_evaluation_status': 'NOT_EXECUTED_NO_FROZEN_MODEL',
        'qualification_gate': 'NOT_EVALUATED',
        'independent_validation': False,
        'ready_for_production': False,
        'production_admission': False,
        'allowed_claim': 'Data bytes/schema and forecast-window support checked; source rights, site independence, model performance and mine safety unverified.',
    }


def main() -> None:
    parser = argparse.ArgumentParser(description='Local research-only candidate external mining telemetry preflight')
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--manifest', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    if args.output.resolve() in (args.source.resolve(), args.manifest.resolve()):
        raise ValueError('external_source_output_must_be_distinct')
    if args.output.exists():
        raise FileExistsError('external_source_output_already_exists')
    report = inspect_external_source(source=args.source, manifest_path=args.manifest)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, sort_keys=True, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({key: report[key] for key in (
        'status', 'source_rows', 'eligible_examples', 'positive_label_examples', 'model_evaluation_status')}, sort_keys=True))


if __name__ == '__main__':
    main()
