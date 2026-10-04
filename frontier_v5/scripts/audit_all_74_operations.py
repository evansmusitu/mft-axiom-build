from __future__ import annotations
import argparse, copy, importlib, json, math, pathlib, sys, traceback
import numpy as np

def finite_tree(v):
    if isinstance(v, dict): return all(finite_tree(x) for x in v.values())
    if isinstance(v, (list,tuple)): return all(finite_tree(x) for x in v)
    if isinstance(v, (int,bool,str)) or v is None: return True
    if isinstance(v, float): return math.isfinite(v)
    return True

def norm(v):
    if isinstance(v, dict): return {str(k):norm(x) for k,x in v.items()}
    if isinstance(v, (list,tuple)): return [norm(x) for x in v]
    if isinstance(v, np.ndarray): return norm(v.tolist())
    if isinstance(v, np.generic): return v.item()
    return str(v) if type(v).__module__.startswith("sympy") else v

def approx(a,b,tol=1e-8): return abs(float(a)-float(b)) <= tol*max(1.0,abs(float(b)))

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--runtime",required=True)
    ap.add_argument("--fixtures",required=True)
    ap.add_argument("--out",required=True)
    ns=ap.parse_args()
    sys.path.insert(0,str(pathlib.Path(ns.runtime).resolve()))
    m=importlib.import_module("kernel.app.main")
    fixtures=json.load(open(ns.fixtures))["fixtures"]
    findings=[]
    rows={}

    def finding(op,category,severity,detail,evidence=None):
        findings.append({"operation":op,"category":category,"severity":severity,"detail":detail,"evidence":evidence})

    # Canonical execution + determinism + serialization + verification visibility.
    for op,args in fixtures.items():
        rec={"canonical":"unknown","deterministic":None,"finite":None,"unknown_arg_rejected":None,"missing_arg_rejected":None,"verification":None}
        try:
            r1=m.dispatch(op,copy.deepcopy(args),50); e1=m.encode(r1); json.dumps(e1,sort_keys=True,allow_nan=False)
            rec["canonical"]="pass"; rec["finite"]=finite_tree(e1)
            if not rec["finite"]:
                finding(op,"nonfinite-output","high","canonical call returned NaN/Inf",norm(e1))
            try:
                r2=m.dispatch(op,copy.deepcopy(args),50); e2=m.encode(r2)
                rec["deterministic"]=norm(e1)==norm(e2)
                if rec["deterministic"] is False and op!="finance.monte_carlo_gbm":
                    finding(op,"nondeterminism","medium","identical deterministic inputs produced different outputs",{"a":norm(e1),"b":norm(e2)})
            except Exception as e:
                rec["deterministic"]=False
                finding(op,"repeat-failure","high",f"canonical repeat failed: {type(e).__name__}: {e}")
            try:
                vv=m._verify_operation(op,copy.deepcopy(args),e1,50)
                rec["verification"]=norm(vv)
                if isinstance(vv,dict) and vv.get("verified") is False:
                    finding(op,"verification-failure","critical","canonical result failed built-in verification",norm(vv))
                if isinstance(vv,dict) and vv.get("verified") is None:
                    finding(op,"verification-gap","medium","canonical result has no substantive independent verification",norm(vv))
            except Exception as e:
                finding(op,"verification-exception","high",f"{type(e).__name__}: {e}")
        except Exception as e:
            rec["canonical"]="fail"
            finding(op,"canonical-failure","critical",f"{type(e).__name__}: {e}")

        # Unknown-key typo probe. A certified operation should not silently ignore nonsense caller fields.
        bad=copy.deepcopy(args); bad["__axiom_unknown_probe__"]=123456789
        try:
            br=m.dispatch(op,bad,50)
            rec["unknown_arg_rejected"]=False
            finding(op,"silent-unknown-argument","high","unknown caller argument was silently accepted",{"key":"__axiom_unknown_probe__","result":norm(m.encode(br))})
        except Exception:
            rec["unknown_arg_rejected"]=True

        # Remove one canonical required-looking field. This is a heuristic; operations with a default can be noted rather than failed.
        if args:
            key=next(iter(args))
            miss=copy.deepcopy(args); miss.pop(key,None)
            try:
                mr=m.dispatch(op,miss,50)
                rec["missing_arg_rejected"]=False
                finding(op,"missing-field-accepted","medium",f"canonical field {key!r} removed but call still succeeded",norm(m.encode(mr)))
            except Exception:
                rec["missing_arg_rejected"]=True
        rows[op]=rec

    # Cross-operation and domain invariants.
    def must_reject(op,args,label,severity="high"):
        try:
            r=m.dispatch(op,copy.deepcopy(args),50)
            finding(op,"invalid-domain-accepted",severity,label,norm(m.encode(r)))
        except Exception:
            pass

    def must(op,args,pred,label,severity="critical"):
        try:
            r=m.encode(m.dispatch(op,copy.deepcopy(args),50))
            ok=bool(pred(r))
            if not ok: finding(op,"wrong-result",severity,label,norm(r))
        except Exception as e:
            finding(op,"unexpected-domain-error",severity,f"{label}: {type(e).__name__}: {e}")

    # Arithmetic/algebra/calculus/numeric
    must("arithmetic.evaluate",{"expression":"1/3+2/3"},lambda r: approx(float(r),1.0,1e-12),"exact arithmetic identity failed")
    must("algebra.expand",{"expression":"(x+1)^3"},lambda r:"x**3" in str(r) and "3*x**2" in str(r),"polynomial expansion invariant failed")
    must("algebra.factor",{"expression":"x^2-1"},lambda r:str(r) in {"(x - 1)*(x + 1)","(x + 1)*(x - 1)"},"factorization invariant failed")
    must("algebra.solve",{"equations":["x+y-3","x-y-1"],"symbols":["x","y"]},lambda r:any("2" in str(z.get("x","")) and "1" in str(z.get("y","")) for z in r if isinstance(z,dict)),"2x2 symbolic solve failed")
    must("calculus.diff",{"expression":"sin(x)","symbol":"x"},lambda r:str(r)=="cos(x)","derivative identity failed")
    must("calculus.integrate",{"expression":"2*x","symbol":"x","bounds":[0,3]},lambda r:approx(float(r),9,1e-12),"definite integral failed")
    must("calculus.limit",{"expression":"(1-cos(x))/x^2","symbol":"x","to":0},lambda r:approx(float(r),.5,1e-12),"limit identity failed")
    must("calculus.sum",{"expression":"k","symbol":"k","start":1,"end":100},lambda r:int(r)==5050,"finite sum failed")
    must("calculus.product",{"expression":"k","symbol":"k","start":1,"end":6},lambda r:int(r)==720,"finite product failed")
    must("numeric.root",{"expression":"cos(x)-x","symbol":"x","guess":.7},lambda r:abs(float(r)-0.7390851332151607)<1e-10,"numeric root accuracy failed")
    must("numeric.integrate",{"expression":"sin(x)","a":0,"b":math.pi},lambda r:abs(float(r["value"])-2)<1e-9,"numeric integration accuracy failed")
    must("numeric.ode",{"rhs":"-2*y","t0":0,"t1":1,"y0":1},lambda r:r["success"] and abs(float(r["y"][-1])-math.exp(-2))<2e-7,"ODE exponential solution failed")
    must("numeric.optimize_scalar",{"expression":"(x-2.5)^2","a":-10,"b":10},lambda r:r["success"] and abs(float(r["x"])-2.5)<1e-5,"scalar optimization failed")
    must_reject("numeric.optimize_scalar",{"expression":"x^2","a":2,"b":-2},"reversed scalar optimization bounds should be rejected")
    must_reject("numeric.interpolate",{"x":[0,2,1],"y":[0,4,1],"at":[1.5]},"unsorted interpolation x should be rejected rather than silently misinterpreted")
    must_reject("numeric.interpolate",{"x":[0,1],"y":[0],"at":[.5]},"interpolation x/y length mismatch should be rejected")
    must_reject("numeric.least_squares",{"A":[[1,2],[3,4]],"b":[1]},"least-squares dimension mismatch should be rejected")

    # Linear algebra
    must("linear.det",{"A":[[1,2],[3,4]]},lambda r:abs(float(r)+2)<1e-12,"determinant failed")
    must("linear.solve",{"A":[[3,1],[1,2]],"b":[9,8]},lambda r:np.linalg.norm(np.array([[3,1],[1,2]],float)@np.asarray(r,float)-np.array([9,8]))<1e-10,"linear solve residual failed")
    must("linear.inv",{"A":[[4,7],[2,6]]},lambda r:np.linalg.norm(np.array([[4,7],[2,6]],float)@np.asarray(r,float)-np.eye(2))<1e-10,"matrix inverse residual failed")
    must_reject("linear.det",{"A":[[1,2,3],[4,5,6]]},"determinant of non-square matrix should reject")
    must_reject("linear.inv",{"A":[[1,2],[2,4]]},"singular inverse should reject")
    must_reject("linear.solve",{"A":[[1,2],[2,4]],"b":[1,2]},"singular solve should reject")

    # Statistics/probability
    must("statistics.describe",{"data":[1,2,3,4,5]},lambda r:r["n"]==5 and approx(r["mean"],3) and approx(r["median"],3),"describe invariant failed")
    must_reject("statistics.describe",{"data":[]},"empty descriptive statistics should reject")
    must_reject("statistics.correlation",{"x":[1,2],"y":[1]},"correlation length mismatch should reject")
    must_reject("statistics.correlation",{"x":[1,1,1],"y":[1,2,3]},"zero-variance correlation should reject instead of NaN")
    must_reject("statistics.regression",{"x":[1,1,1],"y":[1,2,3]},"regression with identical x should reject")
    must_reject("statistics.quantile",{"data":[1,2,3],"q":1.5},"quantile q outside [0,1] should reject")
    must_reject("statistics.quantile",{"data":[],"q":.5},"empty quantile data should reject")
    must_reject("statistics.zscore",{"data":[]},"empty zscore data should reject")
    must_reject("statistics.covariance",{"x":[1,2],"y":[1]},"covariance length mismatch should reject")
    must_reject("statistics.ttest_ind",{"x":[],"y":[1,2]},"empty t-test sample should reject")
    must_reject("statistics.normal_fit",{"data":[]},"normal fit empty data should reject")
    must("probability.normal_cdf",{"x":0,"mu":0,"sigma":1},lambda r:approx(r,.5,1e-12),"normal CDF(0) failed")
    must("probability.normal_ppf",{"p":.975,"mu":0,"sigma":1},lambda r:abs(float(r)-1.959963984540054)<1e-10,"normal PPF failed")
    must_reject("probability.normal_cdf",{"x":0,"sigma":0},"normal sigma<=0 should reject")
    must_reject("probability.normal_ppf",{"p":1.1,"sigma":1},"normal p outside [0,1] should reject")
    must_reject("probability.binomial_pmf",{"k":3,"n":10,"p":1.2},"binomial p outside [0,1] should reject")
    must_reject("probability.binomial_pmf",{"k":3,"n":-1,"p":.4},"negative binomial n should reject")
    must_reject("probability.poisson_pmf",{"k":3,"mu":-1},"negative Poisson mu should reject")
    must_reject("probability.exponential_cdf",{"x":2,"rate":0},"nonpositive exponential rate should reject")
    must_reject("probability.chi2_cdf",{"x":5,"df":0},"nonpositive chi-square df should reject")

    # Finance
    bs={"S":100,"K":95,"T":1.5,"r":.04,"sigma":.25,"q":.01}
    must("finance.black_scholes",{**bs,"kind":"call"},lambda c: float(c)>0,"Black-Scholes call positivity failed")
    try:
        c=float(m.dispatch("finance.black_scholes",{**bs,"kind":"call"},50))
        p=float(m.dispatch("finance.black_scholes",{**bs,"kind":"put"},50))
        rhs=bs["S"]*math.exp(-bs["q"]*bs["T"])-bs["K"]*math.exp(-bs["r"]*bs["T"])
        if abs((c-p)-rhs)>1e-8: finding("finance.black_scholes","cross-operation-invariant","critical","put-call parity failed",{"call":c,"put":p,"rhs":rhs})
    except Exception as e: finding("finance.black_scholes","cross-operation-error","critical",str(e))
    must_reject("finance.greeks",{"S":100,"K":100,"T":0,"r":.05,"sigma":.2,"kind":"call"},"Greeks T<=0 should reject")
    must_reject("finance.greeks",{"S":100,"K":100,"T":1,"r":.05,"sigma":0,"kind":"call"},"Greeks sigma<=0 should reject")
    must_reject("finance.greeks",{"S":100,"K":100,"T":1,"r":.05,"sigma":.2,"kind":"straddle"},"invalid Greeks option kind should reject")
    must_reject("finance.compound",{"principal":1000,"rate":.05,"years":10,"n":0},"compound frequency n<=0 should reject")
    must_reject("finance.npv",{"cashflows":[-100,110],"rate":-1},"NPV rate=-1 singularity should reject")
    must_reject("finance.var_historical",{"returns":[],"alpha":.95},"historical VaR empty returns should reject")
    must_reject("finance.var_historical",{"returns":[.1,-.1],"alpha":1.5},"historical VaR alpha outside (0,1) should reject")
    must_reject("finance.var_parametric",{"returns":[.1],"alpha":.95},"parametric VaR requires enough observations")
    must_reject("finance.var_parametric",{"returns":[.1,-.1],"alpha":0},"parametric VaR alpha outside (0,1) should reject")
    must_reject("finance.cvar_historical",{"returns":[],"alpha":.95},"historical CVaR empty returns should reject")
    must_reject("finance.portfolio_metrics",{"returns":[[.1,.2]],"weights":[.5,.5],"annualization":252},"portfolio metrics with one observation should reject sample-volatility NaN")
    must_reject("finance.beta",{"asset_returns":[.1,.2],"market_returns":[.1]},"beta length mismatch should reject")
    must_reject("finance.beta",{"asset_returns":[.1,.2,.3],"market_returns":[.2,.2,.2]},"beta zero market variance should reject")
    must_reject("finance.drawdown",{"values":[]},"drawdown empty values should reject")
    must_reject("finance.drawdown",{"values":[0,1,2]},"drawdown nonpositive values should reject")
    must_reject("finance.monte_carlo_gbm",{"S0":100,"mu":.05,"sigma":.2,"T":1,"steps":0,"paths":10},"Monte Carlo steps<=0 should reject")
    must_reject("finance.monte_carlo_gbm",{"S0":-100,"mu":.05,"sigma":.2,"T":1,"steps":10,"paths":10},"Monte Carlo S0<=0 should reject")
    must_reject("finance.monte_carlo_gbm",{"S0":100,"mu":.05,"sigma":-.2,"T":1,"steps":10,"paths":10},"Monte Carlo sigma<0 should reject")
    must_reject("finance.implied_vol",{"price":150,"S":100,"K":100,"T":1,"r":.05,"kind":"call"},"call price above no-arbitrage upper bound should reject")
    must_reject("finance.bond_price",{"face":1000,"coupon_rate":.05,"maturity":5,"yield":.04,"frequency":0},"bond frequency<=0 should reject")
    must_reject("finance.bond_price",{"face":-1000,"coupon_rate":.05,"maturity":5,"yield":.04,"frequency":2},"bond face<=0 should reject")
    must_reject("finance.bond_yield",{"face":1000,"coupon_rate":.05,"maturity":5,"price":-1,"frequency":2},"bond price<=0 should reject")
    must_reject("finance.duration",{"face":1000,"coupon_rate":.05,"maturity":0,"yield":.04,"frequency":2},"bond maturity<=0 should reject")

    # Units, geometry, transforms, knowledge, combinatorics, number theory, time series.
    must("units.convert",{"value":0,"from":"C","to":"K"},lambda r:approx(r,273.15,1e-12),"temperature conversion failed")
    must_reject("units.convert",{"value":1,"from":"m","to":"kg"},"incompatible units should reject")
    must_reject("geometry.area_circle",{"radius":-2},"negative circle radius should reject")
    must_reject("geometry.volume_sphere",{"radius":-2},"negative sphere radius should reject")
    must_reject("geometry.distance",{"p":[],"q":[]},"zero-dimensional distance should reject")
    must_reject("timeseries.moving_average",{"data":[],"window":1},"moving average empty data should reject")
    must_reject("timeseries.ewma",{"data":[],"alpha":.2},"EWMA empty data should reject")
    must_reject("timeseries.rolling_volatility",{"returns":[.1],"window":2},"rolling vol invalid window should reject")
    must_reject("timeseries.rolling_volatility",{"returns":[.1,.2],"window":2,"annualization":-1},"rolling vol negative annualization should reject")
    must_reject("combinatorics.factorial",{"n":-1},"negative factorial should reject explicitly")
    must_reject("combinatorics.binomial",{"n":5,"k":7},"binomial k>n should reject explicitly")
    must_reject("numbertheory.factorint",{"n":0},"factorint(0) should reject")
    must_reject("knowledge.constant",{"name":"not-a-constant"},"unknown constant should reject")
    must_reject("knowledge.element",{"symbol":"Xx"},"unknown element should reject")

    # FFT/IFFT round trip.
    try:
        x=[1.0,2.0,3.0,4.0]
        spec=m.dispatch("transforms.fft",{"data":x},50)
        back=m.dispatch("transforms.ifft",{"data":spec,"n":len(x)},50)
        if np.max(np.abs(np.asarray(back,float)-np.asarray(x,float)))>1e-10:
            finding("transforms.fft","roundtrip-failure","critical","FFT/IFFT roundtrip failed",{"fft":norm(spec),"back":norm(back)})
    except Exception as e:
        finding("transforms.fft","roundtrip-error","critical",str(e))

    # Linear programming fail-closed and residuals.
    must("optimization.linear_program",{"c":[1,1],"A_ub":[[-1,-1]],"b_ub":[-1],"bounds":[[0,None],[0,None]]},lambda r:r["success"] and abs(sum(r["x"])-1)<1e-7 and abs(r["fun"]-1)<1e-7,"LP canonical optimum failed")
    try:
        r=m.dispatch("optimization.linear_program",{"c":[1],"A_ub":[[-1]],"b_ub":[-2],"bounds":[[0,1]]},50)
        if r.get("success") is True:
            finding("optimization.linear_program","infeasible-success","critical","infeasible LP reported success",norm(r))
    except Exception:
        pass

    # Interval enclosure.
    must("verified.interval_eval",{"expression":"x^2","symbol":"x","interval":[1,2]},lambda r:"[" in r["interval"] and "]" in r["interval"],"interval enclosure unavailable")
    must_reject("verified.interval_eval",{"expression":"x^2","symbol":"x","interval":[2,1]},"reversed interval should reject")

    # Crosscheck must reflect meaningful verification for operations it advertises.
    for target in ["calculus.diff","numeric.root","numeric.integrate","linear.solve","finance.black_scholes","finance.implied_vol","optimization.linear_program","optimization.quadratic","arithmetic.evaluate","finance.npv"]:
        args=copy.deepcopy(fixtures[target])
        if target=="optimization.quadratic":
            args={"Q":[[2.0]],"c":[-4.0],"bounds":[[0,1]]}
        try:
            r=m.dispatch("verify.crosscheck",{"operation":target,"args":args},50)
            v=r.get("verification") or {}
            if v.get("verified") is None:
                finding("verify.crosscheck","verification-gap","high",f"crosscheck for {target} returned not-applicable",norm(r))
            if v.get("verified") is False:
                finding("verify.crosscheck","verification-failure","critical",f"crosscheck for {target} failed",norm(r))
        except Exception as e:
            finding("verify.crosscheck","crosscheck-error","high",f"{target}: {type(e).__name__}: {e}")

    summary={}
    for f in findings:
        summary[f["severity"]]=summary.get(f["severity"],0)+1
    cats={}
    for f in findings:
        cats[f["category"]]=cats.get(f["category"],0)+1
    out={
        "schema":"musitu.axiom.74_operation_exhaustive_audit.v1",
        "live_kernel_sha256":"cfa39f0f17c56a183c5024a600086aba4644ec925343129245a62e18294f7c47",
        "operation_count":len(fixtures),
        "rows":rows,
        "findings":findings,
        "finding_count":len(findings),
        "severity_counts":summary,
        "category_counts":cats,
    }
    pathlib.Path(ns.out).write_text(json.dumps(out,indent=2,sort_keys=True,allow_nan=False)+"\n")
    print("MUSITU_AXIOM_EXHAUSTIVE_AUDIT_COMPLETE")
    print(json.dumps({"operation_count":len(fixtures),"finding_count":len(findings),"severity_counts":summary,"category_counts":cats},sort_keys=True))
    return 0

if __name__=="__main__":
    raise SystemExit(main())
