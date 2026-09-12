#!/usr/bin/env python3
import argparse, hashlib, json, math, random, re, time
from collections import Counter
from pathlib import Path

import numpy as np
import torch
from torch import nn
from torch.utils.data import DataLoader, Dataset
from transformers import AutoModel, AutoTokenizer

SEED = 928417
BATCH = 48
LABEL_MAP = {'Contradiction': 0, 'Entailment': 1, 'NotMentioned': 2}


def words(s):
    return set(re.findall(r'[a-z0-9]+', s.lower()))


def overlap(a, b):
    A, B = words(a), words(b)
    return len(A & B) / (len(A | B) or 1)


def partition(d):
    return 'cal' if int(hashlib.sha256(str(d['id']).encode()).hexdigest()[:8], 16) % 10 == 0 else 'build'


def span_texts(d):
    return [d['text'][a:b].strip() for a, b in d['spans']]


def target_context(spans, i, radius=2):
    left = ' '.join(spans[max(0, i-radius):i])
    right = ' '.join(spans[i+1:min(len(spans), i+radius+1)])
    return ('TARGET SPAN:\n' + spans[i] + '\nSURROUNDING CONTEXT:\n' + left + ' ' + right)[:5000]


def build_samples(obj):
    labels = obj['labels']
    rows = []
    for d in obj['documents']:
        if partition(d) != 'build':
            continue
        spans = span_texts(d)
        anns = d['annotation_sets'][0]['annotations']
        for hid in sorted(labels):
            h = labels[hid]['hypothesis']
            a = anns[hid]
            gold = LABEL_MAP[a['choice']]
            ev = sorted(set(a.get('spans') or []))

            # Genuine evidence is the only source of semantic supervision.
            if gold != 2:
                for i in ev[:4]:
                    if i < len(spans):
                        rows.append((target_context(spans, i), h, 1, gold))

            # Relevance negatives are lexically hard, but they never teach a semantic label.
            negatives = sorted(
                ((overlap(s, h), i) for i, s in enumerate(spans) if i not in set(ev)),
                reverse=True,
            )
            take = 4 if gold == 2 else 3
            for _, i in negatives[:take]:
                rows.append((target_context(spans, i), h, 0, -100))
    return rows


