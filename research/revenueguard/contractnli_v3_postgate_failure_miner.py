#!/usr/bin/env python3
import argparse, hashlib, json
from collections import Counter, defaultdict
from pathlib import Path

LABELS={0:'Contradiction',1:'Entailment',2:'NotMentioned'}
EXPECTED_AGG_SCHEMA='musitu.revenueguard.contractnli.pairwise_v3_recovery_locked_dev_eval.v1'
EXPECTED_RAW_SCHEMA='musitu.revenueguard.contractnli.pairwise_v3_recovery_raw_shard.v1'
EXPECTED_NAMES_SHA='a858e138760588bdb8c89cb440e75a0f9441d23f7a3a9993a1755a3dc8f77c05'
EXPECTED_SHAPES_SHA='ce0e68f3d68ad81c95165bce95cf196c25bf2756798fbc885b371fef67c9e696'


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--aggregate',required=True);ap.add_argument('--shard-glob',required=True);ap.add_argument('--out',required=True);args=ap.parse_args()
    agg=json.load(open(args.aggregate))
    if agg.get('schema')!=EXPECTED_AGG_SCHEMA:raise SystemExit('unexpected aggregate schema; relevance-only calibration v2 required')
    if agg.get('mode')!='pairwise_relevance_positive_only_semantics':raise SystemExit('not trained V3 pairwise candidate')
    if 'semantic-head labels or correctness do not participate' not in agg.get('calibration_contract',''):raise SystemExit('aggregate is not relevance-only calibrated')
    if agg.get('trainable_names_sha256')!=EXPECTED_NAMES_SHA or agg.get('trainable_shapes_sha256')!=EXPECTED_SHAPES_SHA:raise SystemExit('aggregate state fingerprint drift')
    if agg.get('report_sha256')!='4770d2cad2cdc1faa43706f93a9aa78e80e602d8921c79e5e92560a8f57e3a9f':raise SystemExit('original V3 dev report identity drift')
    if agg.get('checkpoint_artifact_sha256')!='503d654bbb2aa7a384888f7c2959caaee15a63c6cfde6f4693f1fa08d4f75369':raise SystemExit('checkpoint artifact drift')
    if agg.get('source_encoder_artifact_sha256')!='ea7e9a0cf451ea998cd2b055df93b3a7cbde52654cc1268446e5682f7adb6916':raise SystemExit('source encoder drift')
    if agg.get('gate',{}).get('pass') is not False:raise SystemExit('unexpected gate result')
    if agg.get('excluded_duplicate_equivalent_calibration_doc_ids')!=['548'] or agg.get('calibration_rows')!=595:raise SystemExit('duplicate-clean calibration ancestry drift')
    if agg.get('dev_rows')!=1037:raise SystemExit('dev partition identity drift')
    k=int(agg['chosen_k']);th=float(agg['chosen_threshold'])
    if (k,th)!=(32,0.91):raise SystemExit('V3 locked calibration drift')

    files=sorted(Path('.').glob(args.shard_glob));rows=[];seen=set();shard_ids=set()
    for f in files:
        o=json.load(open(f))
        if o.get('schema')!=EXPECTED_RAW_SCHEMA:raise SystemExit(f'bad shard schema {f}')
        if o.get('trainable_names_sha256')!=EXPECTED_NAMES_SHA or o.get('trainable_shapes_sha256')!=EXPECTED_SHAPES_SHA:raise SystemExit(f'shard state fingerprint drift {f}')
        if o.get('source_encoder_artifact_sha256')!=agg['source_encoder_artifact_sha256'] or o.get('v3_state_sha256')!=agg['checkpoint_state_sha256']:raise SystemExit(f'shard checkpoint ancestry drift {f}')
        if o.get('num_shards')!=8 or o.get('next_chunk')!=4 or o.get('mode')!='pairwise_relevance_positive_only_semantics':raise SystemExit(f'shard completeness drift {f}')
        shard_ids.add(int(o['shard_index']))
        for r in o['rows']:
            key=(r['corpus'],r['doc'],r['hid'])
            if key in seen:raise SystemExit(f'duplicate row {key}')
            seen.add(key);rows.append(r)
    expected=set(range(len(files)))
    if shard_ids!=expected:raise SystemExit((shard_ids,expected))

    dev=[r for r in rows if r['corpus']=='dev']
    if len(dev)!=int(agg['dev_rows']):raise SystemExit((len(dev),agg['dev_rows']))
    fam=defaultdict(list);by_hyp=defaultdict(Counter)
    for r in dev:
        s=r['scores'][str(k)];pred=s['candidate_label'] if float(s['score'])>=th else 2
        gold=int(r['gold']);hid=r['hid'];best=s['best_span_index'];gold_spans=set(r.get('gold_spans') or []);exact=best in gold_spans if gold!=2 else False
        if gold==2:
            if pred!=2:fam['false_grounding_notmentioned'].append(r);by_hyp[hid]['false_grounding_notmentioned']+=1
            else:by_hyp[hid]['correct_notmentioned']+=1
            continue
        by_hyp[hid]['positive_n']+=1
        if not exact:fam['wrong_evidence_selection'].append(r);by_hyp[hid]['wrong_evidence_selection']+=1
        if pred==2:fam['positive_abstention'].append(r);by_hyp[hid]['positive_abstention']+=1
        elif pred!=gold:fam['semantic_polarity_flip'].append(r);by_hyp[hid]['semantic_polarity_flip']+=1
        else:by_hyp[hid]['correct_positive']+=1
        if exact and pred==2:fam['abstention_despite_exact_evidence'].append(r);by_hyp[hid]['abstention_despite_exact_evidence']+=1
        if exact and pred not in (2,gold):fam['semantic_flip_despite_exact_evidence'].append(r);by_hyp[hid]['semantic_flip_despite_exact_evidence']+=1
        if (not exact) and pred==gold:fam['semantic_correct_despite_wrong_evidence'].append(r);by_hyp[hid]['semantic_correct_despite_wrong_evidence']+=1

    def ex(rs):
        out=[]
        for r in sorted(rs,key=lambda x:(x['hid'],x['doc']))[:12]:
            s=r['scores'][str(k)];out.append({'doc':r['doc'],'hid':r['hid'],'gold':LABELS[int(r['gold'])],'relevance_score':s['score'],'candidate_label':LABELS[int(s['candidate_label'])],'best_span_index':s['best_span_index'],'gold_spans':r.get('gold_spans') or []})
        return out
    rep={'schema':'musitu.revenueguard.contractnli.pairwise_v3_postgate_failure_mining.v1','status':'POST_GATE_DEV_DIAGNOSTIC_TEST_AND_MAUD_REMAIN_SEALED','source_aggregate_report_sha256':agg['report_sha256'],'checkpoint_artifact_sha256':agg['checkpoint_artifact_sha256'],'calibration_contract':agg['calibration_contract'],'trainable_names_sha256':agg['trainable_names_sha256'],'trainable_shapes_sha256':agg['trainable_shapes_sha256'],'chosen_k_frozen':k,'chosen_relevance_threshold_frozen':th,'dev_rows':len(dev),'gate_pass':bool(agg['gate']['pass']),'failure_family_counts':{x:len(y) for x,y in sorted(fam.items())},'by_hypothesis':{h:dict(c) for h,c in sorted(by_hyp.items())},'failure_family_examples':{x:ex(y) for x,y in sorted(fam.items())},'curriculum_rule':'No threshold, K, gate, split or test result is changed. Failure categories are diagnostic only; future training may use build-only examples, never this dev set as training data.','sealed_policy':'ContractNLI test.json and MAUD remain unopened.'}
    rep['report_sha256']=hashlib.sha256(json.dumps(rep,sort_keys=True,separators=(',',':')).encode()).hexdigest();Path(args.out).write_text(json.dumps(rep,indent=2,sort_keys=True)+'\n');print(json.dumps({k:v for k,v in rep.items() if k!='failure_family_examples'},indent=2,sort_keys=True))

if __name__=='__main__':main()
