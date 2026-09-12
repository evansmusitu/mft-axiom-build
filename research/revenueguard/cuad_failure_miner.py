#!/usr/bin/env python3
import argparse,json,math
from collections import Counter,defaultdict
from pathlib import Path
from cuad_heldout_eval import apply_threshold, metrics, token_f1, exact_match, overlap_span

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--eval-report',required=True);ap.add_argument('--shard-glob',required=True);ap.add_argument('--out',required=True);args=ap.parse_args()
    report=json.load(open(args.eval_report));th=report['threshold']
    rows=[]
    for f in sorted(Path('.').glob(args.shard_glob)):
        o=json.load(open(f));rows.extend(r for r in o['rows'] if r['split']=='evaluation')
    scored=apply_threshold(rows,th)
    failures=[];summary=Counter();by_windows=defaultdict(lambda:Counter())
    for r in scored:
        if not r['has_answer']:
            ok=not r['predict_answer'];kind='correct_abstain' if ok else 'false_grounding'
            best_f1=1.0 if ok else 0.0;loc=1.0 if ok else 0.0
        else:
            pred=r['predicted_text'] if r['predict_answer'] else ''
            best_f1=max((token_f1(pred,g) for g in r['gold_texts']),default=0.0)
            em=max((exact_match(pred,g) for g in r['gold_texts']),default=0.0)
            if r['predict_answer'] and r['predicted_span'][0] is not None:
                a,b=r['predicted_span'];loc=float(any(overlap_span(a,b,c,d) for c,d in r['gold_spans']))
            else:loc=0.0
            ok=r['predict_answer'] and loc==1.0 and best_f1>=.80
            if not r['predict_answer']:kind='missed_answer'
            elif not loc:kind='wrong_location'
            elif best_f1<.80:kind='boundary_or_semantic_span_error'
            else:kind='pass_case'
        summary[kind]+=1
        bucket='1' if r['window_count']==1 else '2-4' if r['window_count']<=4 else '5-9' if r['window_count']<=9 else '10+'
        by_windows[bucket][kind]+=1
        if not ok:
            failures.append({'title':r['title'],'id':r['id'],'kind':kind,'has_answer':r['has_answer'],'confidence':r['confidence'],'window_count':r['window_count'],'predicted_text':r.get('predicted_text',''),'gold_texts':r['gold_texts'],'best_token_f1':best_f1,'location_overlap':loc})
    failures.sort(key=lambda x:(x['kind'],-x['window_count'],-abs(x['confidence']-th)))
    out={'schema':'musitu.revenueguard.cuad.failure_mining.v1','status':'POST_GATE_DEV_DIAGNOSTIC','threshold_from_locked_report':th,'evaluation_rows':len(scored),'summary':dict(summary),'failure_count':len(failures),'by_window_count':{k:dict(v) for k,v in by_windows.items()},'failures':failures[:300]}
    Path(args.out).write_text(json.dumps(out,indent=2,sort_keys=True)+'\n');print(json.dumps({k:v for k,v in out.items() if k!='failures'},indent=2,sort_keys=True))
if __name__=='__main__':main()
