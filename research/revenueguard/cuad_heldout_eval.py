#!/usr/bin/env python3
import argparse, hashlib, json, math, re, string
from pathlib import Path
from collections import Counter
import torch
from transformers import AutoTokenizer, AutoModelForQuestionAnswering

MAX_LEN=384
STRIDE=128
MAX_ANSWER_TOKENS=96
TOP_TOKEN_CANDIDATES=20


def primary_dev(title:str)->bool:
    return int(hashlib.sha256(title.encode()).hexdigest()[:8],16)%10==0

def secondary_split(title:str)->str:
    h=hashlib.sha256(('musitu-cuad-heldout-v1|'+title).encode()).hexdigest()
    return 'calibration' if int(h[:8],16)%2==0 else 'evaluation'

def normalize_answer(s:str)->str:
    s=s.lower()
    s=''.join(ch for ch in s if ch not in set(string.punctuation))
    s=re.sub(r'\b(a|an|the)\b',' ',s)
    return ' '.join(s.split())

def token_f1(pred:str,gold:str)->float:
    p=normalize_answer(pred).split(); g=normalize_answer(gold).split()
    if not p and not g:return 1.0
    if not p or not g:return 0.0
    common=Counter(p)&Counter(g); n=sum(common.values())
    if n==0:return 0.0
    precision=n/len(p); recall=n/len(g)
    return 2*precision*recall/(precision+recall)

def exact_match(pred:str,gold:str)->float:
    return float(normalize_answer(pred)==normalize_answer(gold))

def overlap_span(a,b,c,d):
    return max(a,c)<min(b,d)

@torch.inference_mode()
def score_question(model,tok,question,context):
    enc=tok(
        question,context,
        truncation='only_second',max_length=MAX_LEN,stride=STRIDE,
        return_overflowing_tokens=True,return_offsets_mapping=True,
        padding='max_length',return_tensors='pt'
    )
    offsets=enc.pop('offset_mapping')
    n=enc['input_ids'].shape[0]
    best_score=-1e30; best_text=''; best_chars=(None,None); min_null=1e30
    for lo in range(0,n,24):
        hi=min(n,lo+24)
        batch={k:v[lo:hi] for k,v in enc.items()}
        out=model(**batch)
        for local_i in range(hi-lo):
            fi=lo+local_i
            ids=batch['input_ids'][local_i]
            cls_hits=(ids==tok.cls_token_id).nonzero(as_tuple=False)
            cls=int(cls_hits[0].item()) if len(cls_hits) else 0
            s_logits=out.start_logits[local_i]; e_logits=out.end_logits[local_i]
            min_null=min(min_null,float(s_logits[cls]+e_logits[cls]))
            seq=enc.sequence_ids(fi)
            valid=[j for j,x in enumerate(seq) if x==1 and int(offsets[fi,j,1])>int(offsets[fi,j,0])]
            if not valid:continue
            valid_set=set(valid)
            sk=torch.topk(s_logits,min(TOP_TOKEN_CANDIDATES,s_logits.numel())).indices.tolist()
            ek=torch.topk(e_logits,min(TOP_TOKEN_CANDIDATES,e_logits.numel())).indices.tolist()
            for st in sk:
                if st not in valid_set:continue
                for en in ek:
                    if en not in valid_set or en<st or en-st+1>MAX_ANSWER_TOKENS:continue
                    a=int(offsets[fi,st,0]); b=int(offsets[fi,en,1])
                    if b<=a:continue
                    score=float(s_logits[st]+e_logits[en])
                    if score>best_score:
                        best_score=score; best_text=context[a:b]; best_chars=(a,b)
    confidence=best_score-min_null if best_score>-1e20 and min_null<1e20 else -1e30
    return {'confidence':confidence,'text':best_text,'char_start':best_chars[0],'char_end':best_chars[1],'window_count':n}

def collect(raw,subset,model,tok):
    rows=[]
    for contract in raw:
        title=contract.get('title','')
        if not primary_dev(title) or secondary_split(title)!=subset:continue
        for para in contract['paragraphs']:
            ctx=para['context']
            for qa in para['qas']:
                answers=qa.get('answers',[]) or []
                scored=score_question(model,tok,qa['question'],ctx)
                gold_spans=[(a['answer_start'],a['answer_start']+len(a['text'])) for a in answers]
                rows.append({
                    'title':title,'id':qa['id'],'has_answer':bool(answers),
                    'gold_texts':[a['text'] for a in answers],'gold_spans':gold_spans,
                    **scored
                })
    return rows

def apply_threshold(rows,threshold):
    out=[]
    for r in rows:
        x=dict(r); x['predict_answer']=r['confidence']>=threshold
        if not x['predict_answer']:
            x['predicted_text']='';x['predicted_span']=(None,None)
        else:
            x['predicted_text']=r['text'];x['predicted_span']=(r['char_start'],r['char_end'])
        out.append(x)
    return out

