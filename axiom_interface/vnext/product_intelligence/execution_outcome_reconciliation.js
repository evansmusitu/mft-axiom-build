import {assertAxiomObject} from '../foundation_contracts.js';
import {sha256} from '../execution_security.js';

export const EXECUTION_OUTCOME_VERIFICATION_SCHEMA='musitu.axiom.product-execution-outcome-verification.v1';

const HASH=/^[a-f0-9]{64}$/i;
const HANDOFF_KEYS=new Set(['schema','scope','project_id','work_id','checkpoint_sha256','change_admission_request_sha256','change_admission_evaluation_sha256','authority_sha256','actor_id','agent_id','workload_identity_id','builder_actor_id','risk_class','operation','execution_request','authority_effect','execution_authority','external_execution_authority','release_authority','production_authority','certification_authority','created_at','handoff_sha256']);
const REQUEST_KEYS=new Set(['schema','project_id','actor_id','agent_id','workload_identity_id','operation','computed_risk_class','risk_class','effect','reversible','external','required_tool_scope','target','payload','destination','compute_units','instruction_provenance','requested_at','authority_sha256','execution_mode','request_sha256']);
const RECEIPT_KEYS=new Set(['schema','receipt_id','project_id','sandbox_id','request_sha256','risk_class','status','result','reason','error_name','rollback_available','external_action_executed','network_request_performed','host_shell_executed','plaintext_secret_access','created_at','receipt_sha256']);
const INTEGRITY_KEYS=new Set(['schema','project_id','status','errors','event_count','network_policy','secrets_policy','integrity_sha256']);
const VERIFIED_OUTCOME_KEYS=new Set(['schema','project_id','work_id','checkpoint_sha256','handoff_sha256','request_sha256','receipt_id','receipt_sha256','execution_integrity_sha256','operation','risk_class','execution_status','status','verifier_actor_id','independent_verification','rollback_available','failure_state','failure_reason','external_action_executed','network_request_performed','host_shell_executed','plaintext_secret_access','authority_effect','release_authority','production_authority','certification_authority','created_at','verification_sha256']);
const isPlainObject=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const clean=(value,max=300)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);
function rejectUnknown(value,allowed,label){const extra=Object.keys(value).filter(key=>!allowed.has(key));if(extra.length)throw new DOMException(label+' contains unsupported fields: '+extra.join(','),'SecurityError');}
function canonicalIso(value,label){if(typeof value!=='string')throw new TypeError(label+' must be a string');const ms=Date.parse(value);if(!Number.isFinite(ms))throw new TypeError(label+' must be an ISO instant');const out=new Date(ms).toISOString();if(out!==value)throw new TypeError(label+' must be a canonical ISO instant');return out;}
function requireString(value,label,max=300){if(typeof value!=='string'||!value||clean(value,max)!==value)throw new TypeError(label+' must be a normalized non-empty string');return value;}
function requireHash(value,label){if(typeof value!=='string'||!HASH.test(value))throw new TypeError(label+' must be a sha256 string');return value.toLowerCase();}
function bodyWithout(value,key){return Object.fromEntries(Object.entries(value).filter(([name])=>name!==key));}

