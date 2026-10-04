import {assertAdapterDescriptor} from '../infrastructure_contracts.js';

export const PLAYWRIGHT_REALITY_BROWSER_DESCRIPTOR=Object.freeze({
  kind:'RealityBrowserBackend',adapter_version:'1.0.0',provider:'playwright',provider_baseline:'1.63.0',
  semantic_owner:'AXIOM',authority:'MECHANISM_ONLY',
  capabilities:Object.freeze(['navigate-read','snapshot-dom','screenshot','read-console','read-network','assert-visible','assert-text','health']),
  unsupported_operations:Object.freeze(['submit-form','fill-external-form','upload-file','payment','publish','deploy','delete-external-state','network-write','grant-release-authority']),
  timeout_ms:120000,retry:Object.freeze({max_attempts:1,backoff:'CALLER_GOVERNED'}),
  idempotency:Object.freeze({mode:'SURFACE_DIGEST_PLAN_AND_REQUEST_ID'}),data_classification:Object.freeze(['project-private','browser-observation']),
  egress:Object.freeze({required:true,allowed_origins:Object.freeze([])}),
  identity_binding:Object.freeze({required:true,mode:'AXIOM_WORKLOAD_ID'}),
  evidence_envelope:Object.freeze({schema:'musitu.axiom.evidence.v1',required:true}),
  health:Object.freeze({mode:'EXPLICIT'}),migration_export:Object.freeze({supported:true,format:'OBSERVATION_JSON_AND_DIGESTS'}),
  fail_closed:true,external_write_authority:false,release_authority:false,production_authority:false,certification_authority:false,
  live_runtime_qualification:'NOT_PROVEN',
});
assertAdapterDescriptor(PLAYWRIGHT_REALITY_BROWSER_DESCRIPTOR,{expectedKind:'RealityBrowserBackend'});

const HASH=/^[a-f0-9]{64}$/i;
const ID=/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,299}$/;
const ALLOWED_OPS=new Set(['NAVIGATE','WAIT','SNAPSHOT','SCREENSHOT','READ_CONSOLE','READ_NETWORK','ASSERT_VISIBLE','ASSERT_TEXT']);
const FORBIDDEN_KEY=/^(?:access|refresh|id)?_?token$|authorization|api_?key|password|private_?key|client_?secret|secret$/i;
const isPlainObject=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const clean=(value,max=2000)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);
function id(name,value){const v=clean(value,300);if(!ID.test(v))throw new TypeError(`${name} invalid`);return v;}
function rejectCredentials(value,path='context'){
  if(!value||typeof value!=='object')return;
  for(const [key,child] of Object.entries(value)){
    if(FORBIDDEN_KEY.test(key))throw new DOMException(`${path}.${key} contains forbidden credential material`,'SecurityError');
    rejectCredentials(child,`${path}.${key}`);
  }
}
function rejectAuthorityClaims(result){
  if(!result||typeof result!=='object')return;
  for(const key of ['release_authority','production_authority','certified','accessibility_pass','allow_deploy','external_write_executed','publication_executed']){
    if(result[key]===true)throw new DOMException(`Playwright attempted forbidden authority: ${key}`,'SecurityError');
  }
}
function normalizePlan(plan){
  if(!isPlainObject(plan)||!Array.isArray(plan.steps)||!plan.steps.length)throw new TypeError('observation plan with steps required');
  const steps=plan.steps.map((step,index)=>{
    if(!isPlainObject(step))throw new TypeError(`plan.steps[${index}] must be a plain object`);
    const op=clean(step.op,40).toUpperCase();
    if(!ALLOWED_OPS.has(op))throw new DOMException(`observation plan operation forbidden: ${op||'UNKNOWN'}`,'NotAllowedError');
    rejectCredentials(step,`plan.steps[${index}]`);
    const out={op};
    if(step.selector!==undefined)out.selector=clean(step.selector,1000);
    if(step.text!==undefined)out.text=clean(step.text,3000);
    if(step.timeout_ms!==undefined){const n=Number(step.timeout_ms);if(!Number.isInteger(n)||n<0||n>60000)throw new TypeError('step timeout_ms invalid');out.timeout_ms=n;}
    return Object.freeze(out);
  });
  return Object.freeze({steps:Object.freeze(steps)});
}
function normalizeStringArray(value,name,max=2000){
  if(!Array.isArray(value))throw new TypeError(`${name} must be an array`);
  return Object.freeze(value.map(x=>clean(x,max)));
}

