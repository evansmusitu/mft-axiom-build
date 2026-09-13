#!/usr/bin/env python3
import argparse, hashlib, json
from pathlib import Path
from sklearn.metrics import f1_score

THRESHOLDS = [x / 100 for x in range(5, 96)]
KS = (24, 32)
EXPECTED_GLOBAL_STEPS = 615
EXPECTED_EXCLUDED_DUPLICATE_CAL_DOCS = ('548',)


def apply(rows, k, th):
    out = []
    for r in rows:
        s = r['scores'][str(k)]
        out.append({**r, 'pred': s['candidate_label'] if s['score'] >= th else 2, 'best_span_index': s['best_span_index']})
    return out


def dev_metrics(rows):
    y = [r['gold'] for r in rows]
    p = [r['pred'] for r in rows]
    if not y:
        return {'accuracy': 0.0, 'macro_f1': 0.0, 'false_grounding_notmentioned': 0.0, 'positive_semantic_accuracy': 0.0, 'selected_evidence_exact_span_recall': 0.0, 'n': 0}
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


def relevance_calibration_metrics(rows, k, th):
    """Calibration contract: semantic polarity is deliberately absent.

    Gold is only mentioned (Contradiction or Entailment) vs NotMentioned.
    Prediction is only whether the relevance score crosses the threshold.
    Evidence exact-span recall is a selector diagnostic and does not inspect
    the semantic head's candidate label.
    """
    if not rows:
        return {
            'relevance_detection_f1': 0.0,
            'relevance_accuracy': 0.0,
            'false_grounding_notmentioned': 0.0,
            'positive_relevance_recall': 0.0,
            'selected_evidence_exact_span_recall': 0.0,
            'n': 0,
        }
    gold_relevant = [r['gold'] != 2 for r in rows]
    pred_relevant = [float(r['scores'][str(k)]['score']) >= th for r in rows]
    nm = [i for i, v in enumerate(gold_relevant) if not v]
    pos = [i for i, v in enumerate(gold_relevant) if v]
    evhit = sum(r['scores'][str(k)]['best_span_index'] in r['gold_spans'] for r in (rows[i] for i in pos)) / (len(pos) or 1)
    return {
        'relevance_detection_f1': float(f1_score(gold_relevant, pred_relevant, pos_label=True, zero_division=0)),
        'relevance_accuracy': sum(a == b for a, b in zip(gold_relevant, pred_relevant)) / len(rows),
        'false_grounding_notmentioned': sum(pred_relevant[i] for i in nm) / (len(nm) or 1),
        'positive_relevance_recall': sum(pred_relevant[i] for i in pos) / (len(pos) or 1),
        'selected_evidence_exact_span_recall': evhit,
        'n': len(rows),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--shard-glob', required=True)
    ap.add_argument('--expected-shards', type=int, default=8)
    ap.add_argument('--checkpoint-artifact-sha256', required=True)
    ap.add_argument('--out', required=True)
    args = ap.parse_args()
    if len(args.checkpoint_artifact_sha256) != 64:
        raise SystemExit('bad checkpoint artifact digest')

    files = sorted(Path('.').glob(args.shard_glob))
    if len(files) != args.expected_shards:
        raise SystemExit(f'expected {args.expected_shards} shards got {len(files)}')
    rows, seen = [], set()
    seen_shards, steps, next_chunks, exclusion_sets = set(), set(), set(), set()
    for f in files:
        o = json.load(open(f))
        if o.get('schema') != 'musitu.revenueguard.contractnli.decoupled_raw_shard.v1':
            raise SystemExit(f'bad schema {f}')
        if o.get('mode') != 'decoupled' or o['num_shards'] != args.expected_shards:
            raise SystemExit(f'metadata mismatch {f}')
        si = int(o['shard_index'])
        if si in seen_shards:
            raise SystemExit(f'duplicate shard {si}')
        seen_shards.add(si)
        steps.add(int(o['global_training_steps']))
        next_chunks.add(int(o['next_chunk']))
        exclusion_sets.add(tuple(o.get('excluded_calibration_doc_ids', [])))
        for r in o['rows']:
            key = (r['corpus'], r['doc'], r['hid'])
            if key in seen:
                raise SystemExit(f'duplicate {key}')
            seen.add(key)
            rows.append(r)
    if seen_shards != set(range(args.expected_shards)):
        raise SystemExit('missing shards')
    if steps != {EXPECTED_GLOBAL_STEPS} or next_chunks != {4}:
        raise SystemExit(f'checkpoint identity mismatch steps={steps} next_chunks={next_chunks}')
    if len(exclusion_sets) != 1:
        raise SystemExit('calibration exclusion mismatch')
    excluded = tuple(next(iter(exclusion_sets)))
    if excluded != EXPECTED_EXCLUDED_DUPLICATE_CAL_DOCS:
        raise SystemExit(f'duplicate-clean calibration identity drift: {excluded}')

    cal = [r for r in rows if r['corpus'] == 'train']
    dev = [r for r in rows if r['corpus'] == 'dev']
    if not cal or not dev:
        raise SystemExit('missing calibration or dev rows')
    if any(r['doc'] in excluded for r in cal):
        raise SystemExit('excluded calibration document leaked')

    settings = []
    for k in KS:
        best = None
        for th in THRESHOLDS:
            m = relevance_calibration_metrics(cal, k, th)
            key = (
                m['false_grounding_notmentioned'] <= .02,
                m['relevance_detection_f1'],
                m['positive_relevance_recall'],
                m['relevance_accuracy'],
                m['selected_evidence_exact_span_recall'],
                -m['false_grounding_notmentioned'],
                -th,
            )
            if best is None or key > best[0]:
                best = (key, th, m)
        _, th, cm = best
        settings.append({'k': k, 'threshold': th, 'calibration_relevance_only': cm})

    def setting_key(x):
        m = x['calibration_relevance_only']
        return (
            m['false_grounding_notmentioned'] <= .02,
            m['relevance_detection_f1'],
            m['positive_relevance_recall'],
            m['relevance_accuracy'],
            m['selected_evidence_exact_span_recall'],
            -m['false_grounding_notmentioned'],
            -x['k'],
            -x['threshold'],
        )

    chosen = max(settings, key=setting_key)
    devrows = apply(dev, chosen['k'], chosen['threshold'])
    dm = dev_metrics(devrows)
    by = {hid: dev_metrics([r for r in devrows if r['hid'] == hid]) for hid in sorted({r['hid'] for r in devrows})}
    gate = {'accuracy_min': .90, 'macro_f1_min': .88, 'false_grounding_max': .02, 'evidence_recall_min': .85}
    gate['pass'] = (
        dm['accuracy'] >= gate['accuracy_min'] and
        dm['macro_f1'] >= gate['macro_f1_min'] and
        dm['false_grounding_notmentioned'] <= gate['false_grounding_max'] and
        dm['selected_evidence_exact_span_recall'] >= gate['evidence_recall_min']
    )

    rep = {
        'schema': 'musitu.revenueguard.contractnli.decoupled_checkpoint_eval.v2',
        'status': 'DEV_RESEARCH_ONLY',
        'mode': 'decoupled',
        'checkpoint_artifact_sha256': args.checkpoint_artifact_sha256,
        'global_training_steps': EXPECTED_GLOBAL_STEPS,
        'completed_chunks': 4,
        'calibration_rows': len(cal),
        'excluded_duplicate_equivalent_calibration_doc_ids': list(excluded),
        'dev_rows': len(dev),
        'candidate_settings': settings,
        'chosen_k': chosen['k'],
        'chosen_threshold': chosen['threshold'],
        'calibration_contract': 'K and abstention threshold are selected exclusively from relevance/evidence information on duplicate-clean hash-held training calibration documents. Contradiction-vs-Entailment semantic-head labels or correctness do not participate in selection.',
        'selection_rule': 'First require NotMentioned false grounding <=2% when attainable; then maximize binary relevance F1, positive relevance recall, relevance accuracy, exact evidence-span recall; residual ties prefer lower K then lower threshold. Only after this freeze is the exposed dev scored with the unchanged three-class gate.',
        'dev': dm,
        'dev_by_hypothesis': by,
        'gate': gate,
    }
    rep['report_sha256'] = hashlib.sha256(json.dumps(rep, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    Path(args.out).write_text(json.dumps(rep, indent=2, sort_keys=True) + '\n')
    print(json.dumps(rep, indent=2, sort_keys=True))


if __name__ == '__main__':
    main()
