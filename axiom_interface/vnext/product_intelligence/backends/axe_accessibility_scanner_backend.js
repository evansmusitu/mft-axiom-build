import {assertAdapterDescriptor} from '../infrastructure_contracts.js';

export const AXE_ACCESSIBILITY_SCANNER_DESCRIPTOR=Object.freeze({
  kind:'AccessibilityScannerBackend',adapter_version:'1.0.0',provider:'axe-core',provider_baseline:'4.13.0',
  semantic_owner:'AXIOM',authority:'MECHANISM_ONLY',
  capabilities:Object.freeze(['scan-dom','report-rules','health']),
  unsupported_operations:Object.freeze(['certify-wcag','waive-findings','grant-release-authority','replace-manual-accessibility-evidence']),
  timeout_ms:60000,retry:Object.freeze({max_attempts:1,backoff:'CALLER_GOVERNED'}),
  idempotency:Object.freeze({mode:'SURFACE_DIGEST_AND_REQUEST_ID'}),data_classification:Object.freeze(['project-private','accessibility-findings']),
  egress:Object.freeze({required:false,allowed_origins:Object.freeze([])}),
  identity_binding:Object.freeze({required:true,mode:'AXIOM_WORKLOAD_ID'}),
  evidence_envelope:Object.freeze({schema:'musitu.axiom.evidence.v1',required:true}),
  health:Object.freeze({mode:'EXPLICIT'}),migration_export:Object.freeze({supported:true,format:'AXE_NORMALIZED_JSON'}),
  fail_closed:true,compliance_certification_authority:false,release_authority:false,production_authority:false,
  live_runtime_qualification:'NOT_PROVEN',
});
assertAdapterDescriptor(AXE_ACCESSIBILITY_SCANNER_DESCRIPTOR,{expectedKind:'AccessibilityScannerBackend'});

const HASH=/^[a-f0-9]{64}$/i;
const ID=/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,299}$/;
const IMPACTS=new Set(['UNKNOWN','MINOR','MODERATE','SERIOUS','CRITICAL']);
const FORBIDDEN_KEY=/^(?:access|refresh|id)?_?token$|authorization|api_?key|password|private_?key|client_?secret|secret$/i;
const isPlainObject=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const clean=(value,max=1000)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);
function id(name,value){const v=clean(value,300);if(!ID.test(v))throw new TypeError(`${name} invalid`);return v;}
function rejectCredentials(value,path='context'){
  if(!value||typeof value!=='object') return;
  for(const [key,child] of Object.entries(value)){
    if(FORBIDDEN_KEY.test(key)) throw new DOMException(`${path}.${key} contains forbidden credential material`,'SecurityError');
    rejectCredentials(child,`${path}.${key}`);
  }
}
function rejectAuthorityClaims(result){
  if(!result||typeof result!=='object') return;
  for(const key of ['wcag_compliant','accessibility_pass','certified','release_authority','production_authority','waived','allow_deploy']){
    if(result[key]===true) throw new DOMException(`axe-core attempted forbidden authority: ${key}`,'SecurityError');
  }
}
function normalizeNode(row,index){
  if(!isPlainObject(row)) throw new TypeError(`node[${index}] must be a plain object`);
  const target=Array.isArray(row.target)?row.target.map(x=>clean(x,1000)).filter(Boolean):[];
  return Object.freeze({targets:Object.freeze(target),failure_summary:clean(row.failure_summary,3000),html:clean(row.html,5000)});
}
function normalizeViolation(row,index){
  if(!isPlainObject(row)) throw new TypeError(`violation[${index}] must be a plain object`);
  const rule_id=id(`violation[${index}].id`,row.id);
  const impact=clean(row.impact??'UNKNOWN',20).toUpperCase();
  if(!IMPACTS.has(impact)) throw new TypeError(`violation[${index}] impact invalid`);
  if(!Array.isArray(row.nodes)) throw new TypeError(`violation[${index}] nodes must be an array`);
  return Object.freeze({
    rule_id,impact,description:clean(row.description,3000),help_url:clean(row.help_url??row.helpUrl,2000),
    targets:Object.freeze(row.nodes.map((node,nodeIndex)=>normalizeNode(node,nodeIndex).targets)),
    nodes:Object.freeze(row.nodes.map(normalizeNode)),
  });
}

export function createAxeAccessibilityScannerBackend({client}={}){
  if(!client||typeof client.scan!=='function'||typeof client.health!=='function') throw new TypeError('axe-core client scan and health required');
  return Object.freeze({
    descriptor:AXE_ACCESSIBILITY_SCANNER_DESCRIPTOR,
    async scan({projectId,workId='',workloadIdentityId,surfaceRef,surfaceDigestSha256,requestId,standard='WCAG2AA',context={}}={}){
      const project_id=id('projectId',projectId),work_id=clean(workId,300),workload_identity_id=id('workloadIdentityId',workloadIdentityId),request_id=id('requestId',requestId);
      const surface_ref=clean(surfaceRef,1000);if(!surface_ref)throw new TypeError('surfaceRef required');
      const surface_digest_sha256=clean(surfaceDigestSha256,64).toLowerCase();if(!HASH.test(surface_digest_sha256))throw new TypeError('surfaceDigestSha256 required');
      const standard_id=clean(standard,40).toUpperCase();if(!/^[A-Z0-9._-]+$/.test(standard_id))throw new TypeError('standard invalid');
      rejectCredentials(context,'context');
      const raw=await client.scan({project_id,work_id,workload_identity_id,surface_ref,surface_digest_sha256,request_id,standard:standard_id,context:structuredClone(context)});
      if(!isPlainObject(raw))throw new TypeError('axe-core scan result required');
      rejectAuthorityClaims(raw);
      if(!Array.isArray(raw.violations)||!Array.isArray(raw.passes)||!Array.isArray(raw.incomplete))throw new TypeError('axe-core violations, passes and incomplete arrays required');
      const violations=raw.violations.map(normalizeViolation);
      const severity_counts=Object.fromEntries([...IMPACTS].map(impact=>[impact,violations.filter(v=>v.impact===impact).length]));
      return Object.freeze({
        schema:'musitu.axiom.accessibility-scan.v1',project_id,work_id,workload_identity_id,request_id,surface_ref,surface_digest_sha256,standard:standard_id,
        scanner:'AXE_CORE',scanner_version:AXE_ACCESSIBILITY_SCANNER_DESCRIPTOR.provider_baseline,
        violations:Object.freeze(violations),violation_count:violations.length,severity_counts:Object.freeze(severity_counts),pass_count:raw.passes.length,incomplete_count:raw.incomplete.length,
        accessibility_gate_status:'NOT_EVALUATED',compliance_certified:false,manual_evidence_required:true,device_evidence_required:true,
        canonical_evidence:false,may_certify:false,authority_effect:'NONE',release_authority:false,production_authority:false,
      });
    },
    async health(){
      const provider=await client.health();
      return Object.freeze({provider_status:clean(provider?.status??'UNKNOWN',40),scanner:'AXE_CORE',scanner_version:AXE_ACCESSIBILITY_SCANNER_DESCRIPTOR.provider_baseline,axiom_authority:'NONE',axiom_certification:'NOT_PROVEN',live_runtime_qualification:'NOT_PROVEN'});
    },
  });
}
