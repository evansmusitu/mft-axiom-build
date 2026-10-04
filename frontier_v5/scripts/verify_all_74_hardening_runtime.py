from __future__ import annotations
import argparse, copy, importlib, json, math, pathlib, sys
from fastapi import HTTPException

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--runtime",required=True)
    ap.add_argument("--fixtures",required=True)
    ns=ap.parse_args()
    sys.path.insert(0,str(pathlib.Path(ns.runtime).resolve()))
    m=importlib.import_module("kernel.app.main")
    fixtures=json.load(open(ns.fixtures))["fixtures"]

    # 1) Every canonical operation must execute and serialize cleanly.
    for op,args in fixtures.items():
        out=m.encode(m.dispatch(op,copy.deepcopy(args),50))
        json.dumps(out,sort_keys=True,allow_nan=False)

    # 2) Unknown caller keys must fail closed for every certified operation.
    accepted=[]
    for op,args in fixtures.items():
        bad=copy.deepcopy(args); bad["__unknown_contract_probe__"]=1
        try:
            m.dispatch(op,bad,50)
            accepted.append(op)
        except Exception:
            pass
    if accepted:
        raise AssertionError("unknown arguments accepted: "+",".join(accepted))

    # 3) Valid symbolic solve must be JSON-safe and correct.
    sol=m.encode(m.dispatch("algebra.solve",{"equations":["x+y-3","x-y-1"],"symbols":["x","y"]},50))
    json.dumps(sol,sort_keys=True,allow_nan=False)
    assert any(str(row.get("x"))=="2" and str(row.get("y"))=="1" for row in sol), sol

    # 4) Complex eigenvalues/vectors must be JSON-safe.
    eig=m.encode(m.dispatch("linear.eigen",{"A":[[0,-1],[1,0]]},50))
    json.dumps(eig,sort_keys=True,allow_nan=False)
    assert len(eig["values"])==2

    # 5) Domain-invalid cases must reject rather than returning NaN/garbage.
    rejects=[
      ("numeric.optimize_scalar",{"expression":"x^2","a":2,"b":-2}),
      ("numeric.interpolate",{"x":[0,2,1],"y":[0,4,1],"at":[1.5]}),
      ("numeric.interpolate",{"x":[0,1],"y":[0],"at":[.5]}),
      ("statistics.describe",{"data":[]}),
      ("statistics.correlation",{"x":[1,1,1],"y":[1,2,3]}),
      ("statistics.zscore",{"data":[]}),
      ("statistics.ttest_ind",{"x":[],"y":[1,2]}),
      ("statistics.normal_fit",{"data":[]}),
      ("probability.normal_cdf",{"x":0,"sigma":0}),
      ("probability.normal_ppf",{"p":1.1,"sigma":1}),
      ("probability.binomial_pmf",{"k":3,"n":10,"p":1.2}),
      ("probability.binomial_pmf",{"k":3,"n":-1,"p":.4}),
      ("probability.poisson_pmf",{"k":3,"mu":-1}),
      ("probability.exponential_cdf",{"x":2,"rate":0}),
      ("probability.chi2_cdf",{"x":5,"df":0}),
      ("finance.greeks",{"S":100,"K":100,"T":1,"r":.05,"sigma":.2,"kind":"straddle"}),
      ("finance.compound",{"principal":1000,"rate":.05,"years":10,"n":0}),
      ("finance.npv",{"cashflows":[-100,110],"rate":-1}),
      ("finance.var_historical",{"returns":[],"alpha":.95}),
      ("finance.var_historical",{"returns":[.1,-.1],"alpha":1.5}),
      ("finance.var_parametric",{"returns":[.1],"alpha":.95}),
      ("finance.var_parametric",{"returns":[.1,-.1],"alpha":0}),
      ("finance.cvar_historical",{"returns":[],"alpha":.95}),
      ("finance.portfolio_metrics",{"returns":[[.1,.2]],"weights":[.5,.5],"annualization":252}),
      ("finance.beta",{"asset_returns":[.1,.2,.3],"market_returns":[.2,.2,.2]}),
      ("finance.drawdown",{"values":[]}),
      ("finance.drawdown",{"values":[0,1,2]}),
      ("finance.monte_carlo_gbm",{"S0":100,"mu":.05,"sigma":.2,"T":1,"steps":0,"paths":10}),
      ("finance.monte_carlo_gbm",{"S0":-100,"mu":.05,"sigma":.2,"T":1,"steps":10,"paths":10}),
      ("finance.monte_carlo_gbm",{"S0":100,"mu":.05,"sigma":-.2,"T":1,"steps":10,"paths":10}),
      ("finance.implied_vol",{"price":150,"S":100,"K":100,"T":1,"r":.05,"kind":"call"}),
      ("finance.bond_price",{"face":-1000,"coupon_rate":.05,"maturity":5,"yield":.04,"frequency":2}),
      ("finance.bond_price",{"face":1000,"coupon_rate":.05,"maturity":5,"yield":.04,"frequency":0}),
      ("finance.bond_yield",{"face":1000,"coupon_rate":.05,"maturity":5,"price":-1,"frequency":2}),
      ("finance.duration",{"face":1000,"coupon_rate":.05,"maturity":0,"yield":.04,"frequency":2}),
      ("geometry.area_circle",{"radius":-2}),
      ("geometry.volume_sphere",{"radius":-2}),
      ("geometry.distance",{"p":[],"q":[]}),
      ("timeseries.ewma",{"data":[],"alpha":.2}),
      ("timeseries.moving_average",{"data":[],"window":1}),
      ("timeseries.rolling_volatility",{"returns":[.1,.2],"window":2,"annualization":-1}),
      ("combinatorics.factorial",{"n":-1}),
      ("combinatorics.binomial",{"n":5,"k":7}),
      ("numbertheory.factorint",{"n":0}),
    ]
    accepted_invalid=[]
    for op,args in rejects:
        try:
            m.dispatch(op,copy.deepcopy(args),50)
            accepted_invalid.append((op,args))
        except Exception:
            pass
    if accepted_invalid:
        raise AssertionError("invalid domains accepted: "+repr(accepted_invalid))

    # 6) Fail-closed semantic enum validation.
    for op,args in [
      ("finance.returns",{"prices":[100,101,102],"kind":"typo"}),
      ("finance.black_scholes",{"S":100,"K":100,"T":1,"r":.05,"sigma":.2,"kind":"typo"}),
      ("finance.greeks",{"S":100,"K":100,"T":1,"r":.05,"sigma":.2,"kind":"typo"}),
      ("finance.implied_vol",{"price":10,"S":100,"K":100,"T":1,"r":.05,"kind":"typo"}),
    ]:
        try: m.dispatch(op,args,50)
        except Exception: pass
        else: raise AssertionError(f"{op} accepted invalid enum")

    # 7) Compute verify flag must actually invoke available verification.
    verification_cases=[
      ("calculus.diff",{"expression":"x^3","symbol":"x"}),
      ("numeric.root",{"expression":"x^2-2","symbol":"x","guess":1}),
      ("numeric.integrate",{"expression":"x^2","a":0,"b":1}),
      ("linear.solve",{"A":[[2,1],[1,3]],"b":[3,4]}),
      ("finance.black_scholes",{"S":100,"K":100,"T":1,"r":.05,"sigma":.2,"kind":"call"}),
      ("finance.implied_vol",{"price":10,"S":100,"K":100,"T":1,"r":.05,"kind":"call"}),
      ("optimization.linear_program",{"c":[1,1],"A_ub":[[-1,-1]],"b_ub":[-1],"bounds":[[0,None],[0,None]]}),
      ("optimization.quadratic",{"Q":[[2.0]],"c":[-4.0],"bounds":[[0,1]]}),
    ]
    for op,args in verification_cases:
        out=m.compute(m.ComputeRequest(operation=op,args=args,verify=True))
        v=out.get("verified")
        if not isinstance(v,dict) or v.get("verified") is not True:
            raise AssertionError(f"verify flag ineffective for {op}: {v!r}")

    disabled=m.compute(m.ComputeRequest(operation="linear.solve",args={"A":[[1]],"b":[2]},verify=False))
    if disabled.get("verified") not in (None,{"verified":None,"method":"disabled"}):
        raise AssertionError("verify=False contract unexpected")

    # 8) Public compute layer must convert invalid-domain/non-finite outcomes to 422, not 500.
    for op,args in [
      ("statistics.correlation",{"x":[1,1,1],"y":[1,2,3]}),
      ("probability.normal_cdf",{"x":0,"sigma":0}),
      ("geometry.area_circle",{"radius":-1}),
    ]:
        try:
            m.compute(m.ComputeRequest(operation=op,args=args,verify=True))
        except HTTPException as e:
            if e.status_code!=422: raise AssertionError(f"{op} invalid input status {e.status_code}")
        else:
            raise AssertionError(f"{op} invalid input unexpectedly succeeded")

    print("MUSITU_AXIOM_ALL_74_HARDENING_REGRESSION_PASS")
    return 0

if __name__=="__main__": raise SystemExit(main())
