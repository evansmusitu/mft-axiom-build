"""Generate deterministic finance/numerical reference vectors. NOT an AXIOM comparison.

Reference calculations use Python Decimal (34 digits), independent from AXIOM.
All expected numerical conventions are declared alongside every case.
"""
from decimal import Decimal, localcontext
from pathlib import Path
import json

HERE=Path(__file__).resolve().parent

def d(v): return Decimal(str(v))

def npv(flows,rate):
    with localcontext() as ctx:
        ctx.prec=34
        z=Decimal(0)
        for t,f in enumerate(flows): z+=d(f)/(Decimal(1)+d(rate))**t
        return z

def bond(face,coupon_rate,periods,yield_rate):
    with localcontext() as ctx:
        ctx.prec=34
        f,c,p,y=d(face),d(coupon_rate),int(periods),d(yield_rate)
        assert p>0 and y>Decimal(-1)
        return sum((f*c+(f if t==p else 0))/(1+y)**t for t in range(1,p+1))

def build():
    cases=[]
    rate_grid=['0','0.01','0.025','0.05','0.075','0.1','0.15','0.2','-0.05','-0.1','0.35','0.5']
    for i,rate in enumerate(rate_grid):
        flows=[-1000-i*11, 60+5*i, 170+7*i, 340+13*i, 560+17*i, 800+19*i]
        cases.append({'id':f'npv_{i:02}','operation':'finance.npv','args':{'cashflows':flows,'rate':float(rate)},'expected':str(npv(flows,rate)),'convention':'t0 undiscounted; each subsequent cashflow discounted by (1+rate)^t','abs_tolerance':'0.0000001'})
    for i,rate in enumerate(['0.01','0.02','0.035','0.05','0.075','0.1','0.13','0.2','-0.01','0.0']):
        face=1000+i*10;coupon='0.05';years=i+1
        cases.append({'id':f'bond_{i:02}','operation':'finance.bond_price','args':{'face':face,'coupon_rate':float(coupon),'maturity':years,'frequency':1,'yield':float(rate)},'expected':str(bond(face,coupon,years,rate)),'convention':'annual fixed coupon, frequency=1, face at maturity, yield annual, no accrued interest','abs_tolerance':'0.0000001'})
    for i in range(12):
        q1=2*(i+1);q2=2*(i+2);c1=-(i+1)*2;c2=-(i+2)*4
        x1=d(-c1)/d(q1);x2=d(-c2)/d(q2)
        value=d(q1)*x1*x1/2+d(q2)*x2*x2/2+d(c1)*x1+d(c2)*x2
        cases.append({'id':f'qp_{i:02}','operation':'optimization.quadratic','args':{'Q':[[q1,0],[0,q2]],'c':[c1,c2]},'expected_x':[str(x1),str(x2)],'expected_objective':str(value),'convention':'unconstrained minimum 0.5*x^T Q x + c^T x, strictly positive diagonal Q','abs_tolerance':'0.0000001'})
    return {'schema_version':1,'claim':'REFERENCE_VECTORS_ONLY_NOT_AXIOM_TESTED','reference_engine':'Python Decimal 34-digit precision; exact convex diagonal quadratic stationary point','cases':cases}

if __name__=='__main__':
    p=HERE/'finance_reference_cases.json';p.write_text(json.dumps(build(),indent=2,sort_keys=True)+'\n');print(f'{len(build()["cases"])} deterministic reference vectors -> {p.name}')
