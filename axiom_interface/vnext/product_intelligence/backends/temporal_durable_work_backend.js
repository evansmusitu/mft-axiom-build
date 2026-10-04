import {assertAdapterDescriptor} from '../infrastructure_contracts.js';

export const TEMPORAL_DURABLE_WORK_DESCRIPTOR=Object.freeze({
  kind:'DurableWorkBackend',
  adapter_version:'1.0.0',
  provider:'temporal',
  provider_baseline:'1.32.0',
  semantic_owner:'AXIOM',
  authority:'MECHANISM_ONLY',
  capabilities:Object.freeze(['start','describe','signal','cancel','result','durable-replay-provider']),
  unsupported_operations:Object.freeze(['policy-decision','authority-grant','human-approval','production-promotion','secret-release']),
  timeout_ms:30000,
  retry:Object.freeze({max_attempts:1,backoff:'CALLER_GOVERNED'}),
  idempotency:Object.freeze({mode:'REQUIRED_FOR_MUTATIONS',key_scope:'PROJECT_WORK_OPERATION'}),
  data_classification:Object.freeze(['project-private','work-state','evidence-referenced']),
  egress:Object.freeze({required:true,allowed_origins:Object.freeze([])}),
  identity_binding:Object.freeze({required:true,mode:'AXIOM_WORKLOAD_ID'}),
  evidence_envelope:Object.freeze({schema:'musitu.axiom.evidence.v1',required:true}),
  health:Object.freeze({mode:'EXPLICIT_PROVIDER_STATUS'}),
  migration_export:Object.freeze({supported:true,format:'TEMPORAL_HISTORY_PLUS_AXIOM_WORK_EXPORT'}),
  fail_closed:true,
  live_runtime_qualification:'NOT_PROVEN',
});
assertAdapterDescriptor(TEMPORAL_DURABLE_WORK_DESCRIPTOR,{expectedKind:'DurableWorkBackend'});

const clean=(value,max=1000)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);
const isPlainObject=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const FORBIDDEN_KEY=/^(?:access|refresh|id)?_?token$|authorization|api_?key|password|private_?key|client_?secret|secret$/i;
const AUTHORITY_SIGNAL=/(?:authori[sz]|grant|approve|permission|production|secret|identity|security[-_ ]?policy)/i;

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
function rejectCredentialMaterial(value,path='input'){
  if(!value||typeof value!=='object') return;
  for(const [key,child] of Object.entries(value)){
    if(FORBIDDEN_KEY.test(key)) throw new DOMException(`${path}.${key} contains forbidden credential material`,'SecurityError');
    rejectCredentialMaterial(child,`${path}.${key}`);
  }
}
function requiredText(name,value,max=180){const v=clean(value,max);if(!v)throw new TypeError(`${name} required`);return v;}
function assertTransport(transport){
  if(!transport||typeof transport!=='object') throw new TypeError('Temporal transport required');
  for(const method of ['start','describe','signal','cancel','result']) if(typeof transport[method]!=='function') throw new TypeError(`Temporal transport.${method} required`);
}
function assertHandle(handle){
  if(!isPlainObject(handle)||handle.schema!=='musitu.axiom.temporal-work-receipt.v1') throw new TypeError('Temporal AXIOM work handle required');
  for(const field of ['project_id','work_id','workflow_id','run_id','workload_identity_id']) if(!clean(handle[field],240)) throw new TypeError(`Temporal work handle ${field} required`);
  if(handle.authority_effect!=='NONE'||handle.production_authority!==false) throw new DOMException('Temporal handle authority boundary invalid','SecurityError');
  return handle;
}

