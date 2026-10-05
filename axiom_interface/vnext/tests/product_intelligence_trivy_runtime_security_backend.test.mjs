import assert from 'node:assert/strict';
import test from 'node:test';
import {TRIVY_RUNTIME_SECURITY_DESCRIPTOR,createTrivyRuntimeSecurityBackend} from '../product_intelligence/backends/trivy_runtime_security_backend.js';

function client(result={}){const calls=[];return {calls,async scan(input){calls.push(structuredClone(input));return {database_version:'2026-10-04',database_updated_at:'2026-10-04T17:55:00Z',findings:[{finding_id:'CVE-2026-0001',severity:'HIGH',category:'VULNERABILITY',title:'Example',package:'libx',installed_version:'1.0.0',fixed_version:'1.0.1',path:'package.json',reference:'https://example.invalid/CVE-2026-0001'}],...result};},async health(){return {status:'UP'};}};}
const req={projectId:'project_12345678',workloadIdentityId:'agent_workload_12345678',mode:'filesystem',targetRef:'workspace://candidate',targetDigestSha256:'a'.repeat(64),requestId:'request_12345678',context:{phase:'2'}};

test('Trivy RuntimeSecurityBackend pins Phase-1.5 baseline and remains scanner-only',()=>{
  assert.equal(TRIVY_RUNTIME_SECURITY_DESCRIPTOR.kind,'RuntimeSecurityBackend');
  assert.equal(TRIVY_RUNTIME_SECURITY_DESCRIPTOR.provider,'trivy');
  assert.equal(TRIVY_RUNTIME_SECURITY_DESCRIPTOR.provider_baseline,'0.75.0');
  assert.equal(TRIVY_RUNTIME_SECURITY_DESCRIPTOR.semantic_owner,'AXIOM');
  assert.equal(TRIVY_RUNTIME_SECURITY_DESCRIPTOR.authority,'MECHANISM_ONLY');
  assert.equal(TRIVY_RUNTIME_SECURITY_DESCRIPTOR.security_gate_authority,false);
  assert.equal(TRIVY_RUNTIME_SECURITY_DESCRIPTOR.release_authority,false);
});

test('scan preserves target digest and returns normalized findings without certifying security',async()=>{
  const c=client();const backend=createTrivyRuntimeSecurityBackend({client:c});const report=await backend.scan(req);
  assert.equal(report.target_digest_sha256,'a'.repeat(64));assert.equal(report.scanner_version,'0.75.0');assert.equal(report.finding_count,1);assert.equal(report.severity_counts.HIGH,1);
  assert.equal(report.findings[0].finding_id,'CVE-2026-0001');assert.equal(report.findings[0].fixed_version,'1.0.1');
  assert.equal(report.security_gate_status,'NOT_EVALUATED');assert.equal(report.canonical_evidence,false);assert.equal(report.may_certify,false);assert.equal(report.release_authority,false);
  assert.equal(c.calls[0].mode,'FILESYSTEM');assert.equal(c.calls[0].target_digest_sha256,'a'.repeat(64));
});

test('malformed severity and missing findings fail closed',async()=>{
  const badSeverity=createTrivyRuntimeSecurityBackend({client:client({findings:[{finding_id:'x_12345678',severity:'SUPERCRITICAL'}]})});
  await assert.rejects(()=>badSeverity.scan(req),/severity invalid/);
  const missing=createTrivyRuntimeSecurityBackend({client:client({findings:null})});
  await assert.rejects(()=>missing.scan(req),/findings must be an array/);
});

test('Trivy authority-like outputs are rejected rather than promoted into release decisions',async()=>{
  for(const field of ['security_pass','certified','release_authority','production_authority','allow_deploy','waived']){
    const backend=createTrivyRuntimeSecurityBackend({client:client({[field]:true})});
    await assert.rejects(()=>backend.scan(req),/Trivy attempted forbidden authority/);
  }
});

test('credential-bearing scan context is rejected before provider invocation',async()=>{
  const c=client();const backend=createTrivyRuntimeSecurityBackend({client:c});
  await assert.rejects(()=>backend.scan({...req,context:{api_key:'secret'}}),/forbidden credential material/);
  assert.equal(c.calls.length,0);
});

test('Trivy health is provider health only and cannot certify AXIOM',async()=>{
  const health=await createTrivyRuntimeSecurityBackend({client:client()}).health();
  assert.equal(health.provider_status,'UP');assert.equal(health.scanner_version,'0.75.0');assert.equal(health.axiom_authority,'NONE');assert.equal(health.axiom_certification,'NOT_PROVEN');
});
