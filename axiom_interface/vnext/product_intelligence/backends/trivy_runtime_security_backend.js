import {assertAdapterDescriptor} from '../infrastructure_contracts.js';

export const TRIVY_RUNTIME_SECURITY_DESCRIPTOR=Object.freeze({
  kind:'RuntimeSecurityBackend',adapter_version:'1.0.0',provider:'trivy',provider_baseline:'0.75.0',
  semantic_owner:'AXIOM',authority:'MECHANISM_ONLY',
  capabilities:Object.freeze(['scan-filesystem','scan-image','scan-config','health']),
  unsupported_operations:Object.freeze(['waive-findings','certify-security','grant-release-authority','mutate-target']),
  timeout_ms:120000,retry:Object.freeze({max_attempts:1,backoff:'CALLER_GOVERNED'}),
  idempotency:Object.freeze({mode:'TARGET_DIGEST_AND_REQUEST_ID'}),data_classification:Object.freeze(['project-private','security-findings']),
  egress:Object.freeze({required:false,allowed_origins:Object.freeze([])}),
  identity_binding:Object.freeze({required:true,mode:'AXIOM_WORKLOAD_ID'}),
  evidence_envelope:Object.freeze({schema:'musitu.axiom.evidence.v1',required:true}),
  health:Object.freeze({mode:'EXPLICIT'}),migration_export:Object.freeze({supported:true,format:'SARIF_OR_NORMALIZED_JSON'}),
  fail_closed:true,security_gate_authority:false,release_authority:false,live_runtime_qualification:'NOT_PROVEN',
});
assertAdapterDescriptor(TRIVY_RUNTIME_SECURITY_DESCRIPTOR,{expectedKind:'RuntimeSecurityBackend'});

const HASH=/^[a-f0-9]{64}$/i;
const ID=/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,299}$/;
const MODES=new Set(['FILESYSTEM','IMAGE','CONFIG']);
const SEVERITIES=new Set(['UNKNOWN','LOW','MEDIUM','HIGH','CRITICAL']);
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
function id(name,value){const v=clean(value,300);if(!ID.test(v))throw new TypeError(`${name} invalid`);return v;}
function normalizeFinding(row,index){
  if(!isPlainObject(row)) throw new TypeError(`finding[${index}] must be a plain object`);
  const severity=clean(row.severity,20).toUpperCase(); if(!SEVERITIES.has(severity)) throw new TypeError(`finding[${index}] severity invalid`);
  const finding_id=id(`finding[${index}].finding_id`,row.finding_id||row.vulnerability_id||row.rule_id);
  return Object.freeze({
    finding_id,severity,category:clean(row.category||'VULNERABILITY',80).toUpperCase(),title:clean(row.title||finding_id,500),
    package:clean(row.package,240),installed_version:clean(row.installed_version,120),fixed_version:clean(row.fixed_version,120),
    path:clean(row.path,1000),reference:clean(row.reference,2000),
  });
}
function rejectAuthorityClaims(result){
  if(!result||typeof result!=='object') return;
  for(const key of ['security_pass','certified','release_authority','production_authority','allow_deploy','waived']){
    if(result[key]===true) throw new DOMException(`Trivy attempted forbidden authority: ${key}`,'SecurityError');
  }
}

export function createTrivyRuntimeSecurityBackend({client}={}){
  if(!client||typeof client.scan!=='function'||typeof client.health!=='function') throw new TypeError('Trivy client scan and health required');
  return Object.freeze({
    descriptor:TRIVY_RUNTIME_SECURITY_DESCRIPTOR,
    async scan({projectId,workloadIdentityId,mode,targetRef,targetDigestSha256,requestId,context={}}={}){
      const project_id=id('projectId',projectId),workload_identity_id=id('workloadIdentityId',workloadIdentityId),request_id=id('requestId',requestId);
      const scan_mode=clean(mode,20).toUpperCase(); if(!MODES.has(scan_mode)) throw new TypeError('mode must be FILESYSTEM, IMAGE or CONFIG');
      const target_ref=clean(targetRef,1000); if(!target_ref) throw new TypeError('targetRef required');
      const target_digest_sha256=clean(targetDigestSha256,64).toLowerCase(); if(!HASH.test(target_digest_sha256)) throw new TypeError('targetDigestSha256 required');
      rejectCredentials(context,'context');
      const raw=await client.scan({project_id,workload_identity_id,mode:scan_mode,target_ref,target_digest_sha256,request_id,context:structuredClone(context)});
      if(!isPlainObject(raw)) throw new TypeError('Trivy scan result required');
      rejectAuthorityClaims(raw);
      if(!Array.isArray(raw.findings)) throw new TypeError('Trivy findings must be an array');
      const findings=raw.findings.map(normalizeFinding);
      const counts=Object.fromEntries([...SEVERITIES].map(severity=>[severity,findings.filter(f=>f.severity===severity).length]));
      return Object.freeze({
        schema:'musitu.axiom.runtime-security-scan.v1',project_id,workload_identity_id,request_id,mode:scan_mode,target_ref,target_digest_sha256,
        scanner:'TRIVY',scanner_version:TRIVY_RUNTIME_SECURITY_DESCRIPTOR.provider_baseline,database_version:clean(raw.database_version,120),database_updated_at:clean(raw.database_updated_at,80),
        findings:Object.freeze(findings),severity_counts:Object.freeze(counts),finding_count:findings.length,
        security_gate_status:'NOT_EVALUATED',canonical_evidence:false,may_certify:false,authority_effect:'NONE',release_authority:false,production_authority:false,
      });
    },
    async health(){const provider=await client.health();return Object.freeze({provider_status:clean(provider?.status??'UNKNOWN',40),scanner:'TRIVY',scanner_version:TRIVY_RUNTIME_SECURITY_DESCRIPTOR.provider_baseline,axiom_authority:'NONE',axiom_certification:'NOT_PROVEN',live_runtime_qualification:'NOT_PROVEN'});},
  });
}
