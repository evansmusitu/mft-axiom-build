#!/usr/bin/env python3
import argparse, hashlib, json
from pathlib import Path

CN_SCHEMA='musitu.revenueguard.contractnli.decoupled_checkpoint_eval.v2'
CUAD_SCHEMA='musitu.revenueguard.cuad.heldout_eval.v2_sharded'
PROV_SCHEMA='musitu.revenueguard.v4_1.specialist_training_provenance_seal.v3'
CN_GATE={'accuracy_min':0.90,'macro_f1_min':0.88,'false_grounding_max':0.02,'evidence_recall_min':0.85}
CUAD_GATE={'no_answer_false_positive_max':0.02,'answer_detection_f1_min':0.85,'localization_overlap_recall_min':0.85,'answerable_token_f1_min':0.80}
FROZEN_V4_SHA='16ce77c048bc39990b9fe338f3090e430b2c8d7f2767efef11369bd3013be85d'
FROZEN_V4_REGRESSION_SHA='b669e2756a7846fb04bf40671ed66f456917a94881fb993ceb4ad003b63f44e2'
CN_TRAINING_HEAD_SHA='9bde25dab82909ed40e4a9722fdbfb648896d220'
CN_SOURCE_ENCODER_SHA='3d78d473ffde6f790b3919226d1069b81fa8426f0f139007d3ba8b9d9cf23055'
CUAD_ORIGINAL_RUN_ID=34749003397
CUAD_ORIGINAL_HEAD_SHA='302d36e9dd26af60464d0ecf4e3d2504f9591f52'
CUAD_PREDECESSOR_ID=10323636532
CUAD_PREDECESSOR_SHA='2c31ed0f6ef65542d3a61ffd7dca529c1bf53e1ff0cb63fa68ec40bfbcf0d570'
CUAD_RESUME_RUN_ID=34801041589
CUAD_RESUME_HEAD_SHA='ad142345213d26e9ba8cc868e2aa6772b154ed6e'
CUAD_SOURCE_MODEL_SHA='a5684a5a8ed59909b46c93fd4729ce9ed0f8f672dc0be1474cf94a5e07d6e44b'
CUAD_GEOMETRY_ARTIFACT_SHA='7ff5e7ccd10aa3c4747136a0d5b67af2004edaf9777247155ce6e37812c56c04'


