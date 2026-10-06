import {verifyCompilerCheckpoint} from './compiler_checkpoint.js';
import {evaluateAuthorization,finalizeAuthorization,normalizeActionRequest,normalizeAuthorityEnvelope} from '../authorization_gateway.js';

export const CHANGE_ADMISSION_REQUEST_SCHEMA='musitu.axiom.product-change-admission-request.v1';
export const CHANGE_ADMISSION_RESULT_SCHEMA='musitu.axiom.product-change-admission-result.v1';
export const OPERATION_SCOPED_EXECUTOR_HANDOFF_SCHEMA='musitu.axiom.product-operation-scoped-executor-handoff.v1';

export const CHANGE_RISK_MODEL=Object.freeze({
  S0:Object.freeze({action:'READ_COMPUTE',required_verifications:Object.freeze([]),human_approval_required:false}),
  S1:Object.freeze({action:'PRIVATE_REVERSIBLE_WRITE',required_verifications:Object.freeze(['TESTS']),human_approval_required:false}),
  S2:Object.freeze({action:'EXTERNAL_READ',required_verifications:Object.freeze(['TESTS','SECURITY']),human_approval_required:false}),
  S3:Object.freeze({action:'EXTERNAL_REVERSIBLE_WRITE',required_verifications:Object.freeze(['TESTS','SECURITY','INDEPENDENT_VERIFIER']),human_approval_required:false}),
  S4:Object.freeze({action:'PUBLICATION_OR_PRODUCTION_DEPLOYMENT',required_verifications:Object.freeze(['TESTS','SECURITY','INDEPENDENT_VERIFIER']),human_approval_required:true}),
  S5:Object.freeze({action:'SECRETS_IDENTITY_SECURITY_OR_DESTRUCTIVE',required_verifications:Object.freeze(['TESTS','SECURITY','INDEPENDENT_VERIFIER']),human_approval_required:true}),
});

