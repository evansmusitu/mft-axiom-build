#!/usr/bin/env python3
import argparse, hashlib, json
from pathlib import Path

CN_SCHEMA='musitu.revenueguard.contractnli.decoupled_checkpoint_eval.v1'
CUAD_SCHEMA='musitu.revenueguard.cuad.heldout_eval.v2_sharded'
GEOM_SCHEMA='musitu.revenueguard.cuad.trainer_geometry_contract_audit.v1'

CN_GATE={'accuracy_min':0.90,'macro_f1_min':0.88,'false_grounding_max':0.02,'evidence_recall_min':0.85}
CUAD_GATE={'no_answer_false_positive_max':0.02,'answer_detection_f1_min':0.85,'localization_overlap_recall_min':0.85,'answerable_token_f1_min':0.80}


def sha_obj(x): return hashlib.sha256(json.dumps(x,sort_keys=True,separators=(',',':')).encode()).hexdigest()

def eq_gate(actual,expected,name):
    for k,v in expected.items():
        if float(actual.get(k,-999))!=v: raise SystemExit(f'{name} gate drift {k}: {actual.get(k)} != {v}')

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--contractnli',required=True)
    ap.add_argument('--cuad',required=True)
    ap.add_argument('--cuad-geometry',required=True)
    ap.add_argument('--out',required=True)
    args=ap.parse_args()
    cn=json.load(open(args.contractnli)); cq=json.load(open(args.cuad)); geom=json.load(open(args.cuad_geometry))

    if cn.get('schema')!=CN_SCHEMA: raise SystemExit('ContractNLI schema mismatch')
    if cn.get('mode')!='decoupled': raise SystemExit('ContractNLI mode mismatch')
    if cq.get('schema')!=CUAD_SCHEMA: raise SystemExit('CUAD schema mismatch')
    if geom.get('schema')!=GEOM_SCHEMA or not geom.get('pass'): raise SystemExit('CUAD trainer geometry not proven')
    eq_gate(cn.get('gate') or {},CN_GATE,'ContractNLI')
    eq_gate(cq.get('gate') or {},CUAD_GATE,'CUAD')

    # Recompute pass flags from the locked metrics, never trust a boolean alone.
    d=cn['dev']
    cn_pass=(float(d['accuracy'])>=.90 and float(d['macro_f1'])>=.88 and
             float(d['false_grounding_notmentioned'])<=.02 and
             float(d['selected_evidence_exact_span_recall'])>=.85)
    e=cq['evaluation']
    cq_pass=(float(e['no_answer_false_positive_rate'])<=.02 and
             float(e['answer_detection_f1'])>=.85 and
             float(e['localization_overlap_recall'])>=.85 and
             float(e['answerable_token_f1'])>=.80)
    if bool(cn['gate']['pass'])!=cn_pass: raise SystemExit('ContractNLI pass flag mismatch')
    if bool(cq['gate']['pass'])!=cq_pass: raise SystemExit('CUAD pass flag mismatch')

    rep={
      'schema':'musitu.revenueguard.v4_1.specialist_dev_admission.v1',
      'status':'SPECIALISTS_ADMITTED_FOR_V4_1_ASSEMBLY' if cn_pass and cq_pass else 'SPECIALIST_DEV_GATE_FAILED_NO_V4_1_ASSEMBLY',
      'certification':'NOT_CERTIFIED',
      'contractnli':{
        'gate_pass':cn_pass,
        'report_sha256':cn['report_sha256'],
        'checkpoint_artifact_sha256':cn['checkpoint_artifact_sha256'],
        'chosen_k':cn['chosen_k'],
        'chosen_relevance_threshold':cn['chosen_threshold'],
        'dev':d,
      },
      'cuad':{
        'gate_pass':cq_pass,
        'report_sha256':cq['report_sha256'],
        'model_artifact_sha256':cq['model_artifact_sha256'],
        'threshold':cq['threshold'],
        'evaluation':e,
        'trainer_geometry_report_sha256':geom['report_sha256'],
      },
      'sealed_datasets':{
        'contractnli_test_opened':False,
        'maud_opened':False,
        'cuad_official_test_opened':False,
      },
      'real_world_boundary':{'permissioned_companies':0,'verified_recovered_cash_usd':0},
      'next_authority_if_admitted':'Recover and verify the exact frozen RevenueGuard V4 bytes SHA-256 16ce77c048bc39990b9fe338f3090e430b2c8d7f2767efef11369bd3013be85d and its authoritative structured-money regression harness; assemble a complete V4.1 candidate without mutating V4; freeze V4.1 by SHA-256; replay all frozen V4 regressions unchanged. ContractNLI test and MAUD remain sealed until that V4.1 freeze sequence is complete.',
      'prohibition':'This seal is development admission evidence only. It is not V4.1, not frontier certification, not production certification, and grants no authority to open sealed tests by itself.'
    }
    rep['report_sha256']=sha_obj(rep)
    Path(args.out).write_text(json.dumps(rep,indent=2,sort_keys=True)+'\n')
    print(json.dumps(rep,indent=2,sort_keys=True))

if __name__=='__main__': main()
