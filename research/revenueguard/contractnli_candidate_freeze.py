#!/usr/bin/env python3
import argparse
import hashlib
import json
from pathlib import Path

EXPECTED_SCHEMA = 'musitu.revenueguard.contractnli.checkpoint_eval.v2'
EXPECTED_STEPS = 615
EXPECTED_CHUNKS = 8
VALID_K = {24, 32}
VALID_THRESHOLDS = {0.10,0.15,0.20,0.25,0.30,0.35,0.40,0.45,0.50,0.55,0.60,0.65,0.70,0.75,0.80,0.85,0.90}
CHECKPOINTS = {
    'control': {
        'run_id': 34697863465,
        'artifact_name': 'revenueguard-contractnli-control-epoch1-final',
    },
    'balanced': {
        'run_id': 34697878064,
        'artifact_name': 'revenueguard-contractnli-balanced-epoch1-final',
    },
}

def stable_hash(obj):
    return hashlib.sha256(json.dumps(obj, sort_keys=True, separators=(',', ':')).encode()).hexdigest()

def load_report(path, expected_mode):
    obj = json.load(open(path))
    if obj.get('schema') != EXPECTED_SCHEMA:
        raise SystemExit(f'{path}: unexpected schema {obj.get("schema")}')
    if obj.get('mode') != expected_mode:
        raise SystemExit(f'{path}: expected mode {expected_mode}, got {obj.get("mode")}')
    if obj.get('global_training_steps') != EXPECTED_STEPS:
        raise SystemExit(f'{path}: expected {EXPECTED_STEPS} steps')
    if obj.get('completed_chunks') != EXPECTED_CHUNKS:
        raise SystemExit(f'{path}: expected {EXPECTED_CHUNKS} completed chunks')
    if obj.get('chosen_k') not in VALID_K:
        raise SystemExit(f'{path}: invalid chosen_k {obj.get("chosen_k")}')
    if float(obj.get('chosen_threshold')) not in VALID_THRESHOLDS:
        raise SystemExit(f'{path}: invalid chosen_threshold {obj.get("chosen_threshold")}')
    gate = obj.get('gate') or {}
    dev = obj.get('dev') or {}
    required_gate = {
        'accuracy_min': 0.90,
        'macro_f1_min': 0.88,
        'false_grounding_max': 0.02,
        'evidence_recall_min': 0.85,
    }
    for key, value in required_gate.items():
        if float(gate.get(key, -1)) != value:
            raise SystemExit(f'{path}: gate definition drift at {key}')
    required_metrics = ['accuracy','macro_f1','false_grounding_notmentioned','selected_evidence_exact_span_recall','positive_semantic_accuracy','n']
    if any(k not in dev for k in required_metrics):
        raise SystemExit(f'{path}: incomplete dev metrics')
    recomputed = (
        dev['accuracy'] >= required_gate['accuracy_min'] and
        dev['macro_f1'] >= required_gate['macro_f1_min'] and
        dev['false_grounding_notmentioned'] <= required_gate['false_grounding_max'] and
        dev['selected_evidence_exact_span_recall'] >= required_gate['evidence_recall_min']
    )
    if bool(gate.get('pass')) != bool(recomputed):
        raise SystemExit(f'{path}: gate pass flag does not recompute')
    return obj

def rank_key(obj):
    # Preregistered before final aggregate inspection. Development-only model selection.
    # No test information participates in this ordering.
    d = obj['dev']
    return (
        float(d['macro_f1']),
        float(d['accuracy']),
        float(d['selected_evidence_exact_span_recall']),
        -float(d['false_grounding_notmentioned']),
        float(d['positive_semantic_accuracy']),
        1 if obj['mode'] == 'balanced' else 0,
    )

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--control', required=True)
    ap.add_argument('--balanced', required=True)
    ap.add_argument('--out', required=True)
    args = ap.parse_args()

    reports = [
        load_report(args.control, 'control'),
        load_report(args.balanced, 'balanced'),
    ]
    if reports[0]['dev_rows'] != reports[1]['dev_rows']:
        raise SystemExit('matched-arm dev row count mismatch')
    if reports[0]['calibration_rows'] != reports[1]['calibration_rows']:
        raise SystemExit('matched-arm calibration row count mismatch')

    eligible = [r for r in reports if r['gate']['pass']]
    base = {
        'schema': 'musitu.revenueguard.contractnli.candidate_freeze.v1',
        'status': 'DEV_GATE_FAILED_NO_TEST' if not eligible else 'CANDIDATE_FROZEN_FOR_ONE_TIME_TEST',
        'selection_scope': 'matched development evidence only; ContractNLI test remains unopened until this file is committed',
        'selection_rule': 'Among development-gate-passing arms only, maximize macro-F1, then accuracy, then exact evidence-span recall, then minimize NotMentioned false grounding, then maximize positive semantic accuracy; balanced wins only an exact residual tie.',
        'required_dev_gate': {
            'accuracy_min': 0.90,
            'macro_f1_min': 0.88,
            'false_grounding_max': 0.02,
            'evidence_recall_min': 0.85,
        },
        'control_report_sha256': reports[0]['report_sha256'],
        'balanced_report_sha256': reports[1]['report_sha256'],
        'control_gate_pass': bool(reports[0]['gate']['pass']),
        'balanced_gate_pass': bool(reports[1]['gate']['pass']),
        'control_dev': reports[0]['dev'],
        'balanced_dev': reports[1]['dev'],
    }
    if eligible:
        chosen = max(eligible, key=rank_key)
        cp = CHECKPOINTS[chosen['mode']]
        base['candidate'] = {
            'mode': chosen['mode'],
            'checkpoint_run_id': cp['run_id'],
            'checkpoint_artifact_name': cp['artifact_name'],
            'checkpoint_artifact_sha256': chosen['checkpoint_artifact_sha256'],
            'global_training_steps': chosen['global_training_steps'],
            'completed_chunks': chosen['completed_chunks'],
            'chosen_k': chosen['chosen_k'],
            'chosen_threshold': chosen['chosen_threshold'],
            'source_dev_report_sha256': chosen['report_sha256'],
        }
        base['test_policy'] = 'Open ContractNLI test exactly once using this frozen checkpoint, K, and threshold. No test-time retuning, candidate switching, or threshold selection is permitted.'
    else:
        base['candidate'] = None
        base['test_policy'] = 'Do not open ContractNLI test. Mine development failures and train a new candidate using build-only evidence.'

    base['report_sha256'] = stable_hash(base)
    Path(args.out).write_text(json.dumps(base, indent=2, sort_keys=True) + '\n')
    print(json.dumps(base, indent=2, sort_keys=True))

if __name__ == '__main__':
    main()
