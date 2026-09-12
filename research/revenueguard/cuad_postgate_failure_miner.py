#!/usr/bin/env python3
import argparse, hashlib, json, re, string
from collections import Counter, defaultdict
from pathlib import Path


def norm(s):
    s=s.lower(); s=''.join(ch for ch in s if ch not in set(string.punctuation)); s=re.sub(r'\b(a|an|the)\b',' ',s)
    return ' '.join(s.split())

def token_f1(a,b):
    A=norm(a).split(); B=norm(b).split()
    if not A and not B:return 1.0
    if not A or not B:return 0.0
    n=sum((Counter(A)&Counter(B)).values())
    if not n:return 0.0
    p=n/len(A);r=n/len(B);return 2*p*r/(p+r)

def overlap(a,b,c,d): return a is not None and b is not None and max(a,c)<min(b,d)

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--aggregate',required=True);ap.add_argument('--shard-glob',required=True);ap.add_argument('--out',required=True);args=ap.parse_args()
    agg=json.load(open(args.aggregate)); th=float(agg['threshold'])
    files=sorted(Path('.').glob(args.shard_glob)); rows=[];seen=set()
    for f in files:
        o=json.load(open(f))
        if o.get('schema')!='musitu.revenueguard.cuad.heldout_raw_shard.v1':raise SystemExit(f'bad shard schema {f}')
        for r in o['rows']:
            k=(r['title'],r['id'])
            if k in seen:raise SystemExit(f'duplicate row {k}')
            seen.add(k);rows.append(r)
    if len(rows)!=agg['heldout_rows']:raise SystemExit((len(rows),agg['heldout_rows']))
    eval_rows=[r for r in rows if r['split']=='evaluation']
    if len(eval_rows)!=agg['evaluation_rows']:raise SystemExit((len(eval_rows),agg['evaluation_rows']))
    fam=defaultdict(list)
    for r in eval_rows:
        pred=r['confidence']>=th
        if not r['has_answer']:
            if pred:fam['false_grounding_no_answer'].append(r)
            continue
        if not pred:
            fam['missed_answer_abstention'].append(r);continue
        loc=any(overlap(r['char_start'],r['char_end'],c,d) for c,d in r['gold_spans'])
        best=max((token_f1(r['text'],g) for g in r['gold_texts']),default=0.0)
        if not loc:fam['wrong_localization'].append(r)
        elif best<0.5:fam['localized_but_low_semantic_match'].append(r)
        elif best<0.8:fam['partial_span_boundary_or_semantic'].append(r)
    def sample(rs):
        return [{'title':r['title'],'id':r['id'],'confidence':r['confidence'],'has_answer':r['has_answer'],'window_count':r.get('window_count')} for r in sorted(rs,key=lambda x:abs(x['confidence']-th),reverse=True)[:25]]
    counts={k:len(v) for k,v in sorted(fam.items())}
    rep={'schema':'musitu.revenueguard.cuad.postgate_failure_mining.v1','status':'POST_GATE_DIAGNOSTIC_NOT_CERTIFICATION_EVIDENCE','source_aggregate_report_sha256':agg['report_sha256'],'model_artifact_sha256':agg['model_artifact_sha256'],'threshold_frozen_from_aggregate':th,'evaluation_rows':len(eval_rows),'gate_pass':agg['gate']['pass'],'failure_family_counts':counts,'failure_family_examples':{k:sample(v) for k,v in sorted(fam.items())},'rule':'No threshold, metric, split, model weight, or gate is changed. Output is curriculum for a future candidate only.'}
    rep['report_sha256']=hashlib.sha256(json.dumps(rep,sort_keys=True,separators=(',',':')).encode()).hexdigest();Path(args.out).write_text(json.dumps(rep,indent=2,sort_keys=True)+'\n');print(json.dumps(rep,indent=2,sort_keys=True))
if __name__=='__main__':main()
