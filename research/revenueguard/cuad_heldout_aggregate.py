#!/usr/bin/env python3
import argparse, hashlib, json
from pathlib import Path
from cuad_heldout_eval import choose_threshold, apply_threshold, metrics, official_style_curve, primary_dev, secondary_split


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--train-json',required=True)
    ap.add_argument('--shard-glob',required=True)
    ap.add_argument('--out',required=True)
    ap.add_argument('--expected-shards',type=int,default=8)
    ap.add_argument('--model-artifact-sha256',required=True)
    args=ap.parse_args()
    files=sorted(Path('.').glob(args.shard_glob))
    if len(files)!=args.expected_shards:raise SystemExit(f'expected {args.expected_shards} shards, got {len(files)}: {files}')
    rows=[];seen_shards=set();seen_ids=set()
    for f in files:
        o=json.load(open(f));
        if o.get('schema')!='musitu.revenueguard.cuad.heldout_raw_shard.v1':raise SystemExit(f'bad schema {f}')
        if o['num_shards']!=args.expected_shards:raise SystemExit(f'bad num_shards {f}')
        si=o['shard_index']
        if si in seen_shards:raise SystemExit(f'duplicate shard {si}')
        seen_shards.add(si)
        for r in o['rows']:
            key=(r['title'],r['id'])
            if key in seen_ids:raise SystemExit(f'duplicate row {key}')
            seen_ids.add(key);rows.append(r)
    if seen_shards!=set(range(args.expected_shards)):raise SystemExit(f'missing shards {set(range(args.expected_shards))-seen_shards}')
    raw=json.load(open(args.train_json))['data']
    expected=[]
    for c in raw:
        title=c.get('title','')
        if not primary_dev(title):continue
        for p in c['paragraphs']:
            for qa in p['qas']:expected.append((title,qa['id']))
    expected_set=set(expected)
    if seen_ids!=expected_set:
        raise SystemExit(f'heldout coverage mismatch missing={len(expected_set-seen_ids)} extra={len(seen_ids-expected_set)}')
    cal_raw=[r for r in rows if r['split']=='calibration'];eval_raw=[r for r in rows if r['split']=='evaluation']
    if not cal_raw or not eval_raw:raise SystemExit('empty calibration/evaluation split')
    threshold,cal_metrics=choose_threshold(cal_raw)
    eval_rows=apply_threshold(eval_raw,threshold);eval_metrics=metrics(eval_rows)
    official_style=official_style_curve(eval_raw)
    gate={'no_answer_false_positive_max':.02,'answer_detection_f1_min':.85,'localization_overlap_recall_min':.85,'answerable_token_f1_min':.80}
    gate['pass']=(eval_metrics['no_answer_false_positive_rate']<=gate['no_answer_false_positive_max'] and eval_metrics['answer_detection_f1']>=gate['answer_detection_f1_min'] and eval_metrics['localization_overlap_recall']>=gate['localization_overlap_recall_min'] and eval_metrics['answerable_token_f1']>=gate['answerable_token_f1_min'])
    rep={'schema':'musitu.revenueguard.cuad.heldout_eval.v2_sharded','status':'DEV_RESEARCH_ONLY','split':'original 10% title-hash heldout, then independent deterministic title-hash calibration/evaluation split; official CUAD test.json unopened','execution':'8 deterministic title shards emit raw model scores; threshold selected only after complete calibration merge; evaluation metrics computed only after threshold freeze','model_artifact_sha256':args.model_artifact_sha256,'heldout_rows':len(rows),'calibration_rows':len(cal_raw),'evaluation_rows':len(eval_raw),'threshold':threshold,'calibration':cal_metrics,'evaluation':eval_metrics,'official_style_heldout':official_style,'gate':gate}
    rep['report_sha256']=hashlib.sha256(json.dumps(rep,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    Path(args.out).write_text(json.dumps(rep,indent=2,sort_keys=True)+'\n')
    print(json.dumps(rep,indent=2,sort_keys=True))

if __name__=='__main__':main()