const HASH=/^[a-f0-9]{64}$/i;
const REQUEST_KEYS=new Set(['schema','project_id','work_id','checkpoint_id','checkpoint_sha256','builder_actor_id','requested_action','risk_class','required_verifications','human_approval_required','policy_engine_authority','builder_may_approve','external_execution_authority','production_authority','created_at','request_sha256']);
const POLICY_DECISION_KEYS=new Set(['decision','request_sha256','policy_sha256','reasons']);
const VERIFICATION_EVIDENCE_KEYS=new Set(['kind','status','actor_id','artifact_sha256']);
const HUMAN_APPROVAL_KEYS=new Set(['decision','request_sha256','actor_id','receipt_id','at']);
const ADMISSION_RESULT_KEYS=new Set(['schema','project_id','work_id','request_sha256','checkpoint_sha256','risk_class','requested_action','policy_decision','policy_sha256','policy_reasons','verification_artifacts','missing_verifications','independent_verification','human_approval','status','admitted_to_executor','authority_effect','external_execution_authority','production_authority','required_next_gate','created_at','human_approval_receipt','evaluation_sha256']);
const EXECUTION_REQUEST_KEYS=new Set(['schema','project_id','actor_id','agent_id','workload_identity_id','operation','computed_risk_class','risk_class','effect','reversible','external','required_tool_scope','target','payload','destination','compute_units','instruction_provenance','requested_at','authority_sha256','execution_mode','request_sha256']);
const EXECUTOR_OPERATION_INPUT_KEYS=new Set(['operation','target','payload','destination','compute_units','requested_at']);
const EXECUTOR_HANDOFF_KEYS=new Set(['schema','scope','project_id','work_id','checkpoint_sha256','change_admission_request_sha256','change_admission_evaluation_sha256','authority_sha256','actor_id','agent_id','workload_identity_id','builder_actor_id','risk_class','operation','execution_request','authority_effect','execution_authority','external_execution_authority','release_authority','production_authority','certification_authority','created_at','handoff_sha256']);
const FA11_APPROVAL_KEYS=new Set(['schema','request_sha256','risk_class','actor_id','role','decision','expires_at','approval_sha256']);
const isPlainObject=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const clean=(value,max=1000)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);
function rejectUnknownKeys(value,allowed,label){const extra=Object.keys(value).filter(key=>!allowed.has(key));if(extra.length)throw new DOMException(label+' contains unsupported fields: '+extra.join(','),'SecurityError');}
function canonical(value){
  if(Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if(value&&typeof value==='object') return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
async function sha256(value){
  const bytes=new TextEncoder().encode(typeof value==='string'?value:canonical(value));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');
}
function iso(value,name='at'){
  const time=Date.parse(value??'');
  if(!Number.isFinite(time)) throw new TypeError(`${name} must be an ISO instant`);
  return new Date(time).toISOString();
}
async function assertCheckpoint(checkpoint,projectId){
  if(!isPlainObject(checkpoint)||checkpoint.schema!=='musitu.axiom.product-compiler-checkpoint.v1') throw new TypeError('compiler checkpoint required');
  if(checkpoint.project_id!==projectId) throw new DOMException('cross-project change admission blocked','SecurityError');
  if(typeof checkpoint.checkpoint_sha256!=='string'||!HASH.test(checkpoint.checkpoint_sha256)) throw new TypeError('checkpoint sha256 required');
  if(checkpoint.authority_effect!=='NONE'||checkpoint.rollback_mode!=='PREPARE_ONLY'||checkpoint.external_execution_authority!==false||checkpoint.production_authority!==false) throw new DOMException('checkpoint authority boundary invalid','SecurityError');
  if(!(await verifyCompilerCheckpoint(checkpoint))) throw new DOMException('compiler checkpoint integrity verification required','DataError');
}
function requestHashBody(request){
  return {
    schema:request.schema,project_id:request.project_id,work_id:request.work_id,checkpoint_id:request.checkpoint_id,
    checkpoint_sha256:request.checkpoint_sha256,builder_actor_id:request.builder_actor_id,requested_action:request.requested_action,
    risk_class:request.risk_class,required_verifications:request.required_verifications,human_approval_required:request.human_approval_required,
    policy_engine_authority:request.policy_engine_authority,builder_may_approve:request.builder_may_approve,
    external_execution_authority:request.external_execution_authority,production_authority:request.production_authority,
    created_at:request.created_at,
  };
}

export async function createChangeAdmissionRequest({projectId,workId='',checkpoint,builderActorId,requestedAction,riskClass,at=new Date().toISOString()}={}){
  const project_id=clean(projectId,180),work_id=clean(workId,180),builder_actor_id=clean(builderActorId,180);
  if(!project_id) throw new TypeError('projectId required');
  if(!builder_actor_id) throw new TypeError('builderActorId required');
  const model=CHANGE_RISK_MODEL[riskClass];
  if(!model) throw new TypeError('riskClass must be S0..S5');
  if(requestedAction!==model.action) throw new TypeError(`requestedAction must equal ${model.action} for ${riskClass}`);
  await assertCheckpoint(checkpoint,project_id);
  const body={
    schema:CHANGE_ADMISSION_REQUEST_SCHEMA,
    project_id,work_id,
    checkpoint_id:checkpoint.checkpoint_id,
    checkpoint_sha256:checkpoint.checkpoint_sha256,
    builder_actor_id,
    requested_action:requestedAction,
    risk_class:riskClass,
    required_verifications:[...model.required_verifications],
    human_approval_required:model.human_approval_required,
    policy_engine_authority:'MECHANISM_ONLY',
    builder_may_approve:false,
    external_execution_authority:false,
    production_authority:false,
    created_at:iso(at),
  };
  return Object.freeze({...body,request_sha256:await sha256(body)});
}

function assertRequest(request){
  if(!isPlainObject(request)||request.schema!==CHANGE_ADMISSION_REQUEST_SCHEMA) throw new TypeError('change admission request required');
  rejectUnknownKeys(request,REQUEST_KEYS,'change admission request');
  if(typeof request.project_id!=='string'||!request.project_id||clean(request.project_id,180)!==request.project_id) throw new TypeError('project_id must be a normalized non-empty string');
  if(typeof request.work_id!=='string'||clean(request.work_id,180)!==request.work_id) throw new TypeError('work_id must be a normalized string');
  if(typeof request.checkpoint_id!=='string'||!request.checkpoint_id||clean(request.checkpoint_id,180)!==request.checkpoint_id) throw new TypeError('checkpoint_id must be a normalized non-empty string');
  if(typeof request.checkpoint_sha256!=='string'||!HASH.test(request.checkpoint_sha256)) throw new TypeError('checkpoint_sha256 must be a sha256 string');
  if(typeof request.builder_actor_id!=='string'||!request.builder_actor_id||clean(request.builder_actor_id,180)!==request.builder_actor_id) throw new TypeError('builder_actor_id must be a normalized non-empty string');
  if(typeof request.created_at!=='string'||iso(request.created_at,'request.created_at')!==request.created_at) throw new TypeError('created_at must be a canonical ISO instant string');
  if(typeof request.request_sha256!=='string'||!HASH.test(request.request_sha256)) throw new TypeError('request sha256 required');
  if(request.policy_engine_authority!=='MECHANISM_ONLY'||request.builder_may_approve!==false||request.external_execution_authority!==false||request.production_authority!==false) throw new DOMException('change admission authority boundary invalid','SecurityError');
  const model=CHANGE_RISK_MODEL[request.risk_class];
  if(!model) throw new TypeError('request risk class invalid');
  if(request.requested_action!==model.action) throw new DOMException('change admission request violates frozen risk model action','SecurityError');
  if(!Array.isArray(request.required_verifications)||canonical(request.required_verifications)!==canonical([...model.required_verifications])) throw new DOMException('change admission request verification requirements violate frozen risk model','SecurityError');
  if(request.human_approval_required!==model.human_approval_required) throw new DOMException('change admission request human approval requirement violates frozen risk model','SecurityError');
  return request;
}
async function assertRequestIntegrity(request){
  assertRequest(request);
  if((await sha256(requestHashBody(request)))!==request.request_sha256) throw new DOMException('change admission request integrity failure','DataError');
}
function normalizeVerificationEvidence(request,items){
  if(!Array.isArray(items)) throw new TypeError('verificationEvidence must be an array');
  const byKind=new Map();
  for(const [index,item] of items.entries()){
    if(!isPlainObject(item)) throw new TypeError(`verificationEvidence[${index}] must be a plain object`);
    rejectUnknownKeys(item,VERIFICATION_EVIDENCE_KEYS,`verificationEvidence[${index}]`);
    if(typeof item.kind!=='string'||typeof item.status!=='string'||typeof item.actor_id!=='string'||typeof item.artifact_sha256!=='string') throw new TypeError(`verificationEvidence[${index}] fields must be strings`);
    const kind=clean(item.kind,80),status=clean(item.status,40),actor_id=clean(item.actor_id,180),artifact_sha256=clean(item.artifact_sha256,64).toLowerCase();
    if(!kind||byKind.has(kind)) throw new TypeError(`verificationEvidence[${index}] kind must be unique and non-empty`);
    if(!request.required_verifications.includes(kind)) throw new DOMException(`verificationEvidence[${index}] kind is not required by admission request`,'SecurityError');
    if(status!=='PASS') throw new TypeError(`verificationEvidence[${index}] must be PASS evidence`);
    if(!actor_id) throw new TypeError(`verificationEvidence[${index}] actor_id required`);
    if(!HASH.test(artifact_sha256)) throw new TypeError(`verificationEvidence[${index}] artifact_sha256 required`);
    if((kind==='SECURITY'||kind==='INDEPENDENT_VERIFIER')&&actor_id===request.builder_actor_id){
      if(kind==='INDEPENDENT_VERIFIER') throw new DOMException('independent verifier must differ from builder','NotAllowedError');
      throw new DOMException('security reviewer must differ from builder','NotAllowedError');
    }
    byKind.set(kind,Object.freeze({kind,status,actor_id,artifact_sha256}));
  }
  return byKind;
}
function humanApprovalState(request,humanApproval){
  if(!request.human_approval_required) return {state:'NOT_REQUIRED',receipt:null};
  if(!humanApproval) return {state:'MISSING',receipt:null};
  if(!isPlainObject(humanApproval)) throw new DOMException('human approval ALLOW receipt required','NotAllowedError');
  rejectUnknownKeys(humanApproval,HUMAN_APPROVAL_KEYS,'human approval');
  if(humanApproval.decision!=='ALLOW') throw new DOMException('human approval ALLOW receipt required','NotAllowedError');
  if(humanApproval.request_sha256!==request.request_sha256) throw new DOMException('human approval is not bound to admission request','DataError');
  if(typeof humanApproval.actor_id!=='string'||typeof humanApproval.receipt_id!=='string'||typeof humanApproval.at!=='string') throw new TypeError('human approval actor_id receipt_id and at must be strings');
  const actor_id=clean(humanApproval.actor_id,180),receipt_id=clean(humanApproval.receipt_id,180);
  if(!actor_id||actor_id!==humanApproval.actor_id||!receipt_id||receipt_id!==humanApproval.receipt_id) throw new TypeError('human approval actor_id and receipt_id must be normalized non-empty strings');
  if(actor_id===request.builder_actor_id) throw new DOMException('builder cannot provide required human approval','NotAllowedError');
  return {state:'PASS',receipt:{decision:'ALLOW',request_sha256:request.request_sha256,actor_id,receipt_id,at:iso(humanApproval.at,'humanApproval.at')}};
}

export async function evaluateChangeAdmission({request,policyDecision,verificationEvidence=[],humanApproval=null,at=new Date().toISOString()}={}){
  await assertRequestIntegrity(request);
  if(!isPlainObject(policyDecision)) throw new TypeError('policyDecision required');
  rejectUnknownKeys(policyDecision,POLICY_DECISION_KEYS,'policy decision');
  if(!['ALLOW','DENY','NEEDS_HUMAN'].includes(policyDecision.decision)) throw new TypeError('policy decision must be ALLOW, DENY or NEEDS_HUMAN');
  if(policyDecision.request_sha256!==request.request_sha256) throw new DOMException('policy decision is not bound to admission request','DataError');
  if(typeof policyDecision.policy_sha256!=='string'||!HASH.test(policyDecision.policy_sha256)) throw new TypeError('policy_sha256 required');
  if(!Array.isArray(policyDecision.reasons)||policyDecision.reasons.some(reason=>typeof reason!=='string')) throw new TypeError('policy decision reasons must be an array of strings');
  const created_at=iso(at);
  const evidence=normalizeVerificationEvidence(request,verificationEvidence);
  const missing=request.required_verifications.filter(kind=>!evidence.has(kind));
  const independent_verification=evidence.has('INDEPENDENT_VERIFIER')?'PASS':'NOT_PROVEN';
  const approval=humanApprovalState(request,humanApproval);

  let status='DENIED',admitted=false,required_next_gate='NO_EXECUTION';
  if(policyDecision.decision==='DENY'){
    status='DENIED';
  }else if(missing.length){
    status='BLOCKED_VERIFICATION'; required_next_gate='VERIFICATION';
  }else if(policyDecision.decision==='NEEDS_HUMAN'||(request.human_approval_required&&approval.state!=='PASS')){
    status='BLOCKED_HUMAN_APPROVAL'; required_next_gate='HUMAN_APPROVAL';
  }else{
    status='ADMITTED_TO_EXECUTOR'; admitted=true; required_next_gate='OPERATION_SCOPED_EXECUTOR';
  }

  const body={
    schema:CHANGE_ADMISSION_RESULT_SCHEMA,
    project_id:request.project_id,work_id:request.work_id,request_sha256:request.request_sha256,
    checkpoint_sha256:request.checkpoint_sha256,risk_class:request.risk_class,requested_action:request.requested_action,
    policy_decision:policyDecision.decision,policy_sha256:policyDecision.policy_sha256,policy_reasons:[...policyDecision.reasons],
    verification_artifacts:[...evidence.values()].sort((a,b)=>a.kind.localeCompare(b.kind)),missing_verifications:missing,
    independent_verification,human_approval:approval.state,status,admitted_to_executor:admitted,
    authority_effect:'ADMISSION_ONLY',external_execution_authority:false,production_authority:false,
    required_next_gate,created_at,
    human_approval_receipt:approval.receipt,
  };
  return Object.freeze({...body,evaluation_sha256:await sha256(body)});
}


async function assertAdmittedResultIntegrity(request,result){
  if(!isPlainObject(result)||result.schema!==CHANGE_ADMISSION_RESULT_SCHEMA) throw new TypeError('change admission result required');
  rejectUnknownKeys(result,ADMISSION_RESULT_KEYS,'change admission result');
  if(typeof result.evaluation_sha256!=='string'||!HASH.test(result.evaluation_sha256)) throw new TypeError('change admission evaluation sha256 required');
  const body=Object.fromEntries(Object.entries(result).filter(([key])=>key!=='evaluation_sha256'));
  if((await sha256(body))!==result.evaluation_sha256) throw new DOMException('change admission result integrity failure','DataError');
  if(result.project_id!==request.project_id||result.work_id!==request.work_id||result.request_sha256!==request.request_sha256||result.checkpoint_sha256!==request.checkpoint_sha256) throw new DOMException('change admission result binding mismatch','SecurityError');
  if(result.risk_class!==request.risk_class||result.requested_action!==request.requested_action) throw new DOMException('change admission risk binding mismatch','SecurityError');
  if(result.status!=='ADMITTED_TO_EXECUTOR'||result.admitted_to_executor!==true||result.required_next_gate!=='OPERATION_SCOPED_EXECUTOR') throw new DOMException('change is not admitted to operation-scoped executor','NotAllowedError');
  if(result.authority_effect!=='ADMISSION_ONLY'||result.external_execution_authority!==false||result.production_authority!==false) throw new DOMException('change admission result authority boundary invalid','SecurityError');
  return result;
}
function executionRequestHashBody(request){
  return Object.fromEntries(Object.entries(request).filter(([key])=>key!=='request_sha256'));
}
async function assertExecutionRequestIntegrity(request){
  if(!isPlainObject(request)) throw new TypeError('FA-11 execution request required');
  rejectUnknownKeys(request,EXECUTION_REQUEST_KEYS,'FA-11 execution request');
  if(typeof request.request_sha256!=='string'||!HASH.test(request.request_sha256)) throw new TypeError('FA-11 execution request sha256 required');
  if((await sha256(executionRequestHashBody(request)))!==request.request_sha256) throw new DOMException('FA-11 execution request integrity failure','DataError');
  return request;
}
function executorHandoffHashBody(handoff){
  return Object.fromEntries(Object.entries(handoff).filter(([key])=>key!=='handoff_sha256'));
}
async function assertExecutorHandoffIntegrity(handoff){
  if(!isPlainObject(handoff)||handoff.schema!==OPERATION_SCOPED_EXECUTOR_HANDOFF_SCHEMA) throw new TypeError('operation-scoped executor handoff required');
  rejectUnknownKeys(handoff,EXECUTOR_HANDOFF_KEYS,'operation-scoped executor handoff');
  if(typeof handoff.handoff_sha256!=='string'||!HASH.test(handoff.handoff_sha256)) throw new TypeError('executor handoff sha256 required');
  if((await sha256(executorHandoffHashBody(handoff)))!==handoff.handoff_sha256) throw new DOMException('operation-scoped executor handoff integrity failure','DataError');
  if(handoff.scope!=='SINGLE_OPERATION'||handoff.authority_effect!=='NONE'||handoff.execution_authority!==false||handoff.external_execution_authority!==false||handoff.release_authority!==false||handoff.production_authority!==false||handoff.certification_authority!==false) throw new DOMException('executor handoff authority boundary invalid','SecurityError');
  await assertExecutionRequestIntegrity(handoff.execution_request);
  if(typeof handoff.builder_actor_id!=='string'||!handoff.builder_actor_id||clean(handoff.builder_actor_id,180)!==handoff.builder_actor_id) throw new TypeError('executor handoff builder_actor_id must be a normalized non-empty string');
  if(handoff.execution_request.project_id!==handoff.project_id||handoff.execution_request.authority_sha256!==handoff.authority_sha256||handoff.execution_request.agent_id!==handoff.agent_id||handoff.execution_request.workload_identity_id!==handoff.workload_identity_id||handoff.execution_request.operation!==handoff.operation||handoff.execution_request.risk_class!==handoff.risk_class) throw new DOMException('executor handoff execution-request binding mismatch','SecurityError');
  return handoff;
}


function assertExecutorAuthorityEnvelopeInput(authorityEnvelope){
  if(!isPlainObject(authorityEnvelope)) throw new TypeError('executor authority envelope must be a plain object');
  for(const [key,max] of [['project_id',200],['actor_id',200],['agent_id',200],['workload_identity_id',200]]){
    const value=authorityEnvelope[key];
    if(typeof value!=='string'||!value||clean(value,max)!==value) throw new TypeError(`executor authority ${key} must be a normalized non-empty string`);
  }
  if(authorityEnvelope.grant!==undefined){
    if(!isPlainObject(authorityEnvelope.grant)) throw new TypeError('executor authority grant must be a plain object');
    for(const key of ['tool_scopes','data_scopes']){
      const values=authorityEnvelope.grant[key];
      if(values!==undefined){
        if(!Array.isArray(values)||values.some(value=>typeof value!=='string'||!value||clean(value,120)!==value)) throw new TypeError(`executor authority grant ${key} must contain normalized strings only`);
      }
    }
    if(authorityEnvelope.grant.budget!==undefined){
      const budget=authorityEnvelope.grant.budget;
      if(!isPlainObject(budget)) throw new TypeError('executor authority grant budget must be a plain object');
      if(budget.max_compute_units!==undefined&&(!Number.isInteger(budget.max_compute_units)||budget.max_compute_units<0)) throw new TypeError('executor authority grant budget max_compute_units must be a non-negative integer');
    }
  }
  if(authorityEnvelope.usage!==undefined){
    if(!isPlainObject(authorityEnvelope.usage)) throw new TypeError('executor authority usage must be a plain object');
    if(authorityEnvelope.usage.compute_units!==undefined&&(!Number.isInteger(authorityEnvelope.usage.compute_units)||authorityEnvelope.usage.compute_units<0)) throw new TypeError('executor authority usage compute_units must be a non-negative integer');
  }
  return authorityEnvelope;
}

export async function createOperationScopedExecutorHandoff({request,admissionResult,authorityEnvelope,operationRequest={},at=new Date().toISOString()}={}){
  await assertRequestIntegrity(request);
  await assertAdmittedResultIntegrity(request,admissionResult);
  assertExecutorAuthorityEnvelopeInput(authorityEnvelope);
  if(!isPlainObject(operationRequest)) throw new TypeError('operationRequest must be a plain object');
  rejectUnknownKeys(operationRequest,EXECUTOR_OPERATION_INPUT_KEYS,'operationRequest');
  const authority=normalizeAuthorityEnvelope(authorityEnvelope);
  if(authority.project_id!==request.project_id) throw new DOMException('cross-project executor handoff blocked','SecurityError');
  const execution_request=await normalizeActionRequest(authorityEnvelope,{
    ...operationRequest,
    risk_class:request.risk_class,
    instruction_provenance:'GOVERNED_PLAN',
    requested_at:operationRequest.requested_at??iso(at,'operationRequest.requested_at'),
  });
  if(execution_request.computed_risk_class!==request.risk_class||execution_request.risk_class!==request.risk_class) throw new DOMException('concrete operation risk must exactly match admitted risk class','SecurityError');
  const body={
    schema:OPERATION_SCOPED_EXECUTOR_HANDOFF_SCHEMA,
    scope:'SINGLE_OPERATION',
    project_id:request.project_id,
    work_id:request.work_id,
    checkpoint_sha256:request.checkpoint_sha256,
    change_admission_request_sha256:request.request_sha256,
    change_admission_evaluation_sha256:admissionResult.evaluation_sha256,
    authority_sha256:execution_request.authority_sha256,
    actor_id:authority.actor_id,
    agent_id:authority.agent_id,
    workload_identity_id:authority.workload_identity_id,
    builder_actor_id:request.builder_actor_id,
    risk_class:request.risk_class,
    operation:execution_request.operation,
    execution_request,
    authority_effect:'NONE',
    execution_authority:false,
    external_execution_authority:false,
    release_authority:false,
    production_authority:false,
    certification_authority:false,
    created_at:iso(at),
  };
  return Object.freeze({...body,handoff_sha256:await sha256(body)});
}

export async function evaluateOperationScopedExecutorHandoff({handoff,authorityEnvelope}={}){
  await assertExecutorHandoffIntegrity(handoff);
  assertExecutorAuthorityEnvelopeInput(authorityEnvelope);
  const authority=normalizeAuthorityEnvelope(authorityEnvelope);
  if((await sha256(authority))!==handoff.authority_sha256) throw new DOMException('executor handoff authority envelope changed','SecurityError');
  if(authority.project_id!==handoff.project_id||authority.actor_id!==handoff.actor_id||authority.agent_id!==handoff.agent_id||authority.workload_identity_id!==handoff.workload_identity_id) throw new DOMException('executor handoff workload identity binding mismatch','SecurityError');
  return evaluateAuthorization(authorityEnvelope,handoff.execution_request);
}


export async function finalizeOperationScopedExecutorHandoff({handoff,authorityEnvelope,approvals=[]}={}){
  await assertExecutorHandoffIntegrity(handoff);
  assertExecutorAuthorityEnvelopeInput(authorityEnvelope);
  const authority=normalizeAuthorityEnvelope(authorityEnvelope);
  if((await sha256(authority))!==handoff.authority_sha256) throw new DOMException('executor handoff authority envelope changed','SecurityError');
  if(authority.project_id!==handoff.project_id||authority.actor_id!==handoff.actor_id||authority.agent_id!==handoff.agent_id||authority.workload_identity_id!==handoff.workload_identity_id) throw new DOMException('executor handoff workload identity binding mismatch','SecurityError');
  if(!Array.isArray(approvals)) throw new TypeError('approvals must be an array');
  for(const [index,approval] of approvals.entries()){
    if(!isPlainObject(approval)) throw new TypeError(`approvals[${index}] must be a plain object`);
    rejectUnknownKeys(approval,FA11_APPROVAL_KEYS,`approvals[${index}]`);
    if(approval.schema!=='musitu.axiom.execution-approval.browser.v1') throw new TypeError(`approvals[${index}] schema invalid`);
    for(const key of ['request_sha256','risk_class','actor_id','role','decision','expires_at','approval_sha256']){
      if(typeof approval[key]!=='string') throw new TypeError(`approvals[${index}].${key} must be a string`);
    }
    if(!HASH.test(approval.request_sha256)||!HASH.test(approval.approval_sha256)) throw new TypeError(`approvals[${index}] hashes must be sha256 strings`);
    if(!approval.actor_id||clean(approval.actor_id,180)!==approval.actor_id) throw new TypeError(`approvals[${index}].actor_id must be a normalized non-empty string`);
    if(iso(approval.expires_at,`approvals[${index}].expires_at`)!==approval.expires_at) throw new TypeError(`approvals[${index}].expires_at must be a canonical ISO instant string`);
    if(approval.actor_id===handoff.builder_actor_id) throw new DOMException('builder cannot approve its own operation-scoped executor handoff','NotAllowedError');
  }
  return finalizeAuthorization(authorityEnvelope,handoff.execution_request,approvals);
}
