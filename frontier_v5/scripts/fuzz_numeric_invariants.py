from __future__ import annotations
import argparse,importlib,math,pathlib,sys
import numpy as np

def main():
    ap=argparse.ArgumentParser();ap.add_argument("--runtime",required=True);ns=ap.parse_args()
    sys.path.insert(0,str(pathlib.Path(ns.runtime).resolve()))
    m=importlib.import_module("kernel.app.main")
    rng=np.random.default_rng(20261004)
    checks=0
    # Linear solve / inverse residuals across well-conditioned random systems.
    for n in (2,3,5):
      for _ in range(10):
        B=rng.normal(size=(n,n));A=B.T@B+np.eye(n);b=rng.normal(size=n)
        x=np.asarray(m.dispatch("linear.solve",{"A":A.tolist(),"b":b.tolist()},50),float)
        assert np.linalg.norm(A@x-b)<1e-8;checks+=1
        inv=np.asarray(m.dispatch("linear.inv",{"A":A.tolist()},50),float)
        assert np.linalg.norm(A@inv-np.eye(n))<1e-8;checks+=1
    # Normal CDF/PPF inverse.
    for p in np.linspace(.01,.99,25):
        x=float(m.dispatch("probability.normal_ppf",{"p":float(p)},50))
        pp=float(m.dispatch("probability.normal_cdf",{"x":x},50))
        assert abs(pp-p)<2e-12;checks+=1
    # Black-Scholes parity and implied-vol roundtrip.
    for _ in range(25):
        S=float(rng.uniform(20,200));K=float(rng.uniform(20,200));T=float(rng.uniform(.05,3));r=float(rng.uniform(-.02,.15));q=float(rng.uniform(0,.08));sig=float(rng.uniform(.05,1))
        c=float(m.dispatch("finance.black_scholes",{"S":S,"K":K,"T":T,"r":r,"q":q,"sigma":sig,"kind":"call"},50))
        p=float(m.dispatch("finance.black_scholes",{"S":S,"K":K,"T":T,"r":r,"q":q,"sigma":sig,"kind":"put"},50))
        assert abs((c-p)-(S*math.exp(-q*T)-K*math.exp(-r*T)))<1e-8;checks+=1
        iv=float(m.dispatch("finance.implied_vol",{"price":c,"S":S,"K":K,"T":T,"r":r,"q":q,"kind":"call"},50))
        intrinsic=max(0.0,S*math.exp(-q*T)-K*math.exp(-r*T))
        if c-intrinsic > max(1e-8,1e-10*S):
            assert abs(iv-sig)<2e-7
        else:
            repriced=float(m.dispatch("finance.black_scholes",{"S":S,"K":K,"T":T,"r":r,"q":q,"sigma":iv,"kind":"call"},50))
            assert abs(repriced-c)<1e-8
        checks+=1
    # FFT/IFFT roundtrip.
    for n in (2,3,4,7,16):
      for _ in range(5):
        x=rng.normal(size=n)
        f=m.dispatch("transforms.fft",{"data":x.tolist()},50)
        y=np.asarray(m.dispatch("transforms.ifft",{"data":f,"n":n},50),float)
        assert np.max(np.abs(x-y))<1e-10;checks+=1
    # Bond price/yield inverse.
    for _ in range(20):
        face=float(rng.uniform(100,5000));cr=float(rng.uniform(0,.12));mat=float(rng.integers(1,15));freq=int(rng.choice([1,2,4]));y=float(rng.uniform(-.01,.2))
        price=float(m.dispatch("finance.bond_price",{"face":face,"coupon_rate":cr,"maturity":mat,"yield":y,"frequency":freq},50))
        yy=float(m.dispatch("finance.bond_yield",{"face":face,"coupon_rate":cr,"maturity":mat,"price":price,"frequency":freq},50))
        assert abs(yy-y)<2e-9;checks+=1
    # Convex bounded 1D QPs.
    for _ in range(25):
        q=float(rng.uniform(.1,10));target=float(rng.uniform(-2,2));lo=float(rng.uniform(-3,-.1));hi=float(rng.uniform(.1,3));c=-q*target
        expected=min(max(target,lo),hi)
        r=m.dispatch("optimization.quadratic",{"Q":[[q]],"c":[c],"bounds":[[lo,hi]]},50)
        assert r["success"] and r["verification"]["verified"] and abs(r["x"][0]-expected)<2e-6;checks+=1
    # Unit round trips.
    for v in rng.uniform(-1000,1000,20):
        cm=float(m.dispatch("units.convert",{"value":float(v),"from":"m","to":"cm"},50))
        back=float(m.dispatch("units.convert",{"value":cm,"from":"cm","to":"m"},50))
        assert abs(back-v)<1e-10;checks+=1
    print("MUSITU_AXIOM_NUMERICAL_PROPERTY_FUZZ_PASS")
    print("FUZZ_CHECK_COUNT="+str(checks))
if __name__=="__main__":main()
