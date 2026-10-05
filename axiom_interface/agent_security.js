export const NETWORK_POLICY='DENY_ALL_EXTERNAL_NETWORK';
export const SECRETS_POLICY='SYMBOLIC_REFERENCE_ONLY_NO_PLAINTEXT_SECRETS';
export const EXECUTION_MODE='LOCAL_PREVIEW_ONLY_NO_EXTERNAL_ACTION';
export const MAX_DELEGATION_DEPTH=2;
export const ORGANIZATION_ID='browser-local-personal-workspace';
export const MODEL_POLICY='NO_MODEL_INVOCATION_DETERMINISTIC_LOCAL_PREVIEW';
export const DEPLOYMENT_ENVIRONMENT='BROWSER_LOCAL_DEVICE';

export const TOOL_SCOPES=Object.freeze([
  'project.read',
  'artifact.read',
  'artifact.write',
  'research.read',
  'computer.preview',
  'agent.delegate',
]);
export const ACTION_SCOPES=Object.freeze(TOOL_SCOPES.filter(scope=>scope!=='agent.delegate'));
export const DATA_SCOPES=Object.freeze([
  'project.metadata',
  'project.artifacts',
  'project.sources',
  'project.runs',
]);
export const AUTONOMY_LEVELS=Object.freeze(['PROPOSE_ONLY','LOCAL_PREVIEW']);
export const EVENT_TRIGGERS=Object.freeze(['project.updated','artifact.updated','run.completed','approval.granted']);
export const CONDITION_FIELDS=Object.freeze(['project.open_tasks','project.failed_runs','project.evidence_coverage']);
export const CONDITION_OPERATORS=Object.freeze(['eq','gt','gte','lt','lte']);

