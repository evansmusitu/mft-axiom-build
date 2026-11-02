/** Bounded, deterministic analytical workflows. These consume supplied data;
 * they never fetch sources, infer factual truth or authorize external actions.
 * The server adapter binds input, budget, identity and output to one Work.
 */
import {canonicalJson,sha256Json} from './execution_integrity.mjs';

export const ANALYTICAL_WORKFLOWS=Object.freeze([
  'document-reconciliation','claim-lineage','source-adjudication','causal-policy',
  'bayesian-updating','monte-carlo-uncertainty','forecast-calibration',
  'statement-forensics','project-finance','asset-liability','inventory-decisions',
  'reliability-investigation','twin-validation','analytical-pipeline','benchmark-evaluation',
]);
export const ANALYTICAL_IMPLEMENTATION_ID='musitu.axiom.analytical-engine.20261101.v1';
const scope='DECLARED_INPUT_ANALYSIS_NOT_SOURCE_OR_EXTERNAL_ATTESTATION';
const requireValue=(condition,message)=>{if(!condition)throw new TypeError(message);};
function fields(value,required,optional=[]){
  requireValue(value&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype,'plain input object required');
  requireValue(required.every(k=>Object.hasOwn(value,k))&&Object.keys(value).every(k=>required.includes(k)||optional.includes(k)),'missing or unsupported analytical fields');return value;
}
function number(value,name='value',{minimum=-Infinity,maximum=Infinity,integer=false}={}){
  requireValue(typeof value==='number'&&Number.isFinite(value)&&value>=minimum&&value<=maximum&&(!integer||Number.isSafeInteger(value)),name+' is outside its finite range');return value===0?0:value;
}
function text(value,name='identifier',max=160){requireValue(typeof value==='string'&&value.trim().length>0&&value.length<=max&&!['__proto__','prototype','constructor'].includes(value),name+' required');return value;}
function rows(value,max=250,empty=false){requireValue(Array.isArray(value)&&value.length<=(max)&& (empty||value.length>0),'bounded nonempty rows required');return value;}
function unique(values){requireValue(new Set(values).size===values.length,'duplicate identifiers');}
function sum(values){const value=values.reduce((a,b)=>a+b,0);return number(value,'arithmetic result');}
function probabilities(values){values.forEach(v=>number(v,'probability',{minimum:0,maximum:1}));requireValue(Math.abs(sum(values)-1)<=1e-10,'probabilities must sum to one');}
function instant(value){text(value,'timestamp',40);requireValue(/(?:Z|[+-]\d\d:\d\d)$/.test(value)&&Number.isFinite(Date.parse(value)),'timezone-aware timestamp required');return Date.parse(value);}
function unit(value){return text(value,'common unit',80);}
function equal(a,b,tolerance=0){
  if(typeof a==='number'||typeof b==='number')return typeof a==='number'&&typeof b==='number'&&Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=tolerance;
  if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((x,i)=>equal(x,b[i],tolerance));
  if(a&&typeof a==='object'||b&&typeof b==='object')return !!a&&!!b&&typeof a==='object'&&typeof b==='object'&&Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(k=>Object.hasOwn(b,k)&&equal(a[k],b[k],tolerance));
  return typeof a===typeof b&&a===b;
}

function reconcile(p){
  fields(p,['document_id','period','currency','unit_scale','reported_total','tolerance','minimum_confidence','rows']);
  text(p.document_id);text(p.period);unit(p.currency);number(p.unit_scale,'unit scale',{minimum:Number.MIN_VALUE});number(p.reported_total);number(p.tolerance,'tolerance',{minimum:0});number(p.minimum_confidence,'minimum confidence',{minimum:0,maximum:1});
  const items=rows(p.rows).map(r=>{fields(r,['id','value','locator','confidence']);text(r.id);text(r.locator,'page/cell locator',300);number(r.value);number(r.confidence,'extraction confidence',{minimum:0,maximum:1});return r;});unique(items.map(r=>r.id));unique(items.map(r=>r.locator));
  const total=sum(items.map(r=>r.value)),difference=number(total-p.reported_total),low=items.filter(r=>r.confidence<p.minimum_confidence).map(r=>r.id);
  return {status:Math.abs(difference)<=p.tolerance&&!low.length?'RECONCILED':'REVIEW_REQUIRED',total,reported_total:p.reported_total,difference,normalized_total:number(total*p.unit_scale),currency:p.currency,period:p.period,low_confidence_rows:low,locators:items.map(r=>({id:r.id,document_id:p.document_id,locator:r.locator})),document_extraction_performed:false};
}

