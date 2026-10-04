from __future__ import annotations
import argparse, copy, importlib, json, math, pathlib, sys, traceback
from typing import Any
import numpy as np

def finite_tree(v):
    if isinstance(v, dict): return all(finite_tree(x) for x in v.values())
    if isinstance(v, (list,tuple)): return all(finite_tree(x) for x in v)
    if isinstance(v, np.ndarray): return bool(np.all(np.isfinite(v)))
    if isinstance(v, (float,np.floating)): return math.isfinite(float(v))
    if isinstance(v, complex): return math.isfinite(v.real) and math.isfinite(v.imag)
    return True

def norm(v):
    if isinstance(v,np.ndarray): return [norm(x) for x in v.tolist()]
    if isinstance(v,np.generic): return v.item()
    if isinstance(v,complex): return {"re":v.real,"im":v.imag}
    if isinstance(v,dict): return {str(k):norm(x) for k,x in sorted(v.items(),key=lambda z:str(z[0]))}
    if isinstance(v,(list,tuple)): return [norm(x) for x in v]
    if v is None or isinstance(v,(str,int,float,bool)): return v
    return str(v)

class Audit:
    def __init__(self,m,fixtures):
        self.m=m; self.fixtures=fixtures; self.tests=[]; self.findings=[]
    def rec(self,op,test,ok,category,detail=None,severity="high"):
        row={"operation":op,"test":test,"ok":bool(ok),"category":category,"severity":severity}
        if detail is not None: row["detail"]=norm(detail)
        self.tests.append(row)
        if not ok:
            self.findings.append({k:v for k,v in row.items() if k!="ok"})
    def call(self,op,args):
        return self.m.dispatch(op,copy.deepcopy(args),50)
    def expect_ok(self,op,test,args,check=lambda r: True,category="correctness",severity="high"):
        try:
            r=self.call(op,args); ok=bool(check(r))
            self.rec(op,test,ok,category,{"result":norm(r)} if not ok else None,severity)
            return r
        except Exception as e:
            self.rec(op,test,False,category,{"exception":type(e).__name__,"message":str(e)},severity); return None
    def expect_error(self,op,test,args,category="validation",severity="high"):
        try:
            r=self.call(op,args)
            self.rec(op,test,False,category,{"accepted_result":norm(r)},severity); return False
        except Exception:
            self.rec(op,test,True,category); return True
    def approx(self,a,b,tol=1e-8):
        try:return abs(float(a)-float(b))<=tol
        except:return False