async function assertHandoff(handoff){
  if(!isPlainObject(handoff)||handoff.schema!=='musitu.axiom.product-operation-scoped-executor-handoff.v1')throw new TypeError('operation-scoped executor handoff required');
  rejectUnknown(handoff,HANDOFF_KEYS,'operation-scoped executor handoff');
  requireHash(handoff.handoff_sha256,'handoff_sha256');
  if(await sha256(bodyWithout(handoff,'handoff_sha256'))!==handoff.handoff_sha256)throw new DOMException('operation-scoped executor handoff integrity failure','DataError');
  if(handoff.scope!=='SINGLE_OPERATION'||handoff.authority_effect!=='NONE'||handoff.execution_authority!==false||handoff.external_execution_authority!==false||handoff.release_authority!==false||handoff.production_authority!==false||handoff.certification_authority!==false)throw new DOMException('operation-scoped executor handoff authority boundary invalid','SecurityError');
  for(const key of ['project_id','work_id','actor_id','agent_id','workload_identity_id','builder_actor_id','risk_class','operation'])requireString(handoff[key],`handoff.${key}`);
  requireHash(handoff.checkpoint_sha256,'handoff.checkpoint_sha256');
  requireHash(handoff.change_admission_request_sha256,'handoff.change_admission_request_sha256');
  requireHash(handoff.change_admission_evaluation_sha256,'handoff.change_admission_evaluation_sha256');
  requireHash(handoff.authority_sha256,'handoff.authority_sha256');
  canonicalIso(handoff.created_at,'handoff.created_at');
  const request=handoff.execution_request;
  if(!isPlainObject(request)||request.schema!=='musitu.axiom.execution-request.browser.v1')throw new TypeError('FA-11 execution request required');
  rejectUnknown(request,REQUEST_KEYS,'FA-11 execution request');
  requireHash(request.request_sha256,'execution_request.request_sha256');
  if(await sha256(bodyWithout(request,'request_sha256'))!==request.request_sha256)throw new DOMException('FA-11 execution request integrity failure','DataError');
  if(request.project_id!==handoff.project_id||request.actor_id!==handoff.actor_id||request.agent_id!==handoff.agent_id||request.workload_identity_id!==handoff.workload_identity_id||request.operation!==handoff.operation||request.risk_class!==handoff.risk_class||request.authority_sha256!==handoff.authority_sha256)throw new DOMException('executor handoff request binding mismatch','SecurityError');
  if(request.instruction_provenance!=='GOVERNED_PLAN')throw new DOMException('executor handoff instruction provenance must remain GOVERNED_PLAN','SecurityError');
  if(typeof request.reversible!=='boolean'||typeof request.external!=='boolean')throw new TypeError('execution request effect flags must be booleans');
  canonicalIso(request.requested_at,'execution_request.requested_at');
  return request;
}

async function assertReceipt(receipt,handoff,request){
  if(!isPlainObject(receipt)||receipt.schema!=='musitu.axiom.execution-receipt.browser.v1')throw new TypeError('FA-11 execution receipt required');
  rejectUnknown(receipt,RECEIPT_KEYS,'FA-11 execution receipt');
  for(const key of ['receipt_id','project_id','sandbox_id','request_sha256','risk_class','status'])requireString(receipt[key],`receipt.${key}`);
  requireHash(receipt.receipt_sha256,'receipt.receipt_sha256');
  if(await sha256(bodyWithout(receipt,'receipt_sha256'))!==receipt.receipt_sha256)throw new DOMException('FA-11 execution receipt integrity failure','DataError');
  canonicalIso(receipt.created_at,'receipt.created_at');
  if(receipt.project_id!==handoff.project_id||receipt.request_sha256!==request.request_sha256||receipt.risk_class!==handoff.risk_class)throw new DOMException('execution receipt binding mismatch','SecurityError');
  if(!['COMPLETED','BLOCKED','FAILED'].includes(receipt.status))throw new TypeError('execution receipt status must be COMPLETED, BLOCKED or FAILED');
  for(const key of ['rollback_available','external_action_executed','network_request_performed','host_shell_executed','plaintext_secret_access'])if(typeof receipt[key]!=='boolean')throw new TypeError(`receipt.${key} must be boolean`);
  if(receipt.external_action_executed||receipt.network_request_performed||receipt.host_shell_executed||receipt.plaintext_secret_access)throw new DOMException('FA-11 browser-local receipt attempted forbidden side-effect claim','SecurityError');
  if(receipt.status==='COMPLETED'){
    if(!isPlainObject(receipt.result)||Object.hasOwn(receipt,'reason'))throw new TypeError('COMPLETED execution receipt requires result and no reason');
    if(request.external)throw new DOMException('browser-local FA-11 cannot complete external operation','SecurityError');
    if(receipt.rollback_available!==request.reversible)throw new DOMException('execution receipt rollback truth mismatch','DataError');
  }else{
    requireString(receipt.reason,'receipt.reason');
    if(Object.hasOwn(receipt,'result'))throw new TypeError(receipt.status+' execution receipt cannot contain result');
    if(receipt.rollback_available!==false)throw new DOMException(receipt.status.toLowerCase()+' receipt cannot claim rollback availability','DataError');
    if(receipt.status==='FAILED')requireString(receipt.error_name,'receipt.error_name',80);
    else if(Object.hasOwn(receipt,'error_name'))throw new TypeError('BLOCKED execution receipt cannot contain error_name');
  }
  return receipt;
}

