"""Build public operation contracts from the verified runtime interface.

This file contains interface definitions and synthetic examples, not private
kernel implementation. Keep operation names and defaults aligned with runtime.
"""
import copy
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
C = {}
EXAMPLES = {}

def field(kind, description, **kw):
    return dict(type=kind, description=description, **kw)

def num(description, **kw): return field('number', description, **kw)
def integer(description, **kw): return field('integer', description, **kw)
def text(description, **kw): return field('string', description, minLength=1, **kw)
def vector(description, minimum=1, **kw):
    return field('array', description, items=kw.pop('items',{'type':'number'}), minItems=minimum, **kw)
def matrix(description, minimum=1):
    return field('array', description, items=vector('One matrix row.'), minItems=minimum)
def default(schema, value): return dict(schema, default=value)
def add(op, properties, required, example):
    C[op]={'type':'object','properties':properties,'required':required.split(), 'additionalProperties':False,'examples':[example]}
    EXAMPLES[op]=example

expression=text('SymPy expression, such as x**2, sin(x), pi, or 40+2. Use ** for powers.')
symbol=default(text('Variable or summation index name.'),'x')
scalar={'anyOf':[{'type':'number'},{'type':'string','minLength':1}], 'description':'Number or symbolic value, such as 0, pi, or oo.'}
digits=r'\d(?:_?\d)*'
real=rf'(?:{digits}(?:\.(?:{digits})?)?|\.{digits})(?:[eE][+-]?{digits})?'
complex_value=rf'(?:[+-]?{real}|[+-]?(?:{real})?[jJ]|[+-]?{real}[+-](?:{real})?[jJ])'
complex_pattern=rf'^\s*(?:{complex_value}|\(\s*{complex_value}\s*\))\s*$'
data=vector('Numeric observations in their original order.')
pair={'type':'array','items':copy.deepcopy(scalar),'minItems':2,'maxItems':2}
for op,e in [('arithmetic.evaluate','40+2'),('algebra.simplify','(x**2-1)/(x-1)'),('algebra.expand','(x+1)**2'),('algebra.factor','x**2-1'),('algebra.polynomial_roots','x**2-1')]:
    props={'expression':expression}
    if op.endswith('polynomial_roots'):props['symbol']=symbol
    add(op,props,'expression',{'expression':e})
add('algebra.solve',{'equations':field('array','Expressions equal to zero; for x+1=3 supply x+1-3.',items=text('Expression equal to zero.'),minItems=1),'symbols':default(field('array','Unknown variable names.',items=text('Variable name.'),minItems=1,uniqueItems=True),['x'])},'equations',{'equations':['x+1-3'],'symbols':['x']})
add('calculus.diff',{'expression':expression,'symbol':symbol,'order':integer('Nonnegative differentiation order.',minimum=0,default=1)},'expression',{'expression':'x**3','order':2})
add('calculus.integrate',{'expression':expression,'symbol':symbol,'bounds':{'description':'Optional [lower, upper] limits. Omit, null, or [] for an indefinite integral.','anyOf':[pair,{'type':'null'},{'type':'array','maxItems':0}]}},'expression',{'expression':'x','bounds':[0,2]})
add('calculus.limit',{'expression':expression,'symbol':symbol,'to':scalar},'expression to',{'expression':'sin(x)/x','to':0})
add('calculus.series',{'expression':expression,'symbol':symbol,'at':default(scalar,0),'order':integer('Series truncation order.',minimum=0,default=6)},'expression',{'expression':'exp(x)','order':4})
for op in ['calculus.sum','calculus.product']:
    add(op,{'expression':expression,'symbol':default(text('Index variable name.'),'k'),'start':integer('Inclusive first index.'),'end':integer('Inclusive last index.')},'expression start end',{'expression':'k','start':1,'end':4})
add('numeric.root',{'expression':expression,'symbol':symbol,'guess':num('Initial numerical root estimate.')},'expression guess',{'expression':'x**2-2','guess':1})
for op in ['numeric.integrate','numeric.optimize_scalar']:
    props={'expression':expression,'a':num('Lower interval bound for variable x.'),'b':num('Upper interval bound for variable x.')}
    if op.endswith('integrate'):props['epsabs']=num('Nonnegative absolute integration tolerance; zero uses the relative tolerance.',minimum=0,default=1e-10)
    add(op,props,'expression a b',{'expression':'x**2','a':0,'b':1})
