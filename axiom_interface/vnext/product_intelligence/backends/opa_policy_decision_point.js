import {assertAdapterDescriptor} from '../infrastructure_contracts.js';

export const OPA_POLICY_DECISION_DESCRIPTOR=Object.freeze({
  kind:'PolicyDecisionPoint',adapter_version:'1.0.0',provider:'open-policy-agent',policy_engine_baseline:'1.21.1',
  semantic_owner:'AXIOM',authority:'MECHANISM_ONLY',
  capabilities:Object.freeze(['evaluate','health','policy-bundle-identity']),
  unsupported_operations:Object.freeze(['grant-release-authority','grant-production-authority','human-approval','self-certification']),
  timeout_ms:5000,retry:Object.freeze({max_attempts:1,backoff:'CALLER_GOVERNED'}),
  idempotency:Object.freeze({mode:'REQUEST_SHA256_BOUND'}),data_classification:Object.freeze(['project-private','policy-input']),
  egress:Object.freeze({required:false,allowed_origins:Object.freeze([])}),
  identity_binding:Object.freeze({required:true,mode:'AXIOM_WORKLOAD_ID'}),
  evidence_envelope:Object.freeze({schema:'musitu.axiom.evidence.v1',required:true}),
  health:Object.freeze({mode:'EXPLICIT'}),migration_export:Object.freeze({supported:true,format:'REGO_BUNDLE_AND_DECISION_LOG'}),
  fail_closed:true,live_runtime_qualification:'NOT_PROVEN',release_authority:false,production_authority:false,certification_authority:false,
});
assertAdapterDescriptor(OPA_POLICY_DECISION_DESCRIPTOR,{expectedKind:'PolicyDecisionPoint'});

const HASH=/^[a-f0-9]{64}$/i;
const FORBIDDEN_KEY=/^(?:access|refresh|id)?_?token$|authorization|api_?key|password|private_?key|client_?secret|secret$/i;
const isPlainObject=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const clean=(value,max=1000)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);
function rejectCredentials(value,path='input'){
  if(!value||typeof value!=='object') return;
  for(const [key,child] of Object.entries(value)){
    if(FORBIDDEN_KEY.test(key)) throw new DOMException(`${path}.${key} contains forbidden credential material`,'SecurityError');
    rejectCredentials(child,`${path}.${key}`);
  }
}
function assertAdmissionRequest(request){
  if(!isPlainObject(request)||request.schema!=='musitu.axiom.product-change-admission-request.v1') throw new TypeError('change admission request required');
  if(typeof request.request_sha256!=='string'||!HASH.test(request.request_sha256)) throw new TypeError('request sha256 required');
  if(!request.project_id||!request.builder_actor_id) throw new TypeError('project and builder identity required');
  if(request.policy_engine_authority!=='MECHANISM_ONLY'||request.builder_may_approve!==false||request.external_execution_authority!==false||request.production_authority!==false) throw new DOMException('change admission authority boundary invalid','SecurityError');
}
function normalizeResult(request,result){
  const row=isPlainObject(result?.result)?result.result:result;
  if(!isPlainObject(row)) throw new TypeError('OPA decision result required');
  const decision=clean(row.decision,32).toUpperCase();
  if(!['ALLOW','DENY','NEEDS_HUMAN'].includes(decision)) throw new TypeError('OPA decision must be ALLOW, DENY or NEEDS_HUMAN');
  const policy_sha256=clean(row.policy_sha256,64).toLowerCase();
  if(!HASH.test(policy_sha256)) throw new TypeError('OPA policy_sha256 required');
  if(!Array.isArray(row.reasons)) throw new TypeError('OPA decision reasons must be an array');
  for(const key of ['release_authority','production_authority','certification_authority','human_approval']) if(row[key]===true) throw new DOMException(`OPA attempted forbidden authority: ${key}`,'SecurityError');
  return Object.freeze({
    decision,request_sha256:request.request_sha256,policy_sha256,reasons:row.reasons.map(x=>clean(x,1000)),
    engine:'OPA',engine_version:OPA_POLICY_DECISION_DESCRIPTOR.policy_engine_baseline,authority_effect:'NONE',
    release_authority:false,production_authority:false,certification_authority:false,human_approval:false,
  });
}

export function createOpaPolicyDecisionPoint({client,policyPackage='musitu.axiom.change_admission'}={}){
  if(!client||typeof client.evaluate!=='function'||typeof client.health!=='function') throw new TypeError('OPA client evaluate and health required');
  const packageName=clean(policyPackage,240);
  if(!/^[a-zA-Z0-9_.-]+$/.test(packageName)) throw new TypeError('policyPackage invalid');
  const decisionPath=`data/${packageName.replaceAll('.','/')}/decision`;
  return Object.freeze({
    descriptor:OPA_POLICY_DECISION_DESCRIPTOR,
    async evaluate(request,{context={}}={}){
      assertAdmissionRequest(request); rejectCredentials(request,'request'); rejectCredentials(context,'context');
      const raw=await client.evaluate({path:decisionPath,input:{request:structuredClone(request),context:structuredClone(context)}});
      return normalizeResult(request,raw);
    },
    async health(){
      const provider=await client.health();
      return Object.freeze({provider_status:clean(provider?.status??'UNKNOWN',40),engine:'OPA',engine_version:OPA_POLICY_DECISION_DESCRIPTOR.policy_engine_baseline,axiom_authority:'NONE',axiom_certification:'NOT_PROVEN',live_runtime_qualification:'NOT_PROVEN'});
    },
  });
}