async function assertExecutionIntegrity(executionIntegrity,projectId){
  if(!isPlainObject(executionIntegrity)||executionIntegrity.schema!=='musitu.axiom.execution-integrity.browser.v1')throw new TypeError('FA-11 execution integrity result required');
  rejectUnknown(executionIntegrity,INTEGRITY_KEYS,'FA-11 execution integrity');
  requireHash(executionIntegrity.integrity_sha256,'executionIntegrity.integrity_sha256');
  if(await sha256(bodyWithout(executionIntegrity,'integrity_sha256'))!==executionIntegrity.integrity_sha256)throw new DOMException('FA-11 execution integrity hash failure','DataError');
  if(executionIntegrity.project_id!==projectId)throw new DOMException('cross-project execution integrity blocked','SecurityError');
  if(executionIntegrity.status!=='PASS'||!Array.isArray(executionIntegrity.errors)||executionIntegrity.errors.length)throw new DOMException('FA-11 execution store integrity must PASS without errors','DataError');
  if(!Number.isInteger(executionIntegrity.event_count)||executionIntegrity.event_count<0)throw new TypeError('executionIntegrity.event_count must be a non-negative integer');
  if(executionIntegrity.network_policy!=='DENY_ALL_EXTERNAL_NETWORK'||executionIntegrity.secrets_policy!=='OPAQUE_SHORT_LIVED_OPERATION_SCOPED_NO_PLAINTEXT')throw new DOMException('FA-11 execution integrity boundary mismatch','SecurityError');
  return executionIntegrity;
}

export async function verifyOperationScopedExecutionOutcome({handoff,receipt,executionIntegrity,verifierActorId,at=new Date().toISOString()}={}){
  const request=await assertHandoff(handoff);
  await assertReceipt(receipt,handoff,request);
  await assertExecutionIntegrity(executionIntegrity,handoff.project_id);
  const verifier_actor_id=requireString(verifierActorId,'verifierActorId',180);
  if([handoff.builder_actor_id,handoff.actor_id,handoff.agent_id,handoff.workload_identity_id].includes(verifier_actor_id))throw new DOMException('independent outcome verifier must differ from builder executor and workload identity','NotAllowedError');
  const created_at=canonicalIso(at,'at');
  const body={
    schema:EXECUTION_OUTCOME_VERIFICATION_SCHEMA,
    project_id:handoff.project_id,
    work_id:handoff.work_id,
    checkpoint_sha256:handoff.checkpoint_sha256,
    handoff_sha256:handoff.handoff_sha256,
    request_sha256:request.request_sha256,
    receipt_id:receipt.receipt_id,
    receipt_sha256:receipt.receipt_sha256,
    execution_integrity_sha256:executionIntegrity.integrity_sha256,
    operation:handoff.operation,
    risk_class:handoff.risk_class,
    execution_status:receipt.status,
    status:receipt.status==='COMPLETED'?'VERIFIED_COMPLETED':receipt.status==='FAILED'?'VERIFIED_FAILED':'VERIFIED_BLOCKED',
    verifier_actor_id,
    independent_verification:'PASS',
    rollback_available:receipt.rollback_available,
    failure_state:receipt.status==='COMPLETED'?'NONE':receipt.status,
    failure_reason:receipt.status==='COMPLETED'?null:receipt.reason,
    external_action_executed:false,
    network_request_performed:false,
    host_shell_executed:false,
    plaintext_secret_access:false,
    authority_effect:'NONE',
    release_authority:false,
    production_authority:false,
    certification_authority:false,
    created_at,
  };
  return Object.freeze({...body,verification_sha256:await sha256(body)});
}



