import {sha256Json} from './execution_integrity.mjs';

export const EXECUTION_CONTRACT_SCHEMA='musitu.axiom.execution-contract.v1';
export const EXECUTION_AGENT_ID='axiom-runtime-v1';
export const EXECUTION_BUDGET_UNIT='CALLS_NOT_CURRENCY';
const idPattern=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,179}$/;
export function requireExecutionId(value,label='id'){
  if(typeof value!=='string'||!idPattern.test(value))throw new TypeError(`${label} must be a bounded identifier`);
  return value;
}
export function executionRecord(value,allowed,label){
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw new TypeError(`${label} must be a JSON record`);
  for(const key of Object.keys(value))if(!allowed.includes(key))throw new TypeError(`${label} contains unsupported field ${key}`);
  return value;
}
function choice(value,values,label){if(!values.includes(value))throw new TypeError(`${label} is invalid`);return value;}
export function normalizeExecutionContext(value={}){
  executionRecord(value,['project_id','work_id','agent_id','controls','success_criteria'],'execution context');
  const controls=executionRecord(value.controls||{},['autonomy','privacy','evidence','budget','approval','deadline'],'execution controls');
  const approval=choice(controls.approval??'Before consequential action',['Before consequential action','Every tool action','Read-only auto, writes approved'],'approval');
  let deadline=controls.deadline??null;
  if(deadline==='')deadline=null;
  if(deadline!==null){if(typeof deadline!=='string'||!/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(deadline)||!Number.isFinite(Date.parse(deadline)))throw new TypeError('deadline requires an explicit valid timezone');deadline=new Date(deadline).toISOString();}
  const budget=controls.budget===undefined||controls.budget===''?1:controls.budget;
  if(!((typeof budget==='number'&&Number.isSafeInteger(budget))||(typeof budget==='string'&&/^(0|[1-9][0-9]*)$/.test(budget)))||Number(budget)<0||Number(budget)>1000000)throw new TypeError('budget must be a nonnegative integer number of compute calls');
  const criteria=value.success_criteria??['Return an artifact bound to its execution and evidence.'];
  if(!Array.isArray(criteria)||!criteria.length||criteria.length>20||criteria.some(x=>typeof x!=='string'||x.trim().length<3||x.length>1000))throw new TypeError('success criteria must be nonempty bounded text');
  const normalized={
    project_id:value.project_id===undefined?'project_default':requireExecutionId(value.project_id,'project_id'),
    agent_id:value.agent_id===undefined?EXECUTION_AGENT_ID:requireExecutionId(value.agent_id,'agent_id'),
    controls:{autonomy:choice(controls.autonomy??'Policy-bounded',['Policy-bounded','Preview only','Approval each action'],'autonomy'),privacy:choice(controls.privacy??'Private',['Private','Project','Organization'],'privacy'),evidence:choice(controls.evidence??'Verified',['Verified','Standard','Independent validation'],'evidence'),budget:Number(budget),approval,deadline},
    success_criteria:criteria.map(x=>x.trim()),
  };
  if(value.work_id!==undefined)normalized.work_id=requireExecutionId(value.work_id,'work_id');
  return normalized;
}

export function requiredExecutionOutcomes(objective){
  const rows=['artifact'];
  if(/\b(research|look\s+up|sources?|cite[ds]?|citations?|evidence|latest|market|company|news|context)\b/i.test(objective))rows.push('research');
  if(/\b(calculate|compute|evaluate|what\s+is)\s+[0-9(]/i.test(objective))rows.push('compute');
  return rows;
}

export async function validateExecutionContract(contract){
  executionRecord(contract,['schema','tenant_id','project_id','work_id','agent_id','objective','success_criteria','required_outcomes','input_commitment','policy','issued_at','expires_at','contract_sha256'],'execution contract');
  if(contract.schema!==EXECUTION_CONTRACT_SCHEMA)throw new TypeError('unsupported execution contract version');
  for(const k of ['tenant_id','project_id','work_id','agent_id'])requireExecutionId(contract[k],k);
  if(typeof contract.objective!=='string'||contract.objective.trim().length<3||contract.objective.length>2000)throw new TypeError('contract objective is invalid');
  if(!Array.isArray(contract.success_criteria)||!contract.success_criteria.length||contract.success_criteria.length>20||contract.success_criteria.some(x=>typeof x!=='string'||x.length<3||x.length>1000))throw new TypeError('contract success criteria invalid');
  if(!Array.isArray(contract.required_outcomes)||!contract.required_outcomes.includes('artifact')||new Set(contract.required_outcomes).size!==contract.required_outcomes.length||contract.required_outcomes.some(x=>!['artifact','research','compute','decision'].includes(x)))throw new TypeError('contract outcomes invalid');
  if(contract.input_commitment!==null){
    executionRecord(contract.input_commitment,['kind','sha256'],'input commitment');
    if(contract.input_commitment.kind!=='decision'||!/^[0-9a-f]{64}$/.test(contract.input_commitment.sha256))throw new TypeError('invalid input commitment');
  }
  if(contract.required_outcomes.includes('decision')!==(contract.input_commitment?.kind==='decision'))throw new TypeError('decision outcome requires a bound input commitment');
  const p=executionRecord(contract.policy,['autonomy','privacy','evidence','approval','deadline','budget_unit','max_compute_calls','max_provider_calls','allowed_operations','allowed_actions'],'execution policy');
  choice(p.approval,['Before consequential action','Every tool action','Read-only auto, writes approved'],'approval');
  if(p.deadline!==null&&(!Number.isFinite(Date.parse(p.deadline))||new Date(p.deadline).toISOString()!==p.deadline||Date.parse(contract.expires_at)>Date.parse(p.deadline)))throw new TypeError('contract deadline must bound execution expiry');
  choice(p.autonomy,['Policy-bounded','Preview only','Approval each action'],'autonomy');choice(p.privacy,['Private','Project','Organization'],'privacy');choice(p.evidence,['Verified','Standard','Independent validation'],'evidence');
  if(p.budget_unit!==EXECUTION_BUDGET_UNIT)throw new TypeError('budget unit invalid');
  for(const k of ['max_compute_calls','max_provider_calls'])if(!Number.isSafeInteger(p[k])||p[k]<0||p[k]>1000000)throw new TypeError(`invalid ${k}`);
  if(!Array.isArray(p.allowed_operations)||new Set(p.allowed_operations).size!==p.allowed_operations.length||p.allowed_operations.some(x=>typeof x!=='string'||x.length>120))throw new TypeError('allowed operations invalid');
  if(!Array.isArray(p.allowed_actions)||new Set(p.allowed_actions).size!==p.allowed_actions.length||p.allowed_actions.some(x=>!['compute','research','model','decision'].includes(x)))throw new TypeError('allowed actions invalid');
  const issued=Date.parse(contract.issued_at),expiry=Date.parse(contract.expires_at);
  if(!Number.isFinite(issued)||!Number.isFinite(expiry)||expiry<=issued||new Date(issued).toISOString()!==contract.issued_at||new Date(expiry).toISOString()!==contract.expires_at)throw new TypeError('normalized contract times required');
  const {contract_sha256,...body}=contract;
  if(!/^[0-9a-f]{64}$/.test(contract_sha256)||await sha256Json(body)!==contract_sha256)throw new DOMException('execution contract commitment mismatch','DataError');
  return true;
}
