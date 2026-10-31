#!/usr/bin/env python3
"""Strictly evidence-gated benchmark comparator; no scoring missing/fictional data."""
import argparse, hashlib, json, math, pathlib, sys
DIRECTIONS={'lower','higher'}
def evaluate(manifest, observations):
    if observations.get('program')!=manifest['program']:
        return {'status':'FAILED_INPUT','reason':'program_mismatch'}
    outcome=[]
    expected={d['id']:d for d in manifest['dimensions']}
    submitted={x.get('id'):x for x in observations.get('observations',[])}
    unknown=sorted(set(submitted)-set(expected))
    if unknown:return {'status':'FAILED_INPUT','reason':'unknown_dimensions','ids':unknown}
    for key,rule in expected.items():
        record=submitted.get(key)
        if not record:
            outcome.append({'id':key,'state':'NOT_PROVEN','reason':'no_measurement'});continue
        necessary=['axiom','baseline','baseline_product','baseline_version','benchmark_date','tasks_sha256','measurement_sha256','independent_verifier','independent_verifier_evidence_sha256','same_tasks','same_data','same_budget']
        missing=[p for p in necessary if p not in record]
        if missing:
            outcome.append({'id':key,'state':'NOT_PROVEN','reason':'missing_fields','fields':missing});continue
        digests=[record['tasks_sha256'],record['measurement_sha256'],record['independent_verifier_evidence_sha256']]
        if any(not isinstance(d,str) or len(d)!=64 or any(c not in '0123456789abcdef' for c in d) for d in digests):
            outcome.append({'id':key,'state':'NOT_PROVEN','reason':'invalid_digest'});continue
        if record['same_tasks'] is not True or record['same_data'] is not True or record['same_budget'] is not True or record.get('independent_verifier') in (None,'','builder','owner') or record.get('synthetic') is True:
            outcome.append({'id':key,'state':'NOT_PROVEN','reason':'methodology_or_verifier_unqualified'});continue
        a,b=record['axiom'],record['baseline']
        if isinstance(a,bool) or isinstance(b,bool) or not isinstance(a,(int,float)) or not isinstance(b,(int,float)) or not math.isfinite(a) or not math.isfinite(b):
            outcome.append({'id':key,'state':'NOT_PROVEN','reason':'invalid_metrics'});continue
        if rule['direction'] not in DIRECTIONS:raise ValueError('unsupported_direction')
        better=(a<b if rule['direction']=='lower' else a>b)
        target=(a<=rule['target'] if rule['direction']=='lower' else a>=rule['target'])
        outcome.append({'id':key,'state':'WIN_CANDIDATE_UNVERIFIED' if better and target else 'DID_NOT_BEAT_BASELINE','axiom':a,'baseline':b,'target_met':target})
    return {'status':'NOT_CERTIFIED','comparisons':outcome,'qualified_comparisons':0,'note':'Presence of digests and alleged independent verifier is not cryptographic or human validation. External evidence verification and Security Gateway veto remain mandatory.'}
if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('manifest');ap.add_argument('observations');ap.add_argument('--output');args=ap.parse_args()
    m=json.loads(pathlib.Path(args.manifest).read_text());o=json.loads(pathlib.Path(args.observations).read_text());r=evaluate(m,o)
    payload=json.dumps(r,indent=2,sort_keys=True)+'\n'
    if args.output:pathlib.Path(args.output).write_text(payload)
    print(payload);sys.exit(0 if r['status']=='NOT_CERTIFIED' else 2)