async function assertVerifiedOutcome(verified){
  if(!isPlainObject(verified)||verified.schema!==EXECUTION_OUTCOME_VERIFICATION_SCHEMA)throw new TypeError('verified execution outcome required');
  rejectUnknown(verified,VERIFIED_OUTCOME_KEYS,'verified execution outcome');
  for(const key of ['project_id','receipt_id','operation','risk_class','verifier_actor_id'])requireString(verified[key],`verifiedOutcome.${key}`,300);
  if(typeof verified.work_id!=='string'||clean(verified.work_id,300)!==verified.work_id)throw new TypeError('verifiedOutcome.work_id must be a normalized string');
  for(const key of ['checkpoint_sha256','handoff_sha256','request_sha256','receipt_sha256','execution_integrity_sha256','verification_sha256'])requireHash(verified[key],`verifiedOutcome.${key}`);
  if(await sha256(bodyWithout(verified,'verification_sha256'))!==verified.verification_sha256)throw new DOMException('verified execution outcome integrity failure','DataError');
  canonicalIso(verified.created_at,'verifiedOutcome.created_at');
  if(!['S0','S1','S2','S3','S4','S5'].includes(verified.risk_class))throw new TypeError('verifiedOutcome.risk_class must be S0..S5');
  if(!['COMPLETED','BLOCKED','FAILED'].includes(verified.execution_status))throw new TypeError('verifiedOutcome.execution_status must be COMPLETED, BLOCKED or FAILED');
  const expectedStatus=verified.execution_status==='COMPLETED'?'VERIFIED_COMPLETED':verified.execution_status==='FAILED'?'VERIFIED_FAILED':'VERIFIED_BLOCKED';
  if(verified.status!==expectedStatus)throw new DOMException('verified execution outcome status semantic mismatch','DataError');
  if(verified.independent_verification!=='PASS')throw new DOMException('verified execution outcome independent verification must PASS','SecurityError');
  if(typeof verified.rollback_available!=='boolean')throw new TypeError('verifiedOutcome.rollback_available must be boolean');
  if(verified.execution_status==='COMPLETED'){
    if(verified.failure_state!=='NONE'||verified.failure_reason!==null)throw new DOMException('completed outcome cannot carry failure state','DataError');
  }else{
    if(verified.failure_state!==verified.execution_status)throw new DOMException(verified.execution_status.toLowerCase()+' outcome must preserve '+verified.execution_status+' failure state','DataError');
    requireString(verified.failure_reason,'verifiedOutcome.failure_reason',300);
    if(verified.rollback_available!==false)throw new DOMException(verified.execution_status.toLowerCase()+' outcome cannot claim rollback availability','DataError');
  }
  for(const key of ['external_action_executed','network_request_performed','host_shell_executed','plaintext_secret_access'])if(verified[key]!==false)throw new DOMException(`verified execution outcome ${key} must remain false`,'SecurityError');
  if(verified.authority_effect!=='NONE'||verified.release_authority!==false||verified.production_authority!==false||verified.certification_authority!==false)throw new DOMException('verified execution outcome authority boundary invalid','SecurityError');
  return verified;
}

export async function createExecutionOutcomeEvidence(verified){
  await assertVerifiedOutcome(verified);
  const evidence={
    schema:'musitu.axiom.evidence.v1',
    type:'Evidence',
    id:`evidence_${verified.receipt_sha256.slice(0,24)}`,
    version:1,
    created_at:verified.created_at,
    updated_at:verified.created_at,
    data:{
      inputs:[{project_id:verified.project_id,work_id:verified.work_id,operation:verified.operation,risk_class:verified.risk_class}],
      sources:[{kind:'FA11_BROWSER_LOCAL_EXECUTION_RECEIPT',receipt_id:verified.receipt_id}],
      capability_chain:['ChangeAdmission','OperationScopedExecutorHandoff','FA11AuthorizationGateway','FA11GovernedExecutionStore','ExecutionOutcomeVerification'],
      calculations:[{kind:'EXECUTION_RECEIPT_INTEGRITY',status:'PASS'},{kind:'FA11_STORE_INTEGRITY',status:'PASS'}],
      actions:[{kind:verified.execution_status==='COMPLETED'?'EXECUTION_COMPLETED':verified.execution_status==='FAILED'?'EXECUTION_FAILED':'EXECUTION_BLOCKED',rollback_available:verified.rollback_available,external_action_executed:false}],
      policies:['S0_S5_FROZEN','BUILDER_EXECUTOR_VERIFIER_SEPARATION','FAILURE_TRUTH_PRESERVED','ROLLBACK_TRUTH_PRESERVED','NO_AUTHORITY_ESCALATION'],
      approvals:[],
      hashes:[verified.handoff_sha256,verified.request_sha256,verified.receipt_sha256,verified.execution_integrity_sha256,verified.verification_sha256],
      receipts:[{schema:'musitu.axiom.execution-receipt.browser.v1',receipt_id:verified.receipt_id,receipt_sha256:verified.receipt_sha256,status:verified.execution_status}],
      verification:{status:verified.status,verifier_actor_id:verified.verifier_actor_id,independent_verification:'PASS',receipt_integrity:'PASS',execution_store_integrity:'PASS',authority_effect:'NONE',release_authority:false,production_authority:false,certification_authority:false},
      failures:verified.failure_state==='NONE'?[]:[{status:verified.failure_state,reason:verified.failure_reason}],
      timestamps:[{kind:'OUTCOME_VERIFIED',at:verified.created_at}],
      versions:[{schema:EXECUTION_OUTCOME_VERIFICATION_SCHEMA,verification_sha256:verified.verification_sha256}],
    },
  };
  assertAxiomObject(evidence,{expectedType:'Evidence'});
  return Object.freeze(structuredClone(evidence));
}


