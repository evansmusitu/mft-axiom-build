from __future__ import annotations
import argparse, importlib, json, math, pathlib, sys, copy
import numpy as np
import sympy as sp

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--runtime",required=True)
    ap.add_argument("--fixtures",required=True)
    ns=ap.parse_args()
    sys.path.insert(0,str(pathlib.Path(ns.runtime).resolve()))
    m=importlib.import_module("kernel.app.main")
    fixtures=json.load(open(ns.fixtures))["fixtures"]
    findings=[]
    counts={op:0 for op in fixtures}
    passes=0

    def norm(v):
        if isinstance(v,np.ndarray): return [norm(x) for x in v.tolist()]
        if isinstance(v,np.generic): return norm(v.item())
        if isinstance(v,dict): return {str(k):norm(x) for k,x in v.items()}
        if isinstance(v,(list,tuple)): return [norm(x) for x in v]
        if isinstance(v,float) and not math.isfinite(v): return "NaN" if math.isnan(v) else ("Infinity" if v>0 else "-Infinity")
        if type(v).__module__.startswith("sympy"): return str(v)
        return v

    def finding(op,case,severity,category,detail,evidence=None):
        findings.append({"operation":op,"case":case,"severity":severity,"category":category,"detail":detail,"evidence":norm(evidence)})

    def call(op,args):
        return m.encode(m.dispatch(op,copy.deepcopy(args),50))

    def must(op,case,args,pred,detail,severity="critical"):
        nonlocal passes
        counts[op]+=1
        try:
            r=call(op,args)
            if pred(r):
                passes+=1
            else:
                finding(op,case,severity,"property-failure",detail,r)
        except Exception as e:
            finding(op,case,severity,"unexpected-error",detail+f": {type(e).__name__}: {e}")

    def reject(op,case,args,detail,severity="high"):
        nonlocal passes
        counts[op]+=1
        try:
            r=call(op,args)
            finding(op,case,severity,"invalid-domain-accepted",detail,r)
        except Exception:
            passes+=1

    # 1 arithmetic
    for expr,expected in [("2+3*4",14),("1/8+3/8",.5),("sqrt(2)^2",2),("sin(pi/2)",1)]:
        must("arithmetic.evaluate","identity:"+expr,{"expression":expr},lambda r,e=expected:abs(float(r)-e)<1e-12,"arithmetic identity mismatch")
    reject("arithmetic.evaluate","bad-expression",{"expression":"1/"},"malformed expression must reject")

    # 2-5 algebra
    must("algebra.simplify","rational-cancel",{"expression":"(x^2-1)/(x-1)"},lambda r:"x + 1" in str(r),"simplify failed rational cancellation")
    must("algebra.simplify","trig",{"expression":"sin(x)^2+cos(x)^2"},lambda r:str(r)=="1","simplify failed trig identity")
    must("algebra.expand","cube",{"expression":"(x+2)^3"},lambda r:"x**3" in str(r) and "12*x" in str(r),"expand cube incorrect")
    must("algebra.factor","quartic",{"expression":"x^4-1"},lambda r:"x - 1" in str(r) and "x + 1" in str(r),"factor quartic incorrect")
    def solve2(r):
        if not isinstance(r,list) or not r:return False
        d={str(k):str(v) for k,v in r[0].items()}
        return d.get("x")=="2" and d.get("y")=="1"
    must("algebra.solve","2x2",{"equations":["x+y-3","x-y-1"],"symbols":["x","y"]},solve2,"symbolic 2x2 solve incorrect")
    must("algebra.solve","quadratic",{"equations":["x^2-9"],"symbols":["x"]},lambda r:sorted(float(list(z.values())[0]) for z in r)==[-3.0,3.0],"quadratic solve incorrect")
    # Transport serialization contract: dict keys from solve must be JSON-safe.
    counts["algebra.solve"]+=1
    try:
        raw=m.dispatch("algebra.solve",{"equations":["x-2"],"symbols":["x"]},50)
        enc=m.encode(raw); json.dumps(enc,allow_nan=False)
        passes+=1
    except Exception as e:
        finding("algebra.solve","json-serialization","critical","transport-serialization",f"valid solve result is not JSON serializable: {type(e).__name__}: {e}")

    # 6-9 calculus
    must("calculus.diff","poly",{"expression":"x^5","symbol":"x","order":2},lambda r:sp.simplify(sp.sympify(str(r))-20*sp.Symbol("x")**3)==0,"second derivative incorrect")
    must("calculus.diff","trig",{"expression":"sin(x)","symbol":"x"},lambda r:str(r)=="cos(x)","sin derivative incorrect")
    must("calculus.integrate","definite",{"expression":"3*x^2","symbol":"x","bounds":[0,2]},lambda r:abs(float(r)-8)<1e-12,"definite integral incorrect")
    must("calculus.integrate","antiderivative",{"expression":"cos(x)","symbol":"x"},lambda r:sp.simplify(sp.diff(sp.sympify(str(r)),sp.Symbol("x"))-sp.cos(sp.Symbol("x")))==0,"antiderivative derivative mismatch")
    must("calculus.limit","sinc",{"expression":"sin(x)/x","symbol":"x","to":0},lambda r:sp.simplify(sp.sympify(str(r))-1)==0,"sinc limit incorrect")
    must("calculus.limit","cos",{"expression":"(1-cos(x))/x^2","symbol":"x","to":0},lambda r:sp.simplify(sp.sympify(str(r))-sp.Rational(1,2))==0,"cosine limit incorrect")
    must("calculus.series","exp",{"expression":"exp(x)","symbol":"x","at":0,"order":5},lambda r:"x**4/24" in str(r),"exp series incorrect")
    reject("calculus.diff","negative-order",{"expression":"x^2","symbol":"x","order":-1},"negative derivative order should reject")

    # 10-13 numerical
    must("numeric.root","sqrt2",{"expression":"x^2-2","symbol":"x","guess":1},lambda r:abs(float(r)-math.sqrt(2))<1e-12,"root sqrt2 inaccurate")
    must("numeric.root","cosfix",{"expression":"cos(x)-x","symbol":"x","guess":.7},lambda r:abs(float(r)-0.7390851332151607)<1e-12,"fixed-point root inaccurate")
    reject("numeric.root","bad-guess",{"expression":"x^2+1","symbol":"x","guess":0},"real root solver should reject no-real-root case")
    must("numeric.integrate","sin",{"expression":"sin(x)","a":0,"b":math.pi},lambda r:abs(r["value"]-2)<1e-10 and r["abs_error"]<1e-8,"quadrature sin integral inaccurate")
    must("numeric.integrate","reverse",{"expression":"x","a":2,"b":0},lambda r:abs(r["value"]+2)<1e-10,"reversed definite numeric integral should preserve orientation")
    must("numeric.ode","decay",{"rhs":"-2*y","t0":0,"t1":1,"y0":1},lambda r:r["success"] and abs(r["y"][-1]-math.exp(-2))<2e-7,"ODE exponential decay inaccurate")
    must("numeric.ode","growth",{"rhs":"y","t0":0,"t1":1,"y0":2},lambda r:r["success"] and abs(r["y"][-1]-2*math.e)<3e-7,"ODE exponential growth inaccurate")
    must("numeric.optimize_scalar","quadratic",{"expression":"(x-2.5)^2+3","a":-5,"b":5},lambda r:r["success"] and abs(r["x"]-2.5)<1e-5 and abs(r["fun"]-3)<1e-9,"scalar optimizer incorrect")
    reject("numeric.optimize_scalar","reversed-bounds",{"expression":"x^2","a":2,"b":-2},"reversed bounded optimization must reject")

    # 14-17 linear
    must("linear.det","known",{"A":[[1,2],[3,4]]},lambda r:abs(r+2)<1e-12,"determinant incorrect")
    must("linear.inv","identity",{"A":[[4,7],[2,6]]},lambda r:np.linalg.norm(np.array([[4,7],[2,6]])@np.asarray(r)-np.eye(2))<1e-10,"inverse residual too large")
    must("linear.solve","residual",{"A":[[3,1],[1,2]],"b":[9,8]},lambda r:np.linalg.norm(np.array([[3,1],[1,2]])@np.asarray(r)-np.array([9,8]))<1e-10,"linear solve residual too large")
    must("linear.eigen","diagonal",{"A":[[2,0],[0,5]]},lambda r:sorted(round(float(x),12) for x in r["values"])==[2.0,5.0],"eigenvalues incorrect")
    reject("linear.det","nonsquare",{"A":[[1,2,3],[4,5,6]]},"nonsquare determinant must reject")
    reject("linear.inv","singular",{"A":[[1,2],[2,4]]},"singular inverse must reject")
    reject("linear.solve","singular",{"A":[[1,2],[2,4]],"b":[1,2]},"singular solve must reject")

    # 18-21 statistics
    must("statistics.describe","known",{"data":[1,2,3,4,5]},lambda r:r["n"]==5 and abs(r["mean"]-3)<1e-12 and abs(r["median"]-3)<1e-12 and abs(r["std_sample"]-math.sqrt(2.5))<1e-12,"descriptive statistics incorrect")
    reject("statistics.describe","empty",{"data":[]},"empty descriptive stats must reject")
    must("statistics.correlation","perfect",{"x":[1,2,3,4],"y":[2,4,6,8]},lambda r:abs(r-1)<1e-12,"perfect correlation incorrect")
    must("statistics.correlation","negative",{"x":[1,2,3,4],"y":[8,6,4,2]},lambda r:abs(r+1)<1e-12,"negative correlation incorrect")
    reject("statistics.correlation","length-mismatch",{"x":[1,2],"y":[1]},"correlation length mismatch must reject")
    reject("statistics.correlation","zero-variance",{"x":[1,1,1],"y":[1,2,3]},"zero-variance correlation must reject instead of NaN")
    must("statistics.regression","perfect-line",{"x":[0,1,2,3],"y":[1,3,5,7]},lambda r:abs(r["slope"]-2)<1e-12 and abs(r["intercept"]-1)<1e-12 and abs(r["rvalue"]-1)<1e-12,"linear regression incorrect")
    reject("statistics.regression","constant-x",{"x":[1,1,1],"y":[1,2,3]},"constant-x regression must reject")
    must("statistics.quantile","median",{"data":[1,2,3,4,5],"q":.5},lambda r:abs(r-3)<1e-12,"median quantile incorrect")
    reject("statistics.quantile","q-low",{"data":[1,2,3],"q":-.1},"quantile q<0 must reject")
    reject("statistics.quantile","q-high",{"data":[1,2,3],"q":1.1},"quantile q>1 must reject")

    # 22-23 probability normal
    must("probability.normal_cdf","zero",{"x":0,"mu":0,"sigma":1},lambda r:abs(r-.5)<1e-12,"normal CDF zero incorrect")
    must("probability.normal_ppf","inverse",{"p":.975,"mu":0,"sigma":1},lambda r:abs(r-1.959963984540054)<1e-10,"normal PPF incorrect")
    reject("probability.normal_cdf","sigma-zero",{"x":0,"sigma":0},"normal sigma=0 must reject")
    reject("probability.normal_cdf","sigma-negative",{"x":0,"sigma":-1},"normal sigma<0 must reject")
    reject("probability.normal_ppf","p-outside",{"p":1.1,"sigma":1},"normal PPF p>1 must reject")
    reject("probability.normal_ppf","sigma-zero",{"p":.5,"sigma":0},"normal PPF sigma=0 must reject")

    # 24-28 finance base
    must("finance.compound","known",{"principal":1000,"rate":.05,"years":2,"n":1},lambda r:abs(r-1102.5)<1e-10,"compound growth incorrect")
    reject("finance.compound","n-zero",{"principal":1000,"rate":.05,"years":2,"n":0},"compound n=0 must reject")
    must("finance.npv","zero-rate",{"cashflows":[-100,50,60],"rate":0},lambda r:abs(r-10)<1e-12,"NPV zero-rate incorrect")
    must("finance.npv","known",{"cashflows":[-1000,300,400,500],"rate":.1},lambda r:abs(r-(-21.0368144252443))<1e-9,"NPV known value incorrect")
    reject("finance.npv","minus-one",{"cashflows":[-100,110],"rate":-1},"NPV rate=-1 must reject")
    bs={"S":100,"K":95,"T":1.5,"r":.04,"sigma":.25,"q":.01}
    must("finance.black_scholes","call-positive",{**bs,"kind":"call"},lambda r:r>0,"Black-Scholes call nonpositive")
    must("finance.black_scholes","put-positive",{**bs,"kind":"put"},lambda r:r>0,"Black-Scholes put nonpositive")
    reject("finance.black_scholes","bad-kind",{**bs,"kind":"straddle"},"Black-Scholes invalid kind must reject")
    reject("finance.black_scholes","sigma-zero",{**bs,"sigma":0,"kind":"call"},"Black-Scholes sigma=0 must reject")
    must("finance.greeks","call",{"S":100,"K":100,"T":1,"r":.05,"sigma":.2,"kind":"call"},lambda r:0<r["delta"]<1 and r["gamma"]>0 and r["vega"]>0,"call Greeks invariants failed")
    must("finance.greeks","put",{"S":100,"K":100,"T":1,"r":.05,"sigma":.2,"kind":"put"},lambda r:-1<r["delta"]<0 and r["gamma"]>0 and r["vega"]>0,"put Greeks invariants failed")
    reject("finance.greeks","bad-kind",{"S":100,"K":100,"T":1,"r":.05,"sigma":.2,"kind":"straddle"},"Greeks invalid kind must reject")
    reject("finance.greeks","T-zero",{"S":100,"K":100,"T":0,"r":.05,"sigma":.2,"kind":"call"},"Greeks T=0 must reject")
    must("finance.var_historical","known",{"returns":[-.1,-.05,0,.05,.1],"alpha":.8},lambda r:abs(r["var"]-.06)<1e-12 and abs(r["alpha"]-.8)<1e-12,"historical VaR incorrect")
    reject("finance.var_historical","empty",{"returns":[],"alpha":.95},"historical VaR empty data must reject")
    reject("finance.var_historical","bad-alpha",{"returns":[-.1,.1],"alpha":1.2},"historical VaR alpha outside (0,1) must reject")

    # 29 units
    must("units.convert","m-cm",{"value":1,"from":"m","to":"cm"},lambda r:abs(r-100)<1e-12,"m to cm incorrect")
    must("units.convert","C-K",{"value":0,"from":"C","to":"K"},lambda r:abs(r-273.15)<1e-12,"C to K incorrect")
    must("units.convert","F-C",{"value":32,"from":"F","to":"C"},lambda r:abs(r)<1e-12,"F to C incorrect")
    reject("units.convert","incompatible",{"value":1,"from":"m","to":"kg"},"incompatible units must reject")

    # 30 verify.evaluate
    must("verify.evaluate","equal",{"lhs":"(x+1)^2","rhs":"x^2+2*x+1"},lambda r:r["symbolically_equal"] is True,"symbolic equality false negative")
    must("verify.evaluate","not-equal",{"lhs":"x+1","rhs":"x+2"},lambda r:r["symbolically_equal"] is False,"symbolic inequality false positive")

    # 31-37 knowledge/combinatorics/number theory
    must("knowledge.constant","c",{"name":"c"},lambda r:abs(r["value"]-299792458.0)<1e-9,"speed of light constant incorrect")
    reject("knowledge.constant","unknown",{"name":"xyz"},"unknown constant must reject")
    must("combinatorics.factorial","6",{"n":6},lambda r:r==720,"factorial incorrect")
    reject("combinatorics.factorial","negative",{"n":-1},"negative factorial must reject")
    must("combinatorics.binomial","10c3",{"n":10,"k":3},lambda r:r==120,"binomial coefficient incorrect")
    must("combinatorics.binomial","k>n",{"n":5,"k":7},lambda r:r==0,"binomial k>n should equal zero")
    must("numbertheory.isprime","prime",{"n":101},lambda r:r is True,"isprime prime false negative")
    must("numbertheory.isprime","composite",{"n":100},lambda r:r is False,"isprime composite false positive")
    must("numbertheory.factorint","84",{"n":84},lambda r:r=={"2":2,"3":1,"7":1},"factorint incorrect")
    reject("numbertheory.factorint","zero",{"n":0},"factorization of zero must reject")
    must("numbertheory.gcd","known",{"a":84,"b":30},lambda r:r==6,"gcd incorrect")
    must("numbertheory.lcm","known",{"a":12,"b":18},lambda r:r==36,"lcm incorrect")

    # 38 FFT
    must("transforms.fft","constant",{"data":[1,1,1,1]},lambda r:abs(r[0]["re"]-4)<1e-12 and all(abs(z["re"])<1e-12 and abs(z["im"])<1e-12 for z in r[1:]),"FFT constant sequence incorrect")
    reject("transforms.fft","empty",{"data":[]},"FFT empty input must reject")

    # 39-40 covariance/zscore
    must("statistics.covariance","known",{"x":[1,2,3],"y":[2,4,6]},lambda r:abs(r-2)<1e-12,"sample covariance incorrect")
    reject("statistics.covariance","length-mismatch",{"x":[1,2],"y":[1]},"covariance length mismatch must reject")
    must("statistics.zscore","known",{"data":[1,2,3]},lambda r:abs(sum(r))<1e-12 and abs(np.std(r,ddof=0)-1)<1e-12,"zscore normalization incorrect")
    reject("statistics.zscore","constant",{"data":[1,1,1]},"zscore zero variance must reject")
    reject("statistics.zscore","empty",{"data":[]},"zscore empty input must reject")

    # 41-42 discrete probabilities
    must("probability.binomial_pmf","known",{"k":3,"n":10,"p":.4},lambda r:abs(r-0.214990848)<1e-12,"binomial PMF incorrect")
    must("probability.binomial_pmf","k>n",{"k":11,"n":10,"p":.4},lambda r:r==0.0,"binomial PMF k>n should be zero")
    reject("probability.binomial_pmf","bad-p",{"k":3,"n":10,"p":1.2},"binomial p>1 must reject")
    reject("probability.binomial_pmf","negative-n",{"k":3,"n":-1,"p":.4},"binomial n<0 must reject")
    must("probability.poisson_pmf","known",{"k":3,"mu":2.5},lambda r:abs(r-0.21376301724973645)<1e-12,"Poisson PMF incorrect")
    reject("probability.poisson_pmf","negative-mu",{"k":3,"mu":-1},"Poisson mu<0 must reject")
    reject("probability.poisson_pmf","negative-k",{"k":-1,"mu":2},"Poisson k<0 must reject explicitly")

    # 43-47 finance extended
    must("finance.returns","simple",{"prices":[100,110,99],"kind":"simple"},lambda r:np.allclose(r,[.1,-.1],atol=1e-12),"simple returns incorrect")
    must("finance.returns","log",{"prices":[100,110],"kind":"log"},lambda r:abs(r[0]-math.log(1.1))<1e-12,"log return incorrect")
    reject("finance.returns","bad-kind",{"prices":[100,110],"kind":"banana"},"unknown return kind must reject")
    must("finance.portfolio_metrics","known",{"returns":[[.01,.02],[-.01,.005],[.015,.01],[0,-.005]],"weights":[.6,.4],"annualization":252,"risk_free":0},lambda r:r["observations"]==4 and r["annualized_volatility"]>0,"portfolio metrics invalid")
    reject("finance.portfolio_metrics","one-observation",{"returns":[[.1,.2]],"weights":[.5,.5],"annualization":252},"portfolio metrics one observation must reject")
    reject("finance.portfolio_metrics","negative-ann",{"returns":[[.1,.2],[.2,.1]],"weights":[.5,.5],"annualization":-1},"negative annualization must reject")
    must("finance.var_parametric","finite",{"returns":[-.03,-.01,0,.01,.02,.03],"alpha":.95},lambda r:math.isfinite(r["var"]) and r["alpha"]==.95,"parametric VaR invalid")
    reject("finance.var_parametric","one-observation",{"returns":[.1],"alpha":.95},"parametric VaR one observation must reject")
    reject("finance.var_parametric","bad-alpha",{"returns":[-.1,.1],"alpha":0},"parametric VaR alpha outside (0,1) must reject")
    must("finance.cvar_historical","ordering",{"returns":[-.1,-.05,0,.05,.1],"alpha":.8},lambda r:r["cvar"]>=r["var"],"CVaR must be >= VaR loss")
    reject("finance.cvar_historical","empty",{"returns":[],"alpha":.95},"historical CVaR empty must reject")
    reject("finance.cvar_historical","bad-alpha",{"returns":[-.1,.1],"alpha":1.2},"historical CVaR bad alpha must reject")

    # 48-49 timeseries
    must("timeseries.moving_average","known",{"data":[1,2,3,4,5],"window":3},lambda r:np.allclose(r,[2,3,4]),"moving average incorrect")
    reject("timeseries.moving_average","bad-window",{"data":[1,2],"window":3},"moving average window>n must reject")
    must("timeseries.ewma","known",{"data":[1,2,3],"alpha":.5},lambda r:np.allclose(r,[1,1.5,2.25]),"EWMA incorrect")
    reject("timeseries.ewma","empty",{"data":[],"alpha":.5},"EWMA empty must reject")
    reject("timeseries.ewma","bad-alpha",{"data":[1,2],"alpha":0},"EWMA alpha=0 must reject")

    # 50 geometry.distance
    must("geometry.distance","3-4-5",{"p":[0,0],"q":[3,4]},lambda r:abs(r-5)<1e-12,"Euclidean distance incorrect")
    reject("geometry.distance","dimension-mismatch",{"p":[0],"q":[0,1]},"distance dimension mismatch must reject")
    reject("geometry.distance","empty",{"p":[],"q":[]},"zero-dimensional point must reject")

    # 51 element
    must("knowledge.element","H",{"symbol":"H"},lambda r:r["symbol"]=="H" and r.get("atomic_number")==1,"hydrogen data incorrect")
    reject("knowledge.element","unknown",{"symbol":"Xx"},"unknown element must reject")

    # 52 polynomial roots
    must("algebra.polynomial_roots","quadratic",{"expression":"x^2-4","symbol":"x"},lambda r:sorted(round(float(x),10) for x in r)==[-2.0,2.0],"polynomial roots incorrect")
    must("algebra.polynomial_roots","cubic",{"expression":"x^3-1","symbol":"x"},lambda r:len(r)==3,"cubic root count incorrect")

    # 53-54 sum/product
    must("calculus.sum","100",{"expression":"k","symbol":"k","start":1,"end":100},lambda r:int(r)==5050,"finite sum incorrect")
    must("calculus.product","6fact",{"expression":"k","symbol":"k","start":1,"end":6},lambda r:int(r)==720,"finite product incorrect")

    # 55-56 least squares/interpolation
    must("numeric.least_squares","exact",{"A":[[1],[2],[3]],"b":[2,4,6]},lambda r:abs(r["x"][0]-2)<1e-12 and r["rank"]==1,"least squares exact fit incorrect")
    reject("numeric.least_squares","shape",{"A":[[1,2],[3,4]],"b":[1]},"least squares dimension mismatch must reject")
    must("numeric.interpolate","linear",{"x":[0,1,2],"y":[0,2,4],"at":[.5,1.5]},lambda r:np.allclose(r,[1,3]),"linear interpolation incorrect")
    reject("numeric.interpolate","unsorted",{"x":[0,2,1],"y":[0,4,2],"at":[1.5]},"unsorted interpolation grid must reject")
    reject("numeric.interpolate","shape",{"x":[0,1],"y":[0],"at":[.5]},"interpolation x/y mismatch must reject")

    # 57 interval
    must("verified.interval_eval","square",{"expression":"x^2","symbol":"x","interval":[1,2]},lambda r:r["engine"]=="mpmath.iv" and "[" in r["interval"],"interval evaluation missing enclosure")
    reject("verified.interval_eval","reverse",{"expression":"x^2","symbol":"x","interval":[2,1]},"reversed interval must reject")

    # 58 LP
    must("optimization.linear_program","known",{"c":[1,1],"A_ub":[[-1,-1]],"b_ub":[-1],"bounds":[[0,None],[0,None]]},lambda r:r["success"] and abs(r["fun"]-1)<1e-9 and abs(sum(r["x"])-1)<1e-8,"LP optimum incorrect")
    must("optimization.linear_program","infeasible",{"c":[1],"A_ub":[[-1]],"b_ub":[-2],"bounds":[[0,1]]},lambda r:r["success"] is False and r["x"]==[],"infeasible LP should report failure")
    reject("optimization.linear_program","unknown-key",{"c":[1],"bounds":[[0,None]],"banana":1},"LP unknown argument must reject")

    # 59 QP
    must("optimization.quadratic","unconstrained",{"Q":[[2]],"c":[-4]},lambda r:r["success"] and abs(r["x"][0]-2)<1e-7 and r["verification"]["verified"],"unconstrained QP incorrect")
    must("optimization.quadratic","bounded",{"Q":[[2]],"c":[-4],"bounds":[[0,1]]},lambda r:r["success"] and abs(r["x"][0]-1)<1e-7 and r["verification"]["verified"],"bounded QP incorrect")
    reject("optimization.quadratic","unknown-key",{"Q":[[2]],"c":[0],"Aeq":[[1]],"beq":[1]},"QP alias keys must reject")

    # 60-61 ttest/normal fit
    must("statistics.ttest_ind","identical",{"x":[1,2,3,4],"y":[1,2,3,4],"equal_var":False},lambda r:abs(r["statistic"])<1e-12 and abs(r["pvalue"]-1)<1e-12,"t-test identical samples incorrect")
    reject("statistics.ttest_ind","empty",{"x":[],"y":[1,2]},"t-test empty sample must reject")
    must("statistics.normal_fit","known",{"data":[1,2,3,4,5]},lambda r:abs(r["mu"]-3)<1e-12 and r["sigma"]>0,"normal fit incorrect")
    reject("statistics.normal_fit","empty",{"data":[]},"normal fit empty must reject")

    # 62-63 exponential/chi2
    must("probability.exponential_cdf","known",{"x":2,"rate":.5},lambda r:abs(r-(1-math.exp(-1)))<1e-12,"exponential CDF incorrect")
    reject("probability.exponential_cdf","rate-zero",{"x":2,"rate":0},"exponential rate<=0 must reject")
    must("probability.chi2_cdf","known",{"x":5,"df":3},lambda r:0<r<1,"chi-square CDF out of range")
    reject("probability.chi2_cdf","df-zero",{"x":5,"df":0},"chi-square df<=0 must reject")

    # 64 implied vol
    # generate price from same Black-Scholes formula then recover vol; this tests inverse consistency.
    price=call("finance.black_scholes",{"S":100,"K":100,"T":1,"r":.05,"sigma":.3,"kind":"call"})
    must("finance.implied_vol","roundtrip",{"price":price,"S":100,"K":100,"T":1,"r":.05,"kind":"call"},lambda r:abs(r-.3)<1e-7,"implied-vol roundtrip incorrect")
    reject("finance.implied_vol","above-upper",{"price":150,"S":100,"K":100,"T":1,"r":.05,"kind":"call"},"implied vol impossible option price must reject")

    # 65-67 bonds
    bp_args={"face":1000,"coupon_rate":.05,"maturity":5,"yield":.04,"frequency":2}
    must("finance.bond_price","positive",bp_args,lambda r:r>0,"bond price nonpositive")
    bp=call("finance.bond_price",bp_args)
    must("finance.bond_yield","roundtrip",{"face":1000,"coupon_rate":.05,"maturity":5,"price":bp,"frequency":2},lambda r:abs(r-.04)<1e-8,"bond yield/price roundtrip failed")
    must("finance.duration","positive",bp_args,lambda r:r["macaulay"]>0 and r["modified"]>0 and r["modified"]<r["macaulay"],"bond duration invariants failed")
    reject("finance.bond_price","freq-zero",{"face":1000,"coupon_rate":.05,"maturity":5,"yield":.04,"frequency":0},"bond frequency<=0 must reject")
    reject("finance.bond_price","negative-face",{"face":-1000,"coupon_rate":.05,"maturity":5,"yield":.04,"frequency":2},"bond face<=0 must reject")
    reject("finance.bond_yield","negative-price",{"face":1000,"coupon_rate":.05,"maturity":5,"price":-1,"frequency":2},"bond price<=0 must reject")
    reject("finance.duration","zero-maturity",{"face":1000,"coupon_rate":.05,"maturity":0,"yield":.04,"frequency":2},"bond maturity<=0 must reject")

    # 68 beta
    must("finance.beta","affine",{"asset_returns":[.02,.04,.06,.08],"market_returns":[.01,.02,.03,.04]},lambda r:abs(r-2)<1e-12,"beta affine relation incorrect")
    reject("finance.beta","length",{"asset_returns":[.1,.2],"market_returns":[.1]},"beta length mismatch must reject")
    reject("finance.beta","zero-market-var",{"asset_returns":[.1,.2,.3],"market_returns":[.2,.2,.2]},"beta zero market variance must reject")

    # 69 drawdown
    must("finance.drawdown","known",{"values":[100,120,90,110]},lambda r:abs(r["max_drawdown"]+.25)<1e-12,"drawdown incorrect")
    reject("finance.drawdown","empty",{"values":[]},"drawdown empty must reject")
    reject("finance.drawdown","zero",{"values":[100,0,90]},"drawdown nonpositive values must reject")

    # 70 GBM
    must("finance.monte_carlo_gbm","deterministic-seed",{"S0":100,"mu":.05,"sigma":.2,"T":1,"steps":50,"paths":1000,"seed":42},lambda r:r["paths"]==1000 and r["mean_terminal"]>0 and r["p05"]<r["median_terminal"]<r["p95"],"GBM output invariants failed")
    reject("finance.monte_carlo_gbm","steps-zero",{"S0":100,"mu":.05,"sigma":.2,"T":1,"steps":0,"paths":10},"GBM steps<=0 must reject")
    reject("finance.monte_carlo_gbm","negative-S0",{"S0":-100,"mu":.05,"sigma":.2,"T":1,"steps":10,"paths":10},"GBM S0<=0 must reject")
    reject("finance.monte_carlo_gbm","negative-sigma",{"S0":100,"mu":.05,"sigma":-.2,"T":1,"steps":10,"paths":10},"GBM sigma<0 must reject")

    # 71 rolling volatility
    must("timeseries.rolling_volatility","known",{"returns":[.01,-.02,.015,-.01,.005],"window":3,"annualization":252},lambda r:len(r)==3 and all(x>=0 for x in r),"rolling volatility invalid")
    reject("timeseries.rolling_volatility","bad-window",{"returns":[.1],"window":2},"rolling volatility invalid window must reject")
    reject("timeseries.rolling_volatility","negative-ann",{"returns":[.1,.2],"window":2,"annualization":-1},"rolling volatility negative annualization must reject")

    # 72-73 geometry scalar
    must("geometry.area_circle","known",{"radius":3},lambda r:abs(r-9*math.pi)<1e-12,"circle area incorrect")
    reject("geometry.area_circle","negative",{"radius":-3},"negative radius circle must reject")
    must("geometry.volume_sphere","known",{"radius":3},lambda r:abs(r-36*math.pi)<1e-12,"sphere volume incorrect")
    reject("geometry.volume_sphere","negative",{"radius":-3},"negative radius sphere must reject")

    # 74 ifft + fft roundtrip
    counts["transforms.ifft"]+=2
    try:
        x=[1.,2.,3.,4.]
        spec=call("transforms.fft",{"data":x})
        back=call("transforms.ifft",{"data":spec,"n":4})
        if np.allclose(back,x,atol=1e-12): passes+=1
        else: finding("transforms.ifft","fft-roundtrip","critical","property-failure","FFT/IFFT roundtrip mismatch",{"fft":spec,"back":back})
    except Exception as e:
        finding("transforms.ifft","fft-roundtrip","critical","unexpected-error",f"FFT/IFFT roundtrip error: {type(e).__name__}: {e}")
    reject("transforms.ifft","empty",{"data":[],"n":4},"IFFT empty spectrum must reject")

    # verify.crosscheck gets multiple targets.
    for target in ["calculus.diff","numeric.root","numeric.integrate","linear.solve","finance.black_scholes","finance.implied_vol","optimization.linear_program","optimization.quadratic","arithmetic.evaluate","finance.npv"]:
        counts["verify.crosscheck"]+=1
        args=copy.deepcopy(fixtures[target])
        if target=="optimization.quadratic": args={"Q":[[2]],"c":[-4],"bounds":[[0,1]]}
        try:
            r=call("verify.crosscheck",{"operation":target,"args":args})
            v=r.get("verification") or {}
            if v.get("verified") is True: passes+=1
            elif v.get("verified") is None:
                finding("verify.crosscheck","target:"+target,"high","verification-gap",f"crosscheck returns not-applicable for {target}",r)
            else:
                finding("verify.crosscheck","target:"+target,"critical","verification-failure",f"crosscheck failed for {target}",r)
        except Exception as e:
            finding("verify.crosscheck","target:"+target,"high","unexpected-error",f"crosscheck error for {target}: {type(e).__name__}: {e}")

    missing=[op for op,n in counts.items() if n==0]
    if missing:
        for op in missing:finding(op,"coverage","critical","audit-coverage-gap","operation received no property tests")
    summary={}
    cats={}
    for f in findings:
        summary[f["severity"]]=summary.get(f["severity"],0)+1
        cats[f["category"]]=cats.get(f["category"],0)+1
    print("AXIOM_PROPERTY_AUDIT_SUMMARY="+json.dumps({"operations":len(counts),"tests":sum(counts.values()),"passes":passes,"findings":len(findings),"missing_ops":missing,"severity":summary,"categories":cats},sort_keys=True))
    for i,f in enumerate(findings,1):
        print("AXIOM_PROPERTY_FINDING|%03d|%s|%s|%s|%s|%s" % (i,f["severity"],f["category"],f["operation"],f["case"],f["detail"].replace("|","/").replace("\n"," ")))
    return 0

if __name__=="__main__":
    raise SystemExit(main())
