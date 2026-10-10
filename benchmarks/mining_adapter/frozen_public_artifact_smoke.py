"""Pin and replay the REAL published research LightGBM artifact using synthetic sensors.

This is a reproducible engineering contract smoke, not another mine or an
independent validation. It does not update weights or thresholds, access
customers or promote production models.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from benchmarks.mining_adapter.frozen_model_bundle import load_frozen_bundle
from benchmarks.mining_adapter.frozen_mine_evaluator import evaluate_external_mine
from benchmarks.mining_adapter.external_validation_gate import assess_external_evidence
from connect.mining_telemetry import MINING_TELEMETRY_SENSORS

# Independently measured exact published artifact from GitHub Actions run 37882474024.
PINNED_RUN_ID = 37882474024
PINNED_ARTIFACT_NAME = 'musitu-axiom-native-frozen-lightgbm-research'
PINNED_MANIFEST_SHA256 = 'f57fab879104a8307f0b472fc106d61c1aa7cf440811229b2221b2266ee779bf'
PINNED_MODEL_SHA256 = '3b51f3318fb59d2555b66cbbd41e371f9f0241d2137e5166c77e685f9ab030eb'


def create_synthetic_telemetry(*, source: Path, manifest_path: Path) -> dict[str, Any]:
    """Create deterministic *non-mine* records, strictly for interface testing."""
    if source.resolve() == manifest_path.resolve() or source.exists() or manifest_path.exists():
        raise FileExistsError('frozen_smoke_input_exists')
    count, alerts = 2400, 0
    start = datetime(2025, 1, 1, tzinfo=timezone.utc)
    source.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    with source.open('x', encoding='utf-8') as handle:
        for i in range(count):
            row = {key: 0.2 for key in MINING_TELEMETRY_SENSORS if key != 'F_SIDE'}
            row['F_SIDE'] = 'left'
            row['event_time'] = (start + timedelta(seconds=i)).isoformat()
            if 1200 <= i < 1250 or 1730 <= i < 1790:
                row['MM263'] = 1.2
                alerts += 1
            handle.write(json.dumps(row, sort_keys=True, allow_nan=False, separators=(',', ':')) + '\n')
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    manifest = {
        'schema': 'musitu.axiom.external_source_manifest.v1',
        'source_format': 'canonical_mining_telemetry_ndjson.v1',
        'source_sha256': digest,
        'site_id': 'GENERATED_SYNTHETIC_NO_MINE',
        'source_collection_id': 'GENERATED_SYNTHETIC_CONTRACT_ONLY',
        'rights_basis': 'SELF_GENERATED_SYNTHETIC_NON_CUSTOMER_DATA',
        'authorization_reference': 'SYNTHETIC_TEST_ONLY_NO_MINE_OWNER',
        'provenance_reference': 'GENERATED_LOCALLY_IN_TEST_FROM_SOURCE_CODE',
        'declared_source_rows': count,
        'declared_start_time': start.isoformat(),
        'declared_end_time': (start + timedelta(seconds=count - 1)).isoformat(),
    }
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + '\n', encoding='utf-8')
    # Known construction deliberately places future-window positive labels
    # after a full 600-second feature history has accumulated.
    return {
        'source_sha256': digest,
        'source_rows': count,
        'observed_hard_warning_rows': alerts,
        'synthetic_positive_episodes_constructed': 2,  # constructed pulses, NOT verified incidents
        'independent_validation': False,
        'production_admission': False,
    }


def run_frozen_artifact_smoke(*, bundle_dir: Path, output: Path) -> dict[str, Any]:
    """Replay SHA-pinned model on synthetic telemetry, emit aggregate evidence."""
    output = Path(output)
    if output.exists():
        raise FileExistsError('frozen_smoke_output_exists')
    bundle = load_frozen_bundle(Path(bundle_dir), expected_manifest_sha256=PINNED_MANIFEST_SHA256)
    if bundle.manifest['model_sha256'] != PINNED_MODEL_SHA256:
        raise ValueError('frozen_smoke_public_model_identity_mismatch')
    with TemporaryDirectory(prefix='musitu-axiom-synthetic-') as tmp:
        root = Path(tmp)
        source, manifest = root / 'synthetic.ndjson', root / 'source_manifest.json'
        generated = create_synthetic_telemetry(source=source, manifest_path=manifest)
        evaluated = evaluate_external_mine(
            source=source, manifest_path=manifest, bundle_dir=bundle_dir,
            expected_manifest_sha256=PINNED_MANIFEST_SHA256)
        audit = assess_external_evidence(evaluated)
    if not evaluated['hard_warning_preserved'] or evaluated['observed_hard_warnings'] < 1:
        raise ValueError('frozen_smoke_hard_warning_not_demonstrated')
    if evaluated['test_positives'] < 1 or evaluated['eligible_examples'] < 1:
        raise ValueError('frozen_smoke_future_label_not_demonstrated')
    if (evaluated['model_retrained'] is not False or evaluated['threshold_recalibrated'] is not False
            or evaluated['production_admission'] is not False or evaluated['independent_validation'] is not False
            or audit['admission_gate'] != 'NOT_AUTHORIZED' or audit['production_admission'] is not False):
        raise ValueError('frozen_smoke_admission_unsafe')
    result = {
        'schema': 'musitu.axiom.frozen_artifact_synthetic_smoke.v1',
        'evaluation_kind': 'SYNTHETIC_CONTRACT_SMOKE_ONLY',
        'model_provenance_run_id': PINNED_RUN_ID,
        'model_manifest_sha256': PINNED_MANIFEST_SHA256,
        'model_sha256': PINNED_MODEL_SHA256,
        'synthetic_source_sha256': generated['source_sha256'],
        'source_rows': generated['source_rows'],
        'eligible_examples': evaluated['eligible_examples'],
        'positive_label_examples': evaluated['test_positives'],
        'observed_hard_warnings': evaluated['observed_hard_warnings'],
        'hard_warning_preserved': evaluated['hard_warning_preserved'],
        'frozen_score_threshold': evaluated['frozen_score_threshold'],
        'model_metrics': evaluated['model'],
        'hard_warning_baseline_metrics': evaluated['baseline'],
        'window_proxy_audit': evaluated['window_proxy_audit'],
        'audit': {
            'status': audit['status'],
            'admission_gate': audit['admission_gate'],
            'original_four_fold_gate_satisfied': audit['original_four_fold_gate_satisfied'],
            'provenance_verification': audit['provenance_verification'],
            'window_proxy_overlap_groups': audit['window_proxy_overlap_groups'],
            'window_proxy_missed_groups': audit['window_proxy_missed_groups'],
            'window_proxy_incident_certification': audit['window_proxy_incident_certification'],
        },
        'model_retrained': False,
        'threshold_recalibrated': False,
        'independent_validation': False,
        'production_admission': False,
        'mine_safety_certification': False,
        'claim_policy': 'Generated synthetic smoke only: no external mine, no production admission, no statistical validation.',
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2, sort_keys=True) + '\n', encoding='utf-8')
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description='Published model replay on generated synthetic telemetry only')
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    report = run_frozen_artifact_smoke(bundle_dir=args.bundle, output=args.output)
    print(json.dumps({key: report[key] for key in (
        'evaluation_kind', 'eligible_examples', 'hard_warning_preserved', 'independent_validation', 'production_admission')}, sort_keys=True))


if __name__ == '__main__':
    main()
