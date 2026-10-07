import {assertAdapterDescriptor} from '../infrastructure_contracts.js';
import {clean,clone,rejectSecretLike,sha256} from '../../execution_security.js';

const HASH=/^[a-f0-9]{64}$/i;
const isPlainObject=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const SUBMISSION_INPUT_KEYS=new Set(['schema','project_id','work_id','handoff_sha256','request_sha256','workload_identity_id','operation','risk_class','destination','payload','idempotency_key','external_action_authorized','production_authority']);
const LIFECYCLE_INPUT_KEYS=new Set(['schema','project_id','work_id','handoff_sha256','request_sha256','workload_identity_id','provider_work_id','dispatch_receipt_sha256','dispatch_idempotency_sha256','production_authority']);
const CANCELLATION_INPUT_KEYS=new Set([...LIFECYCLE_INPUT_KEYS,'reason']);
const requiredText=(name,value,max=300)=>{if(typeof value!=='string'||!value||clean(value,max)!==value)throw new TypeError(name+' must be a normalized non-empty string');return value;};
const requiredHash=(name,value)=>{requiredText(name,value,64);if(!HASH.test(value))throw new TypeError(name+' must be a sha256 string');return value.toLowerCase();};
function rejectUnknown(value,allowed,label){if(!isPlainObject(value))throw new TypeError(label+' must be a plain object');const extra=Object.keys(value).filter(key=>!allowed.has(key));if(extra.length)throw new DOMException(label+' contains unsupported fields: '+extra.join(','),'SecurityError');}
function assertTransport(transport){
  if(!transport||typeof transport!=='object'||typeof transport.submit!=='function')throw new TypeError('Engineering worker transport.submit required');
  for(const method of ['describe','cancel','result'])if(typeof transport[method]!=='function')throw new TypeError('Engineering worker transport.'+method+' required');
}
function parseLifecycle(raw,label,{cancellation=false}={}){
  rejectUnknown(raw,cancellation?CANCELLATION_INPUT_KEYS:LIFECYCLE_INPUT_KEYS,label);
  rejectSecretLike(raw,label);
  if(raw.schema!=='musitu.axiom.engineering-worker-lifecycle-request.v1')throw new TypeError('engineering worker lifecycle schema invalid');
  const binding={
    schema:raw.schema,
    project_id:requiredText('project_id',raw.project_id),
    work_id:requiredText('work_id',raw.work_id),
    handoff_sha256:requiredHash('handoff_sha256',raw.handoff_sha256),
    request_sha256:requiredHash('request_sha256',raw.request_sha256),
    workload_identity_id:requiredText('workload_identity_id',raw.workload_identity_id,220),
    provider_work_id:requiredText('provider_work_id',raw.provider_work_id,300),
    dispatch_receipt_sha256:requiredHash('dispatch_receipt_sha256',raw.dispatch_receipt_sha256),
    dispatch_idempotency_sha256:requiredHash('dispatch_idempotency_sha256',raw.dispatch_idempotency_sha256),
    production_authority:false,
  };
  if(raw.production_authority!==false)throw new DOMException('EngineeringWorkerBackend lifecycle cannot receive production authority','SecurityError');
  if(cancellation)binding.reason=requiredText('reason',raw.reason,500);
  return binding;
}
function assertProviderResult(value,label){
  if(!isPlainObject(value))throw new TypeError(label+' returned invalid result');
  rejectSecretLike(value,label+' result');
  return value;
}
async function lifecycleReceipt(body){return Object.freeze({...body,receipt_sha256:await sha256(body)});}

const BASE_DESCRIPTOR=Object.freeze({
  kind:'EngineeringWorkerBackend',
  adapter_version:'1.1.0',
  provider:'provider-neutral',
  semantic_owner:'AXIOM',
  authority:'MECHANISM_ONLY',
  capabilities:Object.freeze([
    'submit-s3-external-reversible-operation',
    'observe-external-operation',
    'request-external-operation-cancellation',
    'collect-external-operation-result',
  ]),
  unsupported_operations:Object.freeze(['policy-decision','authority-grant','human-approval','production-promotion','secret-release','side-effect-certification']),
  timeout_ms:30000,
  retry:Object.freeze({max_attempts:1,backoff:'CALLER_GOVERNED'}),
  idempotency:Object.freeze({mode:'REQUIRED_FOR_MUTATIONS',key_scope:'HANDOFF_REQUEST_WORKLOAD'}),
  data_classification:Object.freeze(['project-private','work-state','evidence-referenced']),
  egress:Object.freeze({required:true,allowed_origins:Object.freeze([])}),
  identity_binding:Object.freeze({required:true,mode:'AXIOM_WORKLOAD_ID'}),
  evidence_envelope:Object.freeze({schema:'musitu.axiom.evidence.v1',required:true}),
  health:Object.freeze({mode:'EXPLICIT_PROVIDER_STATUS'}),
  migration_export:Object.freeze({supported:true,format:'AXIOM_EXTERNAL_WORKER_RECEIPTS'}),
  fail_closed:true,
  live_runtime_qualification:'NOT_PROVEN',
  runtime_activation_authorized:false,
  release_authority:false,
  production_authority:false,
  certification_authority:false,
});