export async function reconcileVerifiedExecutionOutcome({persistence,verifiedOutcome,at=verifiedOutcome?.created_at}={}){
  if(!persistence||typeof persistence!=='object'||typeof persistence.load!=='function'||typeof persistence.commit!=='function')throw new TypeError('Living Product Graph persistence API required');
  const evidence=await createExecutionOutcomeEvidence(verifiedOutcome);
  const projectId=requireString(verifiedOutcome.project_id,'verifiedOutcome.project_id',300);
  const current=await persistence.load(projectId);
  if(!current)throw new DOMException('Living Product Graph required before execution outcome reconciliation','NotFoundError');
  const nodeId=`lpg_evidence_${verifiedOutcome.receipt_sha256.slice(0,24)}`;
  const priorForRequest=current.nodes.filter(node=>node.type==='EvidenceRef'&&node.data?.request_sha256===verifiedOutcome.request_sha256);
  const terminalPrior=priorForRequest.find(node=>['COMPLETED','FAILED'].includes(node.data?.execution_status));
  if(terminalPrior&&terminalPrior.data?.receipt_sha256!==verifiedOutcome.receipt_sha256)throw new DOMException('conflicting execution replay: request already has a different terminal receipt','DataError');
  const existing=current.nodes.find(node=>node.node_id===nodeId);
  if(existing){
    if(existing.type!=='EvidenceRef'||existing.data?.evidence_id!==evidence.id||existing.data?.receipt_sha256!==verifiedOutcome.receipt_sha256||existing.data?.request_sha256!==verifiedOutcome.request_sha256||existing.data?.verification_sha256!==verifiedOutcome.verification_sha256)throw new DOMException('execution outcome replay conflicts with existing EvidenceRef','DataError');
    return Object.freeze({status:'IDEMPOTENT_REPLAY',project_id:projectId,evidence,graph:structuredClone(current),authority_effect:'NONE',release_authority:false,production_authority:false,certification_authority:false});
  }
  const created_at=canonicalIso(at,'reconciliation.at');
  const generation=current.generation+1;
  const nodes=current.nodes.map(node=>({...structuredClone(node),metadata:{...structuredClone(node.metadata),generation}}));
  const edges=current.edges.map(edge=>({...structuredClone(edge),metadata:{...structuredClone(edge.metadata),generation}}));
  nodes.push({
    node_id:nodeId,
    type:'EvidenceRef',
    metadata:{
      project_id:projectId,
      version:1,
      generation,
      valid_from:created_at,
      valid_to:null,
      provenance:{source:'operation-scoped-execution-outcome',handoff_sha256:verifiedOutcome.handoff_sha256,request_sha256:verifiedOutcome.request_sha256,receipt_sha256:verifiedOutcome.receipt_sha256},
      evidence_refs:[evidence.id],
      confidence:1,
      uncertainty:{kind:'NONE'},
      actor_id:verifiedOutcome.verifier_actor_id,
      risk_class:verifiedOutcome.risk_class,
      content_hash:verifiedOutcome.verification_sha256,
      freshness:{as_of:created_at},
      supersession:{state:'CURRENT',supersedes:[]},
    },
    data:{
      evidence_id:evidence.id,
      handoff_sha256:verifiedOutcome.handoff_sha256,
      request_sha256:verifiedOutcome.request_sha256,
      receipt_sha256:verifiedOutcome.receipt_sha256,
      verification_sha256:verifiedOutcome.verification_sha256,
      execution_status:verifiedOutcome.execution_status,
      rollback_available:verifiedOutcome.rollback_available,
      failure_state:verifiedOutcome.failure_state,
    },
  });
  const next={schema:current.schema,project_id:current.project_id,generation,impact_state:current.impact_state,nodes,edges};
  const saved=await persistence.commit(next,{expectedGeneration:current.generation});
  return Object.freeze({status:'RECONCILED',project_id:projectId,evidence,graph:structuredClone(saved),authority_effect:'NONE',release_authority:false,production_authority:false,certification_authority:false});
}


export const EXTERNAL_WORKER_RESULT_VERIFICATION_SCHEMA='musitu.axiom.external-worker-result-verification.v1';

