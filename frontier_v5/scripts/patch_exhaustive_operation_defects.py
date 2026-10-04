from __future__ import annotations
import argparse, hashlib, pathlib

EXPECTED_SHA256="cfa39f0f17c56a183c5024a600086aba4644ec925343129245a62e18294f7c47"

VALIDATION = r'''
_OPERATION_ALLOWED = {
'arithmetic.evaluate':{'expression'},
'algebra.simplify':{'expression'},'algebra.expand':{'expression'},'algebra.factor':{'expression'},'algebra.solve':{'equations','symbols'},
'calculus.diff':{'expression','symbol','order'},'calculus.integrate':{'expression','symbol','bounds'},'calculus.limit':{'expression','symbol','to'},'calculus.series':{'expression','symbol','at','order'},
'numeric.root':{'expression','symbol','guess'},'numeric.integrate':{'expression','a','b','epsabs'},'numeric.ode':{'rhs','t0','t1','y0','rtol','atol'},'numeric.optimize_scalar':{'expression','a','b'},
'linear.det':{'A'},'linear.inv':{'A'},'linear.solve':{'A','b'},'linear.eigen':{'A'},
'statistics.describe':{'data'},'statistics.correlation':{'x','y'},'statistics.regression':{'x','y'},'statistics.quantile':{'data','q'},
'probability.normal_cdf':{'x','mu','sigma'},'probability.normal_ppf':{'p','mu','sigma'},
'finance.compound':{'principal','rate','years','n'},'finance.npv':{'cashflows','rate'},'finance.black_scholes':{'S','K','T','r','sigma','kind','q'},'finance.greeks':{'S','K','T','r','sigma','kind','q'},'finance.var_historical':{'returns','alpha'},
'units.convert':{'value','from','to'},'verify.evaluate':{'lhs','rhs'},'knowledge.constant':{'name'},
'combinatorics.factorial':{'n'},'combinatorics.binomial':{'n','k'},'numbertheory.isprime':{'n'},'numbertheory.factorint':{'n'},'numbertheory.gcd':{'a','b'},'numbertheory.lcm':{'a','b'},
'transforms.fft':{'data'},'statistics.covariance':{'x','y'},'statistics.zscore':{'data','ddof'},
'probability.binomial_pmf':{'k','n','p'},'probability.poisson_pmf':{'k','mu'},
'finance.returns':{'prices','kind'},'finance.portfolio_metrics':{'returns','weights','annualization','risk_free'},'finance.var_parametric':{'returns','alpha'},'finance.cvar_historical':{'returns','alpha'},
'timeseries.moving_average':{'data','window'},'timeseries.ewma':{'data','alpha'},'geometry.distance':{'p','q'},
'knowledge.element':{'symbol'},'algebra.polynomial_roots':{'expression','symbol'},'calculus.sum':{'expression','symbol','start','end'},'calculus.product':{'expression','symbol','start','end'},
'numeric.least_squares':{'A','b'},'numeric.interpolate':{'x','y','at'},'verified.interval_eval':{'expression','symbol','interval'},
'optimization.linear_program':{'c','A_ub','b_ub','A_eq','b_eq','bounds'},'optimization.quadratic':{'Q','c','x0','A_eq','b_eq','A_ub','b_ub','bounds'},
'statistics.ttest_ind':{'x','y','equal_var'},'statistics.normal_fit':{'data'},'probability.exponential_cdf':{'x','rate'},'probability.chi2_cdf':{'x','df'},
'finance.implied_vol':{'price','S','K','T','r','kind','q'},'finance.bond_price':{'face','coupon_rate','maturity','yield','frequency'},'finance.bond_yield':{'face','coupon_rate','maturity','price','frequency'},'finance.duration':{'face','coupon_rate','maturity','yield','frequency'},
'finance.beta':{'asset_returns','market_returns'},'finance.drawdown':{'values'},'finance.monte_carlo_gbm':{'S0','mu','sigma','T','steps','paths','seed'},
'timeseries.rolling_volatility':{'returns','window','annualization'},'geometry.area_circle':{'radius'},'geometry.volume_sphere':{'radius'},'transforms.ifft':{'data','n'},'verify.crosscheck':{'operation','args'},
}
_OPERATION_REQUIRED = {
'arithmetic.evaluate':{'expression'},
'algebra.simplify':{'expression'},'algebra.expand':{'expression'},'algebra.factor':{'expression'},'algebra.solve':{'equations'},
'calculus.diff':{'expression'},'calculus.integrate':{'expression'},'calculus.limit':{'expression','to'},'calculus.series':{'expression'},
'numeric.root':{'expression','guess'},'numeric.integrate':{'expression','a','b'},'numeric.ode':{'rhs','t0','t1','y0'},'numeric.optimize_scalar':{'expression','a','b'},
'linear.det':{'A'},'linear.inv':{'A'},'linear.solve':{'A','b'},'linear.eigen':{'A'},
'statistics.describe':{'data'},'statistics.correlation':{'x','y'},'statistics.regression':{'x','y'},'statistics.quantile':{'data','q'},
'probability.normal_cdf':{'x'},'probability.normal_ppf':{'p'},
'finance.compound':{'principal','rate','years'},'finance.npv':{'cashflows','rate'},'finance.black_scholes':{'S','K','T','r','sigma'},'finance.greeks':{'S','K','T','r','sigma'},'finance.var_historical':{'returns'},
'units.convert':{'value','from','to'},'verify.evaluate':{'lhs','rhs'},'knowledge.constant':{'name'},
'combinatorics.factorial':{'n'},'combinatorics.binomial':{'n','k'},'numbertheory.isprime':{'n'},'numbertheory.factorint':{'n'},'numbertheory.gcd':{'a','b'},'numbertheory.lcm':{'a','b'},
'transforms.fft':{'data'},'statistics.covariance':{'x','y'},'statistics.zscore':{'data'},
'probability.binomial_pmf':{'k','n','p'},'probability.poisson_pmf':{'k','mu'},
'finance.returns':{'prices'},'finance.portfolio_metrics':{'returns','weights'},'finance.var_parametric':{'returns'},'finance.cvar_historical':{'returns'},
'timeseries.moving_average':{'data','window'},'timeseries.ewma':{'data'},'geometry.distance':{'p','q'},
'knowledge.element':{'symbol'},'algebra.polynomial_roots':{'expression'},'calculus.sum':{'expression','start','end'},'calculus.product':{'expression','start','end'},
'numeric.least_squares':{'A','b'},'numeric.interpolate':{'x','y','at'},'verified.interval_eval':{'expression','interval'},
'optimization.linear_program':{'c'},'optimization.quadratic':{'Q','c'},
'statistics.ttest_ind':{'x','y'},'statistics.normal_fit':{'data'},'probability.exponential_cdf':{'x','rate'},'probability.chi2_cdf':{'x','df'},
'finance.implied_vol':{'price','S','K','T','r'},'finance.bond_price':{'coupon_rate','maturity','yield'},'finance.bond_yield':{'coupon_rate','maturity','price'},'finance.duration':{'coupon_rate','maturity','yield'},
'finance.beta':{'asset_returns','market_returns'},'finance.drawdown':{'values'},'finance.monte_carlo_gbm':{'S0','mu','sigma','T'},
'timeseries.rolling_volatility':{'returns','window'},'geometry.area_circle':{'radius'},'geometry.volume_sphere':{'radius'},'transforms.ifft':{'data'},'verify.crosscheck':{'operation','args'},
}

def _finite_array(v,name,min_size=None):
    z=np.asarray(v,float)
    if min_size is not None and z.size<min_size: raise ValueError(f'{name} requires at least {min_size} value(s)')
    if not np.all(np.isfinite(z)): raise ValueError(f'{name} must be finite')
    return z

def _positive(name,v,allow_zero=False):
    x=float(v)
    if not math.isfinite(x) or (x<0 if allow_zero else x<=0): raise ValueError(f'{name} must be {"nonnegative" if allow_zero else "positive"}')
    return x

def _prob(name,v,closed=True):
    x=float(v)
    ok=(0<=x<=1) if closed else (0<x<1)
    if not math.isfinite(x) or not ok: raise ValueError(f'{name} must be in {"[0,1]" if closed else "(0,1)"}')
    return x

def _validate_operation_args(op,a):
    if not isinstance(a,dict): raise ValueError('operation args must be an object')
    allowed=_OPERATION_ALLOWED.get(op)
    required=_OPERATION_REQUIRED.get(op)
    if allowed is None: return
    unknown=sorted(set(a)-allowed)
    if unknown: raise ValueError(f'{op} unsupported arguments: '+','.join(unknown))
    missing=sorted(required-set(a))
    if missing: raise ValueError(f'{op} missing required arguments: '+','.join(missing))

    if op=='algebra.solve':
        if not isinstance(a['equations'],(list,tuple)) or not a['equations']: raise ValueError('equations must be a nonempty list')
    elif op=='calculus.diff' and int(a.get('order',1))<0:
        raise ValueError('order must be nonnegative')
    elif op=='numeric.optimize_scalar':
        if not float(a['a'])<float(a['b']): raise ValueError('a must be less than b')
    elif op in {'linear.det','linear.inv','linear.eigen'}:
        A=_finite_array(a['A'],'A')
        if A.ndim!=2 or A.shape[0]!=A.shape[1] or A.shape[0]<1: raise ValueError('A must be a nonempty square matrix')
    elif op=='linear.solve':
        A=_finite_array(a['A'],'A'); b=_finite_array(a['b'],'b')
        if A.ndim!=2 or A.shape[0]!=A.shape[1] or b.ndim!=1 or b.size!=A.shape[0]: raise ValueError('linear solve dimensions mismatch')
    elif op=='statistics.describe':
        _finite_array(a['data'],'data',1)
    elif op=='statistics.correlation':
        x=_finite_array(a['x'],'x',2); y=_finite_array(a['y'],'y',2)
        if x.shape!=y.shape: raise ValueError('x and y must have same shape')
        if float(np.ptp(x))==0 or float(np.ptp(y))==0: raise ValueError('correlation requires nonzero variance')
    elif op=='statistics.regression':
        x=_finite_array(a['x'],'x',2); y=_finite_array(a['y'],'y',2)
        if x.shape!=y.shape: raise ValueError('x and y must have same shape')
        if float(np.ptp(x))==0: raise ValueError('regression x must have nonzero variance')
    elif op=='statistics.quantile':
        _finite_array(a['data'],'data',1); _prob('q',a['q'])
    elif op in {'probability.normal_cdf','probability.normal_ppf'}:
        _positive('sigma',a.get('sigma',1))
        if op.endswith('ppf'): _prob('p',a['p'],closed=False)
    elif op=='finance.compound':
        n=int(a.get('n',1))
        if n<=0: raise ValueError('n must be positive')
        if float(a['years'])<0: raise ValueError('years must be nonnegative')
        if 1+float(a['rate'])/n<=0: raise ValueError('compound base must be positive')
    elif op=='finance.npv':
        if float(a['rate'])<=-1: raise ValueError('rate must be greater than -1')
        _finite_array(a['cashflows'],'cashflows',1)
    elif op in {'finance.black_scholes','finance.greeks'}:
        _positive('S',a['S']); _positive('K',a['K']); _positive('T',a['T']); _positive('sigma',a['sigma'])
        if a.get('kind','call') not in {'call','put'}: raise ValueError('kind must be call or put')
    elif op=='finance.var_historical':
        _finite_array(a['returns'],'returns',1); _prob('alpha',a.get('alpha',.99),closed=False)
    elif op=='combinatorics.factorial':
        if int(a['n'])<0: raise ValueError('n must be nonnegative')
    elif op=='numbertheory.factorint':
        if int(a['n'])==0: raise ValueError('factorization of zero is undefined')
    elif op=='transforms.fft':
        _finite_array(a['data'],'data',1)
    elif op=='statistics.covariance':
        x=_finite_array(a['x'],'x',2); y=_finite_array(a['y'],'y',2)
        if x.shape!=y.shape: raise ValueError('x and y must have same shape')
    elif op=='statistics.zscore':
        z=_finite_array(a['data'],'data',1); ddof=int(a.get('ddof',0))
        if ddof<0 or ddof>=z.size: raise ValueError('ddof must satisfy 0 <= ddof < len(data)')
        if float(z.std(ddof=ddof))==0: raise ValueError('standard deviation is zero')
    elif op=='probability.binomial_pmf':
        n=int(a['n']); k=int(a['k']); p=float(a['p'])
        if n<0: raise ValueError('n must be nonnegative')
        if k<0: raise ValueError('k must be nonnegative')
        _prob('p',p)
    elif op=='probability.poisson_pmf':
        if int(a['k'])<0: raise ValueError('k must be nonnegative')
        if float(a['mu'])<0 or not math.isfinite(float(a['mu'])): raise ValueError('mu must be nonnegative')
    elif op=='finance.returns':
        if a.get('kind','simple') not in {'simple','log'}: raise ValueError('kind must be simple or log')
    elif op=='finance.portfolio_metrics':
        R=_finite_array(a['returns'],'returns'); w=_finite_array(a['weights'],'weights',1)
        if R.ndim!=2 or R.shape[0]<2 or R.shape[1]!=w.size: raise ValueError('returns must contain at least 2 observations and match weights')
        if float(a.get('annualization',252))<=0: raise ValueError('annualization must be positive')
    elif op=='finance.var_parametric':
        _finite_array(a['returns'],'returns',2); _prob('alpha',a.get('alpha',.99),closed=False)
    elif op=='finance.cvar_historical':
        _finite_array(a['returns'],'returns',1); _prob('alpha',a.get('alpha',.99),closed=False)
    elif op=='timeseries.ewma':
        _finite_array(a['data'],'data',1)
    elif op=='geometry.distance':
        p=_finite_array(a['p'],'p',1); q=_finite_array(a['q'],'q',1)
        if p.shape!=q.shape: raise ValueError('points must have same dimension')
    elif op=='numeric.interpolate':
        x=_finite_array(a['x'],'x',2); y=_finite_array(a['y'],'y',2); _finite_array(a['at'],'at')
        if x.ndim!=1 or y.ndim!=1 or x.size!=y.size: raise ValueError('x and y must be one-dimensional with equal length')
        if not np.all(np.diff(x)>0): raise ValueError('x must be strictly increasing')
    elif op=='numeric.least_squares':
        A=_finite_array(a['A'],'A'); b=_finite_array(a['b'],'b')
        if A.ndim!=2 or b.ndim!=1 or A.shape[0]!=b.size: raise ValueError('least-squares dimensions mismatch')
    elif op=='optimization.linear_program':
        c=_finite_array(a['c'],'c',1)
        for ak,bk in [('A_ub','b_ub'),('A_eq','b_eq')]:
            if (ak in a)!=(bk in a): raise ValueError(f'{ak} and {bk} must be provided together')
            if ak in a:
                A=_finite_array(a[ak],ak); b=_finite_array(a[bk],bk)
                if A.ndim!=2 or A.shape[1]!=c.size or b.ndim!=1 or b.size!=A.shape[0]: raise ValueError(f'{ak}/{bk} dimensions mismatch')
    elif op=='statistics.ttest_ind':
        _finite_array(a['x'],'x',2); _finite_array(a['y'],'y',2)
    elif op=='statistics.normal_fit':
        _finite_array(a['data'],'data',1)
    elif op=='probability.exponential_cdf':
        _positive('rate',a['rate'])
    elif op=='probability.chi2_cdf':
        _positive('df',a['df'])
    elif op=='finance.implied_vol':
        S=_positive('S',a['S']); K=_positive('K',a['K']); T=_positive('T',a['T'])
        if a.get('kind','call') not in {'call','put'}: raise ValueError('kind must be call or put')
        price=float(a['price'])
        if price<=0 or not math.isfinite(price): raise ValueError('price must be positive and finite')
        q=float(a.get('q',0)); r=float(a['r'])
        upper=S*math.exp(-q*T) if a.get('kind','call')=='call' else K*math.exp(-r*T)
        if price>=upper: raise ValueError('option price violates no-arbitrage upper bound')
    elif op in {'finance.bond_price','finance.bond_yield','finance.duration'}:
        face=_positive('face',a.get('face',100)); mat=_positive('maturity',a['maturity']); freq=int(a.get('frequency',2))
        if freq<=0: raise ValueError('frequency must be positive')
        if op=='finance.bond_yield': _positive('price',a['price'])
        else:
            if 1+float(a['yield'])/freq<=0: raise ValueError('yield is below admissible compounding bound')
    elif op=='finance.beta':
        x=_finite_array(a['asset_returns'],'asset_returns',2); y=_finite_array(a['market_returns'],'market_returns',2)
        if x.shape!=y.shape: raise ValueError('asset and market returns must have same shape')
        if float(np.ptp(y))<=1e-15: raise ValueError('market variance is zero')
    elif op=='finance.drawdown':
        z=_finite_array(a['values'],'values',1)
        if np.any(z<=0): raise ValueError('values must be positive')
    elif op=='finance.monte_carlo_gbm':
        _positive('S0',a['S0']); _positive('T',a['T'],allow_zero=True)
        if float(a['sigma'])<0 or not math.isfinite(float(a['sigma'])): raise ValueError('sigma must be nonnegative')
        if int(a.get('steps',252))<=0 or int(a.get('paths',1000))<=0: raise ValueError('steps and paths must be positive')
    elif op=='timeseries.rolling_volatility':
        _finite_array(a['returns'],'returns',2)
        if float(a.get('annualization',252))<=0: raise ValueError('annualization must be positive')
    elif op in {'geometry.area_circle','geometry.volume_sphere'}:
        _positive('radius',a['radius'],allow_zero=True)
    elif op=='transforms.ifft':
        if not isinstance(a['data'],(list,tuple)) or len(a['data'])<1: raise ValueError('data must be a nonempty spectrum')
        if 'n' in a and int(a['n'])<=0: raise ValueError('n must be positive')
    elif op=='verify.crosscheck':
        target=str(a['operation'])
        if target=='verify.crosscheck': raise ValueError('nested verify.crosscheck is not supported')
        if target not in _OPERATION_ALLOWED: raise ValueError('unknown crosscheck operation')
        _validate_operation_args(target,a['args'])
'''