export function createGovernedEngineeringWorkerBackend({transport,provider='provider-neutral'}={}){
  assertTransport(transport);
  provider=requiredText('provider',provider,160);
  const descriptor=Object.freeze({...BASE_DESCRIPTOR,provider});
  assertAdapterDescriptor(descriptor,{expectedKind:'EngineeringWorkerBackend'});
  return Object.freeze({
    descriptor,
    async submitOperation(raw={}){
      rejectUnknown(raw,SUBMISSION_INPUT_KEYS,'engineering worker submission');
      rejectSecretLike(raw,'engineering worker submission');
      if(raw.schema!=='musitu.axiom.external-worker-dispatch.v1')throw new TypeError('engineering worker dispatch schema invalid');
      const project_id=requiredText('project_id',raw.project_id),work_id=requiredText('work_id',raw.work_id);
      const handoff_sha256=requiredHash('handoff_sha256',raw.handoff_sha256),request_sha256=requiredHash('request_sha256',raw.request_sha256);
      const workload_identity_id=requiredText('workload_identity_id',raw.workload_identity_id,220);
      const operation=requiredText('operation',raw.operation,80),risk_class=requiredText('risk_class',raw.risk_class,8);
      if(risk_class!=='S3')throw new DOMException('EngineeringWorkerBackend currently admits S3 only','NotAllowedError');
      const destination=requiredText('destination',raw.destination,2048);
      const idempotency_key=requiredHash('idempotency_key',raw.idempotency_key);
      if(raw.external_action_authorized!==true)throw new DOMException('external worker submission requires prior FA-11 authorization','NotAllowedError');
      if(raw.production_authority!==false)throw new DOMException('EngineeringWorkerBackend cannot receive production authority','SecurityError');
      const providerResult=assertProviderResult(await transport.submit({
        schema:raw.schema,project_id,work_id,handoff_sha256,request_sha256,workload_identity_id,operation,risk_class,destination,
        payload:clone(raw.payload??null),idempotency_key,external_action_authorized:true,production_authority:false,
      }),'engineering worker provider');
      const provider_work_id=requiredText('provider_work_id',providerResult.provider_work_id,300);
      const provider_status=requiredText('provider_status',providerResult.status,80).toUpperCase();
      const body={
        schema:'musitu.axiom.engineering-worker-submit-receipt.v1',project_id,work_id,handoff_sha256,request_sha256,
        workload_identity_id,operation,risk_class,destination,provider,provider_work_id,provider_status,
        idempotency_key_sha256:idempotency_key,external_action_executed:false,live_runtime_qualification:'NOT_PROVEN',
        authority_effect:'NONE',release_authority:false,production_authority:false,certification_authority:false,
        created_at:new Date().toISOString(),
      };
      return Object.freeze({...body,receipt_sha256:await sha256(body)});
    },

    async describeOperation(raw={}){
      const binding=parseLifecycle(raw,'engineering worker observation');
      const providerResult=assertProviderResult(await transport.describe(clone(binding)),'engineering worker describe');
      const provider_status=requiredText('provider_status',providerResult.status,80).toUpperCase();
      return lifecycleReceipt({
        schema:'musitu.axiom.engineering-worker-observation-receipt.v1',
        ...binding,
        provider,
        provider_status,
        provider_data_authority:'UNTRUSTED_MECHANISM_DATA',
        external_action_executed:false,
        live_runtime_qualification:'NOT_PROVEN',
        authority_effect:'NONE',
        release_authority:false,
        production_authority:false,
        certification_authority:false,
        created_at:new Date().toISOString(),
      });
    },

    async cancelOperation(raw={}){
      const binding=parseLifecycle(raw,'engineering worker cancellation',{cancellation:true});
      const providerResult=assertProviderResult(await transport.cancel(clone(binding)),'engineering worker cancel');
      if(typeof providerResult.accepted!=='boolean')throw new TypeError('engineering worker cancellation accepted must be boolean');
      const provider_status=requiredText('provider_status',providerResult.status,80).toUpperCase();
      return lifecycleReceipt({
        schema:'musitu.axiom.engineering-worker-cancellation-request-receipt.v1',
        ...binding,
        provider,
        cancellation_request_accepted:providerResult.accepted,
        provider_status,
        cancellation_effect:'NOT_PROVEN',
        provider_data_authority:'UNTRUSTED_MECHANISM_DATA',
        external_action_executed:false,
        live_runtime_qualification:'NOT_PROVEN',
        authority_effect:'NONE',
        release_authority:false,
        production_authority:false,
        certification_authority:false,
        created_at:new Date().toISOString(),
      });
    },

    async getResult(raw={}){
      const binding=parseLifecycle(raw,'engineering worker result');
      const providerResult=assertProviderResult(await transport.result(clone(binding)),'engineering worker result');
      const provider_status=requiredText('provider_status',providerResult.status,80).toUpperCase();
      if(Object.hasOwn(providerResult,'external_action_executed')&&typeof providerResult.external_action_executed!=='boolean')throw new TypeError('provider external_action_executed claim must be boolean when present');
      const provider_output=clone(providerResult.output??null);
      const provider_output_sha256=await sha256(provider_output);
      return lifecycleReceipt({
        schema:'musitu.axiom.engineering-worker-result-receipt.v1',
        ...binding,
        provider,
        provider_status,
        provider_output,
        provider_output_sha256,
        provider_claimed_external_action_executed:providerResult.external_action_executed===true,
        provider_data_authority:'UNTRUSTED_MECHANISM_DATA',
        independent_verification:'NOT_PROVEN',
        external_action_executed:false,
        live_runtime_qualification:'NOT_PROVEN',
        authority_effect:'NONE',
        release_authority:false,
        production_authority:false,
        certification_authority:false,
        created_at:new Date().toISOString(),
      });
    },
  });
}
