#!/usr/bin/env python3
import argparse, hashlib, json
from pathlib import Path

CN_REPORT_SCHEMA='musitu.revenueguard.contractnli.decoupled_chunk_train.v1'
CUAD_REPORT_SCHEMA='musitu.revenueguard.cuad.matched_window_train.v1'
GEOM_SCHEMAS={
    'musitu.revenueguard.cuad.trainer_geometry_contract_audit.v1',
    'musitu.revenueguard.cuad.trainer_geometry_onepass_audit.v1',
}
CONTRACTNLI_COMMIT='eced6528dd3c1d14d73f9a87df8f7bdbc03126f9'
CUAD_COMMIT='67faa0e6023b04fcaae6cc09497ab00e5d63a2a2'
CUAD_TRAIN_SHA='7de21d2bb741ac939e2a839ef9640634a5e0f9f40ea2b82c6833baf7db33dab4'
CN_EXPECTED_SAMPLES=29488
CN_EXPECTED_STEPS=615


def seal_hash(o): return hashlib.sha256(json.dumps(o,sort_keys=True,separators=(',',':')).encode()).hexdigest()

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--contractnli-final-report',required=True)
    ap.add_argument('--contractnli-artifact-sha256',required=True)
    ap.add_argument('--contractnli-run-id',type=int,required=True)
    ap.add_argument('--cuad-final-report',required=True)
    ap.add_argument('--cuad-artifact-sha256',required=True)
    ap.add_argument('--cuad-run-id',type=int,required=True)
    ap.add_argument('--cuad-geometry-report',required=True)
    ap.add_argument('--out',required=True)
    args=ap.parse_args()

    cn=json.load(open(args.contractnli_final_report))
    cq=json.load(open(args.cuad_final_report))
    geom=json.load(open(args.cuad_geometry_report))

    if cn.get('schema')!=CN_REPORT_SCHEMA: raise SystemExit('bad ContractNLI final report schema')
    if cn.get('mode')!='decoupled' or int(cn.get('chunk_index',-1))!=3 or int(cn.get('num_chunks',-1))!=4:
        raise SystemExit('ContractNLI final chunk identity mismatch')
    if int(cn.get('global_steps',-1))!=CN_EXPECTED_STEPS: raise SystemExit(('ContractNLI incomplete steps',cn.get('global_steps')))
    if int(cn.get('full_epoch_steps',-1))!=CN_EXPECTED_STEPS: raise SystemExit(('ContractNLI epoch step contract drift',cn.get('full_epoch_steps')))
    if int(cn.get('full_epoch_samples',-1))!=CN_EXPECTED_SAMPLES: raise SystemExit(('ContractNLI curriculum size drift',cn.get('full_epoch_samples')))
    if int(cn.get('unfrozen_encoder_layers',-1))!=4: raise SystemExit('ContractNLI architecture drift')
    if len(args.contractnli_artifact_sha256)!=64: raise SystemExit('bad ContractNLI artifact digest')

    if cq.get('schema')!=CUAD_REPORT_SCHEMA: raise SystemExit('bad CUAD final report schema')
    if int(cq.get('chunk_index',-1))!=3 or int(cq.get('num_chunks',-1))!=4: raise SystemExit('CUAD final chunk identity mismatch')
    if cq.get('train_sha256')!=CUAD_TRAIN_SHA: raise SystemExit('CUAD train corpus drift')
    if cq.get('cuad_commit')!=CUAD_COMMIT: raise SystemExit('CUAD source commit drift')
    if int(cq.get('max_length',-1))!=384 or int(cq.get('stride',-1))!=128: raise SystemExit('CUAD window geometry drift')
    counts=cq.get('full_selected_counts') or {}
    if int(counts.get('heldout_questions',-1))!=2461: raise SystemExit('CUAD heldout question drift')
    if int(counts.get('build_questions',-1))!=19989: raise SystemExit('CUAD build question drift')
    if int(counts.get('selected_positive',-1))!=12305: raise SystemExit('CUAD positive window drift')
    if int(counts.get('selected_negative',-1))!=49354: raise SystemExit('CUAD negative window drift')
    if int(counts.get('selected_total',-1))!=61659: raise SystemExit('CUAD selected total drift')
    if len(args.cuad_artifact_sha256)!=64: raise SystemExit('bad CUAD artifact digest')

    if geom.get('schema') not in GEOM_SCHEMAS or not geom.get('pass'): raise SystemExit('CUAD trainer geometry seal absent')
    if geom.get('train_sha256')!=CUAD_TRAIN_SHA: raise SystemExit('geometry/train SHA mismatch')
    # Accept the original four-pass or optimized one-pass audit field names, but require exact conservation.
    gstats=geom.get('trainer_stats') or geom.get('stats') or {}
    if int(gstats.get('selected_total',-1))!=61659: raise SystemExit('geometry selected total mismatch')
    if int(gstats.get('selected_positive',-1))!=12305: raise SystemExit('geometry positive mismatch')
    if int(gstats.get('selected_negative',-1))!=49354: raise SystemExit('geometry negative mismatch')
    if int(geom.get('chunk_size_sum',-1))!=61659: raise SystemExit('geometry chunk conservation mismatch')

    rep={
      'schema':'musitu.revenueguard.v4_1.specialist_training_provenance_seal.v1',
      'status':'TRAINING_PROVENANCE_PASS_NOT_CERTIFICATION',
      'contractnli':{
        'run_id':args.contractnli_run_id,
        'artifact_sha256':args.contractnli_artifact_sha256,
        'final_report_sha256':cn['report_sha256'],
        'source_commit':CONTRACTNLI_COMMIT,
        'mode':'decoupled',
        'completed_chunks':4,
        'global_steps':CN_EXPECTED_STEPS,
        'full_epoch_samples':CN_EXPECTED_SAMPLES,
      },
      'cuad':{
        'run_id':args.cuad_run_id,
        'artifact_sha256':args.cuad_artifact_sha256,
        'final_report_sha256':cq['report_sha256'],
        'source_commit':CUAD_COMMIT,
        'train_sha256':CUAD_TRAIN_SHA,
        'completed_chunks':4,
        'global_steps':int(cq['global_steps']),
        'selected_training_windows':61659,
        'geometry_report_sha256':geom['report_sha256'],
        'chunk_sizes':geom['chunk_sizes'],
      },
      'sealed_policy':{'contractnli_test_opened':False,'maud_opened':False,'cuad_official_test_opened':False},
      'certification':'NOT_CERTIFIED'
    }
    rep['report_sha256']=seal_hash(rep)
    Path(args.out).write_text(json.dumps(rep,indent=2,sort_keys=True)+'\n')
    print(json.dumps(rep,indent=2,sort_keys=True))

if __name__=='__main__': main()
