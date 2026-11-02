// Pure finite-state decision analysis. No authority, provider or I/O adapter.
const FORMAT='musitu.axiom.decision-input-f64be.v1';
const MAX_RANGE_ACTIONS=20; // Bound the quadratic exact-threshold proof before persistence.
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fields=(value,required,optional=[])=>{
  if(!object(value)||required.some(key=>!Object.hasOwn(value,key))||Object.keys(value).some(key=>![...required,...optional].includes(key)))throw new TypeError('invalid or missing decision fields');
  return value;
};
const number=(value,name)=>{
  if(typeof value!=='number'||!Number.isFinite(value)||(Number.isInteger(value)&&!Number.isSafeInteger(value)))throw new TypeError(`${name} must be a finite cross-runtime number`);
  return Object.is(value,-0)?0:value;
};
const text=(value,name,limit=2000)=>{
  if(typeof value!=='string'||!value.trim()||[...value].length>limit||!value.isWellFormed())throw new TypeError(`nonempty ${name} required within ${limit} characters`);
  return value;
};
const rows=(value,name)=>{
  if(!Array.isArray(value)||value.length<1||value.length>100)throw new TypeError(`${name} must contain 1..100 rows`);
  return value;
};
const id=value=>{if(typeof value!=='string'||!/^[A-Za-z0-9_.:-]{1,100}$/.test(value))throw new TypeError('invalid decision identifier');return value;};
const sum=values=>{
  let total=0,compensation=0;
  for(const value of values){const adjusted=value-compensation,next=total+adjusted;compensation=(next-total)-adjusted;total=next;}
  if(!Number.isFinite(total))throw new RangeError('decision arithmetic exceeds finite range');
  return total===0?0:total;
};
const difference=(high,low)=>{
  const result=high-low,tolerance=1e-10*Math.max(1,Math.abs(high),Math.abs(low));
  if(!Number.isFinite(result)||result < -tolerance)throw new RangeError('invalid information-value calculation');
  return Math.max(0,result);
};
const byId=(a,b)=>a.id<b.id?-1:a.id>b.id?1:0;
const entries=items=>Object.fromEntries(items);
const commitment=value=>{
  if(typeof value==='number'){
    const bytes=new Uint8Array(8);new DataView(bytes.buffer).setFloat64(0,value,false);
    return {number_f64be:[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('')};
  }
  if(Array.isArray(value))return value.map(commitment);
  if(object(value))return entries(Object.keys(value).sort().map(key=>[key,commitment(value[key])]));
  return value;
};
const canonical=value=>{
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  if(object(value))return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};

export function normalizeDecision(problem){
  fields(problem,['states','actions','utility_unit','assumptions','evidence_refs'],['signal_model','information_cost','probability_range']);
  const states=rows(problem.states,'states').map(raw=>{
    fields(raw,['id','probability']);const probability=number(raw.probability,'probability');
    if(probability<0||probability>1)throw new RangeError('probabilities must be in [0,1]');
    return {id:id(raw.id),probability};
  }).sort(byId),ids=states.map(row=>row.id);
  if(new Set(ids).size!==ids.length||Math.abs(sum(states.map(row=>row.probability))-1)>1e-10)throw new RangeError('state ids must be unique and probabilities must sum to 1');
  const actions=rows(problem.actions,'actions').map(raw=>{
    fields(raw,['id','utilities']);fields(raw.utilities,ids);
    return {id:id(raw.id),utilities:entries(ids.map(key=>[key,number(raw.utilities[key],'utility')]))};
  }).sort(byId);
  if(new Set(actions.map(row=>row.id)).size!==actions.length)throw new TypeError('action ids must be unique');
  const assumptions=rows(problem.assumptions,'assumptions').map(value=>text(value,'assumption'));
  if(!Array.isArray(problem.evidence_refs)||problem.evidence_refs.length>200)throw new TypeError('evidence_refs must be a bounded list');
  const refs=problem.evidence_refs.map(value=>text(value,'evidence reference',240));
  if(new Set(refs).size!==refs.length)throw new TypeError('evidence references must be unique');
  const cost=number(problem.information_cost??0,'information cost');
  if(cost<0)throw new RangeError('information cost must be nonnegative');
  let signalModel=null;
  if(problem.signal_model!==null&&problem.signal_model!==undefined){
    fields(problem.signal_model,['signals']);
    const signals=rows(problem.signal_model.signals,'signals').map(raw=>{
      fields(raw,['id','likelihoods']);fields(raw.likelihoods,ids);
      const likelihoods=entries(ids.map(key=>[key,number(raw.likelihoods[key],'signal likelihood')]));
      if(Object.values(likelihoods).some(value=>value<0||value>1))throw new RangeError('signal likelihoods must be in [0,1]');
      return {id:id(raw.id),likelihoods};
    }).sort(byId);
    if(new Set(signals.map(row=>row.id)).size!==signals.length||ids.some(key=>Math.abs(sum(signals.map(row=>row.likelihoods[key]))-1)>1e-10))throw new RangeError('conditional signal likelihoods must sum to 1 for each state; ids must be unique');
    signalModel={signals};
  }else if(cost)throw new RangeError('information cost requires a signal model');
  const value={states,actions,utility_unit:text(problem.utility_unit,'utility unit',80),assumptions,evidence_refs:refs,signal_model:signalModel,information_cost:cost};
  if(Object.hasOwn(problem,'probability_range')){
    if(actions.length>MAX_RANGE_ACTIONS)throw new RangeError('probability_range supports at most 20 actions');
    const bounds=fields(problem.probability_range,['state_id','lower','upper']),selected=id(bounds.state_id);
    const lower=number(bounds.lower,'probability lower bound'),upper=number(bounds.upper,'probability upper bound');
    if(states.length!==2||!ids.includes(selected))throw new TypeError('probability_range requires exactly two states and an existing state_id');
    if(lower<0||lower>upper||upper>1)throw new RangeError('probability bounds must satisfy 0 <= lower <= upper <= 1');
    const baseline=states.find(row=>row.id===selected).probability;
    if(baseline<lower||baseline>upper)throw new RangeError('baseline selected-state probability must lie within probability_range');
    if(signalModel!==null)throw new TypeError('probability_range does not support signal models or robust information value');
    value.probability_range={state_id:selected,lower,upper};
  }
  return value;
}

// Exact rational arithmetic over the declared binary64 inputs prevents a
// rounded display threshold (for example 1/3) from inventing an endpoint tie.
const absBig=value=>value<0n?-value:value;
const gcd=(first,second)=>{let a=absBig(first),b=absBig(second);while(b){const r=a%b;a=b;b=r;}return a;};
const rational=(numerator,denominator=1n)=>{
  if(denominator===0n)throw new RangeError('zero rational denominator');
  const sign=denominator<0n?-1n:1n,divisor=gcd(numerator,denominator);
  return {n:sign*numerator/divisor,d:sign*denominator/divisor};
};
const rationalOf=value=>{
  if(value===0)return rational(0n);
  const bytes=new ArrayBuffer(8),view=new DataView(bytes);view.setFloat64(0,value,false);
  const bits=view.getBigUint64(0,false),negative=(bits>>63n)!==0n,exponent=Number((bits>>52n)&2047n),fraction=bits&((1n<<52n)-1n);
  const significand=exponent===0?fraction:fraction+(1n<<52n),power=exponent===0?-1074:exponent-1075,sign=negative?-1n:1n;
  return power>=0?rational(sign*(significand<<BigInt(power))):rational(sign*significand,1n<<BigInt(-power));
};
const rAdd=(a,b)=>rational(a.n*b.d+b.n*a.d,a.d*b.d);
const rSub=(a,b)=>rational(a.n*b.d-b.n*a.d,a.d*b.d);
const rMul=(a,b)=>rational(a.n*b.n,a.d*b.d);
const rDiv=(a,b)=>rational(a.n*b.d,a.d*b.n);
const rCmp=(a,b)=>{const difference=a.n*b.d-b.n*a.d;return difference<0n?-1:difference>0n?1:0;};
const rNeg=a=>({n:-a.n,d:a.d});
const roundedQuotient=(n,d)=>{let q=n/d;const remainder=(n%d)*2n;if(remainder>d||(remainder===d&&q%2n!==0n))q++;return q;};
const rationalNumber=value=>{
  if(value.n===0n)return 0;
  const sign=value.n<0n?-1:1,n=absBig(value.n),d=value.d;
  let exponent=n.toString(2).length-d.toString(2).length;
  if(exponent>=0?n<(d<<BigInt(exponent)):(n<<BigInt(-exponent))<d)exponent--;
  if(exponent>1023)return null;
  if(exponent< -1075)return 0;
  let result;
  if(exponent< -1022)result=Number(roundedQuotient(n<<1074n,d))*Number.MIN_VALUE;
  else{
    const shift=52-exponent,quotient=shift>=0?roundedQuotient(n<<BigInt(shift),d):roundedQuotient(n,d<<BigInt(-shift));
    result=Number(quotient)*2**(exponent-52);
  }
  return Number.isFinite(result)?(result===0?0:sign*result):null;
};

function probabilityRobustness(value){
  const bounds=value.probability_range,selected=bounds.state_id,complement=value.states.find(row=>row.id!==selected).id;
  const lower=rationalOf(bounds.lower),upper=rationalOf(bounds.upper),zero=rational(0n),one=rational(1n);
  const keys=value.actions.map(action=>action.id),lines=entries(value.actions.map(action=>{
    const intercept=rationalOf(action.utilities[complement]);
    return [action.id,{intercept,slope:rSub(rationalOf(action.utilities[selected]),intercept)}];
  }));
  const at=(line,probability)=>rAdd(line.intercept,rMul(line.slope,probability));
  const optimal=probability=>{
    const utilities=keys.map(key=>[key,at(lines[key],probability)]);
    const best=utilities.reduce((value,row)=>rCmp(row[1],value)>0?row[1]:value,utilities[0][1]);
    return utilities.filter(row=>rCmp(row[1],best)===0).map(row=>row[0]);
  };
  const utilityRangeRows=[],possible=[];
  for(const key of keys){
    const line=lines[key];
    const start=at(line,lower),end=at(line,upper),increasing=rCmp(start,end)<=0;
    utilityRangeRows.push([key,{at_lower:rationalNumber(start),at_upper:rationalNumber(end),minimum:rationalNumber(increasing?start:end),maximum:rationalNumber(increasing?end:start)}]);
    // Intersect pairwise affine inequalities to retain actions which are
    // optimal only in the interior, not just winners at the two endpoints.
    let feasibleLower=lower,feasibleUpper=upper,feasible=true;
    for(const otherKey of keys){
      const other=lines[otherKey];
      const intercept=rSub(line.intercept,other.intercept),slope=rSub(line.slope,other.slope);
      if(slope.n===0n){if(intercept.n<0n){feasible=false;break;}}
      else{
        const threshold=rDiv(rNeg(intercept),slope);
        if(slope.n>0n){if(rCmp(threshold,feasibleLower)>0)feasibleLower=threshold;}
        else if(rCmp(threshold,feasibleUpper)<0)feasibleUpper=threshold;
      }
    }
    if(feasible&&rCmp(feasibleLower,feasibleUpper)<=0)possible.push(key);
  }
  const thresholds=[];
  for(let index=0;index<keys.length;index++)for(const second of keys.slice(index+1)){
    const first=keys[index],intercept=rSub(lines[first].intercept,lines[second].intercept),slope=rSub(lines[first].slope,lines[second].slope);
    if(slope.n===0n){
      const identical=intercept.n===0n;
      thresholds.push({actions:[first,second],relation:identical?'IDENTICAL':'PARALLEL',probability:null,exact_probability:null,in_unit_interval:identical,in_range:identical});
    }else{
      const threshold=rDiv(rNeg(intercept),slope);
      thresholds.push({actions:[first,second],relation:'CROSSING',probability:rationalNumber(threshold),exact_probability:{numerator:threshold.n.toString(),denominator:threshold.d.toString()},
        in_unit_interval:rCmp(threshold,zero)>=0&&rCmp(threshold,one)<=0,in_range:rCmp(threshold,lower)>=0&&rCmp(threshold,upper)<=0});
    }
  }
  const atLower=optimal(lower),atUpper=optimal(upper);
  return {schema:'musitu.axiom.decision-probability-robustness.v1',scope:'TWO_STATE_EXPECTED_UTILITY_ONLY',state_id:selected,complement_state_id:complement,
    complement_probability_rule:'P(complement_state_id)=1-P(state_id)',lower:bounds.lower,upper:bounds.upper,utility_ranges:entries(utilityRangeRows),
    optimal_at_lower:atLower,optimal_at_upper:atUpper,robust_optimal_actions:atLower.filter(key=>atUpper.includes(key)),possible_optimal_actions:possible,
    robust_optimal_definition:'EXPECTED_UTILITY_OPTIMAL_THROUGHOUT_CLOSED_RANGE',pairwise_break_even:thresholds,comparison_arithmetic:'EXACT_RATIONALS_OF_DECLARED_BINARY64_INPUTS',probabilities_empirically_validated:false};
}

export async function evaluateDecision(problem){
  const value=normalizeDecision(problem),{states,actions}=value;
  const expected=entries(actions.map(action=>[action.id,sum(states.map(state=>state.probability*action.utilities[state.id]))]));
  const actionIds=Object.hasOwn(value,'probability_range')?actions.map(action=>action.id):Object.keys(expected);
  const best=Math.max(...Object.values(expected)),winners=actionIds.filter(key=>expected[key]===best);
  const bestByState=entries(states.map(state=>[state.id,Math.max(...actions.map(action=>action.utilities[state.id]))]));
  const perfect=sum(states.map(state=>state.probability*bestByState[state.id]));
  const regrets=entries(actions.map(action=>[action.id,entries(states.map(state=>[state.id,difference(bestByState[state.id],action.utilities[state.id])]))]));
  const maxima=entries(Object.entries(regrets).map(([key,row])=>[key,Math.max(...Object.values(row))]));
  const minimum=Math.min(...Object.values(maxima)),minimax=actionIds.find(key=>maxima[key]===minimum),evpi=difference(perfect,best);
  const signalPolicy=[];let sample=null,evsi=null,net=null;
  if(value.signal_model!==null){
    const pieces=[];
    for(const signal of value.signal_model.signals){
      const probability=sum(states.map(state=>state.probability*signal.likelihoods[state.id]));
      if(probability===0){signalPolicy.push({signal_id:signal.id,probability:0,posterior:null,recommended_action:null,expected_utility:null});continue;}
      const joint=entries(actions.map(action=>[action.id,sum(states.map(state=>state.probability*signal.likelihoods[state.id]*action.utilities[state.id]))]));
      const maximum=Math.max(...Object.values(joint));pieces.push(maximum);
      signalPolicy.push({signal_id:signal.id,probability,posterior:entries(states.map(state=>[state.id,state.probability*signal.likelihoods[state.id]/probability])),recommended_action:Object.keys(joint).find(key=>joint[key]===maximum),expected_utility:maximum/probability});
    }
    sample=sum(pieces);evsi=Math.min(evpi,difference(sample,best));net=sum([evsi,-value.information_cost]);
  }
  const body=canonical({format:FORMAT,problem:commitment(value)});
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body));
  const result={schema:'musitu.axiom.decision-analysis.v1',expected_utilities:expected,recommended_action:winners[0],tied_recommendations:winners,max_expected_utility:best,
    regrets,max_regret:maxima,minimax_regret:{action:minimax,value:minimum},expected_value_with_perfect_information:perfect,evpi,
    expected_value_with_sample_information:sample,evsi,net_evsi:net,signal_policy:signalPolicy,utility_unit:value.utility_unit,assumptions:value.assumptions,evidence_refs:value.evidence_refs,
    input_sha256:[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join(''),commitment_format:FORMAT,
    recommendation_only:true,authority_granted:false,source_evidence_verified:false};
  if(Object.hasOwn(value,'probability_range'))result.robustness=probabilityRobustness(value);
  return result;
}