add('numeric.ode',{'rhs':text('Right-hand side f(t,y) of scalar y\'=f(t,y).'),'t0':num('Initial independent-variable value.'),'t1':num('Final independent-variable value.'),'y0':num('Initial value y(t0).'),'rtol':num('Relative solver tolerance.',exclusiveMinimum=0,default=1e-8),'atol':num('Absolute solver tolerance.',exclusiveMinimum=0,default=1e-10)},'rhs t0 t1 y0',{'rhs':'y','t0':0,'t1':1,'y0':1})
for op in ['linear.det','linear.inv','linear.eigen','linear.solve','numeric.least_squares']:
    props={'A':matrix('Numeric matrix, as rows. Linear operations require a square matrix.')};example={'A':[[2,0],[0,4]]};req='A'
    if op in ['linear.solve','numeric.least_squares']:props['b']={'description':'Right-hand-side vector, or matrix for multiple right-hand sides; one entry or row per row of A.','anyOf':[vector('Right-hand-side vector.'),matrix('Right-hand sides as columns.')]};example['b']=[4,8];req+=' b'
    add(op,props,req,example)
add('numeric.interpolate',{'x':vector('Strictly increasing sample coordinates.'),'y':vector('Sample values, one per x coordinate.'),'at':{'description':'Coordinate or coordinates to interpolate. Outside x, uses the closest endpoint value.','anyOf':[{'type':'number'},vector('Interpolation coordinates.')]}},'x y at',{'x':[0,1,2],'y':[0,2,4],'at':[.5,1.5]})
add('verified.interval_eval',{'expression':expression,'symbol':symbol,'interval':dict(pair,description='Numeric [lower, upper] interval.',items={'type':'number'})},'expression interval',{'expression':'x**2','interval':[1,2]})
add('statistics.describe',{'data':data},'data',{'data':[2,4,6,8]})
for op in ['statistics.correlation','statistics.covariance','statistics.regression','statistics.ttest_ind']:
    props={'x':vector('First numeric sample.',1 if op.endswith('ttest_ind') else 2),'y':vector('Second numeric sample. Paired analyses require the same length as x.',1 if op.endswith('ttest_ind') else 2)}
    if op.endswith('ttest_ind'):props['equal_var']=field('boolean','Use pooled variance when true (combined sample size at least 3); Welch test when false (each sample size at least 2).',default=False)
    add(op,props,'x y',{'x':[1,2,4,5],'y':[2,4,5,8]})
add('statistics.quantile',{'data':data,'q':num('Quantile probability between 0 and 1.',minimum=0,maximum=1)},'data q',{'data':[1,2,3,4],'q':.5})
add('statistics.zscore',{'data':vector('Nonconstant numeric sample.'),'ddof':integer('Degrees-of-freedom correction; must be less than sample size.',minimum=0,default=0)},'data',{'data':[1,2,3]})
add('statistics.normal_fit',{'data':data},'data',{'data':[1,2,3]})
for op in ['probability.normal_cdf','probability.normal_ppf']:
    key='p' if op.endswith('ppf') else 'x'
    value=num('Cumulative probability. Endpoints give extended-real quantiles.',minimum=0,maximum=1) if key=='p' else num('Value at which to evaluate the CDF.')
    add(op,{key:value,'mu':num('Distribution mean.',default=0),'sigma':num('Positive standard deviation.',exclusiveMinimum=0,default=1)},key,{key:.5 if key=='p' else 0})
add('probability.binomial_pmf',{'k':integer('Observed successes.'),'n':integer('Number of trials.',minimum=0),'p':num('Success probability.',minimum=0,maximum=1)},'k n p',{'k':2,'n':4,'p':.5})
add('probability.poisson_pmf',{'k':integer('Observed event count.'),'mu':num('Expected event count.',minimum=0)},'k mu',{'k':2,'mu':3})
add('probability.exponential_cdf',{'x':num('Value at which to evaluate the CDF.'),'rate':num('Positive exponential rate.',exclusiveMinimum=0)},'x rate',{'x':1,'rate':2})
add('probability.chi2_cdf',{'x':num('Value at which to evaluate the CDF.'),'df':num('Positive degrees of freedom.',exclusiveMinimum=0)},'x df',{'x':2,'df':3})
add('finance.compound',{'principal':num('Initial amount.'),'rate':num('Annual rate as a decimal, e.g. 0.05.'),'years':num('Investment duration in years.'),'n':integer('Compounding periods per year.',minimum=1,default=1)},'principal rate years',{'principal':100,'rate':.05,'years':2})
add('finance.npv',{'cashflows':vector('Cash flows from time zero onward; include the initial investment as the first entry.'),'rate':num('Discount rate per period as a decimal; cannot equal -1.',**{'not':{'const':-1}})},'cashflows rate',{'cashflows':[-100,60,60],'rate':.1})
option={'S':num('Positive spot price.',exclusiveMinimum=0),'K':num('Positive strike price.',exclusiveMinimum=0),'T':num('Positive time to expiry in years.',exclusiveMinimum=0),'r':num('Continuously compounded annual risk-free rate.'),'sigma':num('Positive annual volatility as a decimal.',exclusiveMinimum=0),'kind':text('Option type.',enum=['call','put'],default='call'),'q':num('Continuously compounded dividend yield.',default=0)}
for op in ['finance.black_scholes','finance.greeks','finance.implied_vol']:
    props=copy.deepcopy(option);required='S K T r sigma';example={'S':100,'K':100,'T':1,'r':.05,'sigma':.2}
    if op.endswith('implied_vol'):props.pop('sigma');props['price']=num('Observed nonnegative option price.',minimum=0);required='price S K T r';example.pop('sigma');example['price']=10.450583572185565
    add(op,props,required,example)
