import {verifyCompilerCheckpoint} from './compiler_checkpoint.js';

export const CHANGE_ADMISSION_REQUEST_SCHEMA='musitu.axiom.product-change-admission-request.v1';
export const CHANGE_ADMISSION_RESULT_SCHEMA='musitu.axiom.product-change-admission-result.v1';

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
  if(!isPlainObject(humanApproval)||humanApproval.decision!=='ALLOW') throw new DOMException('human approval ALLOW receipt required','NotAllowedError');
  if(humanApproval.request_sha256!==request.request_sha256) throw new DOMException('human approval is not bound to admission request','DataError');
  const actor_id=clean(humanApproval.actor_id,180),receipt_id=clean(humanApproval.receipt_id,180);
  if(!actor_id||!receipt_id) throw new TypeError('human approval actor_id and receipt_id required');
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