async function lineage(p){
  fields(p,['sources','claims','as_of','max_age_seconds']);const at=instant(p.as_of);number(p.max_age_seconds,'maximum age',{minimum:0});
  const sources=new Map();for(const s of rows(p.sources)){fields(s,['id','content','captured_at','state']);text(s.id);requireValue(['ACTIVE','DELETED'].includes(s.state),'source state invalid');requireValue(!sources.has(s.id),'duplicate source');const captured=instant(s.captured_at);requireValue(captured<=at,'source captured after as-of');sources.set(s.id,{sha256:await sha256Json(s.content),state:s.state,stale:at-captured>p.max_age_seconds*1000});}
  const claims=new Map();for(const c of rows(p.claims)){fields(c,['id','source_commitments','depends_on']);text(c.id);requireValue(!claims.has(c.id),'duplicate claim');rows(c.source_commitments,250,true);rows(c.depends_on,250,true).forEach(textId=>text(textId));unique(c.depends_on);claims.set(c.id,c);}
  const resolved=new Map(),active=new Set();
  function visit(id){if(resolved.has(id))return resolved.get(id);requireValue(claims.has(id),'unknown claim dependency');requireValue(!active.has(id),'claim dependency cycle');active.add(id);const c=claims.get(id),reasons=[];unique(c.source_commitments.map(r=>r.source_id));
    if(!c.source_commitments.length&&!c.depends_on.length)reasons.push('NO_SUPPORT');
    for(const ref of c.source_commitments){fields(ref,['source_id','sha256']);text(ref.source_id);requireValue(/^[a-f0-9]{64}$/.test(ref.sha256),'source commitment required');const s=sources.get(ref.source_id);if(!s)reasons.push('SOURCE_MISSING');else{if(s.sha256!==ref.sha256)reasons.push('SOURCE_CHANGED');if(s.state==='DELETED')reasons.push('SOURCE_DELETED');if(s.stale)reasons.push('SOURCE_STALE');}}
    for(const dep of c.depends_on)if(visit(dep).status!=='BOUND')reasons.push('DEPENDENCY_INVALIDATED');
    const result={id,status:reasons.length?'UNVERIFIED':'BOUND',reasons:[...new Set(reasons)].sort(),source_commitments:c.source_commitments,depends_on:c.depends_on,factual_entailment_verified:false};active.delete(id);resolved.set(id,result);return result;}
  return {claims:[...claims.keys()].sort().map(visit),source_content_bound:true,factual_entailment_verified:false};
}

function adjudicate(p){
  fields(p,['claim','sources']);text(p.claim,'claim',1000);
  const items=rows(p.sources).map(s=>{fields(s,['id','value','period','unit','basis','origin_id'],['supersedes']);['id','period','unit','basis','origin_id'].forEach(k=>text(s[k]));if(s.supersedes!==undefined)text(s.supersedes);return s;});unique(items.map(s=>s.id));
  const replaced=new Set();for(const s of items)if(s.supersedes){const old=items.find(x=>x.id===s.supersedes);requireValue(old&&old.origin_id===s.origin_id&&old.period===s.period&&old.unit===s.unit&&old.basis===s.basis,'invalid restatement lineage');let cursor=s,seen=new Set();while(cursor?.supersedes){requireValue(!seen.has(cursor.id),'restatement cycle');seen.add(cursor.id);cursor=items.find(x=>x.id===cursor.supersedes);}replaced.add(s.supersedes);}
  const current=items.filter(s=>!replaced.has(s.id)),definitions=new Set(current.map(s=>canonicalJson([s.period,s.unit,s.basis]))),values=new Set(current.map(s=>canonicalJson(s.value)));
  return {status:definitions.size>1?'NOT_COMPARABLE':values.size===1?'CONSISTENT':'UNRESOLVED',current_sources:current,restated_source_ids:[...replaced].sort(),distinct_origins:new Set(current.map(s=>s.origin_id)).size,selected_value:definitions.size===1&&values.size===1?current[0].value:null,truth_established:false};
}

