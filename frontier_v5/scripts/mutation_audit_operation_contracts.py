from __future__ import annotations
import argparse, copy, importlib, json, pathlib, sys
from fastapi import HTTPException

REQUIRED={
'arithmetic.evaluate':{'expression'},
'algebra.simplify':{'expression'},'algebra.expand':{'expression'},'algebra.factor':{'expression'},
'algebra.solve':{'equations'},
'calculus.diff':{'expression'},'calculus.integrate':{'expression'},'calculus.limit':{'expression','to'},'calculus.series':{'expression'},
'numeric.root':{'expression','guess'},'numeric.integrate':{'expression','a','b'},'numeric.ode':{'rhs','t0','t1','y0'},'numeric.optimize_scalar':{'expression','a','b'},
'linear.det':{'A'},'linear.inv':{'A'},'linear.solve':{'A','b'},'linear.eigen':{'A'},
'statistics.describe':{'data'},'statistics.correlation':{'x','y'},'statistics.regression':{'x','y'},'statistics.quantile':{'data','q'},
'probability.normal_cdf':{'x'},'probability.normal_ppf':{'p'},
'finance.compound':{'principal','rate','years'},'finance.npv':{'cashflows','rate'},
'finance.black_scholes':{'S','K','T','r','sigma'},'finance.greeks':{'S','K','T','r','sigma'},'finance.var_historical':{'returns'},
'units.convert':{'value','from','to'},'verify.evaluate':{'lhs','rhs'},
'knowledge.constant':{'name'},'combinatorics.factorial':{'n'},'combinatorics.binomial':{'n','k'},
'numbertheory.isprime':{'n'},'numbertheory.factorint':{'n'},'numbertheory.gcd':{'a','b'},'numbertheory.lcm':{'a','b'},
'transforms.fft':{'data'},'statistics.covariance':{'x','y'},'statistics.zscore':{'data'},
'probability.binomial_pmf':{'k','n','p'},'probability.poisson_pmf':{'k','mu'},
'finance.returns':{'prices'},'finance.portfolio_metrics':{'returns','weights'},'finance.var_parametric':{'returns'},'finance.cvar_historical':{'returns'},
'timeseries.moving_average':{'data','window'},'timeseries.ewma':{'data','alpha'},'geometry.distance':{'p','q'},
'knowledge.element':{'symbol'},'algebra.polynomial_roots':{'expression'},'calculus.sum':{'expression','start','end'},'calculus.product':{'expression','start','end'},
'numeric.least_squares':{'A','b'},'numeric.interpolate':{'x','y','at'},'verified.interval_eval':{'expression','interval'},
'optimization.linear_program':{'c'},'optimization.quadratic':{'Q','c'},
'statistics.ttest_ind':{'x','y'},'statistics.normal_fit':{'data'},
'probability.exponential_cdf':{'x','rate'},'probability.chi2_cdf':{'x','df'},
'finance.implied_vol':{'price','S','K','T','r'},
'finance.bond_price':{'coupon_rate','maturity','yield'},'finance.bond_yield':{'coupon_rate','maturity','price'},'finance.duration':{'coupon_rate','maturity','yield'},
'finance.beta':{'asset_returns','market_returns'},'finance.drawdown':{'values'},'finance.monte_carlo_gbm':{'S0','mu','sigma','T'},
'timeseries.rolling_volatility':{'returns','window'},'geometry.area_circle':{'radius'},'geometry.volume_sphere':{'radius'},
'transforms.ifft':{'data'},'verify.crosscheck':{'operation'},
}

def bad_type(v):
    if isinstance(v,bool): return "not-a-boolean"
    if isinstance(v,str): return {"not":"a string"}
    if isinstance(v,(int,float)): return {"not":"a number"}
    if isinstance(v,list): return {"not":"a list"}
    if isinstance(v,dict): return ["not","an","object"]
    return {"unexpected":"type"}

def expect_422(m,op,args):
    try:
        req=m.ComputeRequest(operation=op,args=args,verify=True)
        out=m.compute(req)
        # If compute returns, ensure the response itself is JSON-safe; any success is failure for this mutation suite.
        json.dumps(out,allow_nan=False)
        return False,{"accepted":out}
    except HTTPException as e:
        return e.status_code==422,{"status":e.status_code,"detail":e.detail}
    except Exception as e:
        return False,{"escaped_exception":type(e).__name__,"message":str(e)}

def main():
    ap=argparse.ArgumentParser();ap.add_argument("--runtime",required=True);ap.add_argument("--fixtures",required=True);ap.add_argument("--out",required=True);ns=ap.parse_args()
    sys.path.insert(0,str(pathlib.Path(ns.runtime).resolve()))
    m=importlib.import_module("kernel.app.main")
    fixtures=json.load(open(ns.fixtures))["fixtures"]
    if set(REQUIRED)!=set(fixtures): raise SystemExit("required-field registry drift")
    tests=[];fail=[]
    def rec(op,name,ok,detail):
        row={"operation":op,"test":name,"ok":bool(ok),"detail":detail};tests.append(row)
        if not ok:fail.append(row)

    for op,args in sorted(fixtures.items()):
        # All declared required keys must fail cleanly when removed.
        for key in sorted(REQUIRED[op]):
            mutated=copy.deepcopy(args); mutated.pop(key,None)
            ok,detail=expect_422(m,op,mutated);rec(op,"missing."+key,ok,detail)
        # Every canonical argument must reject an obviously incompatible structural type.
        for key,val in sorted(args.items()):
            mutated=copy.deepcopy(args);mutated[key]=bad_type(val)
            ok,detail=expect_422(m,op,mutated);rec(op,"wrong_type."+key,ok,detail)

    # Pair-contract mutations not always present in canonical fixtures.
    pair_cases=[
      ("optimization.linear_program",{"c":[1],"A_ub":[[1]]},"lp.A_ub_without_b_ub"),
      ("optimization.linear_program",{"c":[1],"b_ub":[1]},"lp.b_ub_without_A_ub"),
      ("optimization.linear_program",{"c":[1],"A_eq":[[1]]},"lp.A_eq_without_b_eq"),
      ("optimization.linear_program",{"c":[1],"b_eq":[1]},"lp.b_eq_without_A_eq"),
      ("optimization.quadratic",{"Q":[[2]],"c":[0],"A_eq":[[1]]},"qp.A_eq_without_b_eq"),
      ("optimization.quadratic",{"Q":[[2]],"c":[0],"b_eq":[1]},"qp.b_eq_without_A_eq"),
      ("optimization.quadratic",{"Q":[[2]],"c":[0],"A_ub":[[1]]},"qp.A_ub_without_b_ub"),
      ("optimization.quadratic",{"Q":[[2]],"c":[0],"b_ub":[1]},"qp.b_ub_without_A_ub"),
    ]
    for op,args,name in pair_cases:
        ok,detail=expect_422(m,op,args);rec(op,name,ok,detail)

    report={"schema":"musitu.axiom.operation_contract_mutation_audit.v1","tests_run":len(tests),"failure_count":len(fail),"failures":fail,"tests":tests}
    pathlib.Path(ns.out).write_text(json.dumps(report,indent=2,sort_keys=True,default=str)+"\n")
    print("AXIOM_MUTATION_SUMMARY="+json.dumps({"tests_run":len(tests),"failure_count":len(fail)},sort_keys=True))
    for f in fail:print("AXIOM_MUTATION_FAILURE="+json.dumps(f,sort_keys=True,default=str)[:3500])
    return 0
if __name__=="__main__":raise SystemExit(main())