const EXTERNAL_DISPATCH_RECEIPT_KEYS=new Set([
  'schema','project_id','work_id','handoff_sha256','request_sha256','workload_identity_id','operation','risk_class','destination',
  'provider','provider_work_id','provider_status','dispatch_idempotency_sha256','external_action_executed','live_runtime_qualification',
  'authority_effect','release_authority','production_authority','certification_authority','created_at','receipt_sha256',
]);
const EXTERNAL_RESULT_RECEIPT_KEYS=new Set([
  'schema','project_id','work_id','handoff_sha256','request_sha256','workload_identity_id','provider_work_id','dispatch_receipt_sha256',
  'dispatch_idempotency_sha256','production_authority','provider','provider_status','provider_output','provider_output_sha256',
  'provider_claimed_external_action_executed','provider_data_authority','independent_verification','external_action_executed',
  'live_runtime_qualification','authority_effect','release_authority','certification_authority','created_at','receipt_sha256',
]);
const EXTERNAL_RESULT_VERIFICATION_KEYS=new Set([
  'schema','project_id','work_id','handoff_sha256','request_sha256','workload_identity_id','dispatch_receipt_sha256',
  'result_receipt_sha256','provider','provider_work_id','provider_status','provider_output_sha256',
  'provider_claimed_external_action_executed','provider_data_authority','verifier_actor_id','independent_verification',
  'execution_truth','external_action_executed','live_runtime_qualification','status','authority_effect',
  'release_authority','production_authority','certification_authority','created_at','verification_sha256',
]);

async function assertExternalDispatchReceipt(receipt){
  if(!isPlainObject(receipt)||receipt.schema!=='musitu.axiom.external-worker-dispatch-receipt.v1')throw new TypeError('external worker dispatch receipt required');
  rejectUnknown(receipt,EXTERNAL_DISPATCH_RECEIPT_KEYS,'external worker dispatch receipt');
  for(const key of ['project_id','work_id','workload_identity_id','operation','risk_class','destination','provider','provider_work_id','provider_status'])requireString(receipt[key],`dispatchReceipt.${key}`,key==='destination'?2048:300);
  for(const key of ['handoff_sha256','request_sha256','dispatch_idempotency_sha256','receipt_sha256'])requireHash(receipt[key],`dispatchReceipt.${key}`);
  if(await sha256(bodyWithout(receipt,'receipt_sha256'))!==receipt.receipt_sha256)throw new DOMException('external worker dispatch receipt integrity failure','DataError');
  canonicalIso(receipt.created_at,'dispatchReceipt.created_at');
  if(receipt.risk_class!=='S3')throw new DOMException('external worker dispatch receipt must remain S3','SecurityError');
  if(receipt.external_action_executed!==false||receipt.live_runtime_qualification!=='NOT_PROVEN')throw new DOMException('dispatch receipt cannot prove external execution or live qualification','SecurityError');
  if(receipt.authority_effect!=='NONE'||receipt.release_authority!==false||receipt.production_authority!==false||receipt.certification_authority!==false)throw new DOMException('external worker dispatch receipt authority boundary invalid','SecurityError');
  return receipt;
}

async function assertExternalResultReceipt(receipt){
  if(!isPlainObject(receipt)||receipt.schema!=='musitu.axiom.engineering-worker-result-receipt.v1')throw new TypeError('engineering worker result receipt required');
  rejectUnknown(receipt,EXTERNAL_RESULT_RECEIPT_KEYS,'engineering worker result receipt');
  for(const key of ['project_id','work_id','workload_identity_id','provider_work_id','provider','provider_status','provider_data_authority','independent_verification'])requireString(receipt[key],`resultReceipt.${key}`,300);
  for(const key of ['handoff_sha256','request_sha256','dispatch_receipt_sha256','dispatch_idempotency_sha256','provider_output_sha256','receipt_sha256'])requireHash(receipt[key],`resultReceipt.${key}`);
  if(await sha256(receipt.provider_output)!==receipt.provider_output_sha256)throw new DOMException('engineering worker provider output hash mismatch','DataError');
  if(await sha256(bodyWithout(receipt,'receipt_sha256'))!==receipt.receipt_sha256)throw new DOMException('engineering worker result receipt integrity failure','DataError');
  canonicalIso(receipt.created_at,'resultReceipt.created_at');
  if(typeof receipt.provider_claimed_external_action_executed!=='boolean')throw new TypeError('resultReceipt.provider_claimed_external_action_executed must be boolean');
  if(receipt.provider_data_authority!=='UNTRUSTED_MECHANISM_DATA'||receipt.independent_verification!=='NOT_PROVEN')throw new DOMException('provider result must remain untrusted and unverified before AXIOM verification','SecurityError');
  if(receipt.external_action_executed!==false||receipt.live_runtime_qualification!=='NOT_PROVEN')throw new DOMException('provider result receipt cannot certify external execution or live qualification','SecurityError');
  if(receipt.authority_effect!=='NONE'||receipt.release_authority!==false||receipt.production_authority!==false||receipt.certification_authority!==false)throw new DOMException('engineering worker result receipt authority boundary invalid','SecurityError');
  return receipt;
}