function causal(p){
  fields(p,['equations','exogenous','interventions','outcome','assumptions']);text(p.outcome);rows(p.assumptions,50).forEach(a=>text(a,'structural assumption',1000));fields(p.exogenous,[],Object.keys(p.exogenous));fields(p.interventions,[],Object.keys(p.interventions));
  const eq=new Map();for(const e of rows(p.equations,100)){fields(e,['node','intercept','parents']);text(e.node);number(e.intercept);fields(e.parents,[],Object.keys(e.parents));Object.entries(e.parents).forEach(([k,v])=>{text(k);number(v);});requireValue(!eq.has(e.node),'duplicate structural node');eq.set(e.node,e);}
  Object.entries(p.exogenous).forEach(([k,v])=>{text(k);number(v);requireValue(!eq.has(k),'exogenous node conflicts with equation');});
  Object.entries(p.interventions).forEach(([k,v])=>{text(k);number(v);requireValue(eq.has(k)||Object.hasOwn(p.exogenous,k),'unknown intervention');});
  // Validate the original DAG even if an intervention would cut a cycle.
  const seen=new Set(),active=new Set();function check(id){if(seen.has(id))return;requireValue(!active.has(id),'causal cycle');if(!eq.has(id)){requireValue(Object.hasOwn(p.exogenous,id),'missing structural input');return;}active.add(id);Object.keys(eq.get(id).parents).forEach(check);active.delete(id);seen.add(id);}eq.forEach((e,k)=>check(k));requireValue(eq.has(p.outcome)||Object.hasOwn(p.exogenous,p.outcome),'unknown outcome');
  function solve(intervention){const values={...p.exogenous,...intervention};function get(id){if(Object.hasOwn(values,id))return values[id];const e=eq.get(id);return values[id]=sum([e.intercept,...Object.entries(e.parents).map(([parent,coefficient])=>coefficient*get(parent))]);}eq.forEach((e,k)=>get(k));return values;}
  const base=solve({}),changed=solve(p.interventions);return {baseline:base,intervention:changed,effect:number(changed[p.outcome]-base[p.outcome]),identification:'DECLARED_STRUCTURAL_MODEL_ONLY',empirical_causality_established:false};
}

function bayes(p){
  fields(p,['states'],['alternative_priors']);const items=rows(p.states,100).map(s=>{fields(s,['id','prior','likelihood']);text(s.id);number(s.prior,'prior',{minimum:0,maximum:1});number(s.likelihood,'likelihood',{minimum:0,maximum:1});return s;});unique(items.map(s=>s.id));probabilities(items.map(s=>s.prior));
  const update=priors=>{const logs=items.map((s,i)=>priors[i]&&s.likelihood?Math.log(priors[i])+Math.log(s.likelihood):-Infinity),largest=Math.max(...logs);requireValue(Number.isFinite(largest),'evidence has zero probability under all states');const relative=logs.map(x=>Math.exp(x-largest)),total=sum(relative);return {posterior:Object.fromEntries(items.map((s,i)=>[s.id,relative[i]/total])),log_evidence:largest+Math.log(total)};};
  const result=update(items.map(s=>s.prior));result.prior_sensitivity=rows(p.alternative_priors??[],20,true).map(priors=>{fields(priors,items.map(s=>s.id));const values=items.map(s=>priors[s.id]);probabilities(values);return {prior:priors,...update(values)};});return {...result,inference:'SUPPLIED_PRIORS_AND_LIKELIHOODS'};
}