def sha_obj(x): return hashlib.sha256(json.dumps(x,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def eq_gate(actual,expected,name):
    for k,v in expected.items():
        if float(actual.get(k,-999))!=v: raise SystemExit(f'{name} gate drift {k}: {actual.get(k)} != {v}')
def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--contractnli',required=True)
    ap.add_argument('--cuad',required=True)
    ap.add_argument('--training-provenance',required=True)
    ap.add_argument('--out',required=True)
    args=ap.parse_args()
    cn=json.load(open(args.contractnli)); cq=json.load(open(args.cuad)); prov=json.load(open(args.training_provenance))

    if cn.get('schema')!=CN_SCHEMA or cn.get('mode')!='decoupled': raise SystemExit('ContractNLI eval identity mismatch')
    if 'semantic-head labels or correctness do not participate' not in cn.get('calibration_contract',''): raise SystemExit('ContractNLI abstention was not relevance-only calibrated')
    if cq.get('schema')!=CUAD_SCHEMA: raise SystemExit('CUAD eval identity mismatch')
    if prov.get('schema')!=PROV_SCHEMA or prov.get('status')!='TRAINING_PROVENANCE_PASS_NOT_CERTIFICATION': raise SystemExit('training provenance absent')
    eq_gate(cn.get('gate') or {},CN_GATE,'ContractNLI'); eq_gate(cq.get('gate') or {},CUAD_GATE,'CUAD')

    pc=prov.get('contractnli') or {}; pq=prov.get('cuad') or {}; chain=pq.get('split_training_ancestry') or {}
    if int(pc.get('run_id',-1))!=34748996731 or pc.get('training_head_sha')!=CN_TRAINING_HEAD_SHA: raise SystemExit('ContractNLI training ancestry drift')
    if int(pc.get('source_encoder_run_id',-1))!=34676990123 or pc.get('source_encoder_artifact_sha256')!=CN_SOURCE_ENCODER_SHA: raise SystemExit('ContractNLI source encoder ancestry drift')
    if int(chain.get('original_run_id',-1))!=CUAD_ORIGINAL_RUN_ID or chain.get('original_training_head_sha')!=CUAD_ORIGINAL_HEAD_SHA: raise SystemExit('CUAD original training ancestry drift')
    if chain.get('original_run_terminal_conclusion')!='cancelled_after_chunk3_timeout': raise SystemExit('CUAD original terminal state drift')
    if int(chain.get('predecessor_chunk2_artifact_id',-1))!=CUAD_PREDECESSOR_ID or chain.get('predecessor_chunk2_artifact_sha256')!=CUAD_PREDECESSOR_SHA: raise SystemExit('CUAD predecessor checkpoint ancestry drift')
    if int(chain.get('resume_run_id',-1))!=CUAD_RESUME_RUN_ID or chain.get('resume_workflow_head_sha')!=CUAD_RESUME_HEAD_SHA: raise SystemExit('CUAD resume ancestry drift')
    if chain.get('resume_trainer_source_head_sha')!=CUAD_ORIGINAL_HEAD_SHA or chain.get('resume_scope')!='chunk3_only_from_exact_chunk2_predecessor': raise SystemExit('CUAD resume source/scope drift')
    if int(pq.get('source_model_run_id',-1))!=34683449126 or pq.get('source_model_artifact_sha256')!=CUAD_SOURCE_MODEL_SHA: raise SystemExit('CUAD source model ancestry drift')
    if int(pq.get('geometry_run_id',-1))!=34706691340 or pq.get('geometry_artifact_sha256')!=CUAD_GEOMETRY_ARTIFACT_SHA: raise SystemExit('CUAD geometry ancestry drift')

    if pc['artifact_sha256']!=cn['checkpoint_artifact_sha256']: raise SystemExit('ContractNLI eval/training artifact mismatch')
    if int(pc['completed_chunks'])!=4 or int(pc['global_steps'])!=615: raise SystemExit('ContractNLI incomplete training')
    if pq['artifact_sha256']!=cq['model_artifact_sha256']: raise SystemExit('CUAD eval/training artifact mismatch')
    if int(pq['completed_chunks'])!=4 or int(pq['selected_training_windows'])!=61659 or int(pq['global_steps'])!=2571: raise SystemExit('CUAD incomplete training')

    d=cn['dev']
    cn_pass=(float(d['accuracy'])>=.90 and float(d['macro_f1'])>=.88 and float(d['false_grounding_notmentioned'])<=.02 and float(d['selected_evidence_exact_span_recall'])>=.85)
    e=cq['evaluation']
    cq_pass=(float(e['no_answer_false_positive_rate'])<=.02 and float(e['answer_detection_f1'])>=.85 and float(e['localization_overlap_recall'])>=.85 and float(e['answerable_token_f1'])>=.80)
    if bool(cn['gate']['pass'])!=cn_pass: raise SystemExit('ContractNLI pass flag mismatch')
    if bool(cq['gate']['pass'])!=cq_pass: raise SystemExit('CUAD pass flag mismatch')

    rep={
      'schema':'musitu.revenueguard.v4_1.specialist_dev_admission.v5',
      'status':'SPECIALISTS_ADMITTED_FOR_V4_1_ASSEMBLY' if cn_pass and cq_pass else 'SPECIALIST_DEV_GATE_FAILED_NO_V4_1_ASSEMBLY',
      'certification':'NOT_CERTIFIED',
      'training_provenance_report_sha256':prov['report_sha256'],
      'contractnli':{'gate_pass':cn_pass,'report_sha256':cn['report_sha256'],'checkpoint_artifact_sha256':cn['checkpoint_artifact_sha256'],'chosen_k':cn['chosen_k'],'chosen_relevance_threshold':cn['chosen_threshold'],'calibration_contract':cn['calibration_contract'],'training_head_sha':pc['training_head_sha'],'source_encoder_artifact_sha256':pc['source_encoder_artifact_sha256'],'dev':d},
      'cuad':{'gate_pass':cq_pass,'report_sha256':cq['report_sha256'],'model_artifact_sha256':cq['model_artifact_sha256'],'threshold':cq['threshold'],'evaluation':e,'split_training_ancestry':chain,'source_model_artifact_sha256':pq['source_model_artifact_sha256'],'geometry_artifact_sha256':pq['geometry_artifact_sha256'],'trainer_geometry_report_sha256':pq['geometry_report_sha256'],'global_steps':pq['global_steps']},
      'frozen_v4_required_identity':{'archive_sha256':FROZEN_V4_SHA,'structured_money_regression_sha256':FROZEN_V4_REGRESSION_SHA,'regression_test_count':30},
      'sealed_datasets':{'contractnli_test_opened':False,'maud_opened':False,'cuad_official_test_opened':False},
      'real_world_boundary':{'permissioned_companies':0,'verified_recovered_cash_usd':0},
      'next_authority_if_admitted':'Assemble a complete V4.1 candidate from the verified immutable V4 plus these exact admitted specialist artifacts; freeze V4.1 by SHA-256; replay test_revenueguard_v4.py SHA-256 b669e2756a7846fb04bf40671ed66f456917a94881fb993ceb4ad003b63f44e2 unchanged. ContractNLI test and MAUD remain sealed until the V4.1 freeze/replay sequence is complete.',
      'prohibition':'This seal is development admission evidence only. It is not V4.1, not frontier certification, not production certification, and grants no authority to open sealed tests by itself.'
    }
    rep['report_sha256']=sha_obj(rep)
    Path(args.out).write_text(json.dumps(rep,indent=2,sort_keys=True)+'\n')
    print(json.dumps(rep,indent=2,sort_keys=True))
if __name__=='__main__': main()