async function assertExternalWorkerResultVerification(verified){
  if(!isPlainObject(verified)||verified.schema!==EXTERNAL_WORKER_RESULT_VERIFICATION_SCHEMA)throw new TypeError('verified external worker result required');
  rejectUnknown(verified,EXTERNAL_RESULT_VERIFICATION_KEYS,'verified external worker result');
  for(const key of ['project_id','work_id','workload_identity_id','provider','provider_work_id','provider_status','provider_data_authority','verifier_actor_id','independent_verification','execution_truth','status'])requireString(verified[key],`verifiedExternalResult.${key}`,300);
  for(const key of ['handoff_sha256','request_sha256','dispatch_receipt_sha256','result_receipt_sha256','provider_output_sha256','verification_sha256'])requireHash(verified[key],`verifiedExternalResult.${key}`);
  if(await sha256(bodyWithout(verified,'verification_sha256'))!==verified.verification_sha256)throw new DOMException('verified external worker result integrity failure','DataError');
  canonicalIso(verified.created_at,'verifiedExternalResult.created_at');
  if(typeof verified.provider_claimed_external_action_executed!=='boolean')throw new TypeError('verified external result provider claim must be boolean');
  if(verified.status!=='VERIFIED_PROVIDER_REPORT'||verified.provider_data_authority!=='UNTRUSTED_MECHANISM_DATA'||verified.independent_verification!=='PASS_BINDING_INTEGRITY_ONLY'||verified.execution_truth!=='NOT_PROVEN')throw new DOMException('external result verification semantic boundary invalid','SecurityError');
  if(verified.external_action_executed!==false||verified.live_runtime_qualification!=='NOT_PROVEN')throw new DOMException('external result verification cannot certify execution or live runtime','SecurityError');
  if(verified.authority_effect!=='NONE'||verified.release_authority!==false||verified.production_authority!==false||verified.certification_authority!==false)throw new DOMException('verified external result authority boundary invalid','SecurityError');
  return verified;
}

export async function verifyExternalWorkerResult({dispatchReceipt,resultReceipt,verifierActorId,at=new Date().toISOString()}={}){
  await assertExternalDispatchReceipt(dispatchReceipt);
  await assertExternalResultReceipt(resultReceipt);
  const verifier_actor_id=requireString(verifierActorId,'verifierActorId',180);
  if(verifier_actor_id===dispatchReceipt.workload_identity_id)throw new DOMException('independent external result verifier must differ from executor workload identity','NotAllowedError');
  const bindings=[
    ['project_id',dispatchReceipt.project_id,resultReceipt.project_id],
    ['work_id',dispatchReceipt.work_id,resultReceipt.work_id],
    ['handoff_sha256',dispatchReceipt.handoff_sha256,resultReceipt.handoff_sha256],
    ['request_sha256',dispatchReceipt.request_sha256,resultReceipt.request_sha256],
    ['workload_identity_id',dispatchReceipt.workload_identity_id,resultReceipt.workload_identity_id],
    ['provider',dispatchReceipt.provider,resultReceipt.provider],
    ['provider_work_id',dispatchReceipt.provider_work_id,resultReceipt.provider_work_id],
    ['dispatch_idempotency_sha256',dispatchReceipt.dispatch_idempotency_sha256,resultReceipt.dispatch_idempotency_sha256],
    ['dispatch_receipt_sha256',dispatchReceipt.receipt_sha256,resultReceipt.dispatch_receipt_sha256],
  ];
  for(const [name,expected,actual] of bindings)if(actual!==expected)throw new DOMException('external worker result '+name+' binding mismatch','SecurityError');
  const created_at=canonicalIso(at,'at');
  const body={
    schema:EXTERNAL_WORKER_RESULT_VERIFICATION_SCHEMA,
    project_id:dispatchReceipt.project_id,
    work_id:dispatchReceipt.work_id,
    handoff_sha256:dispatchReceipt.handoff_sha256,
    request_sha256:dispatchReceipt.request_sha256,
    workload_identity_id:dispatchReceipt.workload_identity_id,
    dispatch_receipt_sha256:dispatchReceipt.receipt_sha256,
    result_receipt_sha256:resultReceipt.receipt_sha256,
    provider:resultReceipt.provider,
    provider_work_id:resultReceipt.provider_work_id,
    provider_status:resultReceipt.provider_status,
    provider_output_sha256:resultReceipt.provider_output_sha256,
    provider_claimed_external_action_executed:resultReceipt.provider_claimed_external_action_executed,
    provider_data_authority:'UNTRUSTED_MECHANISM_DATA',
    verifier_actor_id,
    independent_verification:'PASS_BINDING_INTEGRITY_ONLY',
    execution_truth:'NOT_PROVEN',
    external_action_executed:false,
    live_runtime_qualification:'NOT_PROVEN',
    status:'VERIFIED_PROVIDER_REPORT',
    authority_effect:'NONE',
    release_authority:false,
    production_authority:false,
    certification_authority:false,
    created_at,
  };
  return Object.freeze({...body,verification_sha256:await sha256(body)});
}

