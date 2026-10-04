from __future__ import annotations
import argparse, copy, importlib, json, math, pathlib, random, sys
import numpy as np
from scipy import stats

class P:
    def __init__(self,m,fixtures):
        self.m=m; self.fixtures=fixtures; self.n=0; self.fail=[]
    def check(self,name,ok,detail=None):
        self.n+=1
        if not ok:self.fail.append({"test":name,"detail":detail})
    def call(self,op,args):
        return self.m.dispatch(op,copy.deepcopy(args),50)
    def raises(self,op,args):
        try:self.call(op,args);return False
        except Exception:return True
    def close(self,a,b,atol=1e-8,rtol=1e-8):
        try:return bool(np.allclose(np.asarray(a,float),np.asarray(b,float),atol=atol,rtol=rtol))
        except:return False

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--runtime",required=True)
    ap.add_argument("--fixtures",required=True)
    ap.add_argument("--out",required=True)
    ns=ap.parse_args()
    sys.path.insert(0,str(pathlib.Path(ns.runtime).resolve()))
    m=importlib.import_module("kernel.app.main")
    fixtures=json.load(open(ns.fixtures))["fixtures"]
    rng=random.Random(20261004)
    np_rng=np.random.default_rng(20261004)
    p=P(m,fixtures)
    ops=sorted(fixtures)
    p.check("registry.74",len(ops)==74,{"count":len(ops)})

    # Every operation: valid fixture, deterministic replay, and multiple unknown-key mutations.
    for op in ops:
        try:
            a=p.call(op,fixtures[op]); b=p.call(op,fixtures[op])
            p.check(f"{op}.fixture_exec",True)
            p.check(f"{op}.deterministic",m.encode(a)==m.encode(b),{"a":m.encode(a),"b":m.encode(b)})
        except Exception as e:
            p.check(f"{op}.fixture_exec",False,{"error":type(e).__name__+":"+str(e)})
            p.check(f"{op}.deterministic",False,{"error":"fixture execution failed"})
        for j in range(3):
            bad=copy.deepcopy(fixtures[op]);bad[f"__unknown_{j}_{rng.randrange(10**9)}"]=j
            p.check(f"{op}.unknown_{j}",p.raises(op,bad))

    # Arithmetic/algebra/calculus exact families.
    for i in range(30):
        a=rng.randint(-20,20); b=rng.randint(-20,20); c=rng.randint(-10,10)
        expr=f"({a})+({b})*({c})"
        p.check(f"arithmetic.{i}",p.close(p.call("arithmetic.evaluate",{"expression":expr}),a+b*c,1e-12,0))
    for n in range(1,10):
        r=p.call("calculus.diff",{"expression":f"x^{n}","symbol":"x"})
        p.check(f"diff.power.{n}",str(r)==str(n*m.sp.Symbol('x')**(n-1)),{"got":str(r)})
        r=p.call("calculus.integrate",{"expression":f"x^{n}","symbol":"x","bounds":[0,1]})
        p.check(f"integrate.power.{n}",p.close(r,1/(n+1),1e-12,0),{"got":str(r)})
        r=p.call("calculus.sum",{"expression":"k","symbol":"k","start":1,"end":n})
        p.check(f"sum.{n}",int(r)==n*(n+1)//2,{"got":str(r)})
        r=p.call("calculus.product",{"expression":"k","symbol":"k","start":1,"end":n})
        p.check(f"product.{n}",int(r)==math.factorial(n),{"got":str(r)})
    for i in range(15):
        a=rng.randint(-8,8); b=rng.randint(-8,8)
        r=p.call("algebra.expand",{"expression":f"(x+({a}))*(x+({b}))"})
        x=m.sp.Symbol("x"); ref=m.sp.expand((x+a)*(x+b))
        p.check(f"expand.{i}",m.sp.simplify(r-ref)==0,{"got":str(r),"ref":str(ref)})
        f=p.call("algebra.factor",{"expression":str(ref)})
        p.check(f"factor.{i}",m.sp.simplify(f-ref)==0,{"got":str(f),"ref":str(ref)})
        s=p.call("algebra.simplify",{"expression":f"(x+({a}))+(x-({a}))"})
        p.check(f"simplify.{i}",m.sp.simplify(s-2*x)==0,{"got":str(s)})
    for i in range(12):
        a=rng.randint(1,10); b=rng.randint(-10,10)
        r=p.call("algebra.solve",{"equations":[f"{a}*x-({b})"],"symbols":["x"]})
        got=float(list(r[0].values())[0])
        p.check(f"solve.linear.{i}",abs(got-b/a)<1e-12,{"got":got,"ref":b/a})
    p.check("limit.sinx",p.close(p.call("calculus.limit",{"expression":"sin(x)/x","symbol":"x","to":0}),1,1e-12,0))
    p.check("series.exp", "x**5/120" in str(p.call("calculus.series",{"expression":"exp(x)","symbol":"x","at":0,"order":6})))

    # Numeric solvers.
    for i in range(20):
        c=rng.uniform(.1,25)
        got=float(p.call("numeric.root",{"expression":f"x^2-({c})","symbol":"x","guess":max(1,math.sqrt(c))}))
        p.check(f"root.{i}",abs(got-math.sqrt(c))<1e-9,{"got":got,"ref":math.sqrt(c)})
        n=rng.randint(0,7)
        got=p.call("numeric.integrate",{"expression":f"x^{n}","a":0,"b":1})
        p.check(f"quad.{i}",abs(got["value"]-1/(n+1))<1e-9,{"got":got})
        center=rng.uniform(-5,5); floor=rng.uniform(-2,2)
        got=p.call("numeric.optimize_scalar",{"expression":f"(x-({center}))^2+({floor})","a":center-5,"b":center+5})
        p.check(f"opt_scalar.{i}",abs(got["x"]-center)<2e-5 and abs(got["fun"]-floor)<1e-8,{"got":got})
    for i in range(10):
        k=rng.uniform(.1,3)
        t=rng.uniform(.2,2)
        got=p.call("numeric.ode",{"rhs":f"-({k})*y","t0":0,"t1":t,"y0":1})
        p.check(f"ode.{i}",got["success"] and abs(got["y"][-1]-math.exp(-k*t))<5e-6,{"got":got["y"][-1],"ref":math.exp(-k*t)})

    # Linear algebra.
    for i in range(30):
        A=np_rng.normal(size=(3,3)); A=A+np.eye(3)*3
        b=np_rng.normal(size=3)
        det=float(p.call("linear.det",{"A":A.tolist()}))
        p.check(f"det.{i}",abs(det-np.linalg.det(A))<1e-9,{"got":det})
        inv=np.asarray(p.call("linear.inv",{"A":A.tolist()}),float)
        p.check(f"inv.{i}",np.allclose(A@inv,np.eye(3),atol=1e-9,rtol=1e-9))
        sol=np.asarray(p.call("linear.solve",{"A":A.tolist(),"b":b.tolist()}),float)
        p.check(f"solve.{i}",np.linalg.norm(A@sol-b)<1e-9)
        eig=p.call("linear.eigen",{"A":A.tolist()})
        vals=np.asarray(eig["values"],complex); vecs=np.asarray(eig["vectors"],complex)
        p.check(f"eigen.{i}",np.linalg.norm(A@vecs-vecs@np.diag(vals))<1e-7)

    # Statistics and probability.
    for i in range(25):
        x=np_rng.normal(loc=rng.uniform(-2,2),scale=rng.uniform(.2,3),size=20)
        y=2*x+np_rng.normal(scale=.3,size=20)
        d=p.call("statistics.describe",{"data":x.tolist()})
        p.check(f"describe.{i}",abs(d["mean"]-x.mean())<1e-12 and abs(d["std_sample"]-x.std(ddof=1))<1e-12)
        corr=float(p.call("statistics.correlation",{"x":x.tolist(),"y":y.tolist()}))
        p.check(f"corr.{i}",abs(corr-np.corrcoef(x,y)[0,1])<1e-12)
        cov=float(p.call("statistics.covariance",{"x":x.tolist(),"y":y.tolist()}))
        p.check(f"cov.{i}",abs(cov-np.cov(x,y,ddof=1)[0,1])<1e-12)
        reg=p.call("statistics.regression",{"x":x.tolist(),"y":y.tolist()})
        ref=stats.linregress(x,y)
        p.check(f"reg.{i}",abs(reg["slope"]-ref.slope)<1e-12 and abs(reg["intercept"]-ref.intercept)<1e-12)
        q=rng.random()
        got=float(p.call("statistics.quantile",{"data":x.tolist(),"q":q}))
        p.check(f"quantile.{i}",abs(got-np.quantile(x,q))<1e-12)
        z=np.asarray(p.call("statistics.zscore",{"data":x.tolist()}),float)
        p.check(f"zscore.{i}",abs(z.mean())<1e-12 and abs(z.std(ddof=0)-1)<1e-12)
        fit=p.call("statistics.normal_fit",{"data":x.tolist()})
        p.check(f"normal_fit.{i}",abs(fit["mu"]-x.mean())<1e-12 and abs(fit["sigma"]-x.std(ddof=0))<1e-12)
    for i in range(50):
        mu=rng.uniform(-5,5); sigma=rng.uniform(.1,4); prob=rng.uniform(.001,.999)
        q=float(p.call("probability.normal_ppf",{"p":prob,"mu":mu,"sigma":sigma}))
        back=float(p.call("probability.normal_cdf",{"x":q,"mu":mu,"sigma":sigma}))
        p.check(f"normal_roundtrip.{i}",abs(back-prob)<1e-10,{"p":prob,"back":back})
    for n in range(1,10):
        prob=rng.uniform(.05,.95)
        s=sum(float(p.call("probability.binomial_pmf",{"k":k,"n":n,"p":prob})) for k in range(n+1))
        p.check(f"binomial_mass.{n}",abs(s-1)<1e-12,{"sum":s})
    for mu in [.1,.5,1,2,5,10]:
        s=sum(float(p.call("probability.poisson_pmf",{"k":k,"mu":mu})) for k in range(0,80))
        p.check(f"poisson_mass.{mu}",abs(s-1)<1e-10,{"sum":s})
    for i in range(20):
        rate=rng.uniform(.1,5); x=rng.uniform(0,10)
        got=float(p.call("probability.exponential_cdf",{"x":x,"rate":rate}))
        p.check(f"exp_cdf.{i}",abs(got-(1-math.exp(-rate*x)))<1e-12)
        df=rng.uniform(.2,10); xx=rng.uniform(0,20)
        got=float(p.call("probability.chi2_cdf",{"x":xx,"df":df}))
        p.check(f"chi2.{i}",abs(got-stats.chi2.cdf(xx,df))<1e-12)

    # Finance identities/inverses.
    for i in range(25):
        principal=rng.uniform(10,10000); rate=rng.uniform(-.2,.3); years=rng.uniform(0,20); n=rng.choice([1,2,4,12])
        got=float(p.call("finance.compound",{"principal":principal,"rate":rate,"years":years,"n":n}))
        ref=principal*(1+rate/n)**(n*years)
        p.check(f"compound.{i}",abs(got-ref)<=max(1e-9,abs(ref)*1e-12))
        cash=[rng.uniform(-1000,1000) for _ in range(6)]; rr=rng.uniform(-.5,.5)
        got=float(p.call("finance.npv",{"cashflows":cash,"rate":rr}))
        ref=sum(cf/(1+rr)**j for j,cf in enumerate(cash))
        p.check(f"npv.{i}",abs(got-ref)<=max(1e-9,abs(ref)*1e-12))
    for i in range(30):
        S=rng.uniform(60,180); K=S*rng.uniform(.75,1.25); T=rng.uniform(.25,3); r=rng.uniform(-.03,.12); sigma=rng.uniform(.1,.7); q=rng.uniform(0,.06)
        call=float(p.call("finance.black_scholes",{"S":S,"K":K,"T":T,"r":r,"sigma":sigma,"q":q,"kind":"call"}))
        put=float(p.call("finance.black_scholes",{"S":S,"K":K,"T":T,"r":r,"sigma":sigma,"q":q,"kind":"put"}))
        parity=S*math.exp(-q*T)-K*math.exp(-r*T)
        p.check(f"bs_parity.{i}",abs((call-put)-parity)<1e-8)
        iv=float(p.call("finance.implied_vol",{"price":call,"S":S,"K":K,"T":T,"r":r,"q":q,"kind":"call"}))
        p.check(f"iv_roundtrip.{i}",abs(iv-sigma)<2e-7,{"got":iv,"ref":sigma})
        g=p.call("finance.greeks",{"S":S,"K":K,"T":T,"r":r,"sigma":sigma,"q":q,"kind":"call"})
        p.check(f"greeks_finite.{i}",all(math.isfinite(float(g[k])) for k in ("delta","gamma","vega","theta","rho")))
    for i in range(20):
        face=rng.uniform(100,5000); coupon=rng.uniform(0,.12); mat=rng.uniform(.5,20); y=rng.uniform(-.02,.15); freq=rng.choice([1,2,4])
        price=float(p.call("finance.bond_price",{"face":face,"coupon_rate":coupon,"maturity":mat,"yield":y,"frequency":freq}))
        y2=float(p.call("finance.bond_yield",{"face":face,"coupon_rate":coupon,"maturity":mat,"price":price,"frequency":freq}))
        p.check(f"bond_inverse.{i}",abs(y2-y)<2e-7,{"got":y2,"ref":y})
        dur=p.call("finance.duration",{"face":face,"coupon_rate":coupon,"maturity":mat,"yield":y,"frequency":freq})
        refmod=dur["macaulay"]/(1+y/freq)
        p.check(f"duration.{i}",dur["macaulay"]>0 and dur["modified"]>0 and abs(dur["modified"]-refmod)<1e-10,{"got":dur,"ref_modified":refmod})
    for i in range(20):
        rts=np_rng.normal(loc=.0005,scale=.02,size=50)
        alpha=rng.uniform(.8,.995)
        vh=p.call("finance.var_historical",{"returns":rts.tolist(),"alpha":alpha})
        ref=-np.quantile(rts,1-alpha)
        p.check(f"var_hist.{i}",abs(vh["var"]-ref)<1e-12)
        vp=p.call("finance.var_parametric",{"returns":rts.tolist(),"alpha":alpha})
        refp=-(rts.mean()+stats.norm.ppf(1-alpha)*rts.std(ddof=1))
        p.check(f"var_param.{i}",abs(vp["var"]-refp)<1e-10,{"got":vp["var"],"ref":refp})
        cv=p.call("finance.cvar_historical",{"returns":rts.tolist(),"alpha":alpha})
        threshold=np.quantile(rts,1-alpha); tail=rts[rts<=threshold]
        refc=-tail.mean()
        p.check(f"cvar.{i}",abs(cv["cvar"]-refc)<1e-12,{"got":cv["cvar"],"ref":refc})
    for i in range(20):
        prices=np.exp(np.cumsum(np_rng.normal(0,.03,size=20)))*100
        simple=np.asarray(p.call("finance.returns",{"prices":prices.tolist(),"kind":"simple"}),float)
        logret=np.asarray(p.call("finance.returns",{"prices":prices.tolist(),"kind":"log"}),float)
        p.check(f"returns_simple.{i}",np.allclose(simple,np.diff(prices)/prices[:-1],atol=1e-12,rtol=1e-12))
        p.check(f"returns_log.{i}",np.allclose(logret,np.diff(np.log(prices)),atol=1e-12,rtol=1e-12))
        market=np_rng.normal(0,.02,size=40); asset=1.7*market+np_rng.normal(0,.002,size=40)
        beta=float(p.call("finance.beta",{"asset_returns":asset.tolist(),"market_returns":market.tolist()}))
        ref=np.cov(asset,market,ddof=1)[0,1]/np.var(market,ddof=1)
        p.check(f"beta.{i}",abs(beta-ref)<1e-10)
    for i in range(10):
        mu=rng.uniform(-.1,.2); T=rng.uniform(.1,2)
        mc=p.call("finance.monte_carlo_gbm",{"S0":100,"mu":mu,"sigma":0.0,"T":T,"steps":10,"paths":25,"seed":i})
        ref=100*math.exp(mu*T)
        p.check(f"mc_sigma0.{i}",max(abs(float(mc[k])-ref) for k in ("mean_terminal","median_terminal","p05","p95"))<1e-9,{"got":mc,"ref":ref})

    # Time series.
    for i in range(20):
        z=np_rng.normal(size=15); window=rng.randint(2,6)
        ma=np.asarray(p.call("timeseries.moving_average",{"data":z.tolist(),"window":window}),float)
        ref=np.convolve(z,np.ones(window)/window,mode="valid")
        p.check(f"ma.{i}",np.allclose(ma,ref,atol=1e-12,rtol=1e-12))
        alpha=rng.uniform(.05,1)
        ew=np.asarray(p.call("timeseries.ewma",{"data":z.tolist(),"alpha":alpha}),float)
        refew=[z[0]]
        for v in z[1:]:refew.append(alpha*v+(1-alpha)*refew[-1])
        p.check(f"ewma.{i}",np.allclose(ew,refew,atol=1e-12,rtol=1e-12))
        rv=np.asarray(p.call("timeseries.rolling_volatility",{"returns":z.tolist(),"window":window,"annualization":252}),float)
        refrv=np.array([np.std(z[j:j+window],ddof=1)*math.sqrt(252) for j in range(len(z)-window+1)])
        p.check(f"rolling_vol.{i}",np.allclose(rv,refrv,atol=1e-12,rtol=1e-12),{"got":rv.tolist(),"ref":refrv.tolist()})

    # Geometry/transforms/knowledge/number theory.
    for i in range(20):
        r=rng.uniform(0,20)
        p.check(f"circle.{i}",abs(float(p.call("geometry.area_circle",{"radius":r}))-math.pi*r*r)<1e-10)
        p.check(f"sphere.{i}",abs(float(p.call("geometry.volume_sphere",{"radius":r}))-(4/3)*math.pi*r**3)<1e-10)
        a=np_rng.normal(size=5); b=np_rng.normal(size=5)
        p.check(f"distance.{i}",abs(float(p.call("geometry.distance",{"p":a.tolist(),"q":b.tolist()}))-np.linalg.norm(a-b))<1e-12)
    for n in [2,3,4,5,8,16]:
        data=np_rng.normal(size=n)
        fft=p.call("transforms.fft",{"data":data.tolist()})
        back=np.asarray(p.call("transforms.ifft",{"data":m.encode(fft),"n":n}),float)
        p.check(f"fft_roundtrip.{n}",np.allclose(back,data,atol=1e-10,rtol=1e-10),{"got":back.tolist(),"ref":data.tolist()})
    for n in range(0,15):
        p.check(f"factorial.{n}",int(p.call("combinatorics.factorial",{"n":n}))==math.factorial(n))
    for n in range(2,30):
        got=bool(p.call("numbertheory.isprime",{"n":n}))
        ref=all(n%d for d in range(2,int(math.sqrt(n))+1))
        p.check(f"isprime.{n}",got==ref)
    p.check("constant.c",abs(p.call("knowledge.constant",{"name":"c"})["value"]-299792458)<1e-12)
    p.check("element.H",p.call("knowledge.element",{"symbol":"H"})["atomic_number"]==1)

    # Interpolation/interval/least squares.
    for i in range(20):
        x=np.sort(np_rng.uniform(-5,5,size=8)); y=2*x+3; q=np_rng.uniform(x[0],x[-1],size=5)
        got=np.asarray(p.call("numeric.interpolate",{"x":x.tolist(),"y":y.tolist(),"at":q.tolist()}),float)
        p.check(f"interp.{i}",np.allclose(got,2*q+3,atol=1e-10,rtol=1e-10))
        A=np_rng.normal(size=(8,3)); beta=np.array([1.5,-2,.7]); b=A@beta
        ls=p.call("numeric.least_squares",{"A":A.tolist(),"b":b.tolist()})
        p.check(f"lstsq.{i}",np.allclose(np.asarray(ls["x"],float),beta,atol=1e-9,rtol=1e-9))
    p.check("interval.linear","1.0" in p.call("verified.interval_eval",{"expression":"x","symbol":"x","interval":[1,2]})["interval"])

    # LP/QP families.
    for i in range(25):
        lo=rng.uniform(-5,0); hi=rng.uniform(.1,5); target=rng.uniform(lo,hi)
        lp=p.call("optimization.linear_program",{"c":[1.0],"bounds":[[lo,hi]]})
        p.check(f"lp_box.{i}",lp["success"] and abs(lp["x"][0]-lo)<1e-8)
        qcoef=rng.uniform(.2,5); center=target
        qp=p.call("optimization.quadratic",{"Q":[[2*qcoef]],"c":[-2*qcoef*center],"bounds":[[lo,hi]]})
        p.check(f"qp_box.{i}",qp["success"] and abs(qp["x"][0]-center)<2e-6 and qp["verification"]["verified"],{"got":m.encode(qp)})
    portfolio={"Q":[[0.04,0.006,0.012,0],[0.006,0.09,0.018,0.009],[0.012,0.018,0.16,0.03],[0,0.009,0.03,0.0625]],"c":[0,0,0,0],"A_eq":[[1,1,1,1],[0.06,0.09,0.14,0.07]],"b_eq":[1,0.09],"bounds":[[0,1],[0,1],[0,1],[0,1]]}
    qpr=p.call("optimization.quadratic",portfolio)
    p.check("qp.permanent_portfolio",qpr["success"] and qpr["verification"]["verified"] and np.allclose(qpr["x"],[0.3041873734721162,0.25477423525473725,0.2563769861375202,0.18466140513562634],atol=2e-6))

    # Explicit verification path.
    for i,c in enumerate([.5,2,10,50]):
        cr=p.call("verify.crosscheck",{"operation":"numeric.root","args":{"expression":f"x^2-{c}","symbol":"x","guess":math.sqrt(c)}})
        p.check(f"crosscheck.{i}",cr["verification"].get("verified") is True and abs(float(cr["result"])-math.sqrt(c))<1e-9,{"got":m.encode(cr)})

    report={"schema":"musitu.axiom.all_operations_property_audit.v1","seed":20261004,"tests_run":p.n,"failures":p.fail,"failure_count":len(p.fail)}
    pathlib.Path(ns.out).write_text(json.dumps(report,indent=2,sort_keys=True)+"\n")
    print("AXIOM_PROPERTY_SUMMARY="+json.dumps({"tests_run":p.n,"failure_count":len(p.fail)},sort_keys=True))
    for f in p.fail[:100]:print("AXIOM_PROPERTY_FAILURE="+json.dumps(f,sort_keys=True)[:3000])
    return 0

if __name__=="__main__":
    raise SystemExit(main())
