#!/usr/bin/env python3
import argparse,hashlib,json
from pathlib import Path
from sklearn.metrics import f1_score

THRESHOLDS=[.10,.15,.20,.25,.30,.35,.40,.45,.50,.55,.60,.65,.70,.75,.80,.85,.90]
KS=(24,32)

def apply(rows,k,th):
    out=[]
    for r in rows:
        s=r['scores'][str(k)];out.append({**r,'pred':s['candidate_label'] if s['score']>=th else 2,'best_span_index':s['best_span_index']})
    return out

def metrics(rows):
    y=[r['gold'] for r in rows];p=[r['pred'] for r in rows]
    if not y:return {'accuracy':0.0,'macro_f1':0.0,'false_grounding_notmentioned':0.0,'positive_semantic_accuracy':0.0,'selected_evidence_exact_span_recall':0.0,'n':0}
    nm=[i for i,v in enumerate(y) if v==2];pos=[i for i,v in enumerate(y) if v!=2]
    evhit=sum(rows[i]['best_span_index'] in rows[i]['gold_spans'] for i in pos)/(len(pos) or 1)
    return {'accuracy':sum(a==b for a,b in zip(y,p))/len(y),'macro_f1':float(f1_score(y,p,labels=[0,1,2],average='macro',zero_division=0)),'false_grounding_notmentioned':sum(p[i]!=2 for i in nm)/(len(nm) or 1),'positive_semantic_accuracy':sum(p[i]==y[i] for i in pos)/(len(pos) or 1),'selected_evidence_exact_span_recall':evhit,'n':len(y)}

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--shard-glob',required=True);ap.add_argument('--expected-shards',type=int,default=8);ap.add_argument('--mode',choices=['control','balanced'],required=True);ap.add_argument('--checkpoint-artifact-sha256',required=True);ap.add_argument('--out',required=True);args=ap.parse_args()
    files=sorted(Path('.').glob(args.shard_glob))
    if len(files)!=args.expected_shards:raise SystemExit(f'expected {args.expected_shards} shards got {len(files)}')
    rows=[];seen_shards=set();seen=set();steps=set();next_chunks=set();exclusion_sets=set()
    for f in files:
        o=json.load(open(f))
        if o.get('schema')!='musitu.revenueguard.contractnli.checkpoint_raw_shard.v2':raise SystemExit(f'bad schema {f}')
        if o['mode']!=args.mode or o['num_shards']!=args.expected_shards:raise SystemExit(f'metadata mismatch {f}')
        si=o['shard_index']
        if si in seen_shards:raise SystemExit(f'duplicate shard {si}')
        seen_shards.add(si);steps.add(o['global_training_steps']);next_chunks.add(o['next_chunk']);exclusion_sets.add(tuple(o.get('excluded_calibration_doc_ids',[])))
        for r in o['rows']:
            key=(r['corpus'],r['doc'],r['hid'])
            if key in seen:raise SystemExit(f'duplicate {key}')
            seen.add(key);rows.append(r)
    if seen_shards!=set(range(args.expected_shards)):raise SystemExit('missing shards')
    if len(steps)!=1 or len(next_chunks)!=1:raise SystemExit('checkpoint identity mismatch across shards')
    if len(exclusion_sets)!=1:raise SystemExit('calibration exclusion mismatch across shards')
    excluded=list(next(iter(exclusion_sets)))
    cal=[r for r in rows if r['corpus']=='train'];dev=[r for r in rows if r['corpus']=='dev']
    if not cal or not dev:raise SystemExit('missing calibration or dev rows')
    if any(r['doc'] in excluded for r in cal):raise SystemExit('excluded calibration document leaked into selector')
    settings=[]
    for k in KS:
        best=None
        for th in THRESHOLDS:
            m=metrics(apply(cal,k,th));key=(m['false_grounding_notmentioned']<=.02,m['macro_f1'],m['accuracy'],m['selected_evidence_exact_span_recall'],-m['false_grounding_notmentioned'])
            if best is None or key>best[0]:best=(key,th,m)
        _,th,cm=best;settings.append({'k':k,'threshold':th,'calibration':cm})
    def setting_key(x):
        m=x['calibration'];return (m['false_grounding_notmentioned']<=.02,m['macro_f1'],m['accuracy'],m['selected_evidence_exact_span_recall'],-x['k'])
    chosen=max(settings,key=setting_key)
    devrows=apply(dev,chosen['k'],chosen['threshold']);dm=metrics(devrows)
    by={hid:metrics([r for r in devrows if r['hid']==hid]) for hid in sorted({r['hid'] for r in devrows})}
    gate={'accuracy_min':.90,'macro_f1_min':.88,'false_grounding_max':.02,'evidence_recall_min':.85}
    gate['pass']=dm['accuracy']>=gate['accuracy_min'] and dm['macro_f1']>=gate['macro_f1_min'] and dm['false_grounding_notmentioned']<=gate['false_grounding_max'] and dm['selected_evidence_exact_span_recall']>=gate['evidence_recall_min']
    rep={'schema':'musitu.revenueguard.contractnli.checkpoint_eval.v2','status':'DEV_RESEARCH_ONLY','mode':args.mode,'checkpoint_artifact_sha256':args.checkpoint_artifact_sha256,'global_training_steps':next(iter(steps)),'completed_chunks':next(iter(next_chunks)),'calibration_rows':len(cal),'excluded_duplicate_equivalent_calibration_doc_ids':excluded,'dev_rows':len(dev),'candidate_settings':settings,'chosen_k':chosen['k'],'chosen_threshold':chosen['threshold'],'selection_rule':'K and threshold selected exclusively on hash-held training calibration documents after excluding any calibration document whose normalized full text appears in build; untouched official dev graded once after selection.','dev':dm,'dev_by_hypothesis':by,'gate':gate}
    rep['report_sha256']=hashlib.sha256(json.dumps(rep,sort_keys=True,separators=(',',':')).encode()).hexdigest();Path(args.out).write_text(json.dumps(rep,indent=2,sort_keys=True)+'\n');print(json.dumps(rep,indent=2,sort_keys=True))
if __name__=='__main__':main()
