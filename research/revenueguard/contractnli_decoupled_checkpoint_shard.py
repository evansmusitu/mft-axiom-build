#!/usr/bin/env python3
import argparse, hashlib, json, random, re
from pathlib import Path

import numpy as np
import torch
from torch import nn
from transformers import AutoModel, AutoTokenizer

SEED = 928417
LABEL_MAP = {'Contradiction': 0, 'Entailment': 1, 'NotMentioned': 2}
KS = (24, 32)
EXPECTED_GLOBAL_STEPS = 615
EXPECTED_TRAINABLE_COUNT = 68
EXPECTED_TRAINABLE_NAMES_SHA256 = 'a858e138760588bdb8c89cb440e75a0f9441d23f7a3a9993a1755a3dc8f77c05'
EXPECTED_TRAINABLE_SHAPES_SHA256 = '185cd8b4100f27950ebc20206ccf407a01d2694f8e2a6f6fa8fe6d4f04250b27'
EXPECTED_DUPLICATE_CAL_DOCS = ['548']


def words(s):
    return set(re.findall(r'[a-z0-9]+', s.lower()))


def overlap(a, b):
    A, B = words(a), words(b)
    return len(A & B) / (len(A | B) or 1)


def partition(d):
    return 'cal' if int(hashlib.sha256(str(d['id']).encode()).hexdigest()[:8], 16) % 10 == 0 else 'build'


def shard_for(corpus, doc_id, n):
    return int(hashlib.sha256(f'musitu-contractnli-decoupled-eval-v1|{corpus}|{doc_id}'.encode()).hexdigest()[:8], 16) % n


def normalize_doc(s):
    return re.sub(r'\s+', ' ', s).strip().lower()