const SECRET_RX=/(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|private[_ -]?key|authorization)\s*[:=]/i;
export const clone=value=>structuredClone(value);
export const clean=(value,max=500)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,max);
export const uid=prefix=>`${prefix}_${crypto.randomUUID?.()||`${Date.now()}_${Math.random().toString(16).slice(2)}`}`;
export const canonical=value=>Array.isArray(value)?`[${value.map(canonical).join(',')}]`:value&&typeof value==='object'?`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`:JSON.stringify(value);
export async function sha256(value){const bytes=new TextEncoder().encode(canonical(value));const digest=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');}

export function rejectSecretLike(value,label='value'){
  if(SECRET_RX.test(typeof value==='string'?value:canonical(value)))throw new DOMException(`${label} contains forbidden plaintext secret-like material`,'SecurityError');
}

function exactScopes(values,allowed,label){
  if(!Array.isArray(values)||!values.length)throw new TypeError(`${label} required`);
  const result=[...new Set(values.map(value=>clean(value,80)))].sort();
  if(result.some(value=>!allowed.includes(value)))throw new DOMException(`${label} exceeds the registered capability vocabulary`,'SecurityError');
  return result;
}

function positiveInteger(value,label,maximum){
  const number=Number(value);
  if(!Number.isInteger(number)||number<1||number>maximum)throw new TypeError(`${label} must be an integer from 1 to ${maximum}`);
  return number;
}

export function normalizeGrant({toolScopes,dataScopes,autonomy='PROPOSE_ONLY',maxRuns=10,maxComputeUnits=100}={}){
  autonomy=clean(autonomy,40).toUpperCase();
  if(!AUTONOMY_LEVELS.includes(autonomy))throw new DOMException('unsupported autonomy level','SecurityError');
  return {
    tool_scopes:exactScopes(toolScopes,TOOL_SCOPES,'tool scopes'),
    data_scopes:exactScopes(dataScopes,DATA_SCOPES,'data scopes'),
    network_policy:NETWORK_POLICY,
    secrets_policy:SECRETS_POLICY,
    autonomy,
    approval_policy:'HUMAN_EACH_CONFIGURATION',
    budget:{max_runs:positiveInteger(maxRuns,'maxRuns',1000),max_compute_units:positiveInteger(maxComputeUnits,'maxComputeUnits',100000)},
  };
}

const subset=(candidate,parent)=>candidate.every(value=>parent.includes(value));
export function grantIsSubset(candidate,parent){
  return subset(candidate.tool_scopes,parent.tool_scopes)
    &&subset(candidate.data_scopes,parent.data_scopes)
    &&candidate.network_policy===parent.network_policy
    &&candidate.secrets_policy===parent.secrets_policy
    &&AUTONOMY_LEVELS.indexOf(candidate.autonomy)<=AUTONOMY_LEVELS.indexOf(parent.autonomy)
    &&candidate.budget.max_runs<=parent.budget.max_runs
    &&candidate.budget.max_compute_units<=parent.budget.max_compute_units;
}

export function requireDelegation(parent,candidate,depth){
  if(parent.status!=='ACTIVE'||parent.kill_switch_engaged)throw new DOMException('active parent agent required','InvalidStateError');
  if(!parent.grant.tool_scopes.includes('agent.delegate'))throw new DOMException('parent lacks agent.delegate','NotAllowedError');
  if(depth>MAX_DELEGATION_DEPTH)throw new DOMException('delegation depth exceeded','SecurityError');
  if(!grantIsSubset(candidate,parent.grant))throw new DOMException('delegated grant must be an exact least-privilege subset','SecurityError');
  return true;
}

export function normalizeTrigger(raw={}){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new TypeError('trigger object required');
  const kind=clean(raw.kind,24).toLowerCase();
  if(kind==='schedule')return {kind,every_minutes:positiveInteger(raw.everyMinutes??raw.every_minutes,'everyMinutes',10080)};
  if(kind==='event'){
    const event_name=clean(raw.eventName??raw.event_name,80);
    if(!EVENT_TRIGGERS.includes(event_name))throw new DOMException('event trigger is not allow-listed','SecurityError');
    return {kind,event_name};
  }
  if(kind==='condition'){
    const field=clean(raw.field,80),operator=clean(raw.operator,12).toLowerCase(),value=Number(raw.value);
    if(!CONDITION_FIELDS.includes(field)||!CONDITION_OPERATORS.includes(operator)||!Number.isFinite(value)||Math.abs(value)>1e12)throw new DOMException('condition trigger is outside the bounded vocabulary','SecurityError');
    return {kind,field,operator,value};
  }
  throw new DOMException('unsupported trigger kind','SecurityError');
}

export function triggerMatches(trigger,signal={}){
  if(!signal||typeof signal!=='object'||Array.isArray(signal)||clean(signal.kind,24).toLowerCase()!==trigger.kind)return false;
  if(trigger.kind==='schedule'){
    const elapsed=Number(signal.elapsedMinutes??signal.elapsed_minutes);
    return Number.isInteger(elapsed)&&elapsed>=trigger.every_minutes&&elapsed%trigger.every_minutes===0;
  }
  if(trigger.kind==='event')return clean(signal.eventName??signal.event_name,80)===trigger.event_name;
  const field=clean(signal.field,80),value=Number(signal.value);
  if(field!==trigger.field||!Number.isFinite(value))return false;
  return {eq:value===trigger.value,gt:value>trigger.value,gte:value>=trigger.value,lt:value<trigger.value,lte:value<=trigger.value}[trigger.operator]===true;
}

export function grantBody(agent){return {schema:'musitu.axiom.agent-grant.browser.v1',agent_id:agent.agent_id,project_id:agent.project_id,parent_agent_id:agent.parent_agent_id,owner_id:agent.owner_id,organization_id:agent.organization_id,workload_identity_id:agent.workload_identity_id,name:agent.name,purpose:agent.purpose,model_policy:agent.model_policy,deployment_environment:agent.deployment_environment,delegation_depth:agent.delegation_depth,grant:clone(agent.grant)};}
export function automationConfigBody(automation){return {schema:'musitu.axiom.automation-config.browser.v1',automation_id:automation.automation_id,project_id:automation.project_id,agent_id:automation.agent_id,name:automation.name,objective:automation.objective,trigger:clone(automation.trigger),action_scope:automation.action_scope,approval_required:true,execution_mode:EXECUTION_MODE};}
