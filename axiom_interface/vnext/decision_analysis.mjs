// Pure finite-state decision analysis. No authority, provider or I/O adapter.
const FORMAT='musitu.axiom.decision-input-f64be.v1';
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
  fields(problem,['states','actions','utility_unit','assumptions','evidence_refs'],['signal_model','information_cost']);
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
  return {states,actions,utility_unit:text(problem.utility_unit,'utility unit',80),assumptions,evidence_refs:refs,signal_model:signalModel,information_cost:cost};
}

export async function evaluateDecision(problem){
  const value=normalizeDecision(problem),{states,actions}=value;
  const expected=entries(actions.map(action=>[action.id,sum(states.map(state=>state.probability*action.utilities[state.id]))]));
  const best=Math.max(...Object.values(expected)),winners=Object.keys(expected).filter(key=>expected[key]===best);
  const bestByState=entries(states.map(state=>[state.id,Math.max(...actions.map(action=>action.utilities[state.id]))]));
  const perfect=sum(states.map(state=>state.probability*bestByState[state.id]));
  const regrets=entries(actions.map(action=>[action.id,entries(states.map(state=>[state.id,difference(bestByState[state.id],action.utilities[state.id])]))]));
  const maxima=entries(Object.entries(regrets).map(([key,row])=>[key,Math.max(...Object.values(row))]));
  const minimum=Math.min(...Object.values(maxima)),minimax=Object.keys(maxima).find(key=>maxima[key]===minimum),evpi=difference(perfect,best);
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
  return {schema:'musitu.axiom.decision-analysis.v1',expected_utilities:expected,recommended_action:winners[0],tied_recommendations:winners,max_expected_utility:best,
    regrets,max_regret:maxima,minimax_regret:{action:minimax,value:minimum},expected_value_with_perfect_information:perfect,evpi,
    expected_value_with_sample_information:sample,evsi,net_evsi:net,signal_policy:signalPolicy,utility_unit:value.utility_unit,assumptions:value.assumptions,evidence_refs:value.evidence_refs,
    input_sha256:[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join(''),commitment_format:FORMAT,
    recommendation_only:true,authority_granted:false,source_evidence_verified:false};
}
