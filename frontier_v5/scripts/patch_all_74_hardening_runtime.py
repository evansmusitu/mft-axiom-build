from __future__ import annotations
import argparse, hashlib, pathlib

EXPECTED_SHA256="cfa39f0f17c56a183c5024a600086aba4644ec925343129245a62e18294f7c47"

OLD_ENCODE="""def encode(v):
    if isinstance(v,(sp.Basic,)): return str(v)
    if isinstance(v,np.ndarray): return v.tolist()
    if isinstance(v,(np.floating,np.integer)): return v.item()
    if isinstance(v,complex): return {'re':v.real,'im':v.imag}
    if isinstance(v,dict): return {k:encode(val) for k,val in v.items()}
    if isinstance(v,(list,tuple)): return [encode(z) for z in v]
    return v
"""

NEW_ENCODE="""def encode(v):
    if isinstance(v,(sp.Basic,)): return str(v)
    if isinstance(v,np.ndarray): return encode(v.tolist())
    if isinstance(v,(np.floating,np.integer,np.bool_)): return v.item()
    if isinstance(v,complex): return {'re':float(v.real),'im':float(v.imag)}
    if isinstance(v,dict): return {str(k):encode(val) for k,val in v.items()}
    if isinstance(v,(list,tuple)): return [encode(z) for z in v]
    return v

def _assert_finite_json(v,path='result'):
    if isinstance(v,float):
        if not math.isfinite(v): raise ValueError(f'non-finite numeric output at {path}')
        return
    if isinstance(v,dict):
        for k,x in v.items(): _assert_finite_json(x,f'{path}.{k}')
        return
    if isinstance(v,(list,tuple)):
        for i,x in enumerate(v): _assert_finite_json(x,f'{path}[{i}]')
"""

OLD_COMPUTE="""@app.post('/v1/compute')
def compute(req:ComputeRequest):
    t=time.perf_counter()
    try: result=dispatch(req.operation,req.args,req.precision)
    except Exception as e: raise HTTPException(status_code=422,detail={'error':type(e).__name__,'message':str(e)[:500]})
    out={'ok':True,'kernel_version':VERSION,'operation':req.operation,'result':encode(result),'verified':None,'elapsed_ms':round((time.perf_counter()-t)*1000,3)}
    out['result_sha256']=hashlib.sha256(json.dumps(out['result'],sort_keys=True,separators=(',',':')).encode()).hexdigest()
    return out
"""

NEW_COMPUTE="""@app.post('/v1/compute')
def compute(req:ComputeRequest):
    t=time.perf_counter()
    try:
        result=dispatch(req.operation,req.args,req.precision)
        encoded=encode(result)
        _assert_finite_json(encoded)
        verification=encode(_verify_operation(req.operation,req.args,encoded,req.precision)) if req.verify else {'verified':None,'method':'disabled'}
        _assert_finite_json(verification,'verified')
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=422,detail={'error':type(e).__name__,'message':str(e)[:500]})
    out={'ok':True,'kernel_version':VERSION,'operation':req.operation,'result':encoded,'verified':verification,'elapsed_ms':round((time.perf_counter()-t)*1000,3)}
    out['result_sha256']=hashlib.sha256(json.dumps(out['result'],sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()
    return out
"""

FINAL_DISPATCH_ANCHOR="""def dispatch(op,a,p):
    if op=='knowledge.element':
"""

