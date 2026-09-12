#!/usr/bin/env python3
import argparse, hashlib, json
from collections import Counter
from pathlib import Path
from transformers import AutoTokenizer

MAX_LEN=384
STRIDE=128
CUAD_COMMIT='67faa0e6023b04fcaae6cc09497ab00e5d63a2a2'

def heldout(title):
    return int(hashlib.sha256(title.encode()).hexdigest()[:8],16)%10==0

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--tokenizer',required=True); ap.add_argument('--train-json',required=True); ap.add_argument('--out',required=True); args=ap.parse_args()
    tok=AutoTokenizer.from_pretrained(args.tokenizer,local_files_only=True,use_fast=True)
    train=Path(args.train_json); raw=json.load(open(train))['data']
    c=Counter(); pos_hist=Counter(); neg_hist=Counter(); win_hist=Counter()
    for contract in raw:
        title=contract.get('title','')
        for para in contract['paragraphs']:
            ctx=para['context']
            for qa in para['qas']:
                if heldout(title): c['heldout_questions']+=1; continue
                c['build_questions']+=1
                answers=qa.get('answers',[]) or []
                enc=tok(qa['question'],ctx,truncation='only_second',max_length=MAX_LEN,stride=STRIDE,return_overflowing_tokens=True,return_offsets_mapping=True,padding=False)
                n=len(enc['input_ids']); c['windows_total']+=n; win_hist[str(min(n,20))]+=1
                positives=0
                for fi in range(n):
                    seq=enc.sequence_ids(fi); offs=enc['offset_mapping'][fi]
                    spans=[(int(a),int(b)) for j,(a,b) in enumerate(offs) if seq[j]==1 and b>a]
                    if not spans: continue
                    lo=min(a for a,b in spans); hi=max(b for a,b in spans)
                    if any(int(a['answer_start'])>=lo and int(a['answer_start'])+len(a['text'])<=hi for a in answers): positives+=1
                negatives=n-positives
                pos_hist[str(min(positives,10))]+=1; neg_hist[str(min(negatives,20))]+=1
                c['positive_windows']+=positives; c['negative_windows']+=negatives
                if answers:
                    c['answerable_questions']+=1
                    c['selected_positive_windows']+=positives
                    c['selected_hard_negative_windows']+=min(2,negatives)
                else:
                    c['impossible_questions']+=1
                    c['selected_hard_negative_windows']+=min(3,negatives)
    selected=c['selected_positive_windows']+c['selected_hard_negative_windows']
    rep={'schema':'musitu.revenueguard.cuad.matched_window_geometry_audit.v1','status':'DEV_RESEARCH_ONLY','cuad_commit':CUAD_COMMIT,'train_sha256':hashlib.sha256(train.read_bytes()).hexdigest(),'max_length':MAX_LEN,'stride':STRIDE,'heldout_rule':'sha256(title)[:8] mod 10 == 0 excluded from training','selection_rule':'all answer-containing windows + up to 2 same-question hard-negative windows for answerable questions; up to 3 hard-negative windows for impossible questions','counts':dict(c),'selected_training_windows':selected,'positive_window_histogram_capped10':dict(pos_hist),'negative_window_histogram_capped20':dict(neg_hist),'windows_per_question_histogram_capped20':dict(win_hist)}
    rep['report_sha256']=hashlib.sha256(json.dumps(rep,sort_keys=True,separators=(',',':')).encode()).hexdigest(); Path(args.out).write_text(json.dumps(rep,indent=2,sort_keys=True)+'\n'); print(json.dumps(rep,indent=2,sort_keys=True))
if __name__=='__main__': main()