def doc_hash(d):
    return hashlib.sha256(normalize_doc(d['text']).encode()).hexdigest()


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
    ap.add_argument('--train-json', required=True)
    ap.add_argument('--dev-json', required=True)
    ap.add_argument('--shard-index', type=int, required=True)
    ap.add_argument('--num-shards', type=int, required=True)
    ap.add_argument('--out', required=True)
    args = ap.parse_args()
    if not (0 <= args.shard_index < args.num_shards):
        raise SystemExit('bad shard')

    random.seed(SEED)
    np.random.seed(SEED)
    torch.manual_seed(SEED)
    torch.set_num_threads(2)

    src = Path(args.encoder)
    tok = AutoTokenizer.from_pretrained(src, local_files_only=True)
    enc = AutoModel.from_pretrained(src, local_files_only=True)
    H = enc.config.hidden_size

    class Decoupled(nn.Module):
        def __init__(self, encoder):
            super().__init__()
            self.encoder = encoder
            self.drop = nn.Dropout(.1)
            self.relevance_head = nn.Linear(H, 2)
            self.semantic_head = nn.Linear(H, 2)
        def forward(self, **kw):
            o = self.encoder(**kw, return_dict=True)
            h = self.drop(o.last_hidden_state[:, 0, :])
            return self.relevance_head(h), self.semantic_head(h)

    model = Decoupled(enc)
    st = torch.load(args.state, map_location='cpu', weights_only=False)
    if st.get('schema') != 'musitu.revenueguard.contractnli.decoupled_chunk_state.v1':
        raise SystemExit('bad state schema')
    if st.get('mode') != 'decoupled' or st.get('num_chunks') != 4 or st.get('next_chunk') != 4 or int(st.get('global_steps', -1)) != EXPECTED_GLOBAL_STEPS:
        raise SystemExit('not an exact complete four-chunk decoupled checkpoint')

    state_keys = sorted(st.get('trainable_state') or {})
    if len(state_keys) != EXPECTED_TRAINABLE_COUNT:
        raise SystemExit(f'trainable tensor count drift {len(state_keys)}')
    names_sha = hashlib.sha256(json.dumps(state_keys, separators=(',', ':')).encode()).hexdigest()
    shapes = {k: list(st['trainable_state'][k].shape) for k in state_keys}
    shapes_sha = hashlib.sha256(json.dumps(shapes, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    if names_sha != EXPECTED_TRAINABLE_NAMES_SHA256:
        raise SystemExit(f'trainable name fingerprint drift {names_sha}')
    if shapes_sha != EXPECTED_TRAINABLE_SHAPES_SHA256:
        raise SystemExit(f'trainable shape fingerprint drift {shapes_sha}')
    layer_counts = {i: sum(k.startswith(f'encoder.encoder.layer.{i}.') for k in state_keys) for i in range(6)}
    if layer_counts != {0: 0, 1: 0, 2: 16, 3: 16, 4: 16, 5: 16}:
        raise SystemExit(f'unfrozen layer tensor drift {layer_counts}')

    missing, unexpected = model.load_state_dict(st['trainable_state'], strict=False)
    if unexpected:
        raise SystemExit(f'unexpected state keys {unexpected}')
    required = {'relevance_head.weight', 'relevance_head.bias', 'semantic_head.weight', 'semantic_head.bias'}
    if not required.issubset(set(state_keys)):
        raise SystemExit('missing trained decoupled heads')
    model.eval()

    train_obj = json.load(open(args.train_json))
    build_hashes = {doc_hash(d) for d in train_obj['documents'] if partition(d) == 'build'}
    excluded_cal_docs = sorted(str(d['id']) for d in train_obj['documents'] if partition(d) == 'cal' and doc_hash(d) in build_hashes)
    if excluded_cal_docs != EXPECTED_DUPLICATE_CAL_DOCS:
        raise SystemExit(f'duplicate-clean calibration identity drift {excluded_cal_docs}')

    @torch.inference_mode()
    def score_one(spans, hypothesis):
        ranked = sorted(((overlap(s, hypothesis), i) for i, s in enumerate(spans)), reverse=True)[:32]
        if not ranked:
            return {str(k): {'score': 0.0, 'candidate_label': 2, 'best_span_index': None, 'semantic_confidence': 0.0} for k in KS}
        segs = [target_context(spans, i) for _, i in ranked]
        relp, semp = [], []
        for z in range(0, len(segs), 64):
            batch = segs[z:z+64]
            e = tok(batch, [hypothesis] * len(batch), padding=True, truncation=True, max_length=256, return_tensors='pt')
            lr, ls = model(**e)
            relp.extend(torch.softmax(lr, -1)[:, 1].tolist())
            semp.extend(torch.softmax(ls, -1).tolist())
        out = {}
        for k in KS:
            best = max(range(min(k, len(ranked))), key=lambda j: relp[j])
            sp = semp[best]
            label = 0 if sp[0] >= sp[1] else 1
            out[str(k)] = {'score': relp[best], 'candidate_label': label, 'best_span_index': ranked[best][1], 'semantic_confidence': max(sp)}
        return out

    rows = []
    for corpus, obj in [('train', train_obj), ('dev', json.load(open(args.dev_json)))]:
        labels = obj['labels']
        for d in obj['documents']:
            if corpus == 'train' and (partition(d) != 'cal' or doc_hash(d) in build_hashes):
                continue
            if shard_for(corpus, str(d['id']), args.num_shards) != args.shard_index:
                continue
            spans = span_texts(d)
            anns = d['annotation_sets'][0]['annotations']
            for hid in sorted(labels):
                a = anns[hid]
                rows.append({'corpus': corpus, 'doc': str(d['id']), 'hid': hid, 'gold': LABEL_MAP[a['choice']], 'gold_spans': a.get('spans') or [], 'scores': score_one(spans, labels[hid]['hypothesis'])})

    rep = {
        'schema': 'musitu.revenueguard.contractnli.decoupled_raw_shard.v2',
        'status': 'DEV_RESEARCH_ONLY',
        'mode': 'decoupled',
        'global_training_steps': st['global_steps'],
        'next_chunk': st['next_chunk'],
        'trainable_tensor_count': len(state_keys),
        'trainable_names_sha256': names_sha,
        'trainable_shapes_sha256': shapes_sha,
        'shard_index': args.shard_index,
        'num_shards': args.num_shards,
        'calibration_exclusion_rule': 'Exclude any hash-held calibration document whose normalized full text SHA-256 appears in the training build partition.',
        'excluded_calibration_doc_ids': excluded_cal_docs,
        'row_count': len(rows),
        'rows': rows,
    }
    rep['report_sha256'] = hashlib.sha256(json.dumps(rep, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    Path(args.out).write_text(json.dumps(rep, separators=(',', ':')) + '\n')
    print(json.dumps({k: v for k, v in rep.items() if k != 'rows'}, indent=2, sort_keys=True))


if __name__ == '__main__':
    main()