SCHEMA_LAYER=r'''_OP_ARG_SCHEMA={
'arithmetic.evaluate':({'expression'},{'expression'}),
'algebra.simplify':({'expression'},{'expression'}),
'algebra.expand':({'expression'},{'expression'}),
'algebra.factor':({'expression'},{'expression'}),
'algebra.solve':({'equations'},{'equations','symbols'}),
'calculus.diff':({'expression'},{'expression','symbol','order'}),
'calculus.integrate':({'expression'},{'expression','symbol','bounds'}),
'calculus.limit':({'expression','to'},{'expression','symbol','to'}),
'calculus.series':({'expression'},{'expression','symbol','at','order'}),
'numeric.root':({'expression','guess'},{'expression','symbol','guess'}),
'numeric.integrate':({'expression','a','b'},{'expression','a','b','epsabs'}),
'numeric.ode':({'rhs','t0','t1','y0'},{'rhs','t0','t1','y0','rtol','atol'}),
'numeric.optimize_scalar':({'expression','a','b'},{'expression','a','b'}),
'linear.det':({'A'},{'A'}),'linear.inv':({'A'},{'A'}),'linear.solve':({'A','b'},{'A','b'}),'linear.eigen':({'A'},{'A'}),
'statistics.describe':({'data'},{'data'}),'statistics.correlation':({'x','y'},{'x','y'}),'statistics.regression':({'x','y'},{'x','y'}),
'statistics.quantile':({'data','q'},{'data','q'}),
'probability.normal_cdf':({'x'},{'x','mu','sigma'}),'probability.normal_ppf':({'p'},{'p','mu','sigma'}),
'finance.compound':({'principal','rate','years'},{'principal','rate','years','n'}),
'finance.npv':({'cashflows','rate'},{'cashflows','rate'}),
'finance.black_scholes':({'S','K','T','r','sigma'},{'S','K','T','r','sigma','kind','q'}),
'finance.greeks':({'S','K','T','r','sigma'},{'S','K','T','r','sigma','kind','q'}),
'finance.var_historical':({'returns'},{'returns','alpha'}),
'units.convert':({'value','from','to'},{'value','from','to'}),
'verify.evaluate':({'lhs','rhs'},{'lhs','rhs'}),
'knowledge.constant':({'name'},{'name'}),
'combinatorics.factorial':({'n'},{'n'}),'combinatorics.binomial':({'n','k'},{'n','k'}),
'numbertheory.isprime':({'n'},{'n'}),'numbertheory.factorint':({'n'},{'n'}),'numbertheory.gcd':({'a','b'},{'a','b'}),'numbertheory.lcm':({'a','b'},{'a','b'}),
'transforms.fft':({'data'},{'data'}),
'statistics.covariance':({'x','y'},{'x','y'}),'statistics.zscore':({'data'},{'data','ddof'}),
'probability.binomial_pmf':({'k','n','p'},{'k','n','p'}),'probability.poisson_pmf':({'k','mu'},{'k','mu'}),
'finance.returns':({'prices'},{'prices','kind'}),
'finance.portfolio_metrics':({'returns','weights'},{'returns','weights','annualization','risk_free'}),
'finance.var_parametric':({'returns'},{'returns','alpha'}),'finance.cvar_historical':({'returns'},{'returns','alpha'}),
'timeseries.moving_average':({'data','window'},{'data','window'}),'timeseries.ewma':({'data'},{'data','alpha'}),
'geometry.distance':({'p','q'},{'p','q'}),
'knowledge.element':({'symbol'},{'symbol'}),
'algebra.polynomial_roots':({'expression'},{'expression','symbol'}),
'calculus.sum':({'expression','start','end'},{'expression','symbol','start','end'}),'calculus.product':({'expression','start','end'},{'expression','symbol','start','end'}),
'numeric.least_squares':({'A','b'},{'A','b'}),'numeric.interpolate':({'x','y','at'},{'x','y','at'}),
'verified.interval_eval':({'expression','interval'},{'expression','symbol','interval'}),
'optimization.linear_program':({'c'},{'c','A_ub','b_ub','A_eq','b_eq','bounds'}),
'optimization.quadratic':({'Q','c'},{'Q','c','x0','A_eq','b_eq','A_ub','b_ub','bounds'}),
'statistics.ttest_ind':({'x','y'},{'x','y','equal_var'}),'statistics.normal_fit':({'data'},{'data'}),
'probability.exponential_cdf':({'x','rate'},{'x','rate'}),'probability.chi2_cdf':({'x','df'},{'x','df'}),
'finance.implied_vol':({'price','S','K','T','r'},{'price','S','K','T','r','kind','q'}),
'finance.bond_price':({'coupon_rate','maturity','yield'},{'face','coupon_rate','maturity','yield','frequency'}),
'finance.bond_yield':({'coupon_rate','maturity','price'},{'face','coupon_rate','maturity','price','frequency'}),
'finance.duration':({'coupon_rate','maturity','yield'},{'face','coupon_rate','maturity','yield','frequency'}),
'finance.beta':({'asset_returns','market_returns'},{'asset_returns','market_returns'}),
'finance.drawdown':({'values'},{'values'}),
'finance.monte_carlo_gbm':({'S0','mu','sigma','T'},{'S0','mu','sigma','T','steps','paths','seed'}),
'timeseries.rolling_volatility':({'returns','window'},{'returns','window','annualization'}),
'geometry.area_circle':({'radius'},{'radius'}),'geometry.volume_sphere':({'radius'},{'radius'}),
'transforms.ifft':({'data'},{'data','n'}),
'verify.crosscheck':({'operation'},{'operation','args'}),
}

def _finite_scalar(name,v):
    try: x=float(v)
    except Exception: raise ValueError(f'{name} must be numeric')
    if not math.isfinite(x): raise ValueError(f'{name} must be finite')
    return x

def _int_value(name,v,minimum=None):
    if isinstance(v,bool): raise ValueError(f'{name} must be an integer')
    try:
        x=float(v); i=int(x)
    except Exception: raise ValueError(f'{name} must be an integer')
    if not math.isfinite(x) or x!=i: raise ValueError(f'{name} must be an integer')
    if minimum is not None and i<minimum: raise ValueError(f'{name} must be >= {minimum}')
    return i

def _vec(name,v,min_size=1):
    z=np.asarray(v,float)
    if z.ndim!=1 or z.size<min_size: raise ValueError(f'{name} must be a 1D array with at least {min_size} values')
    if not np.all(np.isfinite(z)): raise ValueError(f'{name} must contain finite values')
    return z

def _matrix(name,v,min_rows=1,min_cols=1):
    z=np.asarray(v,float)
    if z.ndim!=2 or z.shape[0]<min_rows or z.shape[1]<min_cols: raise ValueError(f'{name} must be a non-empty 2D matrix')
    if not np.all(np.isfinite(z)): raise ValueError(f'{name} must contain finite values')
    return z

def _option_inputs(a,require_price=False):
    S=_finite_scalar('S',a['S']); K=_finite_scalar('K',a['K']); T=_finite_scalar('T',a['T']); r=_finite_scalar('r',a['r']); q=_finite_scalar('q',a.get('q',0)); kind=a.get('kind','call')
    if S<=0 or K<=0 or T<=0: raise ValueError('S,K,T must be positive')
    if kind not in ('call','put'): raise ValueError('kind must be call or put')
    if 'sigma' in a:
        sigma=_finite_scalar('sigma',a['sigma'])
        if sigma<=0: raise ValueError('sigma must be positive')
    if require_price:
        price=_finite_scalar('price',a['price'])
        lower=max(0.0,S*math.exp(-q*T)-K*math.exp(-r*T)) if kind=='call' else max(0.0,K*math.exp(-r*T)-S*math.exp(-q*T))
        upper=S*math.exp(-q*T) if kind=='call' else K*math.exp(-r*T)
        if price < lower-1e-10 or price > upper+1e-10: raise ValueError('option price violates no-arbitrage bounds')

def _validate_lp(a):
    c=_vec('c',a['c']); n=c.size
    for Akey,bkey in (('A_ub','b_ub'),('A_eq','b_eq')):
        if (Akey in a)!=(bkey in a): raise ValueError(f'{Akey} and {bkey} must be provided together')
        if Akey in a:
            A=_matrix(Akey,a[Akey]); b=_vec(bkey,a[bkey])
            if A.shape[1]!=n or A.shape[0]!=b.size: raise ValueError(f'{Akey}/{bkey} dimensions must match c')
    if 'bounds' in a:
        bounds=a['bounds']
        if not isinstance(bounds,(list,tuple)) or len(bounds)!=n: raise ValueError(f'bounds must contain {n} pairs')
        for i,pair in enumerate(bounds):
            if not isinstance(pair,(list,tuple)) or len(pair)!=2: raise ValueError(f'bounds[{i}] must be [lower,upper]')
            lo=None if pair[0] is None else _finite_scalar(f'bounds[{i}].lower',pair[0])
            hi=None if pair[1] is None else _finite_scalar(f'bounds[{i}].upper',pair[1])
            if lo is not None and hi is not None and lo>hi: raise ValueError(f'bounds[{i}] lower exceeds upper')

def _validate_operation_args(op,a):
    if op not in _OP_ARG_SCHEMA: raise ValueError('unsupported operation')
    if not isinstance(a,dict): raise ValueError('args must be an object')
    required,allowed=_OP_ARG_SCHEMA[op]
    missing=sorted(required-set(a))
    unknown=sorted(set(a)-allowed)
    if missing: raise ValueError(f'{op} missing required arguments: '+','.join(missing))
    if unknown: raise ValueError(f'{op} unsupported arguments: '+','.join(unknown))

    if op=='algebra.solve':
        if not isinstance(a['equations'],(list,tuple)) or not a['equations']: raise ValueError('equations must be a non-empty list')
        syms=a.get('symbols',['x'])
        if not isinstance(syms,(list,tuple)) or not syms or len(set(map(str,syms)))!=len(syms): raise ValueError('symbols must be a non-empty unique list')
    elif op=='calculus.diff':
        _int_value('order',a.get('order',1),1)
    elif op=='calculus.integrate' and 'bounds' in a:
        b=a['bounds']
        if not isinstance(b,(list,tuple)) or len(b)!=2: raise ValueError('bounds must contain [lower,upper]')
        _finite_scalar('bounds[0]',b[0]); _finite_scalar('bounds[1]',b[1])
    elif op=='calculus.series':
        _int_value('order',a.get('order',6),1)
    elif op=='numeric.root':
        _finite_scalar('guess',a['guess'])
    elif op=='numeric.integrate':
        _finite_scalar('a',a['a']); _finite_scalar('b',a['b'])
        if _finite_scalar('epsabs',a.get('epsabs',1e-10))<=0: raise ValueError('epsabs must be positive')
    elif op=='numeric.ode':
        t0=_finite_scalar('t0',a['t0']); t1=_finite_scalar('t1',a['t1']); _finite_scalar('y0',a['y0'])
        if t0==t1: raise ValueError('t0 and t1 must differ')
        if _finite_scalar('rtol',a.get('rtol',1e-8))<=0 or _finite_scalar('atol',a.get('atol',1e-10))<=0: raise ValueError('rtol and atol must be positive')
    elif op=='numeric.optimize_scalar':
        lo=_finite_scalar('a',a['a']); hi=_finite_scalar('b',a['b'])
        if not lo<hi: raise ValueError('a must be less than b')
    elif op.startswith('linear.'):
        A=_matrix('A',a['A'])
        if A.shape[0]!=A.shape[1]: raise ValueError('A must be square')
        if op=='linear.solve':
            b=_vec('b',a['b'])
            if b.size!=A.shape[0]: raise ValueError('b dimension must match A')
    elif op=='statistics.describe':
        _vec('data',a['data'])
    elif op in ('statistics.correlation','statistics.covariance','statistics.regression'):
        x=_vec('x',a['x'],2); y=_vec('y',a['y'],2)
        if x.size!=y.size: raise ValueError('x and y must have the same length')
        if op in ('statistics.correlation','statistics.regression') and float(np.std(x))==0: raise ValueError('x variance must be positive')
        if op=='statistics.correlation' and float(np.std(y))==0: raise ValueError('y variance must be positive')
    elif op=='statistics.quantile':
        _vec('data',a['data']); q=_finite_scalar('q',a['q'])
        if not 0<=q<=1: raise ValueError('q must be in [0,1]')
    elif op=='statistics.zscore':
        z=_vec('data',a['data'],2); ddof=_int_value('ddof',a.get('ddof',0),0)
        if ddof>=z.size: raise ValueError('ddof must be less than sample size')
        if float(z.std(ddof=ddof))==0: raise ValueError('standard deviation is zero')
    elif op=='statistics.ttest_ind':
        _vec('x',a['x'],2); _vec('y',a['y'],2)
    elif op=='statistics.normal_fit':
        z=_vec('data',a['data'],2)
        if float(np.std(z))==0: raise ValueError('normal fit requires nonzero variance')
    elif op=='probability.normal_cdf':
        _finite_scalar('x',a['x']); _finite_scalar('mu',a.get('mu',0))
        if _finite_scalar('sigma',a.get('sigma',1))<=0: raise ValueError('sigma must be positive')
    elif op=='probability.normal_ppf':
        p=_finite_scalar('p',a['p']); _finite_scalar('mu',a.get('mu',0))
        if not 0<p<1: raise ValueError('p must be in (0,1)')
        if _finite_scalar('sigma',a.get('sigma',1))<=0: raise ValueError('sigma must be positive')
    elif op=='probability.binomial_pmf':
        n=_int_value('n',a['n'],0); k=_int_value('k',a['k'],0); p=_finite_scalar('p',a['p'])
        if k>n: raise ValueError('k must be <= n')
        if not 0<=p<=1: raise ValueError('p must be in [0,1]')
    elif op=='probability.poisson_pmf':
        _int_value('k',a['k'],0)
        if _finite_scalar('mu',a['mu'])<0: raise ValueError('mu must be nonnegative')
    elif op=='probability.exponential_cdf':
        _finite_scalar('x',a['x'])
        if _finite_scalar('rate',a['rate'])<=0: raise ValueError('rate must be positive')
    elif op=='probability.chi2_cdf':
        _finite_scalar('x',a['x'])
        if _finite_scalar('df',a['df'])<=0: raise ValueError('df must be positive')
    elif op=='finance.compound':
        _finite_scalar('principal',a['principal']); rate=_finite_scalar('rate',a['rate']); _finite_scalar('years',a['years']); n=_int_value('n',a.get('n',1),1)
        if 1+rate/n<=0: raise ValueError('compound base must be positive')
    elif op=='finance.npv':
        cf=_vec('cashflows',a['cashflows']); rate=_finite_scalar('rate',a['rate'])
        if rate<=-1: raise ValueError('rate must be greater than -1')
    elif op in ('finance.black_scholes','finance.greeks'):
        _option_inputs(a)
    elif op in ('finance.var_historical','finance.var_parametric','finance.cvar_historical'):
        z=_vec('returns',a['returns'],2 if op=='finance.var_parametric' else 1); alpha=_finite_scalar('alpha',a.get('alpha',0.99))
        if not 0<alpha<1: raise ValueError('alpha must be in (0,1)')
    elif op=='finance.returns':
        p=_vec('prices',a['prices'],2)
        if np.any(p<=0): raise ValueError('prices must be positive')
        if a.get('kind','simple') not in ('simple','log'): raise ValueError('kind must be simple or log')
    elif op=='finance.portfolio_metrics':
        R=_matrix('returns',a['returns'],2,1); w=_vec('weights',a['weights'])
        if R.shape[1]!=w.size: raise ValueError('returns columns must match weights')
        if abs(float(w.sum())-1)>1e-8: raise ValueError('weights must sum to 1')
        if _finite_scalar('annualization',a.get('annualization',252))<=0: raise ValueError('annualization must be positive')
        _finite_scalar('risk_free',a.get('risk_free',0))
    elif op=='finance.implied_vol':
        _option_inputs(a,True)
    elif op in ('finance.bond_price','finance.bond_yield','finance.duration'):
        face=_finite_scalar('face',a.get('face',100)); cr=_finite_scalar('coupon_rate',a['coupon_rate']); mat=_finite_scalar('maturity',a['maturity']); freq=_int_value('frequency',a.get('frequency',2),1)
        if face<=0 or mat<=0: raise ValueError('face and maturity must be positive')
        if op=='finance.bond_yield':
            if _finite_scalar('price',a['price'])<=0: raise ValueError('price must be positive')
        else:
            y=_finite_scalar('yield',a['yield'])
            if 1+y/freq<=0: raise ValueError('yield produces nonpositive discount base')
    elif op=='finance.beta':
        x=_vec('asset_returns',a['asset_returns'],2); y=_vec('market_returns',a['market_returns'],2)
        if x.size!=y.size: raise ValueError('asset_returns and market_returns must have same length')
        if float(np.var(y,ddof=1))<=1e-24: raise ValueError('market variance must be positive')
    elif op=='finance.drawdown':
        z=_vec('values',a['values'])
        if np.any(z<=0): raise ValueError('values must be positive')
    elif op=='finance.monte_carlo_gbm':
        if _finite_scalar('S0',a['S0'])<=0: raise ValueError('S0 must be positive')
        _finite_scalar('mu',a['mu'])
        if _finite_scalar('sigma',a['sigma'])<0: raise ValueError('sigma must be nonnegative')
        if _finite_scalar('T',a['T'])<0: raise ValueError('T must be nonnegative')
        steps=_int_value('steps',a.get('steps',252),1); paths=_int_value('paths',a.get('paths',1000),1); _int_value('seed',a.get('seed',0))
        if paths>20000 or steps>5000: raise ValueError('simulation bound exceeded')
    elif op=='units.convert':
        _finite_scalar('value',a['value'])
    elif op=='combinatorics.factorial':
        _int_value('n',a['n'],0)
    elif op=='combinatorics.binomial':
        n=_int_value('n',a['n'],0); k=_int_value('k',a['k'],0)
        if k>n: raise ValueError('k must be <= n')
    elif op in ('numbertheory.isprime','numbertheory.factorint'):
        n=_int_value('n',a['n'])
        if op=='numbertheory.factorint' and n==0: raise ValueError('factorint undefined for zero')
    elif op in ('numbertheory.gcd','numbertheory.lcm'):
        _int_value('a',a['a']); _int_value('b',a['b'])
    elif op=='transforms.fft':
        _vec('data',a['data'])
    elif op=='timeseries.moving_average':
        z=_vec('data',a['data']); n=_int_value('window',a['window'],1)
        if n>z.size: raise ValueError('invalid window')
    elif op=='timeseries.ewma':
        _vec('data',a['data']); alpha=_finite_scalar('alpha',a.get('alpha',0.2))
        if not 0<alpha<=1: raise ValueError('alpha must be in (0,1]')
    elif op=='timeseries.rolling_volatility':
        z=_vec('returns',a['returns'],2); n=_int_value('window',a['window'],2)
        if n>z.size: raise ValueError('invalid window')
        if _finite_scalar('annualization',a.get('annualization',252))<=0: raise ValueError('annualization must be positive')
    elif op=='geometry.distance':
        p=_vec('p',a['p']); q=_vec('q',a['q'])
        if p.size!=q.size: raise ValueError('points must have same dimension')
    elif op in ('geometry.area_circle','geometry.volume_sphere'):
        if _finite_scalar('radius',a['radius'])<0: raise ValueError('radius must be nonnegative')
    elif op=='numeric.least_squares':
        A=_matrix('A',a['A']); b=_vec('b',a['b'])
        if A.shape[0]!=b.size: raise ValueError('b length must match A rows')
    elif op=='numeric.interpolate':
        x=_vec('x',a['x'],2); y=_vec('y',a['y'],2); q=np.asarray(a['at'],float)
        if x.size!=y.size: raise ValueError('x and y must have same length')
        if not np.all(np.diff(x)>0): raise ValueError('x must be strictly increasing')
        if not np.all(np.isfinite(q)): raise ValueError('at must be finite')
    elif op=='verified.interval_eval':
        b=a['interval']
        if not isinstance(b,(list,tuple)) or len(b)!=2: raise ValueError('interval must be [lower,upper]')
        lo=_finite_scalar('interval[0]',b[0]); hi=_finite_scalar('interval[1]',b[1])
        if lo>hi: raise ValueError('interval lower bound exceeds upper bound')
    elif op=='optimization.linear_program':
        _validate_lp(a)
    elif op=='optimization.quadratic':
        _quadratic_problem(a)
    elif op=='transforms.ifft':
        if not isinstance(a['data'],(list,tuple)) or not a['data']: raise ValueError('data must be non-empty')
        for i,v in enumerate(a['data']):
            if isinstance(v,dict):
                _finite_scalar(f'data[{i}].re',v.get('re',0)); _finite_scalar(f'data[{i}].im',v.get('im',0))
            else:
                z=complex(v)
                if not math.isfinite(z.real) or not math.isfinite(z.imag): raise ValueError('data must be finite')
        if 'n' in a: _int_value('n',a['n'],1)
    elif op=='verify.crosscheck':
        target=str(a['operation'])
        if target not in _OP_ARG_SCHEMA or target=='verify.crosscheck': raise ValueError('invalid crosscheck target')
        if not isinstance(a.get('args',{}),dict): raise ValueError('crosscheck args must be an object')
'''

