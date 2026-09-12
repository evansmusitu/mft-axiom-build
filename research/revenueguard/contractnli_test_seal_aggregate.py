#!/usr/bin/env python3
import argparse
import hashlib
import json
from pathlib import Path

from sklearn.metrics import f1_score


def metrics(rows):
    y = [r['gold'] for r in rows]
    p = [r['pred'] for r in rows]
    if not y:
        return {
            'accuracy': 0.0,
            'macro_f1': 0.0,
            'false_grounding_notmentioned': 0.0,
            'positive_semantic_accuracy': 0.0,
            'selected_evidence_exact_span_recall': 0.0,
            'n': 0,
        }
    nm = [i for i, v in enumerate(y) if v == 2]
    pos = [i for i, v in enumerate(y) if v != 2]
    evhit = sum(rows[i]['best_span_index'] in rows[i]['gold_spans'] for i in pos) / (len(pos) or 1)
    return {
        'accuracy': sum(a == b for a, b in zip(y, p)) / len(y),
        'macro_f1': float(f1_score(y, p, labels=[0, 1, 2], average='macro', zero_division=0)),
        'false_grounding_notmentioned': sum(p[i] != 2 for i in nm) / (len(nm) or 1),
        'positive_semantic_accuracy': sum(p[i] == y[i] for i in pos) / (len(pos) or 1),
        'selected_evidence_exact_span_recall': evhit,
        'n': len(y),
    }


def stable_hash(obj):
    return hashlib.sha256(json.dumps(obj, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--shard-glob', required=True)
    ap.add_argument('--expected-shards', type=int, default=8)
    ap.add_argument('--candidate-json', required=True)
    ap.add_argument('--out', required=True)
    args = ap.parse_args()

    freeze = json.load(open(args.candidate_json))
    if freeze.get('schema') != 'musitu.revenueguard.contractnli.candidate_freeze.v1':
        raise SystemExit('bad candidate-freeze schema')
    if freeze.get('status') != 'CANDIDATE_FROZEN_FOR_ONE_TIME_TEST' or not freeze.get('candidate'):
        raise SystemExit('candidate is not eligible for test opening')
    cand = freeze['candidate']

    files = sorted(Path('.').glob(args.shard_glob))
    if len(files) != args.expected_shards:
        raise SystemExit(f'expected {args.expected_shards} shards got {len(files)}')

    rows = []
    seen = set()
    seen_shards = set()
    shard_hashes = {}
    for f in files:
        obj = json.load(open(f))
        if obj.get('schema') != 'musitu.revenueguard.contractnli.test_raw_shard.v1':
            raise SystemExit(f'bad shard schema {f}')
        if obj.get('candidate_freeze_report_sha256') != freeze['report_sha256']:
            raise SystemExit(f'candidate-freeze mismatch {f}')
        for key in ['mode','checkpoint_artifact_sha256','global_training_steps','completed_chunks','chosen_k','chosen_threshold']:
            if obj.get(key) != cand.get(key):
                raise SystemExit(f'{f}: frozen candidate drift at {key}')
        if obj.get('num_shards') != args.expected_shards:
            raise SystemExit(f'{f}: shard-count mismatch')
        si = int(obj['shard_index'])
        if si in seen_shards:
            raise SystemExit(f'duplicate shard {si}')
        seen_shards.add(si)
        shard_hashes[str(si)] = obj['report_sha256']
        for r in obj['rows']:
            key = (r['doc'], r['hid'])
            if key in seen:
                raise SystemExit(f'duplicate row {key}')
            seen.add(key)
            score = r['score']
            pred = score['candidate_label'] if float(score['score']) >= float(cand['chosen_threshold']) else 2
            rows.append({**r, 'pred': pred, 'best_span_index': score['best_span_index']})

    if seen_shards != set(range(args.expected_shards)):
        raise SystemExit('missing shards')
    if not rows:
        raise SystemExit('no test rows')

    overall = metrics(rows)
    by_hypothesis = {hid: metrics([r for r in rows if r['hid'] == hid]) for hid in sorted({r['hid'] for r in rows})}
    gate = {
        'accuracy_min': 0.90,
        'macro_f1_min': 0.88,
        'false_grounding_max': 0.02,
        'evidence_recall_min': 0.85,
    }
    gate['pass'] = (
        overall['accuracy'] >= gate['accuracy_min'] and
        overall['macro_f1'] >= gate['macro_f1_min'] and
        overall['false_grounding_notmentioned'] <= gate['false_grounding_max'] and
        overall['selected_evidence_exact_span_recall'] >= gate['evidence_recall_min']
    )

    rep = {
        'schema': 'musitu.revenueguard.contractnli.test_seal.v1',
        'status': 'SEMANTIC_TEST_GATE_PASS' if gate['pass'] else 'SEMANTIC_TEST_GATE_FAIL',
        'certification_scope': 'ContractNLI semantic seal only; this result alone is not RevenueGuard frontier certification.',
        'candidate_freeze_report_sha256': freeze['report_sha256'],
        'source_dev_report_sha256': cand['source_dev_report_sha256'],
        'mode': cand['mode'],
        'checkpoint_run_id': cand['checkpoint_run_id'],
        'checkpoint_artifact_name': cand['checkpoint_artifact_name'],
        'checkpoint_artifact_sha256': cand['checkpoint_artifact_sha256'],
        'global_training_steps': cand['global_training_steps'],
        'completed_chunks': cand['completed_chunks'],
        'frozen_k': cand['chosen_k'],
        'frozen_threshold': cand['chosen_threshold'],
        'test_policy': 'One-time test scoring with checkpoint, K, and threshold frozen before test access; no test-derived selection or retuning.',
        'test_rows': len(rows),
        'test': overall,
        'test_by_hypothesis': by_hypothesis,
        'gate': gate,
        'raw_shard_report_sha256': shard_hashes,
    }
    rep['report_sha256'] = stable_hash(rep)
    Path(args.out).write_text(json.dumps(rep, indent=2, sort_keys=True) + '\n')
    print(json.dumps(rep, indent=2, sort_keys=True))


if __name__ == '__main__':
    main()
