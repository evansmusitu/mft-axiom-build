import {finalizeOperationScopedExecutorHandoff} from './change_admission.js';
import {assertAdapterDescriptor} from './infrastructure_contracts.js';
import {clean,clone,sha256} from '../execution_security.js';

const HASH=/^[a-f0-9]{64}$/i;
const requiredText=(name,value,max=300)=>{if(typeof value!=='string'||!value||clean(value,max)!==value)throw new TypeError(name+' must be a normalized non-empty string');return value;};
const requiredHash=(name,value)=>{requiredText(name,value,64);if(!HASH.test(value))throw new TypeError(name+' must be a sha256 string');return value.toLowerCase();};
const iso=(value,label='at')=>{if(typeof value!=='string')throw new TypeError(label+' must be a string');const ms=Date.parse(value);if(!Number.isFinite(ms))throw new TypeError(label+' must be an ISO instant');return new Date(ms).toISOString();};

export async function dispatchAuthorizedExternalOperation({handoff,authorityEnvelope,approvals=[],backend,at=new Date().toISOString()}={}){
  if(!backend||typeof backend!=='object'||typeof backend.submitOperation!=='function')throw new TypeError('EngineeringWorkerBackend required');
  assertAdapterDescriptor(backend.descriptor,{expectedKind:'EngineeringWorkerBackend'});
  if(backend.descriptor.semantic_owner!=='AXIOM'||backend.descriptor.authority!=='MECHANISM_ONLY'||backend.descriptor.fail_closed!==true)throw new DOMException('EngineeringWorkerBackend authority boundary invalid','SecurityError');
  if(backend.descriptor.runtime_activation_authorized===true||backend.descriptor.production_authority===true||backend.descriptor.release_authority===true||backend.descriptor.certification_authority===true)throw new DOMException('EngineeringWorkerBackend cannot self-activate or grant authority','SecurityError');

  const decision=await finalizeOperationScopedExecutorHandoff({handoff,authorityEnvelope,approvals});
  if(decision.status!=='AUTHORIZED'||decision.execution_allowed!==true)throw new DOMException('external worker dispatch requires finalized FA-11 authorization','NotAllowedError');
  const request=handoff?.execution_request;
  if(!request||request.request_sha256!==decision.request_sha256)throw new DOMException('external worker authorization request binding mismatch','SecurityError');
  if(request.external!==true||request.risk_class!=='S3')throw new DOMException('external worker dispatch currently permits S3 external operations only','NotAllowedError');
  if(!request.destination)throw new DOMException('external worker dispatch requires exact destination','SecurityError');
  if(handoff.release_authority!==false||handoff.production_authority!==false||handoff.certification_authority!==false)throw new DOMException('external worker handoff authority boundary invalid','SecurityError');

  const dispatchKeyBody={
    schema:'musitu.axiom.external-worker-dispatch-key.v1',
    project_id:requiredText('project_id',handoff.project_id),
    work_id:requiredText('work_id',handoff.work_id),
    handoff_sha256:requiredHash('handoff_sha256',handoff.handoff_sha256),
    request_sha256:requiredHash('request_sha256',request.request_sha256),
    workload_identity_id:requiredText('workload_identity_id',handoff.workload_identity_id,220),
    operation:requiredText('operation',request.operation,80),
    destination:requiredText('destination',request.destination,2048),
  };
  const idempotency_key=await sha256(dispatchKeyBody);
  const submission=await backend.submitOperation({
    schema:'musitu.axiom.external-worker-dispatch.v1',
    ...dispatchKeyBody,
    risk_class:request.risk_class,
    payload:clone(request.payload??null),
    idempotency_key,
    external_action_authorized:true,
    production_authority:false,
  });
  if(submission.schema!=='musitu.axiom.engineering-worker-submit-receipt.v1')throw new TypeError('EngineeringWorkerBackend returned invalid submission receipt');
  if(submission.project_id!==handoff.project_id||submission.work_id!==handoff.work_id||submission.handoff_sha256!==handoff.handoff_sha256||submission.request_sha256!==request.request_sha256||submission.workload_identity_id!==handoff.workload_identity_id)throw new DOMException('EngineeringWorkerBackend submission binding mismatch','SecurityError');
  if(submission.idempotency_key_sha256!==idempotency_key)throw new DOMException('EngineeringWorkerBackend idempotency binding mismatch','SecurityError');
  if(submission.external_action_executed!==false||submission.live_runtime_qualification!=='NOT_PROVEN'||submission.authority_effect!=='NONE'||submission.release_authority!==false||submission.production_authority!==false||submission.certification_authority!==false)throw new DOMException('EngineeringWorkerBackend submission exceeded mechanism-only boundary','SecurityError');

  const body={
    schema:'musitu.axiom.external-worker-dispatch-receipt.v1',
    project_id:handoff.project_id,work_id:handoff.work_id,handoff_sha256:handoff.handoff_sha256,
    request_sha256:request.request_sha256,workload_identity_id:handoff.workload_identity_id,
    operation:request.operation,risk_class:request.risk_class,destination:request.destination,
    provider:submission.provider,provider_work_id:submission.provider_work_id,provider_status:submission.provider_status,
    dispatch_idempotency_sha256:idempotency_key,external_action_executed:false,live_runtime_qualification:'NOT_PROVEN',
    authority_effect:'NONE',release_authority:false,production_authority:false,certification_authority:false,
    created_at:iso(at),
  };
  return Object.freeze({...body,receipt_sha256:await sha256(body)});
}
