#!/usr/bin/env python3
import argparse, hashlib, json
from pathlib import Path

CN_REPORT_SCHEMA='musitu.revenueguard.contractnli.decoupled_chunk_train.v1'
CUAD_REPORT_SCHEMA='musitu.revenueguard.cuad.matched_window_train.v1'
GEOM_SCHEMA='musitu.revenueguard.cuad.trainer_geometry_onepass_audit.v1'
CONTRACTNLI_COMMIT='eced6528dd3c1d14d73f9a87df8f7bdbc03126f9'
CUAD_COMMIT='67faa0e6023b04fcaae6cc09497ab00e5d63a2a2'
CN_TRAINING_RUN_ID=34748996731
CN_TRAINING_HEAD_SHA='9bde25dab82909ed40e4a9722fdbfb648896d220'
CN_SOURCE_ENCODER_RUN_ID=34676990123
CN_SOURCE_ENCODER_ARTIFACT_SHA='3d78d473ffde6f790b3919226d1069b81fa8426f0f139007d3ba8b9d9cf23055'
CUAD_ORIGINAL_TRAINING_RUN_ID=34749003397
CUAD_ORIGINAL_TRAINING_HEAD_SHA='302d36e9dd26af60464d0ecf4e3d2504f9591f52'
CUAD_PREDECESSOR_CHUNK2_ARTIFACT_ID=10323636532
CUAD_PREDECESSOR_CHUNK2_ARTIFACT_SHA='2c31ed0f6ef65542d3a61ffd7dca529c1bf53e1ff0cb63fa68ec40bfbcf0d570'
CUAD_RESUME_RUN_ID=34801041589
CUAD_RESUME_WORKFLOW_HEAD_SHA='ad142345213d26e9ba8cc868e2aa6772b154ed6e'
CUAD_RESUME_TRAINER_SOURCE_HEAD_SHA=CUAD_ORIGINAL_TRAINING_HEAD_SHA
CUAD_SOURCE_MODEL_RUN_ID=34683449126
CUAD_SOURCE_MODEL_ARTIFACT_SHA='a5684a5a8ed59909b46c93fd4729ce9ed0f8f672dc0be1474cf94a5e07d6e44b'
CUAD_GEOMETRY_RUN_ID=34706691340
CUAD_GEOMETRY_ARTIFACT_SHA='7ff5e7ccd10aa3c4747136a0d5b67af2004edaf9777247155ce6e37812c56c04'
CUAD_TRAIN_SHA='7de21d2bb741ac939e2a839ef9640634a5e0f9f40ea2b82c6833baf7db33dab4'
CUAD_FROZEN_GEOMETRY_REPORT_SHA='e14b667cc4e8ac96b35909741847d804505b3d7f0c4c79ddebb53ab07bee10e7'
CUAD_TRAINER_ONEPASS_REPORT_SHA='d8820202835ae82499e96a8ee8895c175ac5ddc39e7ec66b7bbfd0367d3520a1'
CUAD_CHUNK_SIZES=[15436,15462,15380,15381]
CUAD_EXPECTED_STEPS=2571
CN_EXPECTED_SAMPLES=29488
CN_EXPECTED_STEPS=615