function monteCarlo(p){
  fields(p,['scenarios','samples','seed','tail_probability']);const scenarios=rows(p.scenarios,100).map(s=>{fields(s,['value','probability']);number(s.value);number(s.probability);return s;});probabilities(scenarios.map(s=>s.probability));number(p.samples,'sample count',{minimum:2,maximum:100000,integer:true});number(p.seed,'seed',{minimum:0,maximum:4294967295,integer:true});number(p.tail_probability,'tail probability',{minimum:Number.MIN_VALUE,maximum:1});
  // Mulberry32: fixed integer recurrence, deterministic within this version.
  let seed=p.seed>>>0;const random=()=>{seed=(seed+0x6D2B79F5)>>>0;let x=seed;x=Math.imul(x^(x>>>15),x|1);x^=x+Math.imul(x^(x>>>7),x|61);return ((x^(x>>>14))>>>0)/4294967296;};
  const cumulative=[];let c=0;for(const s of scenarios){c+=s.probability;cumulative.push(c);}const draws=[];
  for(let i=0;i<p.samples;i++){const u=random();let at=cumulative.findIndex(v=>u<v);if(at===-1)at=scenarios.length-1;draws.push(scenarios[at].value);}
  const sample_mean=sum(draws)/draws.length,variance=sum(draws.map(x=>(x-sample_mean)**2))/(draws.length-1),sorted=[...draws].sort((a,b)=>a-b),quantile=sorted[Math.max(0,Math.ceil(p.tail_probability*sorted.length)-1)];
  const lower=Math.min(...scenarios.filter(s=>s.probability>0).map(s=>s.value)),upper=Math.max(...scenarios.filter(s=>s.probability>0).map(s=>s.value)),half=Math.floor(draws.length/2);
  return {sample_mean,sample_variance:variance,exact_mean:sum(scenarios.map(s=>s.value*s.probability)),upper_quantile:quantile,quantile_definition:'EMPIRICAL_NEAREST_RANK',hoeffding_mean_error_95:(upper-lower)*Math.sqrt(Math.log(40)/(2*draws.length)),half_sample_mean_difference:Math.abs(sum(draws.slice(0,half))/half-sum(draws.slice(half))/(draws.length-half)),samples:p.samples,seed:p.seed,prng:'MULBERRY32_V1_NONCRYPTOGRAPHIC',scope:'IID_DRAWS_FROM_DECLARED_FINITE_SCENARIOS_NOT_A_FITTED_FORECAST'};
}

function calibration(p){
  fields(p,['forecasts','as_of','bins']);const at=instant(p.as_of);number(p.bins,'bin count',{minimum:1,maximum:100,integer:true});
  const data=rows(p.forecasts).map(r=>{fields(r,['id','probability','outcome','predicted_at','outcome_at']);text(r.id);number(r.probability,'forecast probability',{minimum:0,maximum:1});requireValue(r.outcome===0||r.outcome===1,'binary outcome required');requireValue(instant(r.predicted_at)<instant(r.outcome_at)&&instant(r.outcome_at)<=at,'prediction must precede observed outcome');return r;});unique(data.map(r=>r.id));
  const bins=Array.from({length:p.bins},(_,index)=>({index,count:0,probability_sum:0,outcome_sum:0}));for(const r of data){const b=bins[Math.min(Math.floor(r.probability*p.bins),p.bins-1)];b.count++;b.probability_sum+=r.probability;b.outcome_sum+=r.outcome;}
  const reliability=bins.filter(b=>b.count).map(b=>({index:b.index,count:b.count,mean_forecast:b.probability_sum/b.count,outcome_frequency:b.outcome_sum/b.count}));
  return {brier:sum(data.map(r=>(r.probability-r.outcome)**2))/data.length,ece:sum(reliability.map(b=>b.count/data.length*Math.abs(b.mean_forecast-b.outcome_frequency))),reliability,sample_count:data.length,scope:'SUPPLIED_TIMESTAMPED_FORECASTS_NOT_PROOF_OF_ORIGINAL_FORECAST_CUSTODY'};
}

