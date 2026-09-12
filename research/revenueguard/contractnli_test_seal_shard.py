#!/usr/bin/env python3
import argparse
import hashlib
import json
import random
import re
from pathlib import Path

import numpy as np
import torch
from torch import nn
from transformers import AutoModel, AutoTokenizer

SEED = 481928
LABEL_MAP = {'Contradiction': 0, 'Entailment': 1, 'NotMentioned': 2}


def words(s):
    return set(re.findall(r'[a-z0-9]+', s.lower()))


def overlap(a, b):
    A, B = words(a), words(b)
    return len(A & B) / (len(A | B) or 1)


def shard_for(doc_id, n):
    return int(hashlib.sha256(f'musitu-contractnli-test-seal-v1|{doc_id}'.encode()).hexdigest()[:8], 16) % n


def span_texts(d):
    return [d['text'][a:b].strip() for a, b in d['spans']]


def target_context(spans, i, radius=2):
    left = ' '.join(spans[max(0, i-radius):i])
    right = ' '.join(spans[i+1:min(len(spans), i+radius+1)])
    return ('TARGET SPAN:\n' + spans[i] + '\nSURROUNDING CONTEXT:\n' + left + ' ' + right)[:5000]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--encoder', required=True)
    ap.add_argument('--state', required=True)
    ap.add_argument('--test-json', required=True)
    ap.add_argument('--candidate-json', required=True)
    ap.add_argument('--shard-index', type=int, required=True)
    ap.add_argument('--num-shards', type=int, required=True)
    ap.add_argument('--out', required=True)
    args = ap.parse_args()
    if not (0 <= args.shard_index < args.num_shards):
        raise SystemExit('bad shard')

    freeze = json.load(open(args.candidate_json))
    if freeze.get('schema') != 'musitu.revenueguard.contractnli.candidate_freeze.v1':
        raise SystemExit('bad candidate-freeze schema')
    if freeze.get('status') != 'CANDIDATE_FROZEN_FOR_ONE_TIME_TEST' or not freeze.get('candidate'):
        raise SystemExit('candidate is not eligible for test opening')
    cand = freeze['candidate']
    k = int(cand['chosen_k'])
    threshold = float(cand['chosen_threshold'])
    if k not in (24, 32):
        raise SystemExit('candidate K drift')

    random.seed(SEED)
    np.random.seed(SEED)
    torch.manual_seed(SEED)
    torch.set_num_threads(2)

    src = Path(args.encoder)
    tok = AutoTokenizer.from_pretrained(src, local_files_only=True)
    enc = AutoModel.from_pretrained(src, local_files_only=True)
    H = enc.config.hidden_size

    class Joint(nn.Module):
        def __init__(self, encoder):
            super().__init__()
            self.encoder = encoder
            self.drop = nn.Dropout(.1)
            self.class_head = nn.Linear(H, 3)
            self.ev_head = nn.Linear(H, 2)

        def forward(self, **kw):
            o = self.encoder(**kw, return_dict=True)
            h = self.drop(o.last_hidden_state[:, 0, :])
            return self.class_head(h), self.ev_head(h)

    model = Joint(enc)
    st = torch.load(args.state, map_location='cpu', weights_only=False)
    if st.get('schema') != 'musitu.revenueguard.contractnli.chunk_state.v1':
        raise SystemExit('bad checkpoint schema')
    if st.get('mode') != cand['mode']:
        raise SystemExit('checkpoint mode does not match frozen candidate')
    if st.get('next_chunk') != cand['completed_chunks'] or st.get('global_steps') != cand['global_training_steps']:
        raise SystemExit('checkpoint progress does not match frozen candidate')
    missing, unexpected = model.load_state_dict(st['trainable_state'], strict=False)
    if unexpected:
        raise SystemExit(f'unexpected state keys {unexpected}')
    required = {'class_head.weight', 'class_head.bias', 'ev_head.weight', 'ev_head.bias'}
    if not required.issubset(set(st['trainable_state'])):
        raise SystemExit('missing trained heads')
    model.eval()

    obj = json.load(open(args.test_json))
    labs = obj['labels']
    rows = []

    @torch.inference_mode()
    def score_one(spans, hypothesis):
        ranked = sorted(((overlap(s, hypothesis), i) for i, s in enumerate(spans)), reverse=True)[:k]
        if not ranked:
            return {'score': 0.0, 'candidate_label': 2, 'best_span_index': None}
        segs = [target_context(spans, i) for _, i in ranked]
        classp, evp = [], []
        for z in range(0, len(segs), 64):
            batch = segs[z:z+64]
            e = tok(batch, [hypothesis] * len(batch), padding=True, truncation=True, max_length=256, return_tensors='pt')
            lc, le = model(**e)
            classp.extend(torch.softmax(lc, -1).tolist())
            evp.extend(torch.softmax(le, -1)[:, 1].tolist())
        bestc, bestlabel, besti = 0.0, 2, None
        for jj, (cp, ep) in enumerate(zip(classp, evp)):
            for lab in (0, 1):
                score = ep * cp[lab]
                if score > bestc:
                    bestc, bestlabel, besti = score, lab, jj
        return {
            'score': bestc,
            'candidate_label': bestlabel,
            'best_span_index': ranked[besti][1] if besti is not None else None,
        }

    for d in obj['documents']:
        if shard_for(str(d['id']), args.num_shards) != args.shard_index:
            continue
        spans = span_texts(d)
        anns = d['annotation_sets'][0]['annotations']
        for hid in sorted(labs):
            a = anns[hid]
            rows.append({
                'doc': str(d['id']),
                'hid': hid,
                'gold': LABEL_MAP[a['choice']],
                'gold_spans': a.get('spans') or [],
                'score': score_one(spans, labs[hid]['hypothesis']),
            })

    rep = {
        'schema': 'musitu.revenueguard.contractnli.test_raw_shard.v1',
        'status': 'SEALED_TEST_RAW_SCORE',
        'candidate_freeze_report_sha256': freeze['report_sha256'],
        'source_dev_report_sha256': cand['source_dev_report_sha256'],
        'mode': cand['mode'],
        'checkpoint_artifact_sha256': cand['checkpoint_artifact_sha256'],
        'global_training_steps': cand['global_training_steps'],
        'completed_chunks': cand['completed_chunks'],
        'chosen_k': k,
        'chosen_threshold': threshold,
        'shard_index': args.shard_index,
        'num_shards': args.num_shards,
        'row_count': len(rows),
        'rows': rows,
    }
    rep['report_sha256'] = hashlib.sha256(json.dumps(rep, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    Path(args.out).write_text(json.dumps(rep, separators=(',', ':')) + '\n')
    print(json.dumps({k: v for k, v in rep.items() if k != 'rows'}, indent=2, sort_keys=True))


if __name__ == '__main__':
    main()