OLD_FINAL_DISPATCH="""def dispatch(op,a,p):
    if op=='knowledge.element':
"""
NEW_FINAL_DISPATCH="""def dispatch(op,a,p):
    _validate_operation_args(op,a)
    if op=='knowledge.element':
"""

OLD_CROSSCHECK="""    if op=='verify.crosscheck':
        target=str(a['operation']); args=a.get('args',{}); res=_v2_dispatch(target,args,p) if target in V2_OPERATIONS else dispatch(target,args,p); return {'result':encode(res),'verification':_verify_operation(target,args,encode(res),p)}
"""
NEW_CROSSCHECK="""    if op=='verify.crosscheck':
        target=str(a['operation']); args=a.get('args',{}); res=dispatch(target,args,p); return {'result':encode(res),'verification':_verify_operation(target,args,encode(res),p)}
"""

OLD_LP_VERIFY="""        if op=='optimization.linear_program':
            xv=np.asarray(result['x'],float); ok=True
            if 'A_ub' in a: ok=ok and bool(np.all(np.asarray(a['A_ub'],float)@xv <= np.asarray(a['b_ub'],float)+1e-7))
            if 'A_eq' in a: ok=ok and bool(np.allclose(np.asarray(a['A_eq'],float)@xv,np.asarray(a['b_eq'],float),atol=1e-7))
            return {'verified':ok and bool(result.get('success')),'method':'constraint-residual'}
"""
NEW_LP_VERIFY="""        if op=='optimization.linear_program':
            xv=np.asarray(result['x'],float); ok=bool(result.get('success')); max_violation=0.0
            if 'A_ub' in a:
                vv=np.asarray(a['A_ub'],float)@xv-np.asarray(a['b_ub'],float); max_violation=max(max_violation,float(np.max(np.maximum(vv,0.0))) if vv.size else 0.0)
            if 'A_eq' in a:
                vv=np.abs(np.asarray(a['A_eq'],float)@xv-np.asarray(a['b_eq'],float)); max_violation=max(max_violation,float(np.max(vv)) if vv.size else 0.0)
            bounds=a.get('bounds')
            if bounds is not None:
                for i,pair in enumerate(bounds):
                    lo,hi=pair
                    if lo is not None: max_violation=max(max_violation,float(max(float(lo)-xv[i],0.0)))
                    if hi is not None: max_violation=max(max_violation,float(max(xv[i]-float(hi),0.0)))
            ok=ok and max_violation<=1e-7
            return {'verified':bool(ok),'method':'constraint-residual','max_violation':max_violation}
"""

