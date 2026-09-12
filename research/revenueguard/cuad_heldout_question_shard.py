#!/usr/bin/env python3
import argparse, hashlib, json
from pathlib import Path
import torch
from transformers import AutoTokenizer, AutoModelForQuestionAnswering
from cuad_heldout_eval import primary_dev, secondary_split, score_question


def shard_for(title: str, qa_id: str, n: int) -> int:
    # Execution-only partition. The heldout set and calibration/evaluation split remain title-bound.
    h = hashlib.sha256((f'musitu-cuad-question-shard-v1|{title}|{qa_id}').encode()).hexdigest()
    return int(h[:8], 16) % n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', required=True)
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
                scored = score_question(model, tok, qa['question'], ctx)
                rows.append({
                    'title': title,
                    'split': split,
                    'id': qa['id'],
                    'has_answer': bool(answers),
                    'gold_texts': [a['text'] for a in answers],
                    'gold_spans': [(a['answer_start'], a['answer_start'] + len(a['text'])) for a in answers],
                    **scored,
                })

    # Deliberately emit the same raw-shard schema consumed by the frozen aggregator.
    rep = {
        'schema': 'musitu.revenueguard.cuad.heldout_raw_shard.v1',
        'status': 'DEV_RESEARCH_ONLY',
        'execution_partition': 'question_hash_v1',
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