export function createTemporalDurableWorkBackend({transport,namespace='default',taskQueue='axiom-product-intelligence'}={}){
  assertTransport(transport);
  namespace=requiredText('namespace',namespace,180);
  taskQueue=requiredText('taskQueue',taskQueue,180);

  const backend={
    descriptor:TEMPORAL_DURABLE_WORK_DESCRIPTOR,
    async startWork({projectId,workId,workflowType,workloadIdentityId,idempotencyKey,input={}}={}){
      const project_id=requiredText('projectId',projectId),work_id=requiredText('workId',workId),workflow_type=requiredText('workflowType',workflowType);
      const workload_identity_id=requiredText('workloadIdentityId',workloadIdentityId,220),idempotency_key=requiredText('idempotencyKey',idempotencyKey,220);
      if(!isPlainObject(input)) throw new TypeError('input must be a plain object');
      rejectCredentialMaterial(input);
      const workflow_id=`axiom:${project_id}:${work_id}`;
      const provider=await transport.start({
        namespace,task_queue:taskQueue,workflow_type,workflow_id,idempotency_key,
        args:[structuredClone(input)],
        memo:{project_id,work_id,workload_identity_id,semantic_owner:'AXIOM',authority:'MECHANISM_ONLY'},
      });
      if(!isPlainObject(provider)||clean(provider.workflow_id,300)!==workflow_id||!clean(provider.run_id,300)) throw new TypeError('Temporal start returned invalid workflow handle');
      const body={
        schema:'musitu.axiom.temporal-work-receipt.v1',project_id,work_id,workflow_id,run_id:clean(provider.run_id,300),
        workload_identity_id,provider:'temporal',provider_status:clean(provider.status,80)||'UNKNOWN',namespace,task_queue:taskQueue,
        authority_effect:'NONE',external_action_executed:false,production_authority:false,semantic_owner:'AXIOM',
        live_runtime_qualification:'NOT_PROVEN',idempotency_key_sha256:await sha256(idempotency_key),created_at:new Date().toISOString(),
      };
      return Object.freeze({...body,receipt_sha256:await sha256(body)});
    },
    async describeWork(handle){
      handle=assertHandle(handle);
      const provider=await transport.describe({namespace,workflow_id:handle.workflow_id,run_id:handle.run_id});
      if(!isPlainObject(provider)||!clean(provider.status,80)) throw new TypeError('Temporal describe returned invalid status');
      return Object.freeze({schema:'musitu.axiom.temporal-work-status.v1',project_id:handle.project_id,work_id:handle.work_id,workflow_id:handle.workflow_id,run_id:handle.run_id,provider_status:clean(provider.status,80),history_length:Number.isInteger(provider.history_length)?provider.history_length:null,authority_effect:'NONE',production_authority:false,live_runtime_qualification:'NOT_PROVEN'});
    },
    async signalWork(handle,{signal,payload={},idempotencyKey}={}){
      handle=assertHandle(handle);
      signal=requiredText('signal',signal,180);const idempotency_key=requiredText('idempotencyKey',idempotencyKey,220);
      if(AUTHORITY_SIGNAL.test(signal)) throw new DOMException('authority-like workflow signal blocked','SecurityError');
      if(!isPlainObject(payload)) throw new TypeError('signal payload must be a plain object');
      rejectCredentialMaterial(payload,'signal.payload');
      const provider=await transport.signal({namespace,workflow_id:handle.workflow_id,run_id:handle.run_id,signal,payload:structuredClone(payload),idempotency_key});
      if(!isPlainObject(provider)||provider.accepted!==true) throw new Error('Temporal signal not accepted');
      return Object.freeze({schema:'musitu.axiom.temporal-work-signal-receipt.v1',project_id:handle.project_id,work_id:handle.work_id,workflow_id:handle.workflow_id,run_id:handle.run_id,signal,accepted:true,authority_effect:'NONE',production_authority:false,live_runtime_qualification:'NOT_PROVEN'});
    },
    async cancelWork(handle,{reason,idempotencyKey}={}){
      handle=assertHandle(handle);
      reason=requiredText('reason',reason,500);const idempotency_key=requiredText('idempotencyKey',idempotencyKey,220);
      const provider=await transport.cancel({namespace,workflow_id:handle.workflow_id,run_id:handle.run_id,reason,idempotency_key});
      if(!isPlainObject(provider)||provider.accepted!==true) throw new Error('Temporal cancel not accepted');
      return Object.freeze({schema:'musitu.axiom.temporal-work-cancel-receipt.v1',project_id:handle.project_id,work_id:handle.work_id,workflow_id:handle.workflow_id,run_id:handle.run_id,provider_status:clean(provider.status,80)||'CANCEL_REQUESTED',authority_effect:'NONE',production_authority:false,live_runtime_qualification:'NOT_PROVEN'});
    },
    async result(handle){
      handle=assertHandle(handle);
      const provider=await transport.result({namespace,workflow_id:handle.workflow_id,run_id:handle.run_id});
      if(!isPlainObject(provider)||!clean(provider.status,80)) throw new TypeError('Temporal result returned invalid status');
      rejectCredentialMaterial(provider.output??{},'result.output');
      return Object.freeze({schema:'musitu.axiom.temporal-work-result.v1',project_id:handle.project_id,work_id:handle.work_id,workflow_id:handle.workflow_id,run_id:handle.run_id,provider_status:clean(provider.status,80),output:structuredClone(provider.output??null),authority_effect:'NONE',external_action_executed:false,production_authority:false,live_runtime_qualification:'NOT_PROVEN'});
    },
  };
  return Object.freeze(backend);
}