class DS(Dataset):
    def __init__(self, rows):
        self.rows = rows
    def __len__(self):
        return len(self.rows)
    def __getitem__(self, i):
        return self.rows[i]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--encoder', required=True)
    ap.add_argument('--train-json', required=True)
    ap.add_argument('--chunk-index', type=int, required=True)
    ap.add_argument('--num-chunks', type=int, default=4)
    ap.add_argument('--state-in')
    ap.add_argument('--state-out', required=True)
    ap.add_argument('--report', required=True)
    args = ap.parse_args()
    if not (0 <= args.chunk_index < args.num_chunks):
        raise SystemExit('bad chunk')

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
    for p in model.encoder.parameters():
        p.requires_grad = False
    core = getattr(model.encoder, 'encoder', None)
    if core is None and hasattr(model.encoder, 'bert'):
        core = model.encoder.bert.encoder
    layers = getattr(core, 'layer', None) if core is not None else None
    if layers is None:
        raise RuntimeError(type(model.encoder))
    # Retrieval is the hard bottleneck; expose more capacity than epoch1's final two layers.
    for layer in layers[-4:]:
        for p in layer.parameters():
            p.requires_grad = True

    trainable_names = {n for n, p in model.named_parameters() if p.requires_grad}
    params = [p for p in model.parameters() if p.requires_grad]

    train_obj = json.load(open(args.train_json))
    rows_all = build_samples(train_obj)
    n = len(rows_all)
    rel_counts = Counter(r[2] for r in rows_all)
    sem_counts = Counter(r[3] for r in rows_all if r[3] >= 0)
    if not rel_counts[0] or not rel_counts[1] or not sem_counts[0] or not sem_counts[1]:
        raise SystemExit('incomplete training classes')

    rw = np.array([math.sqrt(n / (2 * rel_counts[i])) for i in range(2)], dtype=np.float32)
    rw = rw / rw.mean()
    spos = sum(sem_counts.values())
    sw = np.array([math.sqrt(spos / (2 * sem_counts[i])) for i in range(2)], dtype=np.float32)
    sw = sw / sw.mean()
    rel_ce = nn.CrossEntropyLoss(weight=torch.tensor(rw))
    sem_ce = nn.CrossEntropyLoss(weight=torch.tensor(sw))

    opt = torch.optim.AdamW(params, lr=1.5e-5, weight_decay=.01)
    cumulative_loss = 0.0
    cumulative_rel_loss = 0.0
    cumulative_sem_loss = 0.0
    global_steps = 0

    if args.state_in:
        st = torch.load(args.state_in, map_location='cpu', weights_only=False)
        if st.get('schema') != 'musitu.revenueguard.contractnli.decoupled_chunk_state.v1':
            raise SystemExit('bad state schema')
        if st['next_chunk'] != args.chunk_index or st['num_chunks'] != args.num_chunks:
            raise SystemExit('state continuity mismatch')
        model.load_state_dict(st['trainable_state'], strict=False)
        opt.load_state_dict(st['optimizer_state'])
        cumulative_loss = float(st['cumulative_loss'])
        cumulative_rel_loss = float(st['cumulative_rel_loss'])
        cumulative_sem_loss = float(st['cumulative_sem_loss'])
        global_steps = int(st['global_steps'])
        torch.set_rng_state(st['torch_rng_state'])
        random.setstate(st['python_rng_state'])
        np.random.set_state(st['numpy_rng_state'])

    # Fixed epoch order independent of dropout RNG and chunk boundaries.
    g = torch.Generator()
    g.manual_seed(SEED + 19937)
    perm = torch.randperm(n, generator=g).tolist()
    total_steps = math.ceil(n / BATCH)
    start_step = (total_steps * args.chunk_index) // args.num_chunks
    end_step = (total_steps * (args.chunk_index + 1)) // args.num_chunks
    ix = perm[start_step * BATCH:min(end_step * BATCH, n)]
    rows = [rows_all[i] for i in ix]

    def collate(batch):
        e = tok(
            [x[0] for x in batch],
            [x[1] for x in batch],
            padding=True,
            truncation=True,
            max_length=256,
            return_tensors='pt',
        )
        return e, torch.tensor([x[2] for x in batch]), torch.tensor([x[3] for x in batch])

    dl = DataLoader(DS(rows), batch_size=BATCH, shuffle=False, collate_fn=collate, num_workers=0)
    model.train()
    chunk_loss = chunk_rel = chunk_sem = 0.0
    chunk_steps = 0
    t0 = time.time()
    for step, (e, yrel, ysem) in enumerate(dl):
        opt.zero_grad(set_to_none=True)
        lr, ls = model(**e)
        rloss = rel_ce(lr, yrel)
        mask = ysem >= 0
        sloss = sem_ce(ls[mask], ysem[mask]) if mask.any() else lr.sum() * 0.0
        # Relevance gets the larger coefficient because exact evidence recall is the measured bottleneck.
        loss = 1.15 * rloss + sloss
        loss.backward()
        torch.nn.utils.clip_grad_norm_(params, 1.0)
        opt.step()
        v = float(loss.detach())
        rv = float(rloss.detach())
        sv = float(sloss.detach())
        chunk_loss += v
        chunk_rel += rv
        chunk_sem += sv
        cumulative_loss += v
        cumulative_rel_loss += rv
        cumulative_sem_loss += sv
        chunk_steps += 1
        global_steps += 1
        if step and step % 25 == 0:
            print('chunk', args.chunk_index, 'step', step,
                  'loss', round(chunk_loss/chunk_steps, 4),
                  'rel', round(chunk_rel/chunk_steps, 4),
                  'sem', round(chunk_sem/chunk_steps, 4),
                  'elapsed', round(time.time()-t0, 1), flush=True)

    partial = {k: v.detach().cpu() for k, v in model.state_dict().items() if k in trainable_names}
    state = {
        'schema': 'musitu.revenueguard.contractnli.decoupled_chunk_state.v1',
        'mode': 'decoupled',
        'num_chunks': args.num_chunks,
        'next_chunk': args.chunk_index + 1,
        'trainable_state': partial,
        'optimizer_state': opt.state_dict(),
        'cumulative_loss': cumulative_loss,
        'cumulative_rel_loss': cumulative_rel_loss,
        'cumulative_sem_loss': cumulative_sem_loss,
        'global_steps': global_steps,
        'torch_rng_state': torch.get_rng_state(),
        'python_rng_state': random.getstate(),
        'numpy_rng_state': np.random.get_state(),
        'relevance_weights': rw.tolist(),
        'semantic_weights': sw.tolist(),
        'seed': SEED,
    }
    Path(args.state_out).parent.mkdir(parents=True, exist_ok=True)
    torch.save(state, args.state_out)
    state_bytes = Path(args.state_out).read_bytes()

    rep = {
        'schema': 'musitu.revenueguard.contractnli.decoupled_chunk_train.v1',
        'status': 'DEV_RESEARCH_ONLY',
        'mode': 'decoupled',
        'objective': 'separate evidence relevance from positive-only binary semantic polarity; abstention is not a semantic training class',
        'chunk_index': args.chunk_index,
        'num_chunks': args.num_chunks,
        'batch_size': BATCH,
        'full_epoch_samples': n,
        'full_epoch_steps': total_steps,
        'batch_start': start_step,
        'batch_end': end_step,
        'chunk_samples': len(rows),
        'chunk_steps': chunk_steps,
        'chunk_loss': chunk_loss / (chunk_steps or 1),
        'chunk_relevance_loss': chunk_rel / (chunk_steps or 1),
        'chunk_semantic_loss': chunk_sem / (chunk_steps or 1),
        'epoch_running_loss': cumulative_loss / (global_steps or 1),
        'global_steps': global_steps,
        'relevance_counts': dict(rel_counts),
        'semantic_counts': dict(sem_counts),
        'relevance_weights': rw.tolist(),
        'semantic_weights': sw.tolist(),
        'unfrozen_encoder_layers': 4,
        'state_sha256': hashlib.sha256(state_bytes).hexdigest(),
        'execution': 'fixed batch-aligned epoch permutation; optimizer and RNG state preserved across chunks; ContractNLI build partition only',
    }
    rep['report_sha256'] = hashlib.sha256(json.dumps(rep, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    Path(args.report).write_text(json.dumps(rep, indent=2, sort_keys=True) + '\n')
    print(json.dumps(rep, indent=2, sort_keys=True))


if __name__ == '__main__':
    main()