function forensics(p){
  fields(p,['currency','period','assets','liabilities','equity','net_income','operating_cash_flow','revenue','receivables_begin','receivables_end','balance_tolerance','accrual_ratio_threshold','receivables_growth_threshold']);unit(p.currency);text(p.period);
  for(const k of ['assets','liabilities','revenue','receivables_begin','receivables_end','balance_tolerance','accrual_ratio_threshold','receivables_growth_threshold'])number(p[k],k,{minimum:0});for(const k of ['equity','net_income','operating_cash_flow'])number(p[k]);
  const balance_gap=p.assets-p.liabilities-p.equity,accruals=p.net_income-p.operating_cash_flow,accrual_ratio=p.assets>0?accruals/p.assets:null,receivables_growth=p.receivables_begin>0?(p.receivables_end-p.receivables_begin)/p.receivables_begin:null,flags=[];
  if(Math.abs(balance_gap)>p.balance_tolerance)flags.push('BALANCE_RECONCILIATION_GAP');if(accrual_ratio!==null&&accrual_ratio>p.accrual_ratio_threshold)flags.push('CASH_EARNINGS_DIVERGENCE');if(receivables_growth!==null&&receivables_growth>p.receivables_growth_threshold)flags.push('RECEIVABLES_GROWTH');
  return {balance_gap,accruals,accrual_ratio,receivables_growth,undefined_ratios:[...(accrual_ratio===null?['ACCRUAL_RATIO_ZERO_ASSETS']:[]),...(receivables_growth===null?['RECEIVABLES_GROWTH_ZERO_BASE']:[])],flags,fraud_established:false,benign_alternatives:['Working-capital timing','Growth or seasonality','Consolidation or restatement','Different accounting classifications'],currency:p.currency,period:p.period};
}

function projectFinance(p){
  fields(p,['currency','period_unit','discount_rate','periods']);unit(p.currency);requireValue(['month','year'].includes(p.period_unit),'period unit must be month or year');number(p.discount_rate,'rate per period',{minimum:-1+Number.EPSILON});
  const schedule=rows(p.periods,120).map((r,i)=>{fields(r,['period','revenue','opex','tax','capex','debt_service','debt_draw','working_capital_change']);requireValue(r.period===i,'contiguous periods must begin at zero');for(const key of ['revenue','opex','capex','debt_service','debt_draw'])number(r[key],key,{minimum:0});number(r.tax);number(r.working_capital_change);const cfads=r.revenue-r.opex-r.tax-r.working_capital_change,project_cashflow=cfads-r.capex,equity_cashflow=project_cashflow-r.debt_service+r.debt_draw;return {period:i,cfads,project_cashflow,equity_cashflow,dscr:r.debt_service>0?cfads/r.debt_service:null,coverage_status:r.debt_service>0?'DEFINED':'NO_DEBT_SERVICE'};});
  const npv=key=>sum(schedule.map(r=>r[key]/(1+p.discount_rate)**r.period));return {project_npv:npv('project_cashflow'),equity_cashflow_npv:npv('equity_cashflow'),coverage:schedule,currency:p.currency,rate_basis:p.period_unit,terminal_debt_balance_verified:false,scope:'SUPPLIED_CASHFLOW_SCHEDULE_NO_IMPLICIT_TAX_FX_OR_DEBT_MODEL'};
}

function assetLiability(p){
  fields(p,['currency','annual_yield','rate_shock','bucket_ends','cashflows']);unit(p.currency);number(p.annual_yield,'yield',{minimum:-1+Number.EPSILON});number(p.rate_shock,'shock',{minimum:0,maximum:1});requireValue(p.annual_yield-p.rate_shock>-1,'downward shocked yield must exceed -1');
  const ends=rows(p.bucket_ends,100).map(x=>number(x,'bucket boundary',{minimum:0}));requireValue(ends.every((x,i)=>i===0||x>ends[i-1]),'bucket ends must increase');
  const flows=rows(p.cashflows).map(r=>{fields(r,['id','side','time_years','amount']);text(r.id);requireValue(['asset','liability'].includes(r.side),'side must be asset or liability');number(r.time_years,'time',{minimum:0,maximum:100});number(r.amount,'amount',{minimum:0});return r;});unique(flows.map(r=>r.id));
  const pv=(side,y)=>sum(flows.filter(r=>r.side===side).map(r=>r.amount/(1+y)**r.time_years)),assets=pv('asset',p.annual_yield),liabilities=pv('liability',p.annual_yield);
  const dollarDuration=side=>sum(flows.filter(r=>r.side===side).map(r=>r.time_years*r.amount/(1+p.annual_yield)**(r.time_years+1)));
  const liquidity=ends.map(end=>{const a=sum(flows.filter(r=>r.side==='asset'&&r.time_years<=end).map(r=>r.amount)),l=sum(flows.filter(r=>r.side==='liability'&&r.time_years<=end).map(r=>r.amount));return {end_years:end,cumulative_assets:a,cumulative_liabilities:l,cumulative_gap:a-l};});
  return {asset_present_value:assets,liability_present_value:liabilities,surplus_present_value:assets-liabilities,surplus_pv01:-(dollarDuration('asset')-dollarDuration('liability'))*.0001,up_shock_surplus:pv('asset',p.annual_yield+p.rate_shock)-pv('liability',p.annual_yield+p.rate_shock),down_shock_surplus:pv('asset',p.annual_yield-p.rate_shock)-pv('liability',p.annual_yield-p.rate_shock),liquidity,currency:p.currency,scope:'FIXED_CASHFLOWS_COMMON_PARALLEL_YIELD_NO_DEFAULT_OR_OPTIONALITY'};
}

