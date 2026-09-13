#!/usr/bin/env python3
import argparse, hashlib, json
from pathlib import Path
import torch
from torch import nn
from transformers import AutoTokenizer, AutoModelForQuestionAnswering
from cuad_heldout_eval import (
    MAX_LEN, STRIDE, MAX_ANSWER_TOKENS, TOP_TOKEN_CANDIDATES,
    primary_dev, secondary_split, score_question,
)


def shard_for(title: str, qa_id: str, n: int) -> int:
    # Execution-only partition. The heldout set and calibration/evaluation split remain title-bound.
    h = hashlib.sha256((f'musitu-cuad-question-shard-v1|{title}|{qa_id}').encode()).hexdigest()
    return int(h[:8], 16) % n


@torch.inference_mode()
def score_question_multitask(model, answer_head, tok, question, context):
    """Use the trained explicit answerability head to select a window, then the QA head to localize within it.

    The locked heldout split and downstream threshold/gate are unchanged.  Only the candidate's
    preregistered explicit answerability signal replaces the epoch-1 span-null confidence signal.
    """
    enc = tok(
        question, context,
        truncation='only_second', max_length=MAX_LEN, stride=STRIDE,
        return_overflowing_tokens=True, return_offsets_mapping=True,
        padding='max_length', return_tensors='pt',
    )
    offsets = enc.pop('offset_mapping')
    enc.pop('overflow_to_sample_mapping', None)
    n = enc['input_ids'].shape[0]
    best_conf = -1e30
    best_span_score = -1e30
    best_text = ''
    best_chars = (None, None)

    for lo in range(0, n, 24):
        hi = min(n, lo + 24)
        batch = {k: v[lo:hi] for k, v in enc.items()}
        out = model(**batch, output_hidden_states=True, return_dict=True)
        ans_logits = answer_head(out.hidden_states[-1][:, 0, :])
        margins = ans_logits[:, 1] - ans_logits[:, 0]

        for local_i in range(hi - lo):
            fi = lo + local_i
            seq = enc.sequence_ids(fi)
            valid = [
                j for j, x in enumerate(seq)
                if x == 1 and int(offsets[fi, j, 1]) > int(offsets[fi, j, 0])
            ]
            if not valid:
                continue
            valid_set = set(valid)
            s_logits = out.start_logits[local_i]
            e_logits = out.end_logits[local_i]
            sk = torch.topk(s_logits, min(TOP_TOKEN_CANDIDATES, s_logits.numel())).indices.tolist()
            ek = torch.topk(e_logits, min(TOP_TOKEN_CANDIDATES, e_logits.numel())).indices.tolist()
            window_span_score = -1e30
            window_text = ''
            window_chars = (None, None)
            for st in sk:
                if st not in valid_set:
                    continue
                for en in ek:
                    if en not in valid_set or en < st or en - st + 1 > MAX_ANSWER_TOKENS:
                        continue
                    a = int(offsets[fi, st, 0])
                    b = int(offsets[fi, en, 1])
                    if b <= a:
                        continue
                    span_score = float(s_logits[st] + e_logits[en])
                    if span_score > window_span_score:
                        window_span_score = span_score
                        window_text = context[a:b]
                        window_chars = (a, b)

            conf = float(margins[local_i])
            if conf > best_conf or (conf == best_conf and window_span_score > best_span_score):
                best_conf = conf
                best_span_score = window_span_score
                best_text = window_text
                best_chars = window_chars

    return {
        'confidence': best_conf,
        'text': best_text,
        'char_start': best_chars[0],
        'char_end': best_chars[1],
        'window_count': n,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', required=True)
    ap.add_argument('--answer-head')
    ap.add_argument('--train-json', required=True)
    ap.add_argument('--shard-index', type=int, required=True)
    ap.add_argument('--num-shards', type=int, required=True)
    ap.add_argument('--out', required=True)
    args = ap.parse_args()
    if not (0 <= args.shard_index < args.num_shards):
        raise SystemExit('bad shard')

    torch.set_num_threads(2)
    model_path = Path(args.model)
    tok = AutoTokenizer.from_pretrained(model_path, local_files_only=True, use_fast=True)
    model = AutoModelForQuestionAnswering.from_pretrained(model_path, local_files_only=True)
    model.eval()

    answer_head = None
    scoring_mode = 'legacy_span_null_confidence'
    if args.answer_head:
        answer_head = nn.Linear(model.config.hidden_size, 2)
        state = torch.load(args.answer_head, map_location='cpu', weights_only=True)
        answer_head.load_state_dict(state)
        answer_head.eval()
        scoring_mode = 'explicit_answerability_margin_with_bound_span_localization'

    raw = json.load(open(args.train_json))['data']
    rows = []
    titles = set()
    for contract in raw:
        title = contract.get('title', '')
        if not primary_dev(title):
            continue
        split = secondary_split(title)
        for para in contract['paragraphs']:
            ctx = para['context']
            for qa in para['qas']:
                qid = str(qa['id'])
                if shard_for(title, qid, args.num_shards) != args.shard_index:
                    continue
                titles.add(title)
                answers = qa.get('answers', []) or []
                if answer_head is None:
                    scored = score_question(model, tok, qa['question'], ctx)
                else:
                    scored = score_question_multitask(model, answer_head, tok, qa['question'], ctx)
                rows.append({
                    'title': title,
                    'split': split,
                    'id': qa['id'],
                    'has_answer': bool(answers),
                    'gold_texts': [a['text'] for a in answers],
                    'gold_spans': [(a['answer_start'], a['answer_start'] + len(a['text'])) for a in answers],
                    **scored,
                })

    # Deliberately retain the raw-shard schema consumed by the frozen heldout aggregator.
    rep = {
        'schema': 'musitu.revenueguard.cuad.heldout_raw_shard.v1',
        'status': 'DEV_RESEARCH_ONLY',
        'execution_partition': 'question_hash_v1',
        'scoring_mode': scoring_mode,
        'shard_index': args.shard_index,
        'num_shards': args.num_shards,
        'title_count': len(titles),
        'row_count': len(rows),
        'rows': rows,
    }
    rep['report_sha256'] = hashlib.sha256(json.dumps(rep, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    Path(args.out).write_text(json.dumps(rep, separators=(',', ':')) + '\n')
    print(json.dumps({k: v for k, v in rep.items() if k != 'rows'}, indent=2, sort_keys=True))


if __name__ == '__main__':
    main()