export async function createExternalWorkerResultEvidence(verified){
  await assertExternalWorkerResultVerification(verified);
  const evidence={
    schema:'musitu.axiom.evidence.v1',
    type:'Evidence',
    id:`evidence_${verified.result_receipt_sha256.slice(0,24)}`,
    version:1,
    created_at:verified.created_at,
    updated_at:verified.created_at,
    data:{
      inputs:[{project_id:verified.project_id,work_id:verified.work_id,provider:verified.provider,provider_work_id:verified.provider_work_id}],
      sources:[
        {kind:'EXTERNAL_WORKER_DISPATCH_RECEIPT',receipt_sha256:verified.dispatch_receipt_sha256},
        {kind:'EXTERNAL_WORKER_PROVIDER_RESULT_RECEIPT',receipt_sha256:verified.result_receipt_sha256,provider_status:verified.provider_status},
      ],
      capability_chain:['ChangeAdmission','OperationScopedExecutorHandoff','FA11AuthorizationGateway','EngineeringWorkerBackend','ExternalWorkerResultVerification'],
      calculations:[
        {kind:'DISPATCH_RESULT_BINDING_INTEGRITY',status:'PASS'},
        {kind:'PROVIDER_OUTPUT_CONTENT_HASH',status:'PASS'},
      ],
      actions:[{kind:'PROVIDER_RESULT_REPORTED',provider_status:verified.provider_status,external_action_executed:false}],
      policies:['PROVIDER_OUTPUT_IS_DATA_NOT_AUTHORITY','BUILDER_EXECUTOR_VERIFIER_SEPARATION','NO_EXTERNAL_EXECUTION_CERTIFICATION_WITHOUT_EVIDENCE','NO_AUTHORITY_ESCALATION'],
      approvals:[],
      hashes:[verified.handoff_sha256,verified.request_sha256,verified.dispatch_receipt_sha256,verified.result_receipt_sha256,verified.provider_output_sha256,verified.verification_sha256],
      receipts:[
        {schema:'musitu.axiom.external-worker-dispatch-receipt.v1',receipt_sha256:verified.dispatch_receipt_sha256},
        {schema:'musitu.axiom.engineering-worker-result-receipt.v1',receipt_sha256:verified.result_receipt_sha256,status:verified.provider_status},
      ],
      verification:{
        status:'VERIFIED_PROVIDER_REPORT',
        verifier_actor_id:verified.verifier_actor_id,
        independent_verification:'PASS_BINDING_INTEGRITY_ONLY',
        provider_report_integrity:'PASS',
        provider_data_authority:'UNTRUSTED_MECHANISM_DATA',
        execution_truth:'NOT_PROVEN',
        external_action_executed:false,
        live_runtime_qualification:'NOT_PROVEN',
        authority_effect:'NONE',
        release_authority:false,
        production_authority:false,
        certification_authority:false,
      },
      failures:[],
      timestamps:[{kind:'PROVIDER_RESULT_VERIFIED_AS_REPORT_ONLY',at:verified.created_at}],
      versions:[{schema:EXTERNAL_WORKER_RESULT_VERIFICATION_SCHEMA,verification_sha256:verified.verification_sha256}],
    },
  };
  assertAxiomObject(evidence,{expectedType:'Evidence'});
  return Object.freeze(structuredClone(evidence));
}