function inventory(p){
  fields(p,['demand','order_quantities','underage_cost','overage_cost']);number(p.underage_cost,'underage cost',{minimum:0});number(p.overage_cost,'overage cost',{minimum:0});const demand=rows(p.demand,100).map(r=>{fields(r,['quantity','probability']);number(r.quantity,'demand',{minimum:0,integer:true});number(r.probability);return r;});probabilities(demand.map(r=>r.probability));unique(demand.map(r=>r.quantity));const orders=rows(p.order_quantities,100).map(q=>number(q,'order quantity',{minimum:0,integer:true}));unique(orders);
  const mean=sum(demand.map(r=>r.quantity*r.probability)),options=orders.sort((a,b)=>a-b).map(quantity=>{const shortage=sum(demand.map(r=>Math.max(0,r.quantity-quantity)*r.probability)),surplus=sum(demand.map(r=>Math.max(0,quantity-r.quantity)*r.probability));return {quantity,expected_cost:shortage*p.underage_cost+surplus*p.overage_cost,cycle_service_level:sum(demand.filter(r=>r.quantity<=quantity).map(r=>r.probability)),expected_fill_rate:mean>0?1-shortage/mean:null};}),best=Math.min(...options.map(r=>r.expected_cost));
  return {optimal_quantities:options.filter(r=>Math.abs(r.expected_cost-best)<=1e-10*Math.max(1,best)).map(r=>r.quantity),options,critical_fractile:p.underage_cost+p.overage_cost>0?p.underage_cost/(p.underage_cost+p.overage_cost):null,order_placed:false,scope:'SINGLE_PERIOD_DECLARED_DISCRETE_DEMAND_AND_FEASIBLE_ORDER_GRID'};
}

function reliability(p){
  fields(p,['observations','hypotheses','tests']);const observations=rows(p.observations,100).map(r=>{fields(r,['event','value','source_ref']);text(r.event);text(r.source_ref,'source reference',300);requireValue([true,false,null].includes(r.value),'observation must be boolean or unknown');return r;});unique(observations.map(r=>r.event));
  const hypotheses=rows(p.hypotheses,100).map(h=>{fields(h,['id','predicts']);text(h.id);fields(h.predicts,[],Object.keys(h.predicts));requireValue(Object.keys(h.predicts).length>0,'nonempty hypothesis predictions required');Object.entries(h.predicts).forEach(([event,v])=>{text(event);requireValue(typeof v==='boolean','binary prediction required');});return h;});unique(hypotheses.map(h=>h.id));
  const survivors=hypotheses.filter(h=>!observations.some(o=>o.value!==null&&Object.hasOwn(h.predicts,o.event)&&h.predicts[o.event]!==o.value)),excluded=hypotheses.filter(h=>!survivors.includes(h)).map(h=>({id:h.id,contradictions:observations.filter(o=>o.value!==null&&Object.hasOwn(h.predicts,o.event)&&h.predicts[o.event]!==o.value).map(o=>o.source_ref)}));
  const tests=rows(p.tests,100,true).map(t=>{fields(t,['id','event','cost']);text(t.id);text(t.event);number(t.cost,'test cost',{minimum:0});return t;});unique(tests.map(t=>t.id));
  const choices=tests.filter(t=>!observations.some(o=>o.event===t.event&&o.value!==null)).map(t=>{const yes=survivors.filter(h=>h.predicts[t.event]===true).length,no=survivors.filter(h=>h.predicts[t.event]===false).length;return {...t,split_score:Math.min(yes,no),unknown_predictions:survivors.length-yes-no};}).filter(t=>t.split_score>0).sort((a,b)=>b.split_score-a.split_score||a.cost-b.cost||a.id.localeCompare(b.id));
  return {status:survivors.length?'HYPOTHESES_REMAIN':'MODEL_INCONSISTENT',surviving_hypotheses:survivors.map(h=>h.id).sort(),excluded,next_tests:choices,cause_proven:false,ranking_rule:'MAXIMIZE_MINIMUM_KNOWN_PARTITION_THEN_COST_NOT_A_PROBABILITY'};
}