def metrics(rows):
    tp=sum(r['has_answer'] and r['predict_answer'] for r in rows)
    fp=sum((not r['has_answer']) and r['predict_answer'] for r in rows)
    fn=sum(r['has_answer'] and (not r['predict_answer']) for r in rows)
    tn=sum((not r['has_answer']) and (not r['predict_answer']) for r in rows)
    precision=tp/(tp+fp or 1); recall=tp/(tp+fn or 1); det_f1=2*precision*recall/(precision+recall or 1)
    no_answer=[r for r in rows if not r['has_answer']]
    answerable=[r for r in rows if r['has_answer']]
    ems=[]; f1s=[]; loc=[]
    for r in answerable:
        pred=r['predicted_text'] if r['predict_answer'] else ''
        ems.append(max((exact_match(pred,g) for g in r['gold_texts']),default=0.0))
        f1s.append(max((token_f1(pred,g) for g in r['gold_texts']),default=0.0))
        if r['predict_answer'] and r['predicted_span'][0] is not None:
            a,b=r['predicted_span'];loc.append(float(any(overlap_span(a,b,c,d) for c,d in r['gold_spans'])))
        else:loc.append(0.0)
    overall_exact=[];overall_f1=[]
    for r in rows:
        if not r['has_answer']:
            v=float(not r['predict_answer']);overall_exact.append(v);overall_f1.append(v)
        else:
            pred=r['predicted_text'] if r['predict_answer'] else ''
            overall_exact.append(max((exact_match(pred,g) for g in r['gold_texts']),default=0.0))
            overall_f1.append(max((token_f1(pred,g) for g in r['gold_texts']),default=0.0))
    return {
      'n':len(rows),'answerable_n':len(answerable),'no_answer_n':len(no_answer),
      'answer_detection_precision':precision,'answer_detection_recall':recall,'answer_detection_f1':det_f1,
      'no_answer_false_positive_rate':fp/(len(no_answer) or 1),
      'answerable_exact_match':sum(ems)/(len(ems) or 1),'answerable_token_f1':sum(f1s)/(len(f1s) or 1),
      'localization_overlap_recall':sum(loc)/(len(loc) or 1),
      'overall_exact_match':sum(overall_exact)/(len(overall_exact) or 1),'overall_token_f1':sum(overall_f1)/(len(overall_f1) or 1),
      'tp':tp,'fp':fp,'fn':fn,'tn':tn
    }

def choose_threshold(rows):
    vals=sorted(set([r['confidence'] for r in rows if math.isfinite(r['confidence'])]))
    if not vals:return 0.0,metrics(apply_threshold(rows,0.0))
    # Include extremes and midpoints; select exclusively on calibration contracts.
    candidates=[vals[0]-1.0,vals[-1]+1.0]+[(a+b)/2 for a,b in zip(vals,vals[1:])]
    best=None
    for th in candidates:
        m=metrics(apply_threshold(rows,th))
        key=(m['no_answer_false_positive_rate']<=.02,m['answer_detection_f1'],m['localization_overlap_recall'],m['answerable_token_f1'],m['overall_token_f1'],-m['no_answer_false_positive_rate'])
        if best is None or key>best[0]:best=(key,th,m)
    return best[1],best[2]

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--model',required=True);ap.add_argument('--train-json',required=True);ap.add_argument('--out',required=True);args=ap.parse_args()
    torch.set_num_threads(2)
    model_path=Path(args.model);tok=AutoTokenizer.from_pretrained(model_path,local_files_only=True,use_fast=True);model=AutoModelForQuestionAnswering.from_pretrained(model_path,local_files_only=True);model.eval()
    raw=json.load(open(args.train_json))['data']
    cal_raw=collect(raw,'calibration',model,tok);threshold,cal_metrics=choose_threshold(cal_raw)
    eval_raw=collect(raw,'evaluation',model,tok);eval_rows=apply_threshold(eval_raw,threshold);eval_metrics=metrics(eval_rows)
    gate={
      'no_answer_false_positive_max':.02,
      'answer_detection_f1_min':.85,
      'localization_overlap_recall_min':.85,
      'answerable_token_f1_min':.80,
    }
    gate['pass']=(eval_metrics['no_answer_false_positive_rate']<=gate['no_answer_false_positive_max'] and eval_metrics['answer_detection_f1']>=gate['answer_detection_f1_min'] and eval_metrics['localization_overlap_recall']>=gate['localization_overlap_recall_min'] and eval_metrics['answerable_token_f1']>=gate['answerable_token_f1_min'])
    rep={'schema':'musitu.revenueguard.cuad.heldout_eval.v1','status':'DEV_RESEARCH_ONLY','split':'original 10% title-hash heldout, then independent deterministic title-hash calibration/evaluation split; official CUAD test.json unopened','max_length':MAX_LEN,'stride':STRIDE,'threshold':threshold,'calibration':cal_metrics,'evaluation':eval_metrics,'gate':gate}
    rep['report_sha256']=hashlib.sha256(json.dumps(rep,sort_keys=True,separators=(',',':')).encode()).hexdigest();Path(args.out).write_text(json.dumps(rep,indent=2,sort_keys=True)+'\n');print(json.dumps(rep,indent=2,sort_keys=True))
if __name__=='__main__':main()