export function createPlaywrightRealityBrowserBackend({client}={}){
  if(!client||typeof client.observe!=='function'||typeof client.health!=='function')throw new TypeError('Playwright client observe and health required');
  return Object.freeze({
    descriptor:PLAYWRIGHT_REALITY_BROWSER_DESCRIPTOR,
    async observe({projectId,workId='',workloadIdentityId,surfaceRef,surfaceDigestSha256,requestId,plan,context={}}={}){
      const project_id=id('projectId',projectId),work_id=clean(workId,300),workload_identity_id=id('workloadIdentityId',workloadIdentityId),request_id=id('requestId',requestId);
      const surface_ref=clean(surfaceRef,2000);if(!surface_ref)throw new TypeError('surfaceRef required');
      const expected_surface_digest_sha256=clean(surfaceDigestSha256,64).toLowerCase();if(!HASH.test(expected_surface_digest_sha256))throw new TypeError('surfaceDigestSha256 required');
      rejectCredentials(context,'context');
      const normalized_plan=normalizePlan(plan);
      const raw=await client.observe({project_id,work_id,workload_identity_id,surface_ref,expected_surface_digest_sha256,request_id,plan:structuredClone(normalized_plan),context:structuredClone(context)});
      if(!isPlainObject(raw))throw new TypeError('Playwright observation result required');
      rejectAuthorityClaims(raw);
      const observedMs=Date.parse(raw.observed_at??'');if(!Number.isFinite(observedMs))throw new TypeError('observed_at must be an ISO instant');
      const final_url=clean(raw.final_url,3000);if(!final_url)throw new TypeError('final_url required');
      const dom_sha256=clean(raw.dom_sha256,64).toLowerCase();if(!HASH.test(dom_sha256))throw new TypeError('dom_sha256 required');
      let screenshot_sha256=null;
      if(raw.screenshot_sha256!==null&&raw.screenshot_sha256!==undefined&&raw.screenshot_sha256!==''){
        screenshot_sha256=clean(raw.screenshot_sha256,64).toLowerCase();if(!HASH.test(screenshot_sha256))throw new TypeError('screenshot_sha256 invalid');
      }
      if(!isPlainObject(raw.viewport))throw new TypeError('viewport required');
      const width=Number(raw.viewport.width),height=Number(raw.viewport.height);if(!Number.isInteger(width)||width<1||!Number.isInteger(height)||height<1)throw new TypeError('viewport dimensions invalid');
      const console_errors=normalizeStringArray(raw.console_errors,'console_errors',4000);
      const failed_requests=normalizeStringArray(raw.failed_requests,'failed_requests',4000);
      return Object.freeze({
        schema:'musitu.axiom.browser-reality-observation.v1',project_id,work_id,workload_identity_id,request_id,surface_ref,expected_surface_digest_sha256,
        browser:'PLAYWRIGHT',browser_version:PLAYWRIGHT_REALITY_BROWSER_DESCRIPTOR.provider_baseline,observed_at:new Date(observedMs).toISOString(),
        final_url,title:clean(raw.title,1000),dom_sha256,screenshot_sha256,viewport:Object.freeze({width,height}),console_errors,failed_requests,
        observation_state:'OBSERVED',certification:'NOT_CERTIFIED',canonical_evidence:false,external_action_executed:false,external_write_authority:false,
        authority_effect:'NONE',release_authority:false,production_authority:false,plan:normalized_plan,
      });
    },
    async health(){
      const provider=await client.health();
      return Object.freeze({provider_status:clean(provider?.status??'UNKNOWN',40),browser:'PLAYWRIGHT',browser_version:PLAYWRIGHT_REALITY_BROWSER_DESCRIPTOR.provider_baseline,axiom_authority:'NONE',axiom_certification:'NOT_PROVEN',live_runtime_qualification:'NOT_PROVEN'});
    },
  });
}