function twin(p){
  fields(p,['calibration_end','observations','operating_range','absolute_tolerance','relative_tolerance']);const end=instant(p.calibration_end);number(p.absolute_tolerance,'absolute tolerance',{minimum:0});number(p.relative_tolerance,'relative tolerance',{minimum:0});fields(p.operating_range,['minimum','maximum']);number(p.operating_range.minimum);number(p.operating_range.maximum);requireValue(p.operating_range.minimum<=p.operating_range.maximum,'operating range inverted');
  const data=rows(p.observations).map(r=>{fields(r,['id','at','input','observed','predicted']);text(r.id);requireValue(instant(r.at)>end,'validation must be after calibration');number(r.input);number(r.observed);number(r.predicted);return {...r,residual:r.predicted-r.observed,in_range:r.input>=p.operating_range.minimum&&r.input<=p.operating_range.maximum};});unique(data.map(r=>r.id));
  const outside=data.filter(r=>!r.in_range).map(r=>r.id),failed=data.filter(r=>Math.abs(r.residual)>p.absolute_tolerance+p.relative_tolerance*Math.abs(r.observed)).map(r=>r.id);
  return {status:outside.length?'OUT_OF_OPERATING_RANGE':failed.length?'VALIDATION_FAILED':'WITHIN_DECLARED_TOLERANCE',rmse:Math.sqrt(sum(data.map(r=>r.residual**2))/data.length),mean_residual:sum(data.map(r=>r.residual))/data.length,failed_observations:failed,outside_observations:outside,validated_range:p.operating_range,scope:'SUPPLIED_HELD_OUT_PAIRS_NOT_INDEPENDENT_SIMULATOR_OR_DATA_CUSTODY'};
}

function getPath(value,path){for(const key of rows(path,20,true)){requireValue(typeof key==='string'||Number.isSafeInteger(key),'path keys required');requireValue(!['__proto__','constructor','prototype'].includes(key)&&value!==null&&typeof value==='object'&&Object.hasOwn(value,key),'missing or forbidden result path');value=value[key];}return value;}
async function pipeline(p){
  fields(p,['stages','checks']);const stages=rows(p.stages,20).map(s=>{fields(s,['id','workflow','data','depends_on','bindings']);text(s.id);requireValue(ANALYTICAL_WORKFLOWS.includes(s.workflow)&&s.workflow!=='analytical-pipeline','unregistered or recursive pipeline workflow');rows(s.depends_on,20,true).forEach(id=>text(id));unique(s.depends_on);rows(s.bindings,20,true);return s;});unique(stages.map(s=>s.id));
  const byId=new Map(stages.map(s=>[s.id,s])),resolved=new Map(),visiting=new Set();
  async function visit(id){if(resolved.has(id))return resolved.get(id);requireValue(byId.has(id),'missing pipeline dependency');requireValue(!visiting.has(id),'pipeline dependency cycle');visiting.add(id);const s=byId.get(id);for(const dep of s.depends_on)await visit(dep);const data=structuredClone(s.data);requireValue(data&&typeof data==='object'&&!Array.isArray(data),'stage data must be object');
    unique(s.bindings.map(b=>b.field));for(const b of s.bindings){fields(b,['field','stage_id','path']);text(b.field);requireValue(!Object.hasOwn(data,b.field)&&s.depends_on.includes(b.stage_id),'binding may only fill an absent field from a declared dependency');data[b.field]=structuredClone(getPath(resolved.get(b.stage_id).result,b.path));}
    const output=await evaluateAnalyticalWorkflow({workflow:s.workflow,data});visiting.delete(id);resolved.set(id,output);return output;}
  for(const id of [...byId.keys()].sort())await visit(id);
  const checks=rows(p.checks,100,true).map(c=>{fields(c,['stage_id','path','expected','absolute_tolerance']);number(c.absolute_tolerance,'oracle tolerance',{minimum:0});requireValue(resolved.has(c.stage_id),'unknown checked stage');return {...c,pass:equal(getPath(resolved.get(c.stage_id).result,c.path),c.expected,c.absolute_tolerance)};});
  return {stages:Object.fromEntries([...resolved].sort(([a],[b])=>a.localeCompare(b))),checks,status:!checks.length?'UNVERIFIED':checks.every(c=>c.pass)?'DECLARED_CHECKS_PASS':'CHECK_FAILED',external_code_executed:false};
}