VERIFY_INSERT = r'''        if op=='arithmetic.evaluate':
            ref=sp.N(expr(str(a['expression'])),max(int(p)+20,80))
            delta=abs(float(sp.N(ref-sp.sympify(str(result)),30)))
            return {'verified':bool(delta<1e-25),'method':'higher-precision-recompute','delta':delta}
        if op=='finance.npv':
            rate=float(a['rate'])
            ref=math.fsum(float(cf)/((1+rate)**i) for i,cf in enumerate(a['cashflows']))
            delta=abs(float(result)-ref)
            return {'verified':bool(delta<=max(1e-10,abs(ref)*1e-12)),'method':'formula-recompute','delta':delta}
'''

def main():
    ap=argparse.ArgumentParser(); ap.add_argument("path"); ns=ap.parse_args()
    p=pathlib.Path(ns.path); raw=p.read_bytes()
    got=hashlib.sha256(raw).hexdigest()
    if got!=EXPECTED_SHA256: raise SystemExit(f'fail-closed input digest mismatch: {got}')
    s=raw.decode()

    old="if isinstance(v,dict): return {k:encode(val) for k,val in v.items()}"
    new="if isinstance(v,dict): return {str(k):encode(val) for k,val in v.items()}"
    if s.count(old)!=1: raise SystemExit('encode dict-key anchor mismatch')
    s=s.replace(old,new,1)

    marker="_QUADRATIC_ALLOWED={'Q','c','x0','A_eq','b_eq','A_ub','b_ub','bounds'}"
    pos=s.find(marker)
    if pos<0: raise SystemExit('quadratic helper anchor missing')
    s=s[:pos]+VALIDATION+"\\n"+s[pos:]

    dispatch_pos=s.rfind("def dispatch(op,a,p):")
    if dispatch_pos<0: raise SystemExit('final dispatch missing')
    body_pos=s.find("\\n",dispatch_pos)+1
    if "_validate_operation_args(op,a)" in s[body_pos:body_pos+200]: raise SystemExit('validator already present')
    s=s[:body_pos]+"    _validate_operation_args(op,a)\\n"+s[body_pos:]

    qverify="        if op=='optimization.quadratic':"
    qpos=s.find(qverify)
    if qpos<0: raise SystemExit('quadratic verification branch missing')
    epos=s.find("    except Exception as e:",qpos)
    if epos<0: raise SystemExit('verification except boundary missing')
    verify_region=s[qpos:epos]
    if "return _quadratic_verify(a,result)" not in verify_region: raise SystemExit('quadratic verification return missing')
    if "higher-precision-recompute" in verify_region: raise SystemExit('verification patch already present')
    s=s[:epos]+VERIFY_INSERT+s[epos:]

    old_compute="    try: result=dispatch(req.operation,req.args,req.precision)\\n    except Exception as e: raise HTTPException(status_code=422,detail={'error':type(e).__name__,'message':str(e)[:500]})\\n    out={'ok':True,'kernel_version':VERSION,'operation':req.operation,'result':encode(result),'verified':None,'elapsed_ms':round((time.perf_counter()-t)*1000,3)}"
    new_compute="    try:\\n        result=dispatch(req.operation,req.args,req.precision)\\n        encoded=encode(result)\\n    except Exception as e: raise HTTPException(status_code=422,detail={'error':type(e).__name__,'message':str(e)[:500]})\\n    out={'ok':True,'kernel_version':VERSION,'operation':req.operation,'result':encoded,'verified':None,'elapsed_ms':round((time.perf_counter()-t)*1000,3)}"
    if s.count(old_compute)!=1: raise SystemExit('compute route anchor mismatch')
    s=s.replace(old_compute,new_compute,1)

    p.write_text(s)
    out=hashlib.sha256(p.read_bytes()).hexdigest()
    print(f'MUSITU_AXIOM_EXHAUSTIVE_DEFECT_PATCH_PASS before={got} after={out}')

if __name__=="__main__": main()