def seal_hash(o): return hashlib.sha256(json.dumps(o,sort_keys=True,separators=(',',':')).encode()).hexdigest()

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--contractnli-final-report',required=True)
    ap.add_argument('--contractnli-artifact-sha256',required=True)
    ap.add_argument('--contractnli-run-id',type=int,required=True)
    ap.add_argument('--contractnli-training-head-sha',required=True)
    ap.add_argument('--contractnli-source-encoder-artifact-sha256',required=True)
    ap.add_argument('--cuad-final-report',required=True)
    ap.add_argument('--cuad-artifact-sha256',required=True)
    ap.add_argument('--cuad-original-run-id',type=int,required=True)
    ap.add_argument('--cuad-original-training-head-sha',required=True)
    ap.add_argument('--cuad-predecessor-artifact-id',type=int,required=True)
    ap.add_argument('--cuad-predecessor-artifact-sha256',required=True)
    ap.add_argument('--cuad-resume-run-id',type=int,required=True)
    ap.add_argument('--cuad-resume-workflow-head-sha',required=True)
    ap.add_argument('--cuad-resume-trainer-source-head-sha',required=True)
    ap.add_argument('--cuad-source-model-artifact-sha256',required=True)
    ap.add_argument('--cuad-geometry-artifact-sha256',required=True)
    ap.add_argument('--cuad-geometry-report',required=True)
    ap.add_argument('--out',required=True)
    args=ap.parse_args()

    if args.contractnli_run_id!=CN_TRAINING_RUN_ID: raise SystemExit('ContractNLI training run drift')
    if args.contractnli_training_head_sha!=CN_TRAINING_HEAD_SHA: raise SystemExit('ContractNLI training workflow head drift')
    if args.contractnli_source_encoder_artifact_sha256!=CN_SOURCE_ENCODER_ARTIFACT_SHA: raise SystemExit('ContractNLI source encoder artifact drift')
    if args.cuad_original_run_id!=CUAD_ORIGINAL_TRAINING_RUN_ID: raise SystemExit('CUAD original training run drift')
    if args.cuad_original_training_head_sha!=CUAD_ORIGINAL_TRAINING_HEAD_SHA: raise SystemExit('CUAD original training head drift')
    if args.cuad_predecessor_artifact_id!=CUAD_PREDECESSOR_CHUNK2_ARTIFACT_ID: raise SystemExit('CUAD predecessor artifact id drift')
    if args.cuad_predecessor_artifact_sha256!=CUAD_PREDECESSOR_CHUNK2_ARTIFACT_SHA: raise SystemExit('CUAD predecessor artifact digest drift')
    if args.cuad_resume_run_id!=CUAD_RESUME_RUN_ID: raise SystemExit('CUAD resume run drift')
    if args.cuad_resume_workflow_head_sha!=CUAD_RESUME_WORKFLOW_HEAD_SHA: raise SystemExit('CUAD resume workflow head drift')
    if args.cuad_resume_trainer_source_head_sha!=CUAD_RESUME_TRAINER_SOURCE_HEAD_SHA: raise SystemExit('CUAD resume trainer source head drift')
    if args.cuad_source_model_artifact_sha256!=CUAD_SOURCE_MODEL_ARTIFACT_SHA: raise SystemExit('CUAD source model artifact drift')
    if args.cuad_geometry_artifact_sha256!=CUAD_GEOMETRY_ARTIFACT_SHA: raise SystemExit('CUAD geometry artifact drift')

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
    if int(cq.get('chunk_samples',-1))!=15381 or int(cq.get('chunk_steps',-1))!=641: raise SystemExit('CUAD resumed final chunk execution drift')
    if int(cq.get('global_steps',-1))!=CUAD_EXPECTED_STEPS: raise SystemExit(('CUAD incomplete steps',cq.get('global_steps')))
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

    if geom.get('schema')!=GEOM_SCHEMA or not geom.get('pass'): raise SystemExit('exact CUAD one-pass trainer geometry seal absent')
    if geom.get('report_sha256')!=CUAD_TRAINER_ONEPASS_REPORT_SHA: raise SystemExit('CUAD one-pass geometry report identity drift')
    if geom.get('geometry_report_sha256')!=CUAD_FROZEN_GEOMETRY_REPORT_SHA: raise SystemExit('frozen CUAD geometry ancestry drift')
    if geom.get('train_sha256')!=CUAD_TRAIN_SHA: raise SystemExit('geometry/train SHA mismatch')
    if int(geom.get('heldout_contracts',-1))!=45: raise SystemExit('CUAD heldout contract drift')
    if int(geom.get('dropped_empty_context_windows',-1))!=0: raise SystemExit('CUAD trainer dropped context windows')
    if list(geom.get('chunk_sizes') or [])!=CUAD_CHUNK_SIZES: raise SystemExit('CUAD exact chunk geometry drift')
    if int(geom.get('chunk_size_sum',-1))!=61659: raise SystemExit('geometry chunk conservation mismatch')
    gstats=geom.get('stats') or {}
    if int(gstats.get('build_questions',-1))!=19989 or int(gstats.get('heldout_questions',-1))!=2461: raise SystemExit('geometry question-count drift')
    if int(gstats.get('answerable_questions',-1))!=9972 or int(gstats.get('impossible_questions',-1))!=10017: raise SystemExit('geometry answerability-count drift')
    if int(gstats.get('selected_total',-1))!=61659: raise SystemExit('geometry selected total mismatch')
    if int(gstats.get('selected_positive',-1))!=12305: raise SystemExit('geometry positive mismatch')
    if int(gstats.get('selected_negative',-1))!=49354: raise SystemExit('geometry negative mismatch')

    rep={
      'schema':'musitu.revenueguard.v4_1.specialist_training_provenance_seal.v3',
      'status':'TRAINING_PROVENANCE_PASS_NOT_CERTIFICATION',
      'contractnli':{
        'run_id':CN_TRAINING_RUN_ID,
        'training_head_sha':CN_TRAINING_HEAD_SHA,
        'artifact_sha256':args.contractnli_artifact_sha256,
        'final_report_sha256':cn['report_sha256'],
        'source_commit':CONTRACTNLI_COMMIT,
        'source_encoder_run_id':CN_SOURCE_ENCODER_RUN_ID,
        'source_encoder_artifact_sha256':CN_SOURCE_ENCODER_ARTIFACT_SHA,
        'mode':'decoupled',
        'completed_chunks':4,
        'global_steps':CN_EXPECTED_STEPS,
        'full_epoch_samples':CN_EXPECTED_SAMPLES,
      },
      'cuad':{
        'artifact_sha256':args.cuad_artifact_sha256,
        'final_report_sha256':cq['report_sha256'],
        'source_commit':CUAD_COMMIT,
        'source_model_run_id':CUAD_SOURCE_MODEL_RUN_ID,
        'source_model_artifact_sha256':CUAD_SOURCE_MODEL_ARTIFACT_SHA,
        'geometry_run_id':CUAD_GEOMETRY_RUN_ID,
        'geometry_artifact_sha256':CUAD_GEOMETRY_ARTIFACT_SHA,
        'train_sha256':CUAD_TRAIN_SHA,
        'completed_chunks':4,
        'global_steps':CUAD_EXPECTED_STEPS,
        'selected_training_windows':61659,
        'geometry_report_sha256':geom['report_sha256'],
        'frozen_geometry_report_sha256':geom['geometry_report_sha256'],
        'chunk_sizes':geom['chunk_sizes'],
        'dropped_empty_context_windows':geom['dropped_empty_context_windows'],
        'split_training_ancestry':{
          'original_run_id':CUAD_ORIGINAL_TRAINING_RUN_ID,
          'original_training_head_sha':CUAD_ORIGINAL_TRAINING_HEAD_SHA,
          'original_run_terminal_conclusion':'cancelled_after_chunk3_timeout',
          'predecessor_chunk2_artifact_id':CUAD_PREDECESSOR_CHUNK2_ARTIFACT_ID,
          'predecessor_chunk2_artifact_sha256':CUAD_PREDECESSOR_CHUNK2_ARTIFACT_SHA,
          'resume_run_id':CUAD_RESUME_RUN_ID,
          'resume_workflow_head_sha':CUAD_RESUME_WORKFLOW_HEAD_SHA,
          'resume_trainer_source_head_sha':CUAD_RESUME_TRAINER_SOURCE_HEAD_SHA,
          'resume_scope':'chunk3_only_from_exact_chunk2_predecessor',
        },
      },
      'sealed_policy':{'contractnli_test_opened':False,'maud_opened':False,'cuad_official_test_opened':False},
      'certification':'NOT_CERTIFIED'
    }
    rep['report_sha256']=seal_hash(rep)
    Path(args.out).write_text(json.dumps(rep,indent=2,sort_keys=True)+'\n')
    print(json.dumps(rep,indent=2,sort_keys=True))

if __name__=='__main__': main()