function benchmark(p){
  fields(p,['runs','absolute_tolerance']);number(p.absolute_tolerance,'oracle tolerance',{minimum:0});const runs=rows(p.runs,250).map(r=>{fields(r,['case_id','system','split','input_sha256','expected','actual','cost','latency_ms','contaminated']);text(r.case_id);text(r.system);requireValue(['development','holdout'].includes(r.split),'benchmark split invalid');requireValue(/^[a-f0-9]{64}$/.test(r.input_sha256),'sealed input digest required');number(r.cost,'cost',{minimum:0});number(r.latency_ms,'latency',{minimum:0});requireValue(typeof r.contaminated==='boolean','contamination label required');return r;});unique(runs.map(r=>canonicalJson([r.system,r.case_id])));
  const holdout=runs.filter(r=>r.split==='holdout');requireValue(holdout.length>0,'holdout observations required');requireValue(holdout.every(r=>!r.contaminated),'contaminated holdout cannot qualify');
  for(const id of new Set(runs.map(r=>r.case_id))){const matched=runs.filter(r=>r.case_id===id);requireValue(new Set(matched.map(r=>r.split)).size===1,'same case cannot be development and holdout');requireValue(new Set(matched.map(r=>r.input_sha256)).size===1&&matched.every(r=>equal(r.expected,matched[0].expected,0)),'comparators require identical sealed task and oracle');}
  const systems=[...new Set(holdout.map(r=>r.system))].sort(),ids=holdout.filter(r=>r.system===systems[0]).map(r=>r.case_id).sort();
  const results=systems.map(system=>{const current=holdout.filter(r=>r.system===system);requireValue(equal(current.map(r=>r.case_id).sort(),ids),'comparators must cover exactly the same holdout cases');return {system,cases:current.length,correct:current.filter(r=>equal(r.expected,r.actual,p.absolute_tolerance)).length,cost:sum(current.map(r=>r.cost)),latency_ms:sum(current.map(r=>r.latency_ms))};});
  return {systems:results,holdout_cases:ids,excluded_development_runs:runs.length-holdout.length,independent_execution_verified:false,superiority_claim_authorized:false,scope:'REPLAY_OF_SUPPLIED_RUN_RECORDS_ONLY'};
}

const handlers=Object.freeze({'document-reconciliation':reconcile,'claim-lineage':lineage,'source-adjudication':adjudicate,'causal-policy':causal,'bayesian-updating':bayes,'monte-carlo-uncertainty':monteCarlo,'forecast-calibration':calibration,'statement-forensics':forensics,'project-finance':projectFinance,'asset-liability':assetLiability,'inventory-decisions':inventory,'reliability-investigation':reliability,'twin-validation':twin,'analytical-pipeline':pipeline,'benchmark-evaluation':benchmark});

export async function evaluateAnalyticalWorkflow(input){
  fields(input,['workflow','data']);requireValue(ANALYTICAL_WORKFLOWS.includes(input.workflow),'unregistered analytical workflow');
  const serialized=canonicalJson(input);requireValue(new TextEncoder().encode(serialized).length<=131072,'analytical input exceeds byte bound');
  const snapshot=JSON.parse(serialized),result=JSON.parse(canonicalJson(await handlers[snapshot.workflow](snapshot.data)));
  return {schema:'musitu.axiom.analytical-workflow.v1',implementation_id:ANALYTICAL_IMPLEMENTATION_ID,workflow:snapshot.workflow,input_sha256:await sha256Json(snapshot),result,verification_scope:scope,external_actions_performed:false};
}
