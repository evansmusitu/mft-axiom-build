"""Read-only, frozen methane predictor research evaluation on authorized telemetry.

No model training, post-hoc threshold changes or production admission. Source
rights and actual independence cannot be authenticated by a numeric evaluator.
"""
from __future__ import annotations

import argparse
from hashlib import sha256
import json
from pathlib import Path
from typing import Any

from benchmarks.mining_adapter.external_source_preflight import (
    inspect_external_source, _stream_source,
)
from benchmarks.mining_adapter.frozen_model_bundle import load_frozen_bundle, _sha256_file
from benchmarks.mining_adapter.methane_backtest import MethaneBacktestSpec, build_windowed_prediction_examples
from benchmarks.mining_adapter.methane_prediction import binary_metrics
from benchmarks.mining_adapter.external_event_proxy_audit import EventProxyAudit


def evaluate_external_mine(*, source: Path, manifest_path: Path,
                           bundle_dir: Path, expected_manifest_sha256: str) -> dict[str, Any]:
    """Score a frozen model; preserve immutable policy and retain only aggregates."""
    from sklearn.metrics import average_precision_score

    source, manifest_path = Path(source), Path(manifest_path)
    bundle = load_frozen_bundle(bundle_dir, expected_manifest_sha256=expected_manifest_sha256)
    preflight = inspect_external_source(source=source, manifest_path=manifest_path)
    if (preflight.get('status') != 'RESEARCH_INTAKE_ONLY_NOT_ADMITTED'
            or preflight.get('independent_validation') is not False
            or preflight.get('production_admission') is not False
            or preflight.get('source_integrity') != 'HASH_AND_SCHEMA_VERIFIED'):
        raise ValueError('frozen_external_preflight_not_research_only')
    spec = MethaneBacktestSpec()
    source_sha = _sha256_file(source)
    if source_sha != preflight['source_sha256']:
        raise ValueError('frozen_external_source_changed')
    state = {'source_rows': 0, 'discontinuities': 0, 'first_time': None,
             'last_time': None, 'observed_hard_warning_rows': 0}
    names = bundle.manifest['feature_names']
    predictions: list[bool] = []
    baseline: list[bool] = []
    labels: list[bool] = []
    scores: list[float] = []
    hard_total = 0
    window_audit = EventProxyAudit()

    def flush(batch):
        nonlocal hard_total
        if not batch: return
        chunk_scores = bundle.predict(batch)
        for item, score in zip(batch, chunk_scores, strict=True):
            hard = float(item.features['target_current_max']) >= bundle.manifest['warning_threshold']
            # The policy was frozen before this source was evaluated.
            alerted = hard or score >= bundle.manifest['score_threshold']
            if hard and not alerted:
                raise ValueError('frozen_external_hard_warning_suppressed')
            window_audit.observe(
                feature_time=item.feature_time, label_window_end=item.label_window_end,
                label=bool(item.label), hard_observed=bool(hard),
                predicted_alert=bool(alerted),
            )
            hard_total += int(hard)
            baseline.append(hard)
            predictions.append(bool(alerted))
            labels.append(bool(item.label))
            scores.append(score)
        batch.clear()

    batch=[]
    for example in build_windowed_prediction_examples(_stream_source(source, state), spec):
        if list(example.features) != names:
            raise ValueError('frozen_external_feature_schema_mismatch')
        batch.append(example)
        if len(batch)>=1024: flush(batch)
    flush(batch)
    if (_sha256_file(source) != source_sha or state['source_rows'] != preflight['source_rows']
            or len(labels) != preflight['eligible_examples']):
        raise ValueError('frozen_external_source_changed')
    if not labels: raise ValueError('frozen_external_no_examples')
    window_proxy_audit = window_audit.finalize()
    model_metrics = binary_metrics(labels, predictions)
    baseline_metrics = binary_metrics(labels, baseline)
    positives=sum(labels)
    # AP is only meaningful when both label classes occur. Reject the inference
    # of predictive skill from degenerate external event support.
    model_metrics['average_precision'] = (
        float(average_precision_score(labels, scores)) if 0 < positives < len(labels) else None)
    model_metrics['prevalence'] = positives/len(labels)
    model_metrics['f2_delta_vs_hard_warning'] = model_metrics['f2'] - baseline_metrics['f2']
    return {
        'schema': 'musitu.axiom.frozen_external_mine_evaluation.v1',
        'status': 'RESEARCH_ONLY_NOT_ADMITTED',
        'model_manifest_sha256': bundle.manifest_sha256,
        'model_sha256': bundle.manifest['model_sha256'],
        'source_sha256': source_sha,
        'source_manifest_sha256': preflight['manifest_sha256'],
        'source_rows': state['source_rows'], 'eligible_examples': len(labels),
        'test_positives': positives, 'observed_hard_warnings': hard_total,
        'hard_warning_preserved': True,
        'baseline': baseline_metrics,
        'window_proxy_audit': window_proxy_audit,
        'model': model_metrics,
        'feature_count': len(names),
        'frozen_score_threshold': bundle.manifest['score_threshold'],
        'frozen_warning_threshold': bundle.manifest['warning_threshold'],
        'model_retrained': False, 'threshold_recalibrated': False,
        'preflight': {'source_integrity': preflight['source_integrity'],
                      'provenance_status': preflight['provenance_status'],
                      'positive_label_examples': preflight['positive_label_examples']},
        'independent_validation': False, 'production_admission': False,
        'admission_gate': 'NOT_EVALUATED',
        'claim_policy': 'Unverified external origin and rights; research-only aggregate metrics; never automatically authorize mine safety or production.',
    }


def main() -> None:
    p=argparse.ArgumentParser(description='Evaluate frozen methane model on local authorized candidate data')
    p.add_argument('--source', type=Path, required=True)
    p.add_argument('--manifest', type=Path, required=True)
    p.add_argument('--bundle', type=Path, required=True)
    p.add_argument('--expected-manifest-sha256', type=str, required=True)
    p.add_argument('--output', type=Path, required=True)
    args=p.parse_args()
    if args.output.exists() or args.output.resolve() in (args.source.resolve(), args.manifest.resolve()):
        raise FileExistsError('frozen_external_output_already_exists_or_input')
    report=evaluate_external_mine(source=args.source,manifest_path=args.manifest,
                                  bundle_dir=args.bundle,expected_manifest_sha256=args.expected_manifest_sha256)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(report,indent=2,sort_keys=True)+'\n',encoding='utf-8')
    print(json.dumps({'status':report['status'],'eligible_examples':report['eligible_examples'],
                      'independent_validation':False,'production_admission':False},sort_keys=True))


if __name__ == '__main__':
    main()
