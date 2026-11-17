"""Recheck returned enterprise evidence without importing Axiom's checker.

Usage: python ops/verify_enterprise_response_evidence.py live-after.json
Uses Python Fraction and a separately invoked Node SHA-256 implementation.
"""
import argparse
import copy
from fractions import Fraction as F
import hashlib
import json
from pathlib import Path
import subprocess

ROOT=Path(__file__).resolve().parents[1]
POLICY={'absolute':'0.0000001','relative':'0.000000000001','feasibility_absolute':'0.00000001','feasibility_relative':'0.0000000001'}
def f(x):return F(str(x))
def close(a,b,feas=False):
    prefix='feasibility_' if feas else ''
    return abs(a-b)<=f(POLICY[prefix+'absolute'])+f(POLICY[prefix+'relative'])*max(abs(a),abs(b))
def dot(a,b):return sum((x*y for x,y in zip(a,b)),F(0))
def audit(case):
    operation,args=case['operation'],case['args'];engine=case['response']['structuredContent']['result'];value=engine['result'];ev=engine['verification']
    assert engine['verified'] is True and engine['ok'] is True
    while operation=='verify.crosscheck':
        assert value['verification']==ev
        operation,args=args['operation'],args['args'];value=value['result']
    assert ev['operation']==operation and ev['status']=='verified' and ev['verified'] is True and ev['tolerances']==POLICY
    assert ev['checker_source_sha256']==hashlib.sha256((ROOT/'mcp/independent_verification.mjs').read_bytes()).hexdigest()
    if operation=='finance.npv':
        rate=f(args['rate']);expected=sum((f(cf)/(1+rate)**i for i,cf in enumerate(args['cashflows'])),F(0))
        assert F(ev['checks']['expected_exact'])==expected
        assert close(expected,f(value)),'independent NPV mismatch'
    elif operation=='arithmetic.evaluate':
        assert args['expression']=='40+2' and f(value)==42 and ev['checks']['expected_exact']=='42'
    elif operation=='optimization.linear_program':
        assert value['success'] is True and value['status']==0
        c=list(map(f,args['c']));x=list(map(f,value['x']));n=len(c);constraints={}
        for name,bname in [('A_ub','b_ub'),('A_eq','b_eq')]:
            for i,(row,rhs) in enumerate(zip(args.get(name,[]),args.get(bname,[]))):
                a=list(map(f,row));b=f(rhs);constraints[f'{name}[{i}]']=(a,b)
                assert dot(a,x)<=b or close(dot(a,x),b,True)
                if name=='A_eq':constraints[f'-{name}[{i}]']=([-z for z in a],-b);assert close(dot(a,x),b,True)
        bounds=args.get('bounds') or [[0,None]]*n
        if not isinstance(bounds[0],list):bounds=[bounds]*n
        for i,(lo,hi) in enumerate(bounds):
            for bound,lower in [(lo,True),(hi,False)]:
                if bound is None:continue
                row=[F(0)]*n;row[i]=F(-1 if lower else 1);b=-f(bound) if lower else f(bound)
                constraints[f'{"lower" if lower else "upper"}[{i}]']=(row,b)
                assert dot(row,x)<=b or close(dot(row,x),b,True)
        objective=dot(c,x);assert close(objective,f(value['fun'])),'independent objective mismatch'
        cert=ev['checks']['optimality_certificate'];lam=list(map(F,cert['multipliers']));rows=[constraints[label] for label in cert['constraints']]
        assert len(lam)==len(rows) and all(z>=0 for z in lam)
        assert all(c[i]+sum((z*row[i] for z,(row,_) in zip(lam,rows)),F(0))==0 for i in range(n)),'stationarity fails'
        lower=-sum((z*b for z,(_,b) in zip(lam,rows)),F(0))
        assert lower==F(cert['dual_lower_bound_exact']) and close(objective,lower),'independent dual bound fails'
    else:raise AssertionError('Uncovered enterprise case')
    return case['id']

HASH_JS=r"""
const fs=require('node:fs'),crypto=require('node:crypto');
function ordered(x){if(Array.isArray(x))return x.map(ordered);if(x&&typeof x==='object')return Object.fromEntries(Object.keys(x).sort().map(k=>[k,ordered(x[k])]));return x;}
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(ordered(x))).digest('hex');
const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));
for(const c of data.cases){let op=c.operation,args=c.args;const e=c.response.structuredContent.result;let value=e.result;
while(op==='verify.crosscheck'){op=args.operation;args=args.args;value=value.result;}
const v=e.verification,copy={...v};delete copy.evidence_digest;
if(sha({operation:op,args})!==v.input_digest||sha(value)!==v.output_digest||sha(copy)!==v.evidence_digest)throw Error('evidence hash mismatch: '+c.id);
}
console.log(JSON.stringify({canonical_hashes_checked:data.cases.length,decision:'PASS'}));
"""
def main():
    parser=argparse.ArgumentParser();parser.add_argument('responses',type=Path);parser.add_argument('--output',type=Path);args=parser.parse_args()
    data=json.loads(args.responses.read_text());passed=[audit(c) for c in data['cases']]
    # Wrong NPV, wrong objective, stale inputs and a forged dual witness must fail.
    mutations=[]
    for label,target,mutate in [
        ('wrong_financial_result','old_base',lambda c:c['response']['structuredContent']['result'].__setitem__('result',0)),
        ('wrong_objective','ggf_lp',lambda c:c['response']['structuredContent']['result']['result'].__setitem__('fun',0)),
        ('stale_financial_evidence','old_base',lambda c:c['args'].__setitem__('rate',.5)),
        ('forged_dual_witness','ggf_lp',lambda c:c['response']['structuredContent']['result']['verification']['checks']['optimality_certificate'].__setitem__('multipliers',['0','0'])),
    ]:
        case=copy.deepcopy(next(c for c in data['cases'] if c['id']==target));mutate(case)
        try:audit(case)
        except (AssertionError,ValueError,KeyError):mutations.append({'case':label,'decision':'REJECTED_AS_EXPECTED'})
        else:raise AssertionError(label+' escaped the independent auditor')
    subprocess.run(['node','-e',HASH_JS,str(args.responses.resolve())],check=True)
    out={'schema':'musitu.axiom.independent-returned-evidence-audit.v1','decision':'PASS','live_cases_audited':passed,'negative_mutations':mutations,'response_file_sha256':hashlib.sha256(args.responses.read_bytes()).hexdigest(),'production_checker_imported':False}
    if args.output:args.output.write_text(json.dumps(out,indent=2)+'\n')
    print(json.dumps(out))
if __name__=='__main__':main()
