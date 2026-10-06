import {assertAxiomObject} from '../foundation_contracts.js';
import {sha256} from '../execution_security.js';

export const EXECUTION_OUTCOME_VERIFICATION_SCHEMA='musitu.axiom.product-execution-outcome-verification.v1';

const HASH=/^[a-f0-9]{64}$/i;
const HANDOFF_KEYS=new Set(['schema','scope','project_id','work_id','checkpoint_sha256','change_admission_request_sha256','change_admission_evaluation_sha256','authority_sha256','actor_id','agent_id','workload_identity_id','builder_actor_id','risk_class','operation','execution_request','authority_effect','execution_authority','external_execution_authority','release_authority','production_authority','certification_authority','created_at','handoff_sha256']);
const REQUEST_KEYS=new Set(['schema','project_id','actor_id','agent_id','workload_identity_id','operation','computed_risk_class','risk_class','effect','reversible','external','required_tool_scope','target','payload','destination','compute_units','instruction_provenance','requested_at','authority_sha256','execution_mode','request_sha256']);
const RECEIPT_KEYS=new Set(['schema','receipt_id','project_id','sandbox_id','request_sha256','risk_class','status','result','reason','rollback_available','external_action_executed','network_request_performed','host_shell_executed','plaintext_secret_access','created_at','receipt_sha256']);
const INTEGRITY_KEYS=new Set(['schema','project_id','status','errors','event_count','network_policy','secrets_policy','integrity_sha256']);
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
  if(!['COMPLETED','BLOCKED'].includes(receipt.status))throw new TypeError('execution receipt status must be COMPLETED or BLOCKED');
  for(const key of ['rollback_available','external_action_executed','network_request_performed','host_shell_executed','plaintext_secret_access'])if(typeof receipt[key]!=='boolean')throw new TypeError(`receipt.${key} must be boolean`);
  if(receipt.external_action_executed||receipt.network_request_performed||receipt.host_shell_executed||receipt.plaintext_secret_access)throw new DOMException('FA-11 browser-local receipt attempted forbidden side-effect claim','SecurityError');
  if(receipt.status==='COMPLETED'){
    if(!isPlainObject(receipt.result)||Object.hasOwn(receipt,'reason'))throw new TypeError('COMPLETED execution receipt requires result and no reason');
    if(request.external)throw new DOMException('browser-local FA-11 cannot complete external operation','SecurityError');
    if(receipt.rollback_available!==request.reversible)throw new DOMException('execution receipt rollback truth mismatch','DataError');
  }else{
    requireString(receipt.reason,'receipt.reason');
    if(Object.hasOwn(receipt,'result'))throw new TypeError('BLOCKED execution receipt cannot contain result');
    if(receipt.rollback_available!==false)throw new DOMException('blocked receipt cannot claim rollback availability','DataError');
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
    status:receipt.status==='COMPLETED'?'VERIFIED_COMPLETED':'VERIFIED_BLOCKED',
    verifier_actor_id,
    independent_verification:'PASS',
    rollback_available:receipt.rollback_available,
    failure_state:receipt.status==='BLOCKED'?'BLOCKED':'NONE',
    failure_reason:receipt.status==='BLOCKED'?receipt.reason:null,
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

export async function createExecutionOutcomeEvidence(verified){
  if(!isPlainObject(verified)||verified.schema!==EXECUTION_OUTCOME_VERIFICATION_SCHEMA)throw new TypeError('verified execution outcome required');
  requireHash(verified.verification_sha256,'verification_sha256');
  if(await sha256(bodyWithout(verified,'verification_sha256'))!==verified.verification_sha256)throw new DOMException('verified execution outcome integrity failure','DataError');
  if(verified.independent_verification!=='PASS'||verified.authority_effect!=='NONE'||verified.release_authority!==false||verified.production_authority!==false||verified.certification_authority!==false)throw new DOMException('verified execution outcome authority boundary invalid','SecurityError');
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
      actions:[{kind:verified.execution_status==='COMPLETED'?'EXECUTION_COMPLETED':'EXECUTION_BLOCKED',rollback_available:verified.rollback_available,external_action_executed:false}],
      policies:['S0_S5_FROZEN','BUILDER_EXECUTOR_VERIFIER_SEPARATION','FAILURE_TRUTH_PRESERVED','ROLLBACK_TRUTH_PRESERVED','NO_AUTHORITY_ESCALATION'],
      approvals:[],
      hashes:[verified.handoff_sha256,verified.request_sha256,verified.receipt_sha256,verified.execution_integrity_sha256,verified.verification_sha256],
      receipts:[{schema:'musitu.axiom.execution-receipt.browser.v1',receipt_id:verified.receipt_id,receipt_sha256:verified.receipt_sha256,status:verified.execution_status}],
      verification:{status:verified.status,verifier_actor_id:verified.verifier_actor_id,independent_verification:'PASS',receipt_integrity:'PASS',execution_store_integrity:'PASS',authority_effect:'NONE',release_authority:false,production_authority:false,certification_authority:false},
      failures:verified.failure_state==='BLOCKED'?[{status:'BLOCKED',reason:verified.failure_reason}]:[],
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
