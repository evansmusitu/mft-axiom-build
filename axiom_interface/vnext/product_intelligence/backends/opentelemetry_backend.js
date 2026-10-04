import {assertAdapterDescriptor} from '../infrastructure_contracts.js';

export const OPENTELEMETRY_BACKEND_DESCRIPTOR=Object.freeze({
  kind:'TelemetryBackend',adapter_version:'1.0.0',provider:'opentelemetry',collector_baseline:'0.162.0',
  semantic_owner:'AXIOM',authority:'MECHANISM_ONLY',evidence_authority:'NONE',
  capabilities:Object.freeze(['traces','metrics','logs','health']),
  unsupported_operations:Object.freeze(['evidence-certification','policy-decision','authority-grant','production-promotion']),
  timeout_ms:10000,retry:Object.freeze({max_attempts:1,backoff:'CALLER_GOVERNED'}),idempotency:Object.freeze({mode:'EXPORTER_DEFINED'}),
  data_classification:Object.freeze(['telemetry','project-private','work-state']),
  egress:Object.freeze({required:true,allowed_origins:Object.freeze([])}),identity_binding:Object.freeze({required:true,mode:'AXIOM_WORKLOAD_ID'}),
  evidence_envelope:Object.freeze({schema:'musitu.axiom.evidence.v1',required:true}),health:Object.freeze({mode:'EXPLICIT_PROVIDER_STATUS'}),
  migration_export:Object.freeze({supported:true,format:'OTLP_OR_OPEN_TELEMETRY_COMPATIBLE'}),fail_closed:true,live_runtime_qualification:'NOT_PROVEN',
});
assertAdapterDescriptor(OPENTELEMETRY_BACKEND_DESCRIPTOR,{expectedKind:'TelemetryBackend'});

const clean=(value,max=1000)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);
const isPlainObject=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const FORBIDDEN_KEY=/^(?:access|refresh|id)?_?token$|authorization|api_?key|password|private_?key|client_?secret|secret$/i;
const SECRET_VALUE=/(?:bearer\s+[A-Za-z0-9._~-]{10,}|\b(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{10,})/i;
function canonical(value){if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;return JSON.stringify(value);}
async function sha256(value){const bytes=new TextEncoder().encode(typeof value==='string'?value:canonical(value));const digest=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');}
function required(name,value,max=240){const v=clean(value,max);if(!v)throw new TypeError(`${name} required`);return v;}
function rejectCredentialMaterial(value,path='telemetry'){
  if(typeof value==='string'&&SECRET_VALUE.test(value)) throw new DOMException(`${path} contains forbidden credential material`,'SecurityError');
  if(!value||typeof value!=='object') return;
  for(const [key,child] of Object.entries(value)){
    if(FORBIDDEN_KEY.test(key)) throw new DOMException(`${path}.${key} contains forbidden credential material`,'SecurityError');
    rejectCredentialMaterial(child,`${path}.${key}`);
  }
}
function assertExporter(exporter){
  if(!exporter||typeof exporter!=='object') throw new TypeError('OpenTelemetry exporter required');
  for(const m of ['exportTrace','exportMetric','exportLog','health'])if(typeof exporter[m]!=='function')throw new TypeError(`OpenTelemetry exporter.${m} required`);
}
function context(input){
  const project_id=required('projectId',input.projectId,180),work_id=required('workId',input.workId,180),workload_identity_id=required('workloadIdentityId',input.workloadIdentityId,220);
  return {project_id,work_id,workload_identity_id};
}

export function createOpenTelemetryBackend({exporter,serviceName='musitu-axiom-product-intelligence',environment='development'}={}){
  assertExporter(exporter);serviceName=required('serviceName',serviceName,180);environment=required('environment',environment,120);
  const resource=Object.freeze({'service.name':serviceName,'deployment.environment.name':environment,'axiom.semantic_owner':'AXIOM'});
  async function exportOne(kind,input,payload){
    rejectCredentialMaterial(payload);
    const method={trace:'exportTrace',metric:'exportMetric',log:'exportLog'}[kind];
    const provider=await exporter[method](payload);
    if(!isPlainObject(provider)||provider.accepted!==true) throw new Error(`OpenTelemetry ${kind} export not accepted`);
    const ids=context(input);
    const body={schema:`musitu.axiom.opentelemetry-${kind}-receipt.v1`,...ids,provider:'opentelemetry',provider_export_id:clean(provider.export_id,240)||null,authority_effect:'NONE',canonical_evidence:false,may_certify:false,production_authority:false,live_runtime_qualification:'NOT_PROVEN',created_at:new Date().toISOString()};
    return Object.freeze({...body,receipt_sha256:await sha256(body)});
  }
  return Object.freeze({
    descriptor:OPENTELEMETRY_BACKEND_DESCRIPTOR,
    async emitTrace(input={}){
      const ids=context(input),trace_id=clean(input.traceId,32).toLowerCase(),span_id=clean(input.spanId,16).toLowerCase(),name=required('name',input.name,240),status=required('status',input.status,40);
      if(!/^[a-f0-9]{32}$/.test(trace_id)||!/[1-9a-f]/.test(trace_id))throw new TypeError('traceId must be non-zero 32 hex');
      if(!/^[a-f0-9]{16}$/.test(span_id)||!/[1-9a-f]/.test(span_id))throw new TypeError('spanId must be non-zero 16 hex');
      const attributes=isPlainObject(input.attributes)?structuredClone(input.attributes):{};rejectCredentialMaterial(attributes,'trace.attributes');
      const payload={resource:{...resource},trace_id,span_id,name,status,attributes:{...attributes,'axiom.project_id':ids.project_id,'axiom.work_id':ids.work_id,'axiom.workload_identity_id':ids.workload_identity_id},evidence_authority:'NONE'};
      return exportOne('trace',input,payload);
    },
    async emitMetric(input={}){
      const ids=context(input),name=required('name',input.name,240),unit=required('unit',input.unit,40),value=Number(input.value);
      if(!Number.isFinite(value))throw new TypeError('metric value must be finite');
      const attributes=isPlainObject(input.attributes)?structuredClone(input.attributes):{};rejectCredentialMaterial(attributes,'metric.attributes');
      const payload={resource:{...resource},name,value,unit,attributes:{...attributes,'axiom.project_id':ids.project_id,'axiom.work_id':ids.work_id,'axiom.workload_identity_id':ids.workload_identity_id},evidence_authority:'NONE'};
      return exportOne('metric',input,payload);
    },
    async emitLog(input={}){
      const ids=context(input),severity=required('severity',input.severity,40).toUpperCase(),body=required('body',input.body,12000);
      const attributes=isPlainObject(input.attributes)?structuredClone(input.attributes):{};rejectCredentialMaterial(attributes,'log.attributes');rejectCredentialMaterial(body,'log.body');
      const payload={resource:{...resource},severity,body,attributes:{...attributes,'axiom.project_id':ids.project_id,'axiom.work_id':ids.work_id,'axiom.workload_identity_id':ids.workload_identity_id},evidence_authority:'NONE'};
      return exportOne('log',input,payload);
    },
    async health(){
      const result=await exporter.health();
      if(!isPlainObject(result)||!clean(result.status,80))throw new TypeError('OpenTelemetry health returned invalid status');
      return Object.freeze({schema:'musitu.axiom.opentelemetry-health.v1',provider_status:clean(result.status,80),axiom_certification:'NOT_PROVEN',authority_effect:'NONE',canonical_evidence:false,production_authority:false});
    },
  });
}
