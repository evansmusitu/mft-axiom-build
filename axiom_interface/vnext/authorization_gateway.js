import {APPROVAL_ROLES,EXECUTION_MODE,NETWORK_DENY,SECRET_POLICY,boundedCost,clean,clone,computeRisk,networkAllows,normalizeDestination,normalizeProvenance,rejectSecretLike,requiredApprovalRoles,riskIndex,sha256,specFor} from './execution_security.js';

const ACTIVE=new Set(['ACTIVE','READY']);
const requireText=(value,label,max=200)=>{const out=clean(value,max);if(!out)throw new TypeError(`${label} required`);return out;};
const scopeList=(value,label)=>{if(!Array.isArray(value))throw new TypeError(`${label} must be a list`);return [...new Set(value.map(v=>clean(v,120)).filter(Boolean))].sort();};
export function normalizeAuthorityEnvelope(raw={}){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new TypeError('authority envelope required');
  const grant=raw.grant||{};
  const budget=grant.budget||{};
  const envelope={
    schema:'musitu.axiom.execution-authority.browser.v1',
    project_id:requireText(raw.project_id,'project id'),
    actor_id:requireText(raw.actor_id,'actor id'),
    agent_id:requireText(raw.agent_id,'agent id'),
    workload_identity_id:requireText(raw.workload_identity_id,'workload identity id'),
    agent_status:requireText(raw.agent_status??'ACTIVE','agent status',32).toUpperCase(),
    kill_switch_engaged:Boolean(raw.kill_switch_engaged),
    revoked:Boolean(raw.revoked),
    requester_type:requireText(raw.requester_type??'AGENT','requester type',32).toUpperCase(),
    tool_scopes:scopeList(grant.tool_scopes||[],'tool scopes'),
    data_scopes:scopeList(grant.data_scopes||[],'data scopes'),
    network_policy:clone(grant.network_policy??NETWORK_DENY),
    secrets_policy:clean(grant.secrets_policy??SECRET_POLICY,160),
    budget:{max_compute_units:Number(budget.max_compute_units??100),used_compute_units:Number(raw.usage?.compute_units??0)},
    incident_posture:requireText(raw.incident_posture??'NORMAL','incident posture',32).toUpperCase(),
    jurisdiction:clean(raw.jurisdiction??'LOCAL_BROWSER',80),
  };
  if(!Number.isFinite(envelope.budget.max_compute_units)||envelope.budget.max_compute_units<0||!Number.isFinite(envelope.budget.used_compute_units)||envelope.budget.used_compute_units<0)throw new TypeError('invalid budget state');
  rejectSecretLike(envelope,'authority envelope');
  return envelope;
}
export async function authorityFingerprint(raw){return sha256(normalizeAuthorityEnvelope(raw));}
export async function normalizeActionRequest(envelopeRaw,raw={}){
  const authority=normalizeAuthorityEnvelope(envelopeRaw);
  const operation=clean(raw.operation,80).toLowerCase();
  const spec=specFor(operation);
  const risk_class=computeRisk(operation,raw.risk_class??null);
  const provenance=normalizeProvenance(raw.instruction_provenance);
  const cost=boundedCost(raw.compute_units??1);
  const target=clean(raw.target,2048);
  const payload=raw.payload==null?null:clone(raw.payload);
  rejectSecretLike({target,payload},'execution request');
  let destination=null;
  if(spec?.external||['S2','S3','S4','S5'].includes(risk_class)){
    if(raw.destination)destination=normalizeDestination(raw.destination).url;
  }
  const body={
    schema:'musitu.axiom.execution-request.browser.v1',
    project_id:authority.project_id,
    actor_id:authority.actor_id,
    agent_id:authority.agent_id,
    workload_identity_id:authority.workload_identity_id,
    operation,
    computed_risk_class:spec?.risk||'S5',
    risk_class,
    effect:spec?.effect||'UNKNOWN_BLOCKED',
    reversible:Boolean(spec?.reversible),
    external:Boolean(spec?.external),
    required_tool_scope:spec?.tool_scope||null,
    target,
    payload,
    destination,
    compute_units:cost,
    instruction_provenance:provenance,
    requested_at:clean(raw.requested_at||new Date().toISOString(),80),
    authority_sha256:await sha256(authority),
    execution_mode:EXECUTION_MODE,
  };
  return {...body,request_sha256:await sha256(body)};
}
function deny(reason,request,authority){return {schema:'musitu.axiom.authorization-decision.browser.v1',status:'DENIED',reason,request_sha256:request.request_sha256,risk_class:request.risk_class,authority_sha256:request.authority_sha256,required_approvals:requiredApprovalRoles(request.risk_class),execution_allowed:false,network_allowed:false,secret_material_allowed:false,policy_version:'FA11_S0_S5_V1',authority:clone(authority)};}
export async function evaluateAuthorization(envelopeRaw,requestRaw){
  const authority=normalizeAuthorityEnvelope(envelopeRaw);
  const request=requestRaw?.request_sha256?clone(requestRaw):await normalizeActionRequest(authority,requestRaw);
  if(await sha256(authority)!==request.authority_sha256)return deny('authority envelope changed',request,authority);
  if(request.project_id!==authority.project_id||request.workload_identity_id!==authority.workload_identity_id||request.agent_id!==authority.agent_id)return deny('request identity binding mismatch',request,authority);
  if(!ACTIVE.has(authority.agent_status)||authority.kill_switch_engaged||authority.revoked)return deny('workload identity inactive killed or revoked',request,authority);
  if(authority.incident_posture==='LOCKDOWN')return deny('incident posture blocks execution',request,authority);
  const spec=specFor(request.operation);
  if(!spec)return deny('unknown operation fails closed at S5',request,authority);
  if(request.required_tool_scope&&!authority.tool_scopes.includes(request.required_tool_scope))return deny('required tool scope not granted',request,authority);
  if(authority.budget.used_compute_units+request.compute_units>authority.budget.max_compute_units)return deny('compute budget exhausted',request,authority);
  if(request.instruction_provenance==='RETRIEVED_DATA'&&riskIndex(request.risk_class)>=riskIndex('S1'))return deny('retrieved data cannot authorize side effects',request,authority);
  if(request.external){
    if(!request.destination)return deny('external operation requires exact destination',request,authority);
    if(!networkAllows(authority.network_policy,request.destination))return deny('destination not allowed by network policy',request,authority);
  }
  if(request.risk_class==='S1'&&!request.reversible)return deny('S1 mutation must be reversible',request,authority);
  const approvals=requiredApprovalRoles(request.risk_class);
  const status=approvals.length?'AWAITING_APPROVAL':'AUTHORIZED';
  return {schema:'musitu.axiom.authorization-decision.browser.v1',status,reason:status==='AUTHORIZED'?'policy satisfied':'exact independent approval required',request_sha256:request.request_sha256,risk_class:request.risk_class,authority_sha256:request.authority_sha256,required_approvals:approvals,execution_allowed:status==='AUTHORIZED',network_allowed:Boolean(request.external&&networkAllows(authority.network_policy,request.destination)),secret_material_allowed:false,policy_version:'FA11_S0_S5_V1'};
}
export async function createApproval(request,{actor_id,role,decision='APPROVED',expires_at}={}){
  actor_id=requireText(actor_id,'approval actor id');role=requireText(role,'approval role',40).toUpperCase();decision=requireText(decision,'approval decision',20).toUpperCase();
  if(!APPROVAL_ROLES.includes(role))throw new DOMException('approval role not recognized','SecurityError');
  if(actor_id===request.workload_identity_id||actor_id===request.actor_id||actor_id===request.agent_id)throw new DOMException('requester cannot self-approve consequential action','SecurityError');
  if(decision!=='APPROVED')throw new DOMException('only explicit approved decision can authorize','SecurityError');
  const expiry=Date.parse(expires_at);if(!expires_at||Number.isNaN(expiry)||expiry<=Date.now())throw new DOMException('approval expiry must be in the future','SecurityError');
  const body={schema:'musitu.axiom.execution-approval.browser.v1',request_sha256:request.request_sha256,risk_class:request.risk_class,actor_id,role,decision,expires_at:new Date(expiry).toISOString()};
  return {...body,approval_sha256:await sha256(body)};
}
export async function finalizeAuthorization(envelopeRaw,request,approvals=[]){
  const base=await evaluateAuthorization(envelopeRaw,request);if(base.status==='DENIED'||base.status==='AUTHORIZED')return base;
  const required=base.required_approvals;const valid=[];
  for(const approval of approvals){
    const body=Object.fromEntries(Object.entries(approval).filter(([key])=>key!=='approval_sha256'));
    if(await sha256(body)!==approval.approval_sha256)continue;
    if(approval.request_sha256!==request.request_sha256||approval.risk_class!==request.risk_class||approval.decision!=='APPROVED'||Date.parse(approval.expires_at)<=Date.now())continue;
    if(approval.actor_id===request.actor_id||approval.actor_id===request.agent_id||approval.actor_id===request.workload_identity_id)continue;
    valid.push(approval);
  }
  const roles=new Set(valid.map(a=>a.role));if(!required.every(role=>roles.has(role)))return {...base,status:'AWAITING_APPROVAL',reason:'required independent approvals incomplete',execution_allowed:false};
  if(['S4','S5'].includes(request.risk_class)&&new Set(valid.filter(a=>required.includes(a.role)).map(a=>a.actor_id)).size<required.length)return {...base,status:'AWAITING_APPROVAL',reason:'S4/S5 approvals require distinct approvers',execution_allowed:false};
  return {...base,status:'AUTHORIZED',reason:'exact independent approvals satisfied',execution_allowed:true,approval_sha256s:valid.filter(a=>required.includes(a.role)).map(a=>a.approval_sha256).sort()};
}