def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--runtime",required=True); ap.add_argument("--fixtures",required=True); ap.add_argument("--out",required=True)
    ns=ap.parse_args()
    sys.path.insert(0,str(pathlib.Path(ns.runtime).resolve()))
    m=importlib.import_module("kernel.app.main")
    fixtures=json.load(open(ns.fixtures))["fixtures"]
    A=Audit(m,fixtures)
    ops=sorted(fixtures)
    assert len(ops)==74

    # Layer 1: every registered operation executes its canonical fixture.
    baseline={}
    for op in ops:
        r=A.expect_ok(op,"fixture.valid",fixtures[op],lambda x: finite_tree(x),"fixture-smoke","critical")
        baseline[op]=norm(r) if r is not None else None

    # Layer 2: deterministic replay for every bounded fixture, including seeded Monte Carlo.
    for op in ops:
        try:
            r1=norm(A.call(op,fixtures[op])); r2=norm(A.call(op,fixtures[op]))
            A.rec(op,"fixture.deterministic_replay",r1==r2,"determinism",{"first":r1,"second":r2} if r1!=r2 else None,"medium")
        except Exception as e:
            A.rec(op,"fixture.deterministic_replay",False,"determinism",{"exception":type(e).__name__,"message":str(e)},"medium")

    # Layer 3: all operations must fail closed on unknown arguments.
    for op in ops:
        bad=copy.deepcopy(fixtures[op]); bad["__axiom_unknown_argument__"]=123
        A.expect_error(op,"schema.unknown_argument_rejected",bad,"strict-schema","high")

    # Layer 4: known-answer / metamorphic checks for all operations.
    A.expect_ok("arithmetic.evaluate","oracle.precedence",{"expression":"2+3*4"},lambda r:A.approx(r,14))
    A.expect_ok("arithmetic.evaluate","oracle.rational",{"expression":"1/3+2/3"},lambda r:A.approx(r,1,1e-12))
    A.expect_ok("algebra.simplify","oracle.identity",{"expression":"sin(x)^2+cos(x)^2"},lambda r:str(r)=="1")
    A.expect_ok("algebra.expand","oracle.binomial",{"expression":"(x+2)^3"},lambda r:"x**3" in str(r) and "12*x" in str(r))
    A.expect_ok("algebra.factor","oracle.factor",{"expression":"x^2-5*x+6"},lambda r:str(r) in {"(x - 3)*(x - 2)","(x - 2)*(x - 3)"})
    A.expect_ok("algebra.solve","oracle.linear_system",{"equations":["x+y-3","x-y-1"],"symbols":["x","y"]},lambda r:len(r)==1 and str(r[0].get(m.sp.Symbol("x")))=="2" and str(r[0].get(m.sp.Symbol("y")))=="1")
    A.expect_ok("calculus.diff","oracle.derivative",{"expression":"sin(x)","symbol":"x"},lambda r:str(r)=="cos(x)")
    A.expect_ok("calculus.integrate","oracle.definite",{"expression":"x","symbol":"x","bounds":[0,2]},lambda r:A.approx(r,2))
    A.expect_ok("calculus.limit","oracle.limit",{"expression":"(1-cos(x))/x^2","symbol":"x","to":0},lambda r:A.approx(r,0.5))
    A.expect_ok("calculus.series","oracle.series",{"expression":"sin(x)","symbol":"x","at":0,"order":6},lambda r:"x**5/120" in str(r))
    A.expect_ok("numeric.root","oracle.sqrt2",{"expression":"x^2-2","symbol":"x","guess":1},lambda r:A.approx(r,math.sqrt(2),1e-10))
    A.expect_ok("numeric.integrate","oracle.sin",{"expression":"sin(x)","a":0,"b":math.pi},lambda r:A.approx(r.get("value"),2,1e-9))
    A.expect_ok("numeric.ode","oracle.exp_decay",{"rhs":"-y","t0":0,"t1":1,"y0":1},lambda r:r.get("success") and A.approx(r["y"][-1],math.exp(-1),2e-6))
    A.expect_ok("numeric.optimize_scalar","oracle.convex_min",{"expression":"(x-1.25)^2+3","a":-2,"b":4},lambda r:r.get("success") and A.approx(r["x"],1.25,2e-5) and A.approx(r["fun"],3,1e-8))
    A.expect_ok("linear.det","oracle.det",{"A":[[1,2],[3,4]]},lambda r:A.approx(r,-2))
    A.expect_ok("linear.inv","oracle.inverse",{"A":[[4,7],[2,6]]},lambda r:np.allclose(np.asarray(r,float),[[.6,-.7],[-.2,.4]],atol=1e-10))
    A.expect_ok("linear.solve","oracle.solve",{"A":[[3,1],[1,2]],"b":[9,8]},lambda r:np.allclose(np.asarray(r,float),[2,3],atol=1e-10))
    A.expect_ok("linear.eigen","oracle.trace_product",{"A":[[2,0],[0,5]]},lambda r:np.allclose(sorted(np.asarray(r["values"],float)),[2,5],atol=1e-10))
    A.expect_ok("statistics.describe","oracle.describe",{"data":[1,2,3,4,5]},lambda r:r["n"]==5 and A.approx(r["mean"],3) and A.approx(r["median"],3) and A.approx(r["std_sample"],math.sqrt(2.5)))
    A.expect_ok("statistics.correlation","oracle.perfect",{"x":[1,2,3],"y":[2,4,6]},lambda r:A.approx(r,1))
    A.expect_ok("statistics.regression","oracle.line",{"x":[0,1,2,3],"y":[1,3,5,7]},lambda r:A.approx(r["slope"],2) and A.approx(r["intercept"],1))
    A.expect_ok("statistics.quantile","oracle.median",{"data":[1,2,3,4],"q":0.5},lambda r:A.approx(r,2.5))
    A.expect_ok("probability.normal_cdf","oracle.cdf0",{"x":0,"mu":0,"sigma":1},lambda r:A.approx(r,0.5,1e-12))
    A.expect_ok("probability.normal_ppf","oracle.ppfhalf",{"p":0.5,"mu":7,"sigma":2},lambda r:A.approx(r,7,1e-12))
    A.expect_ok("finance.compound","oracle.compound",{"principal":1000,"rate":0.1,"years":2,"n":1},lambda r:A.approx(r,1210))
    A.expect_ok("finance.npv","oracle.npv",{"cashflows":[-100,60,60],"rate":0.1},lambda r:A.approx(r,-100+60/1.1+60/1.1**2,1e-10))
    bs=A.expect_ok("finance.black_scholes","oracle.put_call_call",{"S":100,"K":100,"T":1,"r":0.05,"sigma":0.2,"kind":"call"},lambda r:A.approx(r,10.450583572185565,1e-9))
    A.expect_ok("finance.black_scholes","oracle.put",{"S":100,"K":100,"T":1,"r":0.05,"sigma":0.2,"kind":"put"},lambda r:A.approx(r,5.573526022256971,1e-9))
    A.expect_ok("finance.greeks","oracle.greeks_signs",{"S":100,"K":100,"T":1,"r":0.05,"sigma":0.2,"kind":"call"},lambda r:0<r["delta"]<1 and r["gamma"]>0 and r["vega"]>0)
    A.expect_ok("finance.var_historical","oracle.var_hist",{"returns":[-0.1,-0.05,0,0.05,0.1],"alpha":0.8},lambda r:r["alpha"]==0.8 and r["var"]>=0)
    A.expect_ok("units.convert","oracle.length",{"value":1,"from":"km","to":"m"},lambda r:A.approx(r,1000))
    A.expect_ok("units.convert","oracle.temperature",{"value":32,"from":"F","to":"C"},lambda r:A.approx(r,0,1e-12))
    A.expect_ok("verify.evaluate","oracle.identity",{"lhs":"(x+1)^2","rhs":"x^2+2*x+1"},lambda r:r.get("symbolically_equal") is True)
    A.expect_ok("knowledge.constant","oracle.c",{"name":"c"},lambda r:A.approx(r["value"],299792458.0) and r["unit"]=="m/s")
    A.expect_ok("combinatorics.factorial","oracle.factorial",{"n":8},lambda r:int(r)==40320)
    A.expect_ok("combinatorics.binomial","oracle.binomial",{"n":10,"k":3},lambda r:int(r)==120)
    A.expect_ok("numbertheory.isprime","oracle.prime",{"n":104729},lambda r:r is True)
    A.expect_ok("numbertheory.isprime","oracle.composite",{"n":104728},lambda r:r is False)
    A.expect_ok("numbertheory.factorint","oracle.factor",{"n":360},lambda r:{int(k):int(v) for k,v in r.items()}=={2:3,3:2,5:1})
    A.expect_ok("numbertheory.gcd","oracle.gcd",{"a":84,"b":30},lambda r:int(r)==6)
    A.expect_ok("numbertheory.lcm","oracle.lcm",{"a":12,"b":18},lambda r:int(r)==36)
    fft=A.expect_ok("transforms.fft","oracle.fft_impulse",{"data":[1,0,0,0]},lambda r:len(r)==3)
    A.expect_ok("statistics.covariance","oracle.cov",{"x":[1,2,3],"y":[2,4,6]},lambda r:A.approx(r,2,1e-12))
    A.expect_ok("statistics.zscore","oracle.zscore",{"data":[1,2,3]},lambda r:np.allclose(np.asarray(r,float),[-1.224744871391589,0,1.224744871391589],atol=1e-12))
    A.expect_ok("probability.binomial_pmf","oracle.binomial_pmf",{"k":0,"n":1,"p":0.25},lambda r:A.approx(r,0.75,1e-12))
    A.expect_ok("probability.poisson_pmf","oracle.poisson_pmf",{"k":0,"mu":2},lambda r:A.approx(r,math.exp(-2),1e-12))
    A.expect_ok("finance.returns","oracle.simple_returns",{"prices":[100,110,99],"kind":"simple"},lambda r:np.allclose(np.asarray(r,float),[.1,-.1],atol=1e-12))
    A.expect_ok("finance.returns","oracle.log_returns",{"prices":[100,math.e*100],"kind":"log"},lambda r:np.allclose(np.asarray(r,float),[1],atol=1e-12))
    A.expect_ok("finance.portfolio_metrics","oracle.one_asset",{"returns":[[.01],[.02],[-.01],[0]],"weights":[1],"annualization":1,"risk_free":0},lambda r:A.approx(r["annualized_return"],.005,1e-12) and r["annualized_volatility"]>0 and r["observations"]==4)
    A.expect_ok("finance.var_parametric","oracle.var_parametric_nonnegative",{"returns":[-.02,-.01,0,.01,.02],"alpha":.95},lambda r:r["var"]>=0)
    A.expect_ok("finance.cvar_historical","oracle.cvar_tail",{"returns":[-.1,-.05,0,.05,.1],"alpha":.8},lambda r:r["cvar"]>=r.get("var",0))
    A.expect_ok("timeseries.moving_average","oracle.ma",{"data":[1,2,3,4],"window":2},lambda r:np.allclose(np.asarray(r,float),[1.5,2.5,3.5],atol=1e-12))
    A.expect_ok("timeseries.ewma","oracle.ewma",{"data":[1,2,3],"alpha":.5},lambda r:np.allclose(np.asarray(r,float),[1,1.5,2.25],atol=1e-12))
    A.expect_ok("geometry.distance","oracle.distance",{"p":[0,0,0],"q":[1,2,2]},lambda r:A.approx(r,3))
    A.expect_ok("knowledge.element","oracle.H",{"symbol":"H"},lambda r:r["symbol"]=="H" and int(r["atomic_number"])==1)
    A.expect_ok("algebra.polynomial_roots","oracle.roots",{"expression":"x^2-5*x+6","symbol":"x"},lambda r:np.allclose(sorted([float(x) for x in r]),[2,3],atol=1e-10))
    A.expect_ok("calculus.sum","oracle.sum",{"expression":"k","symbol":"k","start":1,"end":100},lambda r:int(r)==5050)
    A.expect_ok("calculus.product","oracle.product",{"expression":"k","symbol":"k","start":1,"end":6},lambda r:int(r)==720)
    A.expect_ok("numeric.least_squares","oracle.lstsq",{"A":[[1],[2],[3]],"b":[2,4,6]},lambda r:np.allclose(np.asarray(r["x"],float),[2],atol=1e-12) and r["rank"]==1)
    A.expect_ok("numeric.interpolate","oracle.interpolate",{"x":[0,1,2],"y":[0,2,4],"at":[.5,1.5]},lambda r:np.allclose(np.asarray(r,float),[1,3],atol=1e-12))
    A.expect_ok("verified.interval_eval","oracle.interval_contains",{"expression":"x^2","symbol":"x","interval":[1,2]},lambda r:"interval" in r)
    A.expect_ok("optimization.linear_program","oracle.lp",{"c":[1,1],"A_ub":[[-1,-1]],"b_ub":[-1],"bounds":[[0,None],[0,None]]},lambda r:r["success"] and A.approx(r["fun"],1,1e-8))
    A.expect_ok("optimization.quadratic","oracle.qp_unconstrained",{"Q":[[2,0],[0,2]],"c":[-2,-4]},lambda r:r["success"] and np.allclose(np.asarray(r["x"],float),[1,2],atol=1e-6) and r["verification"]["verified"])
    A.expect_ok("statistics.ttest_ind","oracle.ttest_zero",{"x":[1,2,3],"y":[1,2,3],"equal_var":False},lambda r:A.approx(r["statistic"],0,1e-12) and A.approx(r["pvalue"],1,1e-12))
    A.expect_ok("statistics.normal_fit","oracle.normal_fit",{"data":[1,2,3]},lambda r:A.approx(r["mu"],2) and A.approx(r["sigma"],math.sqrt(2/3),1e-12))
    A.expect_ok("probability.exponential_cdf","oracle.exp_cdf",{"x":2,"rate":.5},lambda r:A.approx(r,1-math.exp(-1),1e-12))
    A.expect_ok("probability.chi2_cdf","oracle.chi2_range",{"x":5,"df":3},lambda r:0<r<1)
    imp=A.expect_ok("finance.implied_vol","oracle.implied_vol",{"price":10.450583572185565,"S":100,"K":100,"T":1,"r":.05,"kind":"call"},lambda r:A.approx(r,.2,2e-7))
    bp=A.expect_ok("finance.bond_price","oracle.par_bond",{"face":1000,"coupon_rate":.05,"maturity":5,"yield":.05,"frequency":2},lambda r:A.approx(r,1000,1e-7))
    by=A.expect_ok("finance.bond_yield","oracle.yield_inverse",{"face":1000,"coupon_rate":.05,"maturity":5,"price":1000,"frequency":2},lambda r:A.approx(r,.05,2e-7))
    A.expect_ok("finance.duration","oracle.duration_positive",{"face":1000,"coupon_rate":.05,"maturity":5,"yield":.05,"frequency":2},lambda r:r["macaulay"]>0 and r["modified"]>0 and r["modified"]<r["macaulay"])
    A.expect_ok("finance.beta","oracle.beta2",{"asset_returns":[.02,-.02,.04,-.04],"market_returns":[.01,-.01,.02,-.02]},lambda r:A.approx(r,2,1e-12))
    A.expect_ok("finance.drawdown","oracle.drawdown",{"values":[100,120,90,150,120]},lambda r:A.approx(r["max_drawdown"],-.25,1e-12))
    A.expect_ok("finance.monte_carlo_gbm","oracle.mc_summary",{"S0":100,"mu":.05,"sigma":.2,"T":1,"steps":5,"paths":7,"seed":42},lambda r:r["paths"]==7 and r["seed"]==42 and 0<r["p05"]<=r["median_terminal"]<=r["p95"] and r["mean_terminal"]>0)
    A.expect_ok("timeseries.rolling_volatility","oracle.rolling_len",{"returns":[.01,-.02,.015,-.01,.005],"window":3,"annualization":252},lambda r:len(r)==3 and all(float(x)>=0 for x in r))
    A.expect_ok("geometry.area_circle","oracle.area",{"radius":3},lambda r:A.approx(r,math.pi*9,1e-12))
    A.expect_ok("geometry.volume_sphere","oracle.volume",{"radius":3},lambda r:A.approx(r,36*math.pi,1e-12))
    if fft is not None:
        A.expect_ok("transforms.ifft","oracle.fft_roundtrip",{"data":norm(fft),"n":4},lambda r:np.allclose(np.asarray(r,float),[1,0,0,0],atol=1e-10))
    A.expect_ok("verify.crosscheck","oracle.crosscheck",{"operation":"numeric.root","args":{"expression":"x^2-2","symbol":"x","guess":1}},lambda r:A.approx(r["result"],math.sqrt(2),1e-10) and r["verification"].get("verified") is True)

    # Layer 5: domain and shape rejection. These cases must never produce successful non-finite or nonsensical results.
    neg=[
      ("probability.normal_cdf","domain.sigma_zero",{"x":0,"mu":0,"sigma":0}),
      ("probability.normal_cdf","domain.sigma_negative",{"x":0,"mu":0,"sigma":-1}),
      ("probability.normal_ppf","domain.p_below_zero",{"p":-0.1,"mu":0,"sigma":1}),
      ("probability.normal_ppf","domain.p_above_one",{"p":1.1,"mu":0,"sigma":1}),
      ("probability.normal_ppf","domain.sigma_nonpositive",{"p":.5,"mu":0,"sigma":0}),
      ("finance.greeks","domain.invalid_kind",{"S":100,"K":100,"T":1,"r":.05,"sigma":.2,"kind":"nonsense"}),
      ("finance.greeks","domain.T_zero",{"S":100,"K":100,"T":0,"r":.05,"sigma":.2,"kind":"call"}),
      ("finance.greeks","domain.sigma_zero",{"S":100,"K":100,"T":1,"r":.05,"sigma":0,"kind":"call"}),
      ("statistics.quantile","domain.q_below_zero",{"data":[1,2,3],"q":-.1}),
      ("statistics.quantile","domain.q_above_one",{"data":[1,2,3],"q":1.1}),
      ("statistics.zscore","domain.constant_series",{"data":[2,2,2]}),
      ("probability.binomial_pmf","domain.p_negative",{"k":1,"n":3,"p":-.1}),
      ("probability.binomial_pmf","domain.p_gt_one",{"k":1,"n":3,"p":1.1}),
      ("probability.poisson_pmf","domain.mu_negative",{"k":1,"mu":-1}),
      ("finance.returns","domain.zero_price_simple",{"prices":[100,0,90],"kind":"simple"}),
      ("finance.returns","domain.nonpositive_log_price",{"prices":[100,0,90],"kind":"log"}),
      ("timeseries.moving_average","domain.window_zero",{"data":[1,2,3],"window":0}),
      ("timeseries.moving_average","domain.window_negative",{"data":[1,2,3],"window":-1}),
      ("timeseries.ewma","domain.alpha_zero",{"data":[1,2,3],"alpha":0}),
      ("timeseries.ewma","domain.alpha_gt_one",{"data":[1,2,3],"alpha":1.1}),
      ("geometry.distance","shape.dimension_mismatch",{"p":[0,0],"q":[1,2,3]}),
      ("numeric.interpolate","domain.unsorted_x",{"x":[0,2,1],"y":[0,4,1],"at":[1.5]}),
      ("numeric.interpolate","shape.x_y_mismatch",{"x":[0,1,2],"y":[0,1],"at":[.5]}),
      ("verified.interval_eval","domain.reversed_interval",{"expression":"x","symbol":"x","interval":[2,1]}),
      ("statistics.ttest_ind","domain.empty_x",{"x":[],"y":[1,2],"equal_var":False}),
      ("statistics.normal_fit","domain.empty_data",{"data":[]}),
      ("probability.exponential_cdf","domain.negative_rate",{"x":1,"rate":-1}),
      ("probability.chi2_cdf","domain.df_zero",{"x":1,"df":0}),
      ("finance.beta","domain.zero_market_variance",{"asset_returns":[.1,.2,.3],"market_returns":[.1,.1,.1]}),
      ("finance.drawdown","domain.zero_base",{"values":[0,1,2]}),
      ("finance.monte_carlo_gbm","domain.negative_sigma",{"S0":100,"mu":.05,"sigma":-.2,"T":1,"steps":5,"paths":5,"seed":1}),
      ("finance.monte_carlo_gbm","domain.negative_T",{"S0":100,"mu":.05,"sigma":.2,"T":-1,"steps":5,"paths":5,"seed":1}),
      ("finance.monte_carlo_gbm","domain.steps_zero",{"S0":100,"mu":.05,"sigma":.2,"T":1,"steps":0,"paths":5,"seed":1}),
      ("timeseries.rolling_volatility","domain.window_one",{"returns":[.1,.2,.3],"window":1,"annualization":252}),
      ("timeseries.rolling_volatility","domain.window_zero",{"returns":[.1,.2,.3],"window":0,"annualization":252}),
      ("geometry.area_circle","domain.negative_radius",{"radius":-1}),
      ("geometry.volume_sphere","domain.negative_radius",{"radius":-1}),
      ("finance.compound","domain.n_zero",{"principal":1000,"rate":.05,"years":1,"n":0}),
      ("finance.compound","domain.n_negative",{"principal":1000,"rate":.05,"years":1,"n":-1}),
      ("finance.bond_price","domain.frequency_zero",{"face":1000,"coupon_rate":.05,"maturity":5,"yield":.04,"frequency":0}),
      ("finance.duration","domain.frequency_zero",{"face":1000,"coupon_rate":.05,"maturity":5,"yield":.04,"frequency":0}),
      ("finance.var_historical","domain.alpha_zero",{"returns":[-.1,0,.1],"alpha":0}),
      ("finance.var_historical","domain.alpha_one",{"returns":[-.1,0,.1],"alpha":1}),
      ("finance.var_historical","domain.empty_returns",{"returns":[],"alpha":.95}),
      ("finance.var_parametric","domain.alpha_zero",{"returns":[-.1,0,.1],"alpha":0}),
      ("finance.var_parametric","domain.alpha_one",{"returns":[-.1,0,.1],"alpha":1}),
      ("finance.var_parametric","domain.empty_returns",{"returns":[],"alpha":.95}),
      ("finance.cvar_historical","domain.alpha_zero",{"returns":[-.1,0,.1],"alpha":0}),
      ("finance.cvar_historical","domain.alpha_one",{"returns":[-.1,0,.1],"alpha":1}),
      ("finance.cvar_historical","domain.empty_returns",{"returns":[],"alpha":.95}),
      ("finance.portfolio_metrics","shape.weight_mismatch",{"returns":[[.01,.02],[.02,.03]],"weights":[1],"annualization":252,"risk_free":0}),
      ("finance.portfolio_metrics","domain.empty_returns",{"returns":[],"weights":[],"annualization":252,"risk_free":0}),
      ("finance.portfolio_metrics","domain.annualization_zero",{"returns":[[.01],[.02]],"weights":[1],"annualization":0,"risk_free":0}),
      ("finance.bond_price","domain.face_nonpositive",{"face":0,"coupon_rate":.05,"maturity":5,"yield":.04,"frequency":2}),
      ("finance.bond_price","domain.maturity_nonpositive",{"face":1000,"coupon_rate":.05,"maturity":0,"yield":.04,"frequency":2}),
      ("finance.bond_yield","domain.face_nonpositive",{"face":0,"coupon_rate":.05,"maturity":5,"price":1000,"frequency":2}),
      ("finance.bond_yield","domain.price_nonpositive",{"face":1000,"coupon_rate":.05,"maturity":5,"price":0,"frequency":2}),
      ("finance.bond_yield","domain.maturity_nonpositive",{"face":1000,"coupon_rate":.05,"maturity":0,"price":1000,"frequency":2}),
      ("finance.duration","domain.face_nonpositive",{"face":0,"coupon_rate":.05,"maturity":5,"yield":.04,"frequency":2}),
      ("finance.duration","domain.maturity_nonpositive",{"face":1000,"coupon_rate":.05,"maturity":0,"yield":.04,"frequency":2}),
      ("combinatorics.factorial","domain.negative_n",{"n":-1}),
      ("combinatorics.factorial","domain.fractional_n",{"n":3.5}),
      ("combinatorics.binomial","domain.negative_n",{"n":-1,"k":0}),
      ("combinatorics.binomial","domain.fractional_n",{"n":5.5,"k":2}),
      ("numbertheory.isprime","domain.fractional_n",{"n":7.9}),
      ("numbertheory.factorint","domain.zero_n",{"n":0}),
      ("numbertheory.factorint","domain.fractional_n",{"n":12.9}),
      ("numbertheory.gcd","domain.fractional_a",{"a":12.9,"b":6}),
      ("numbertheory.lcm","domain.fractional_a",{"a":12.9,"b":6}),
      ("statistics.correlation","shape.length_mismatch",{"x":[1,2,3],"y":[1,2]}),
      ("statistics.correlation","domain.constant_series",{"x":[1,1,1],"y":[1,2,3]}),
      ("statistics.covariance","shape.length_mismatch",{"x":[1,2,3],"y":[1,2]}),
      ("statistics.regression","shape.length_mismatch",{"x":[1,2,3],"y":[1,2]}),
      ("statistics.regression","domain.constant_x",{"x":[1,1,1],"y":[1,2,3]}),
      ("linear.det","shape.nonsquare",{"A":[[1,2,3],[4,5,6]]}),
      ("linear.inv","shape.nonsquare",{"A":[[1,2,3],[4,5,6]]}),
      ("linear.solve","shape.b_mismatch",{"A":[[1,0],[0,1]],"b":[1]}),
      ("linear.eigen","shape.nonsquare",{"A":[[1,2,3],[4,5,6]]}),
      ("numeric.least_squares","shape.b_mismatch",{"A":[[1],[2],[3]],"b":[1,2]}),
      ("transforms.fft","domain.empty_data",{"data":[]}),
      ("transforms.ifft","domain.empty_data",{"data":[]}),
      ("geometry.distance","domain.empty_vectors",{"p":[],"q":[]}),
      ("timeseries.moving_average","domain.window_gt_length",{"data":[1,2,3],"window":4}),
      ("timeseries.rolling_volatility","domain.window_gt_length",{"returns":[.1,.2,.3],"window":4,"annualization":252}),
      ("timeseries.rolling_volatility","domain.annualization_zero",{"returns":[.1,.2,.3],"window":2,"annualization":0}),
      ("probability.normal_ppf","domain.p_zero",{"p":0,"mu":0,"sigma":1}),
      ("probability.normal_ppf","domain.p_one",{"p":1,"mu":0,"sigma":1}),
      ("calculus.diff","type.fractional_order",{"expression":"x^3","symbol":"x","order":1.5}),
      ("calculus.series","type.fractional_order",{"expression":"exp(x)","symbol":"x","at":0,"order":4.5}),
      ("calculus.sum","type.fractional_start",{"expression":"k","symbol":"k","start":1.5,"end":5}),
      ("calculus.product","type.fractional_end",{"expression":"k","symbol":"k","start":1,"end":5.5}),
      ("probability.binomial_pmf","type.fractional_n",{"k":1,"n":3.5,"p":.5}),
      ("probability.binomial_pmf","type.fractional_k",{"k":1.5,"n":3,"p":.5}),
      ("probability.poisson_pmf","type.fractional_k",{"k":1.5,"mu":2}),
      ("finance.returns","domain.invalid_kind",{"prices":[100,110,120],"kind":"nonsense"}),
      ("timeseries.moving_average","type.fractional_window",{"data":[1,2,3,4],"window":2.5}),
      ("statistics.ttest_ind","type.nonboolean_equal_var",{"x":[1,2,3],"y":[2,3,4],"equal_var":"false"}),
      ("finance.bond_price","type.fractional_frequency",{"face":1000,"coupon_rate":.05,"maturity":5,"yield":.04,"frequency":2.5}),
      ("finance.bond_yield","type.fractional_frequency",{"face":1000,"coupon_rate":.05,"maturity":5,"price":1000,"frequency":2.5}),
      ("finance.duration","type.fractional_frequency",{"face":1000,"coupon_rate":.05,"maturity":5,"yield":.04,"frequency":2.5}),
      ("finance.beta","shape.length_mismatch",{"asset_returns":[.1,.2,.3],"market_returns":[.1,.2]}),
      ("finance.monte_carlo_gbm","type.fractional_steps",{"S0":100,"mu":.05,"sigma":.2,"T":1,"steps":5.5,"paths":10,"seed":1}),
      ("finance.monte_carlo_gbm","type.fractional_paths",{"S0":100,"mu":.05,"sigma":.2,"T":1,"steps":5,"paths":10.5,"seed":1}),
      ("timeseries.rolling_volatility","type.fractional_window",{"returns":[.1,.2,.3,.4],"window":2.5,"annualization":252}),
    ]
    for op,test,args in neg:
        try:
            r=A.call(op,args)
            # Rejection is preferred. A successful finite result for known invalid input is a defect; nonfinite is also a defect.
            A.rec(op,test,False,"domain-validation",{"accepted_result":norm(r),"finite":finite_tree(r)},"high")
        except Exception:
            A.rec(op,test,True,"domain-validation")

    # Layer 6: invalid shapes and singular/infeasible problems should fail or explicitly return success:false, never false success.
    def reject_or_unsuccessful(op,test,args):
        try:
            r=A.call(op,args)
            ok=isinstance(r,dict) and r.get("success") is False
            A.rec(op,test,ok,"failure-semantics",{"result":norm(r)} if not ok else None,"critical")
        except Exception:
            A.rec(op,test,True,"failure-semantics")
    reject_or_unsuccessful("linear.inv","failure.singular_matrix",{"A":[[1,2],[2,4]]})
    reject_or_unsuccessful("linear.solve","failure.singular_matrix",{"A":[[1,2],[2,4]],"b":[1,2]})
    reject_or_unsuccessful("optimization.linear_program","failure.infeasible",{"c":[1],"A_ub":[[1],[-1]],"b_ub":[0,-1],"bounds":[[None,None]]})
    reject_or_unsuccessful("optimization.quadratic","failure.infeasible",{"Q":[[2]],"c":[0],"A_eq":[[1],[1]],"b_eq":[0,1]})

    # Cross-operation invariants.
    try:
        p=A.call("finance.bond_price",{"face":1000,"coupon_rate":.05,"maturity":5,"yield":.04,"frequency":2})
        y=A.call("finance.bond_yield",{"face":1000,"coupon_rate":.05,"maturity":5,"price":float(p),"frequency":2})
        A.rec("finance.bond_yield","cross.price_yield_inverse",A.approx(y,.04,2e-7),"cross-invariant",{"price":norm(p),"yield":norm(y)} if not A.approx(y,.04,2e-7) else None,"critical")
    except Exception as e:A.rec("finance.bond_yield","cross.price_yield_inverse",False,"cross-invariant",{"exception":type(e).__name__,"message":str(e)},"critical")
    try:
        call=A.call("finance.black_scholes",{"S":100,"K":100,"T":1,"r":.05,"sigma":.2,"kind":"call"})
        iv=A.call("finance.implied_vol",{"price":float(call),"S":100,"K":100,"T":1,"r":.05,"kind":"call"})
        A.rec("finance.implied_vol","cross.price_iv_inverse",A.approx(iv,.2,2e-7),"cross-invariant",{"call":norm(call),"iv":norm(iv)} if not A.approx(iv,.2,2e-7) else None,"critical")
    except Exception as e:A.rec("finance.implied_vol","cross.price_iv_inverse",False,"cross-invariant",{"exception":type(e).__name__,"message":str(e)},"critical")

    counts={}
    for f in A.findings:
        counts[f["category"]]=counts.get(f["category"],0)+1
    report={
      "schema":"musitu.axiom.all_operations_exhaustive_audit.v1",
      "operation_count":len(ops),
      "operations":ops,
      "tests_run":len(A.tests),
      "tests_passed":sum(1 for x in A.tests if x["ok"]),
      "tests_failed":sum(1 for x in A.tests if not x["ok"]),
      "finding_count":len(A.findings),
      "findings_by_category":counts,
      "findings":A.findings,
      "tests":A.tests,
    }
    pathlib.Path(ns.out).write_text(json.dumps(report,indent=2,sort_keys=True)+"\n")
    print("AXIOM_AUDIT_SUMMARY="+json.dumps({k:report[k] for k in ("operation_count","tests_run","tests_passed","tests_failed","finding_count","findings_by_category")},sort_keys=True))
    for f in A.findings:
        print("AXIOM_FINDING="+json.dumps(f,sort_keys=True)[:3500])
    return 0

if __name__=="__main__":
    raise SystemExit(main())