def main():
    ap=argparse.ArgumentParser(); ap.add_argument("path"); ns=ap.parse_args()
    p=pathlib.Path(ns.path); raw=p.read_bytes(); got=hashlib.sha256(raw).hexdigest()
    if got!=EXPECTED_SHA256: raise SystemExit(f'fail-closed source digest mismatch: {got}')
    s=raw.decode()
    replacements=[
      (OLD_ENCODE,NEW_ENCODE,'encode'),
      (OLD_COMPUTE,NEW_COMPUTE,'compute'),
      (OLD_FINAL_DISPATCH,SCHEMA_LAYER+"\n"+NEW_FINAL_DISPATCH,'final-dispatch'),
      (OLD_CROSSCHECK,NEW_CROSSCHECK,'crosscheck'),
      (OLD_LP_VERIFY,NEW_LP_VERIFY,'lp-verify'),
    ]
    for old,new,label in replacements:
        if s.count(old)!=1: raise SystemExit(f'fail-closed {label} anchor count={s.count(old)}')
        s=s.replace(old,new,1)
    p.write_text(s)
    after=hashlib.sha256(p.read_bytes()).hexdigest()
    print(f'MUSITU_AXIOM_ALL74_HARDENING_PATCH_PASS before={got} after={after}')

if __name__=="__main__": main()
