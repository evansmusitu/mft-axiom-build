"""Independent demo references: Decimal DCFs and exact 2D vertex enumeration.

No Axiom code, numerical solver, NumPy or SciPy is imported. This comparison
is reproducible evidence, not a signed certificate or an investment opinion.
"""
import argparse
from decimal import Decimal, localcontext
from fractions import Fraction
import hashlib
import itertools
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
def d(x):return Decimal(str(x))
def q(x):return Fraction(str(x))
def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--fixtures',type=Path,default=ROOT/'mcp/tests/fixtures/verification-live-before.json')
    parser.add_argument('--output',type=Path,default=Path('verification-evidence/independent-comparison.json'))
    args=parser.parse_args()
    data=json.loads(args.fixtures.read_text());cases=data['cases'];results=[]
    with localcontext() as ctx:
        ctx.prec=100
        for case in cases:
            if case['operation']!='finance.npv':continue
            a=case['args'];rate=d(a['rate'])
            terms=[d(flow)/(1+rate)**period for period,flow in enumerate(a['cashflows'])]
            expected=sum(terms,Decimal(0));observed=d(case['response']['structuredContent']['result']['result'])
            error=abs(expected-observed);limit=Decimal('1e-7')+Decimal('1e-12')*max(abs(expected),abs(observed))
            assert error<=limit,case['id']
            results.append({'id':case['id'],'expected_decimal':str(expected),'observed':str(observed),'absolute_error':str(error),'limit':str(limit),'discounted_cashflows':[str(t) for t in terms],'comparison':'PASS'})
        lp=next(c for c in cases if c['operation']=='optimization.linear_program');a=lp['args'];c=list(map(q,a['c']))
        # The enterprise fixture is a two-variable bounded participation model.
        assert len(c)==2 and a['bounds']==[[0,1],[0,1]] and not a.get('A_eq')
        rows=[(list(map(q,row)),q(rhs)) for row,rhs in zip(a['A_ub'],a['b_ub'])]
        rows += [([Fraction(-1),Fraction(0)],Fraction(0)),([Fraction(1),Fraction(0)],Fraction(1)),([Fraction(0),Fraction(-1)],Fraction(0)),([Fraction(0),Fraction(1)],Fraction(1))]
        vertices=[]
        for (u,b),(v,e) in itertools.combinations(rows,2):
            det=u[0]*v[1]-u[1]*v[0]
            if not det:continue
            x=[(b*v[1]-u[1]*e)/det,(u[0]*e-b*v[0])/det]
            if all(sum(ai*xi for ai,xi in zip(row,x))<=rhs for row,rhs in rows):vertices.append((sum(ci*xi for ci,xi in zip(c,x)),x))
        best,x=min(vertices);actual=lp['response']['structuredContent']['result']['result']
        assert actual['success'] is True and actual['status']==0
        assert all(abs(q(z)-xi)<=Fraction(1,10**10) for z,xi in zip(actual['x'],x))
        assert abs(q(actual['fun'])-best)<=Fraction(1,10**7)
        results.append({'id':lp['id'],'method':'exact-rational-2D-vertex-enumeration','vertices':[{'x':[str(z) for z in v],'min_objective':str(f)} for f,v in vertices],'optimal_fractions':[str(z) for z in x],'minimum_objective_exact':str(best),'maximum_npv':str(-Decimal(best.numerator)/Decimal(best.denominator)),'capital_used':str(sum(q(v)*xi for v,xi in zip(a['A_ub'][0],x))),'comparison':'PASS'})
    result={'schema':'musitu.axiom.independent-demo-comparison.v1','precision_decimal_digits':100,'fixture_sha256':hashlib.sha256(args.fixtures.read_bytes()).hexdigest(),'cases':results,'decision':'PASS_NUMERICAL_COMPARISON','certificate_issued':False}
    args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'independent_cases':len(results),'decision':result['decision'],'evidence_sha256':hashlib.sha256(args.output.read_bytes()).hexdigest()}))
if __name__=='__main__':main()