for op in ['finance.var_historical','finance.var_parametric','finance.cvar_historical']:
    add(op,{'returns':vector('Period returns as decimals.',2 if op.endswith('parametric') else 1),'alpha':num('Confidence level as a decimal strictly between 0 and 1.',exclusiveMinimum=0,exclusiveMaximum=1,default=.99)},'returns',{'returns':[-.03,-.01,.01,.02,.04]})
add('finance.returns',{'prices':field('array','At least two strictly positive prices, in time order.',items={'type':'number','exclusiveMinimum':0},minItems=2),'kind':text('Return convention.',enum=['simple','log'],default='simple')},'prices',{'prices':[100,110,105]})
add('finance.portfolio_metrics',{'returns':matrix('Period rows by asset columns; at least two observations.',2),'weights':vector('One weight per asset; weights must sum to 1 within 1e-8.'),'annualization':num('Periods per year.',exclusiveMinimum=0,default=252),'risk_free':num('Annual risk-free return as a decimal.',default=0)},'returns weights',{'returns':[[.01,.02],[-.01,.01],[.03,-.02]],'weights':[.5,.5]})
add('finance.beta',{'asset_returns':vector('Asset returns as decimals, paired with market_returns.',2),'market_returns':vector('Benchmark returns as decimals; must have nonzero variance.',2)},'asset_returns market_returns',{'asset_returns':[.01,-.02,.03,.04],'market_returns':[.02,-.01,.02,.03]})
add('finance.drawdown',{'values':vector('Positive asset or portfolio values in time order.',items={'type':'number','exclusiveMinimum':0})},'values',{'values':[100,110,99,120]})
bond={'face':num('Bond face value.',exclusiveMinimum=0,default=100),'coupon_rate':num('Annual coupon rate as a decimal.'),'maturity':num('Years to maturity.',exclusiveMinimum=0),'frequency':integer('Coupon payments per year.',minimum=1,default=2)}
for op in ['finance.bond_price','finance.bond_yield','finance.duration']:
    props=copy.deepcopy(bond);key='price' if op.endswith('bond_yield') else 'yield';props[key]=num('Positive observed bond price.',exclusiveMinimum=0) if key=='price' else num('Annual yield as a decimal, greater than -frequency.')
    add(op,props,'coupon_rate maturity '+key,{'coupon_rate':.05,'maturity':2,key:100 if key=='price' else .04})
