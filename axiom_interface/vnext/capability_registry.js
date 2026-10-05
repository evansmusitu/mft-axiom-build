export const ATOMIC_OPERATIONS = Object.freeze([
  "algebra.expand","algebra.factor","algebra.polynomial_roots","algebra.simplify","algebra.solve",
  "arithmetic.evaluate",
  "calculus.diff","calculus.integrate","calculus.limit","calculus.product","calculus.series","calculus.sum",
  "combinatorics.binomial","combinatorics.factorial",
  "finance.beta","finance.black_scholes","finance.bond_price","finance.bond_yield","finance.compound","finance.cvar_historical","finance.drawdown","finance.duration","finance.greeks","finance.implied_vol","finance.monte_carlo_gbm","finance.npv","finance.portfolio_metrics","finance.returns","finance.var_historical","finance.var_parametric",
  "geometry.area_circle","geometry.distance","geometry.volume_sphere",
  "knowledge.constant","knowledge.element",
  "linear.det","linear.eigen","linear.inv","linear.solve",
  "numbertheory.factorint","numbertheory.gcd","numbertheory.isprime","numbertheory.lcm",
  "numeric.integrate","numeric.interpolate","numeric.least_squares","numeric.ode","numeric.optimize_scalar","numeric.root",
  "optimization.linear_program","optimization.quadratic",
  "probability.binomial_pmf","probability.chi2_cdf","probability.exponential_cdf","probability.normal_cdf","probability.normal_ppf","probability.poisson_pmf",
  "statistics.correlation","statistics.covariance","statistics.describe","statistics.normal_fit","statistics.quantile","statistics.regression","statistics.ttest_ind","statistics.zscore",
  "timeseries.ewma","timeseries.moving_average","timeseries.rolling_volatility",
  "transforms.fft","transforms.ifft","units.convert","verified.interval_eval","verify.crosscheck","verify.evaluate"
]);
export const ARCHETYPES = Object.freeze([
  {id:"portfolio_risk_stack",category:"Finance / Portfolio Risk",keywords:["portfolio","risk","var","cvar","drawdown","exposure"],ops:["finance.returns","statistics.describe","statistics.covariance","statistics.correlation","finance.beta","finance.portfolio_metrics","finance.var_historical","finance.cvar_historical","finance.drawdown","verify.crosscheck"]},
  {id:"portfolio_parametric_risk",category:"Finance / Parametric Risk",keywords:["parametric","risk","var","covariance"],ops:["finance.returns","statistics.describe","statistics.covariance","finance.var_parametric","finance.portfolio_metrics","verify.crosscheck"]},
  {id:"portfolio_optimization",category:"Finance / Portfolio Optimization",keywords:["optimize","allocation","weights","portfolio"],ops:["finance.returns","statistics.covariance","finance.portfolio_metrics","optimization.quadratic","verify.crosscheck"]},
  {id:"capital_allocation",category:"Finance / Capital Allocation",keywords:["capital","allocation","budget","constraint"],ops:["finance.returns","statistics.covariance","optimization.linear_program","finance.portfolio_metrics","verify.crosscheck"]},
  {id:"option_valuation_risk",category:"Finance / Options",keywords:["option","black scholes","greeks","implied vol","volatility"],ops:["finance.black_scholes","finance.greeks","finance.implied_vol","finance.monte_carlo_gbm","verify.crosscheck"]},
  {id:"option_sensitivity",category:"Finance / Options Sensitivity",keywords:["delta","gamma","vega","theta","option sensitivity"],ops:["finance.black_scholes","finance.greeks","statistics.zscore","finance.var_parametric","verify.crosscheck"]},
  {id:"fixed_income_stack",category:"Finance / Fixed Income",keywords:["bond","yield","duration","fixed income"],ops:["finance.bond_price","finance.bond_yield","finance.duration","finance.npv","verify.crosscheck"]},
  {id:"investment_case",category:"Finance / Investment Appraisal",keywords:["npv","investment","project","capex","cash flow"],ops:["finance.compound","finance.npv","finance.monte_carlo_gbm","statistics.quantile","verify.crosscheck"]},
  {id:"drawdown_stress",category:"Finance / Drawdown & Stress",keywords:["stress","drawdown","loss","tail","scenario"],ops:["finance.returns","finance.drawdown","finance.var_historical","finance.cvar_historical","finance.monte_carlo_gbm","verify.crosscheck"]},
  {id:"time_series_signal",category:"Time Series / Signal",keywords:["time series","moving average","signal","trend","ewma"],ops:["timeseries.moving_average","timeseries.ewma","timeseries.rolling_volatility","transforms.fft","verify.crosscheck"]},
  {id:"time_series_spectral",category:"Time Series / Spectral",keywords:["fft","frequency","spectral","cycle"],ops:["transforms.fft","transforms.ifft","timeseries.moving_average","statistics.correlation","verify.crosscheck"]},
  {id:"forecast_diagnostics",category:"Time Series / Diagnostics",keywords:["forecast","predict","diagnostic","residual"],ops:["timeseries.ewma","statistics.regression","statistics.zscore","statistics.quantile","verify.crosscheck"]},
  {id:"statistical_profile",category:"Statistics / Profiling",keywords:["describe","distribution","summary statistics","profile"],ops:["statistics.describe","statistics.quantile","statistics.zscore","statistics.normal_fit","verify.crosscheck"]},
  {id:"statistical_relationship",category:"Statistics / Relationships",keywords:["regression","correlation","covariance","ttest","relationship"],ops:["statistics.correlation","statistics.covariance","statistics.regression","statistics.ttest_ind","verify.crosscheck"]},
  {id:"distribution_analysis",category:"Probability / Distribution",keywords:["normal","distribution","percentile","cdf","ppf"],ops:["probability.normal_cdf","probability.normal_ppf","statistics.normal_fit","statistics.quantile","verify.crosscheck"]},
  {id:"event_probability",category:"Probability / Events",keywords:["probability","poisson","binomial","event","arrival"],ops:["probability.binomial_pmf","probability.poisson_pmf","probability.exponential_cdf","probability.chi2_cdf","verify.crosscheck"]},
  {id:"symbolic_calculus",category:"Mathematics / Symbolic Calculus",keywords:["differentiate","integrate","limit","series","calculus"],ops:["algebra.simplify","calculus.diff","calculus.integrate","calculus.limit","calculus.series","verify.evaluate"]},
  {id:"symbolic_equation",category:"Mathematics / Symbolic Equations",keywords:["equation","factor","solve","polynomial","expand"],ops:["algebra.expand","algebra.factor","algebra.solve","algebra.polynomial_roots","verify.evaluate"]},
  {id:"numerical_model",category:"Mathematics / Numerical Modeling",keywords:["interpolate","least squares","root","numerical","optimize"],ops:["numeric.interpolate","numeric.least_squares","numeric.root","numeric.optimize_scalar","numeric.integrate","verify.crosscheck"]},
  {id:"dynamical_system",category:"Mathematics / Dynamical Systems",keywords:["ode","differential equation","dynamics","simulation"],ops:["numeric.ode","numeric.integrate","statistics.describe","verified.interval_eval","verify.crosscheck"]},
  {id:"linear_system",category:"Mathematics / Linear Algebra",keywords:["matrix","linear system","eigen","inverse","determinant"],ops:["linear.det","linear.inv","linear.solve","linear.eigen","numeric.least_squares","verify.crosscheck"]},
  {id:"discrete_number_theory",category:"Mathematics / Discrete",keywords:["prime","factor integer","gcd","lcm","number theory"],ops:["numbertheory.factorint","numbertheory.isprime","numbertheory.gcd","numbertheory.lcm","verify.evaluate"]},
  {id:"physical_geometry",category:"Measurement / Geometry",keywords:["geometry","distance","circle","sphere","units"],ops:["units.convert","geometry.distance","geometry.area_circle","geometry.volume_sphere","arithmetic.evaluate","verify.crosscheck"]},
  {id:"knowledge_math_bridge",category:"Knowledge / Scientific Constants",keywords:["constant","element","physics","chemistry","unit conversion"],ops:["knowledge.constant","knowledge.element","units.convert","arithmetic.evaluate","verified.interval_eval","verify.crosscheck"]}
]);
export const INTENTS = Object.freeze(["baseline","comparative","sensitivity","stress","scenario","diagnostic","robustness","decision","explainable","verified"]);
export const CONTEXTS_PER_ARCHETYPE = 10;
export const DERIVED_CAPABILITY_COUNT = ARCHETYPES.length * INTENTS.length * CONTEXTS_PER_ARCHETYPE;
const normalize = value => String(value || "").toLowerCase().replace(/[^a-z0-9.+%-]+/g," ").trim();
function scoreArchetype(text, archetype){const n=normalize(text);let score=0;for(const keyword of archetype.keywords){const k=normalize(keyword);if(n.includes(k))score+=Math.max(2,k.split(" ").length*2)}for(const op of archetype.ops){const tail=op.split(".").pop().replaceAll("_"," ");if(n.includes(tail))score+=1}return score}
function inferIntent(text){const n=normalize(text);const checks=[["verified",["verify","verified","cross check","prove"]],["stress",["stress","adverse","shock","crash"]],["sensitivity",["sensitivity","sensitive","what if"]],["comparative",["compare","versus","vs","relative"]],["scenario",["scenario","cases","multiple assumptions"]],["diagnostic",["diagnose","anomaly","why","problem"]],["robustness",["robust","stability","parameter changes"]],["decision",["decide","recommend","decision"]],["explainable",["explain","interpret","decompose"]]];for(const[intent,words]of checks)if(words.some(w=>n.includes(w)))return intent;return"baseline"}
export function routeCapability(text){const scored=ARCHETYPES.map(a=>({a,score:scoreArchetype(text,a)})).sort((x,y)=>y.score-x.score||x.a.id.localeCompare(y.a.id));const top=scored[0]?.score>0?scored[0].a:ARCHETYPES.find(a=>a.id==="statistical_profile");const intent=inferIntent(text);return Object.freeze({schema:"musitu.axiom.capability-route-preview.v1",qualification:"LOCAL_ROUTING_PREVIEW_NOT_EXECUTION",archetype:top.id,category:top.category,intent,atomic_operations:[...top.ops],side_effect_class:"COMPUTE_ONLY",evidence_requirement:top.ops.some(op=>op.startsWith("verify."))?"VERIFIED":"STANDARD",derived_catalog_size:DERIVED_CAPABILITY_COUNT})}
export function capabilityFamilies(){const counts=new Map();for(const op of ATOMIC_OPERATIONS){const family=op.split(".")[0];counts.set(family,(counts.get(family)||0)+1)}return[...counts.entries()].map(([family,count])=>({family,count})).sort((a,b)=>a.family.localeCompare(b.family))}
