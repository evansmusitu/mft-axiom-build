#!/usr/bin/env python3
import argparse, hashlib, json
from pathlib import Path

EXPECTED_SCHEMA='musitu.revenueguard.cuad.heldout_eval.v2_sharded'
EXPECTED_MODEL='a5684a5a8ed59909b46c93fd4729ce9ed0f8f672dc0be1474cf94a5e07d6e44b'


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--input',required=True)
    ap.add_argument('--out',required=True)
    ap.add_argument('--raw-run-id',type=int,required=True)
    ap.add_argument('--raw-shards',type=int,required=True)
    args=ap.parse_args()
    src=json.load(open(args.input))
    if src.get('schema')!=EXPECTED_SCHEMA: raise SystemExit('unexpected aggregate schema')
    if src.get('model_artifact_sha256')!=EXPECTED_MODEL: raise SystemExit('model identity mismatch')
    if src.get('heldout_rows')!=2461: raise SystemExit(f"heldout_rows={src.get('heldout_rows')}")
    if args.raw_shards!=32: raise SystemExit('expected 32 question shards')
    # Metrics, threshold, split, gate and model identity are copied byte-for-value from
    # the frozen aggregate. Only execution/provenance metadata is corrected.
    rep=dict(src)
    original_report_sha=rep.pop('report_sha256',None)
    rep['schema']='musitu.revenueguard.cuad.heldout_eval.v2_sharded.provenance_sealed.v1'
    rep['execution']='32 deterministic question-hash shards emit raw model scores; exact 2461-question coverage verified before threshold selection; threshold selected only after complete calibration merge; evaluation metrics computed only after threshold freeze'
    rep['provenance_correction']={
        'type':'METADATA_ONLY_NO_SCORE_OR_GATE_CHANGE',
        'reason':'Frozen aggregator execution-description string was hard-coded to legacy 8-title-shard topology.',
        'source_aggregate_report_sha256':original_report_sha,
        'raw_score_run_id':args.raw_run_id,
        'raw_shard_count':args.raw_shards,
        'metric_fields_unchanged':['threshold','calibration','evaluation','official_style_heldout','gate','heldout_rows','calibration_rows','evaluation_rows','model_artifact_sha256','split']
    }
    rep['report_sha256']=hashlib.sha256(json.dumps(rep,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    Path(args.out).write_text(json.dumps(rep,indent=2,sort_keys=True)+'\n')
    print(json.dumps(rep,indent=2,sort_keys=True))

if __name__=='__main__': main()
