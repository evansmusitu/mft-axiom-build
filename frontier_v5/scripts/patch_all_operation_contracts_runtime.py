from __future__ import annotations
import argparse
import hashlib
import pathlib

EXPECTED_SHA256 = "cfa39f0f17c56a183c5024a600086aba4644ec925343129245a62e18294f7c47"
MARKER = "# ---- MUSITU AXIOM ALL-OPERATION CONTRACT HARDENING 20261004 ----"

CODE = r'''
# ---- MUSITU AXIOM ALL-OPERATION CONTRACT HARDENING 20261004 ----
_AXIOM_ALLOWED_KEYS = {
    'arithmetic.evaluate': {'expression'},
    'algebra.simplify': {'expression'},
    'algebra.expand': {'expression'},
    'algebra.factor': {'expression'},
    'algebra.solve': {'equations','symbols'},
    'calculus.diff': {'expression','symbol','order'},
    'calculus.integrate': {'expression','symbol','bounds'},
    'calculus.limit': {'expression','symbol','to'},
    'calculus.series': {'expression','symbol','at','order'},
    'numeric.root': {'expression','symbol','guess'},
    'numeric.integrate': {'expression','a','b','epsabs'},
    'numeric.ode': {'rhs','t0','t1','y0','rtol','atol'},
    'numeric.optimize_scalar': {'expression','a','b'},
    'linear.det': {'A'},
    'linear.inv': {'A'},
    'linear.solve': {'A','b'},
    'linear.eigen': {'A'},
    'statistics.describe': {'data'},
    'statistics.correlation': {'x','y'},
    'statistics.regression': {'x','y'},
    'statistics.quantile': {'data','q'},
    'probability.normal_cdf': {'x','mu','sigma'},
    'probability.normal_ppf': {'p','mu','sigma'},
    'finance.compound': {'principal','rate','years','n'},
    'finance.npv': {'cashflows','rate'},
    'finance.black_scholes': {'S','K','T','r','sigma','kind','q'},
    'finance.greeks': {'S','K','T','r','sigma','kind','q'},
    'finance.var_historical': {'returns','alpha'},
    'units.convert': {'value','from','to'},
    'verify.evaluate': {'lhs','rhs'},
    'knowledge.constant': {'name'},
    'combinatorics.factorial': {'n'},
    'combinatorics.binomial': {'n','k'},
    'numbertheory.isprime': {'n'},
    'numbertheory.factorint': {'n'},
    'numbertheory.gcd': {'a','b'},
    'numbertheory.lcm': {'a','b'},
    'transforms.fft': {'data'},
    'statistics.covariance': {'x','y'},
    'statistics.zscore': {'data'},
    'probability.binomial_pmf': {'k','n','p'},
    'probability.poisson_pmf': {'k','mu'},
    'finance.returns': {'prices','kind'},
    'finance.portfolio_metrics': {'returns','weights','annualization','risk_free'},
    'finance.var_parametric': {'returns','alpha'},
    'finance.cvar_historical': {'returns','alpha'},
    'timeseries.moving_average': {'data','window'},
    'timeseries.ewma': {'data','alpha'},
    'geometry.distance': {'p','q'},
    'knowledge.element': {'symbol'},
    'algebra.polynomial_roots': {'expression','symbol'},
    'calculus.sum': {'expression','symbol','start','end'},
    'calculus.product': {'expression','symbol','start','end'},
    'numeric.least_squares': {'A','b'},
    'numeric.interpolate': {'x','y','at'},
    'verified.interval_eval': {'expression','symbol','interval'},
    'optimization.linear_program': {'c','A_ub','b_ub','A_eq','b_eq','bounds'},
    'optimization.quadratic': {'Q','c','x0','A_eq','b_eq','A_ub','b_ub','bounds'},
    'statistics.ttest_ind': {'x','y','equal_var'},
    'statistics.normal_fit': {'data'},
    'probability.exponential_cdf': {'x','rate'},
    'probability.chi2_cdf': {'x','df'},
    'finance.implied_vol': {'price','S','K','T','r','kind','q'},
    'finance.bond_price': {'face','coupon_rate','maturity','yield','frequency'},
    'finance.bond_yield': {'face','coupon_rate','maturity','price','frequency'},
    'finance.duration': {'face','coupon_rate','maturity','yield','frequency'},
    'finance.beta': {'asset_returns','market_returns'},
    'finance.drawdown': {'values'},
    'finance.monte_carlo_gbm': {'S0','mu','sigma','T','steps','paths','seed'},
    'timeseries.rolling_volatility': {'returns','window','annualization'},
    'geometry.area_circle': {'radius'},
    'geometry.volume_sphere': {'radius'},
    'transforms.ifft': {'data','n'},
    'verify.crosscheck': {'operation','args'},
}
if set(_AXIOM_ALLOWED_KEYS) != set(V3_OPERATIONS):
    raise RuntimeError('Axiom validation registry drift')

def _axiom_num(v, name):
    if isinstance(v, (bool, np.bool_)):
        raise ValueError(name + ' must be numeric, not boolean')
    try:
        z = float(v)
    except Exception as exc:
        raise ValueError(name + ' must be numeric') from exc
    if not math.isfinite(z):
        raise ValueError(name + ' must be finite')
    return z

def _axiom_int(v, name, minimum=None):
    if isinstance(v, (bool, np.bool_)) or not isinstance(v, (int, np.integer)):
        raise ValueError(name + ' must be an integer')
    z = int(v)
    if minimum is not None and z < minimum:
        raise ValueError(name + f' must be >= {minimum}')
    return z

def _axiom_vec(v, name, minlen=1):
    try:
        z = np.asarray(v, float)
    except Exception as exc:
        raise ValueError(name + ' must be a numeric array') from exc
    if z.ndim != 1:
        raise ValueError(name + ' must be one-dimensional')
    if len(z) < minlen:
        raise ValueError(name + f' must contain at least {minlen} value(s)')
    if not np.all(np.isfinite(z)):
        raise ValueError(name + ' must contain only finite values')
    return z

def _axiom_mat(v, name):
    try:
        z = np.asarray(v, float)
    except Exception as exc:
        raise ValueError(name + ' must be a numeric matrix') from exc
    if z.ndim != 2 or z.shape[0] < 1 or z.shape[1] < 1:
        raise ValueError(name + ' must be a non-empty matrix')
    if not np.all(np.isfinite(z)):
        raise ValueError(name + ' must contain only finite values')
    return z

def _axiom_alpha(a):
    x = _axiom_num(a.get('alpha', 0.99), 'alpha')
    if not 0.0 < x < 1.0:
        raise ValueError('alpha must be strictly between 0 and 1')
    return x

def _axiom_finite_tree(v):
    if v is None or isinstance(v, (str, bool, int, np.integer)):
        return True
    if isinstance(v, (float, np.floating)):
        return math.isfinite(float(v))
    if isinstance(v, (complex, np.complexfloating)):
        return math.isfinite(float(np.real(v))) and math.isfinite(float(np.imag(v)))
    if isinstance(v, np.ndarray):
        return bool(np.all(np.isfinite(v)))
    if isinstance(v, dict):
        return all(_axiom_finite_tree(x) for x in v.values())
    if isinstance(v, (list, tuple)):
        return all(_axiom_finite_tree(x) for x in v)
    return True

def _axiom_validate(op, a):
    if not isinstance(a, dict):
        raise ValueError('operation args must be an object')
    allowed = _AXIOM_ALLOWED_KEYS.get(op)
    if allowed is None:
        return
    unknown = sorted(set(a) - allowed)
    if unknown:
        raise ValueError(op + ' unsupported arguments: ' + ','.join(unknown))

    if op == 'calculus.diff' and 'order' in a:
        _axiom_int(a['order'], 'order', 0)
    if op == 'calculus.series' and 'order' in a:
        _axiom_int(a['order'], 'order', 1)
    if op in {'calculus.sum','calculus.product'}:
        _axiom_int(a['start'], 'start')
        _axiom_int(a['end'], 'end')

    if op in {'linear.det','linear.inv','linear.eigen'}:
        M = _axiom_mat(a['A'], 'A')
        if M.shape[0] != M.shape[1]:
            raise ValueError('A must be square')
    if op == 'linear.solve':
        M = _axiom_mat(a['A'], 'A')
        b = _axiom_vec(a['b'], 'b')
        if M.shape[0] != M.shape[1]:
            raise ValueError('A must be square')
        if len(b) != M.shape[0]:
            raise ValueError('b length must match A rows')

    if op == 'statistics.describe':
        _axiom_vec(a['data'], 'data')
    if op in {'statistics.correlation','statistics.covariance','statistics.regression'}:
        x = _axiom_vec(a['x'], 'x', 2)
        y = _axiom_vec(a['y'], 'y', 2)
        if len(x) != len(y):
            raise ValueError('x and y must have the same length')
        if op == 'statistics.correlation' and (np.ptp(x) == 0 or np.ptp(y) == 0):
            raise ValueError('correlation requires non-constant x and y')
        if op == 'statistics.regression' and np.ptp(x) == 0:
            raise ValueError('regression x must be non-constant')
    if op == 'statistics.quantile':
        _axiom_vec(a['data'], 'data')
        q = _axiom_num(a['q'], 'q')
        if not 0 <= q <= 1:
            raise ValueError('q must be between 0 and 1')
    if op == 'statistics.zscore':
        z = _axiom_vec(a['data'], 'data', 2)
        if np.ptp(z) == 0:
            raise ValueError('zscore data must be non-constant')
    if op == 'statistics.ttest_ind':
        _axiom_vec(a['x'], 'x', 2)
        _axiom_vec(a['y'], 'y', 2)
        if 'equal_var' in a and not isinstance(a['equal_var'], (bool, np.bool_)):
            raise ValueError('equal_var must be boolean')
    if op == 'statistics.normal_fit':
        _axiom_vec(a['data'], 'data')

    if op == 'probability.normal_cdf':
        sigma = _axiom_num(a.get('sigma', 1), 'sigma')
        if sigma <= 0:
            raise ValueError('sigma must be positive')
    if op == 'probability.normal_ppf':
        p = _axiom_num(a['p'], 'p')
        sigma = _axiom_num(a.get('sigma', 1), 'sigma')
        if not 0 < p < 1:
            raise ValueError('p must be strictly between 0 and 1')
        if sigma <= 0:
            raise ValueError('sigma must be positive')
    if op == 'probability.binomial_pmf':
        n = _axiom_int(a['n'], 'n', 0)
        k = _axiom_int(a['k'], 'k', 0)
        p = _axiom_num(a['p'], 'p')
        if k > n:
            raise ValueError('k must not exceed n')
        if not 0 <= p <= 1:
            raise ValueError('p must be between 0 and 1')
    if op == 'probability.poisson_pmf':
        _axiom_int(a['k'], 'k', 0)
        if _axiom_num(a['mu'], 'mu') < 0:
            raise ValueError('mu must be non-negative')
    if op == 'probability.exponential_cdf':
        if _axiom_num(a['rate'], 'rate') <= 0:
            raise ValueError('rate must be positive')
    if op == 'probability.chi2_cdf':
        if _axiom_num(a['df'], 'df') <= 0:
            raise ValueError('df must be positive')

    if op == 'combinatorics.factorial':
        _axiom_int(a['n'], 'n', 0)
    if op == 'combinatorics.binomial':
        n = _axiom_int(a['n'], 'n', 0)
        k = _axiom_int(a['k'], 'k', 0)
        if k > n:
            raise ValueError('k must not exceed n')
    if op == 'numbertheory.isprime':
        _axiom_int(a['n'], 'n')
    if op == 'numbertheory.factorint':
        n = _axiom_int(a['n'], 'n')
        if n == 0:
            raise ValueError('n must be nonzero')
    if op in {'numbertheory.gcd','numbertheory.lcm'}:
        _axiom_int(a['a'], 'a')
        _axiom_int(a['b'], 'b')

    if op == 'numeric.least_squares':
        M = _axiom_mat(a['A'], 'A')
        b = _axiom_vec(a['b'], 'b')
        if len(b) != M.shape[0]:
            raise ValueError('b length must match A rows')
    if op == 'numeric.interpolate':
        x = _axiom_vec(a['x'], 'x')
        y = _axiom_vec(a['y'], 'y')
        if len(x) != len(y):
            raise ValueError('x and y must have the same length')
        if len(x) > 1 and not bool(np.all(np.diff(x) > 0)):
            raise ValueError('x must be strictly increasing')
        q = np.asarray(a['at'], float)
        if not np.all(np.isfinite(q)):
            raise ValueError('at must contain only finite values')

    if op == 'finance.compound':
        n = _axiom_int(a.get('n', 1), 'n', 1)
        rate = _axiom_num(a['rate'], 'rate')
        years = _axiom_num(a['years'], 'years')
        _axiom_num(a['principal'], 'principal')
        if years < 0:
            raise ValueError('years must be non-negative')
        if 1 + rate / n <= 0:
            raise ValueError('rate is outside the supported compounding domain')
    if op == 'finance.npv':
        _axiom_vec(a['cashflows'], 'cashflows')
        if _axiom_num(a['rate'], 'rate') <= -1:
            raise ValueError('rate must be greater than -1')
    if op in {'finance.black_scholes','finance.greeks','finance.implied_vol'}:
        for key in ('S','K','T'):
            if _axiom_num(a[key], key) <= 0:
                raise ValueError(key + ' must be positive')
        if op != 'finance.implied_vol' and _axiom_num(a['sigma'], 'sigma') <= 0:
            raise ValueError('sigma must be positive')
        _axiom_num(a['r'], 'r')
        _axiom_num(a.get('q', 0), 'q')
        kind = a.get('kind', 'call')
        if kind not in {'call','put'}:
            raise ValueError('kind must be call or put')
        if op == 'finance.implied_vol':
            price = _axiom_num(a['price'], 'price')
            S = float(a['S']); K = float(a['K']); T = float(a['T'])
            r = float(a['r']); q = float(a.get('q', 0))
            discS = S * math.exp(-q * T)
            discK = K * math.exp(-r * T)
            lo = max(0.0, discS - discK) if kind == 'call' else max(0.0, discK - discS)
            hi = discS if kind == 'call' else discK
            if not lo < price < hi:
                raise ValueError('price is outside finite implied-volatility arbitrage bounds')
    if op in {'finance.var_historical','finance.var_parametric','finance.cvar_historical'}:
        z = _axiom_vec(a['returns'], 'returns')
        _axiom_alpha(a)
        if op == 'finance.var_parametric' and len(z) < 2:
            raise ValueError('parametric VaR requires at least two returns')
    if op == 'finance.returns':
        prices = _axiom_vec(a['prices'], 'prices', 2)
        kind = a.get('kind', 'simple')
        if kind not in {'simple','log'}:
            raise ValueError('kind must be simple or log')
        if kind == 'log' and np.any(prices <= 0):
            raise ValueError('log returns require strictly positive prices')
        if kind == 'simple' and np.any(prices[:-1] == 0):
            raise ValueError('simple returns require nonzero prior prices')
    if op == 'finance.portfolio_metrics':
        R = np.asarray(a['returns'], float)
        w = _axiom_vec(a['weights'], 'weights')
        if R.ndim != 2 or R.shape[0] < 2 or R.shape[1] < 1 or not np.all(np.isfinite(R)):
            raise ValueError('returns must be a finite 2D matrix with at least two observations')
        if len(w) != R.shape[1]:
            raise ValueError('weights length must match return columns')
        if _axiom_num(a.get('annualization', 252), 'annualization') <= 0:
            raise ValueError('annualization must be positive')
        _axiom_num(a.get('risk_free', 0), 'risk_free')
    if op in {'finance.bond_price','finance.bond_yield','finance.duration'}:
        face = _axiom_num(a.get('face', 100), 'face')
        maturity = _axiom_num(a['maturity'], 'maturity')
        freq = _axiom_int(a.get('frequency', 2), 'frequency', 1)
        _axiom_num(a['coupon_rate'], 'coupon_rate')
        if face <= 0:
            raise ValueError('face must be positive')
        if maturity <= 0:
            raise ValueError('maturity must be positive')
        if op == 'finance.bond_yield':
            if _axiom_num(a['price'], 'price') <= 0:
                raise ValueError('price must be positive')
        else:
            y = _axiom_num(a['yield'], 'yield')
            if 1 + y / freq <= 0:
                raise ValueError('yield is outside supported discounting domain')
    if op == 'finance.beta':
        x = _axiom_vec(a['asset_returns'], 'asset_returns', 2)
        y = _axiom_vec(a['market_returns'], 'market_returns', 2)
        if len(x) != len(y):
            raise ValueError('asset_returns and market_returns must have the same length')
        if np.ptp(y) == 0:
            raise ValueError('market_returns must have nonzero variance')
    if op == 'finance.drawdown':
        values = _axiom_vec(a['values'], 'values')
        if np.any(values <= 0):
            raise ValueError('drawdown values must be strictly positive')
    if op == 'finance.monte_carlo_gbm':
        if _axiom_num(a['S0'], 'S0') <= 0:
            raise ValueError('S0 must be positive')
        _axiom_num(a['mu'], 'mu')
        sigma = _axiom_num(a['sigma'], 'sigma')
        T = _axiom_num(a['T'], 'T')
        if sigma < 0:
            raise ValueError('sigma must be non-negative')
        if T < 0:
            raise ValueError('T must be non-negative')
        _axiom_int(a.get('steps', 252), 'steps', 1)
        _axiom_int(a.get('paths', 1000), 'paths', 1)
        if 'seed' in a:
            _axiom_int(a['seed'], 'seed')

    if op == 'timeseries.moving_average':
        z = _axiom_vec(a['data'], 'data')
        n = _axiom_int(a['window'], 'window', 1)
        if n > len(z):
            raise ValueError('window must not exceed data length')
    if op == 'timeseries.ewma':
        _axiom_vec(a['data'], 'data')
        alpha = _axiom_num(a['alpha'], 'alpha')
        if not 0 < alpha <= 1:
            raise ValueError('alpha must be in (0,1]')
    if op == 'timeseries.rolling_volatility':
        z = _axiom_vec(a['returns'], 'returns', 2)
        n = _axiom_int(a['window'], 'window', 2)
        if n > len(z):
            raise ValueError('window must not exceed returns length')
        if _axiom_num(a.get('annualization', 252), 'annualization') <= 0:
            raise ValueError('annualization must be positive')

    if op == 'geometry.distance':
        p = _axiom_vec(a['p'], 'p')
        q = _axiom_vec(a['q'], 'q')
        if len(p) != len(q):
            raise ValueError('p and q must have the same dimension')
    if op in {'geometry.area_circle','geometry.volume_sphere'}:
        if _axiom_num(a['radius'], 'radius') < 0:
            raise ValueError('radius must be non-negative')

    if op == 'transforms.fft':
        _axiom_vec(a['data'], 'data')
    if op == 'transforms.ifft':
        if not isinstance(a.get('data'), (list, tuple)) or len(a['data']) < 1:
            raise ValueError('data must be a non-empty spectral array')
        if 'n' in a:
            _axiom_int(a['n'], 'n', 1)

    if op == 'verified.interval_eval':
        iv = _axiom_vec(a['interval'], 'interval')
        if len(iv) != 2:
            raise ValueError('interval must contain exactly two endpoints')
        if iv[0] > iv[1]:
            raise ValueError('interval lower bound exceeds upper bound')

    if op == 'verify.crosscheck':
        target = a.get('operation')
        nested = a.get('args', {})
        if not isinstance(target, str) or target not in _AXIOM_ALLOWED_KEYS:
            raise ValueError('crosscheck operation must be a registered operation')
        if target == 'verify.crosscheck':
            raise ValueError('nested verify.crosscheck is not supported')
        if not isinstance(nested, dict):
            raise ValueError('crosscheck args must be an object')
        _axiom_validate(target, nested)

_AXIOM_FINITE_RESULT_OPS = set(V3_OPERATIONS) - {
    'algebra.simplify','algebra.expand','algebra.factor','algebra.solve',
    'calculus.diff','calculus.integrate','calculus.limit','calculus.series',
    'algebra.polynomial_roots','calculus.sum','calculus.product',
    'verified.interval_eval','verify.evaluate','verify.crosscheck',
}

_AXIOM_RAW_DISPATCH = dispatch
_AXIOM_RAW_V2_DISPATCH = _v2_dispatch

def _axiom_checked_v2_dispatch(op, a, p):
    _axiom_validate(op, a)
    out = _AXIOM_RAW_V2_DISPATCH(op, a, p)
    if op in _AXIOM_FINITE_RESULT_OPS and not _axiom_finite_tree(out):
        raise ValueError(op + ' produced a non-finite result')
    return out

_v2_dispatch = _axiom_checked_v2_dispatch

def dispatch(op, a, p):
    _axiom_validate(op, a)
    out = _AXIOM_RAW_DISPATCH(op, a, p)
    if op in _AXIOM_FINITE_RESULT_OPS and not _axiom_finite_tree(out):
        raise ValueError(op + ' produced a non-finite result')
    return out
'''

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("path")
    ns = ap.parse_args()
    p = pathlib.Path(ns.path)
    raw = p.read_bytes()
    got = hashlib.sha256(raw).hexdigest()
    if got != EXPECTED_SHA256:
        raise SystemExit(f"Fail-closed patched runtime digest mismatch: {got}")
    s = raw.decode()
    if MARKER in s:
        raise SystemExit("hardening marker already present")
    p.write_text(s + "\n" + CODE + "\n")
    out = hashlib.sha256(p.read_bytes()).hexdigest()
    print(f"MUSITU_AXIOM_ALL_OPERATION_HARDENING_PATCH_PASS before={got} after={out}")

if __name__ == "__main__":
    main()