add('finance.monte_carlo_gbm',{'S0':num('Positive initial asset price.',exclusiveMinimum=0),'mu':num('Annual drift as a decimal.'),'sigma':num('Annual volatility as a decimal.',minimum=0),'T':num('Simulation horizon in years.',minimum=0),'steps':integer('Time steps per simulated path.',minimum=1,maximum=5000,default=252),'paths':integer('Number of simulated paths.',minimum=1,maximum=20000,default=1000),'seed':integer('Nonnegative deterministic random seed.',minimum=0,default=0)},'S0 mu sigma T',{'S0':100,'mu':.05,'sigma':.2,'T':1,'steps':10,'paths':100,'seed':0})
add('timeseries.moving_average',{'data':data,'window':integer('Window length; cannot exceed the data length.',minimum=1)},'data window',{'data':[1,2,3,4,5],'window':3})
add('timeseries.ewma',{'data':data,'alpha':num('Recursive smoothing weight in (0,1].',exclusiveMinimum=0,maximum=1,default=.2)},'data',{'data':[1,2,3,4],'alpha':.5})
add('timeseries.rolling_volatility',{'returns':vector('Period return observations as decimals.',2),'window':integer('Window length, from 2 through the returns length.',minimum=2),'annualization':num('Periods per year.',exclusiveMinimum=0,default=252)},'returns window',{'returns':[-.01,.02,.01,-.02],'window':2})
add('geometry.distance',{'p':vector('First point coordinates.'),'q':vector('Second point coordinates with the same dimension as p.')},'p q',{'p':[0,0],'q':[3,4]})
for op in ['geometry.area_circle','geometry.volume_sphere']:add(op,{'radius':num('Nonnegative radius.',minimum=0)},'radius',{'radius':2})
add('transforms.fft',{'data':data},'data',{'data':[1,2,3,4]})
add('transforms.ifft',{'data':field('array','Real-FFT frequency bins, not a full complex spectrum.',minItems=1,items={'anyOf':[{'type':'number'},text('Python-compatible finite complex value, such as 1+2j.',pattern=complex_pattern),{'type':'object','properties':{'re':num('Real part.',default=0),'im':num('Imaginary part.',default=0)},'additionalProperties':False}]}),'n':{'description':'Output sample count. Omit or null for 2*(number of bins-1).','anyOf':[{'type':'integer','minimum':1},{'type':'null'}]}},'data',{'data':[{'re':10,'im':0},{'re':-2,'im':2},{'re':-2,'im':0}],'n':4})
nullable={'anyOf':[{'type':'number'},{'type':'null'}]}
boundpair={'type':'array','items':nullable,'minItems':2,'maxItems':2}
add('optimization.linear_program',{'c':vector('Objective coefficients to minimize c dot x.'),'A_ub':matrix('Inequality coefficient rows for A_ub x <= b_ub.'),'b_ub':vector('One upper limit per row of A_ub.'),'A_eq':matrix('Equality coefficient rows for A_eq x = b_eq.'),'b_eq':vector('One target per row of A_eq.'),'bounds':{'description':'[lower,upper] for all variables, or one such pair per variable. A null endpoint means unbounded; null for the whole bounds value uses default nonnegative bounds [0,null].','default':[0,None],'anyOf':[boundpair,{'type':'array','items':boundpair,'minItems':1},{'type':'null'}]}},'c',{'c':[-3,-2],'A_ub':[[1,1],[1,0],[0,1]],'b_ub':[4,2,3],'bounds':[0,None]})
add('optimization.quadratic',{'Q':matrix('Square symmetric quadratic matrix for 0.5*x.T*Q*x+c.T*x.'),'c':vector('Linear objective coefficients.'),'x0':vector('Initial point; defaults to the zero vector.')},'Q c',{'Q':[[2,0],[0,2]],'c':[-2,-4]})
units=['m','km','cm','mm','kg','g','s','min','h','Pa','kPa','MPa','C','F','K']
add('units.convert',{'value':num('Quantity to convert.'),'from':text('Source unit; must be dimensionally compatible with to.',enum=units),'to':text('Target unit.',enum=units)},'value from to',{'value':1,'from':'km','to':'m'})
add('knowledge.constant',{'name':text('Embedded scientific constant identifier.',enum=['c','G','h','e','k_B','N_A'])},'name',{'name':'c'})
add('knowledge.element',{'symbol':text('Case-sensitive chemical symbol, embedded elements H through Ca.',enum=['H','He','Li','Be','B','C','N','O','F','Ne','Na','Mg','Al','Si','P','S','Cl','Ar','K','Ca'])},'symbol',{'symbol':'C'})
add('combinatorics.factorial',{'n':integer('Nonnegative factorial argument.',minimum=0)},'n',{'n':5})
add('combinatorics.binomial',{'n':integer('Upper binomial argument.'),'k':integer('Lower binomial argument.')},'n k',{'n':5,'k':2})
for op in ['numbertheory.isprime','numbertheory.factorint']:add(op,{'n':integer('Integer to analyze.')},'n',{'n':42})
for op in ['numbertheory.gcd','numbertheory.lcm']:add(op,{'a':integer('First integer.'),'b':integer('Second integer.')},'a b',{'a':12,'b':18})
add('verify.evaluate',{'lhs':text('Left-hand symbolic expression.'),'rhs':text('Right-hand symbolic expression.')},'lhs rhs',{'lhs':'(x+1)**2','rhs':'x**2+2*x+1'})
add('verify.crosscheck',{'operation':text('Operation to compute and independently check where a verification method applies.'),'args':{'type':'object','description':'Inputs for the selected operation.'}},'operation args',{'operation':'arithmetic.evaluate','args':{'expression':'40+2'}})

def main():
    assert len(C)==74, len(C)
    (ROOT/'mcp/operation_contracts.json').write_text(json.dumps(C,indent=2)+'\n')
    (ROOT/'mcp/tests/fixtures/operation-examples.json').write_text(json.dumps(EXAMPLES,indent=2)+'\n')
    print('Built 74 operation contracts and synthetic examples.')

if __name__=='__main__':main()
