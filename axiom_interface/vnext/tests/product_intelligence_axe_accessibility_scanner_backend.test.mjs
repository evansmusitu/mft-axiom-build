import assert from 'node:assert/strict';
import test from 'node:test';
import {AXE_ACCESSIBILITY_SCANNER_DESCRIPTOR,createAxeAccessibilityScannerBackend} from '../product_intelligence/backends/axe_accessibility_scanner_backend.js';

function client(result={violations:[{id:'color-contrast',impact:'serious',description:'Elements must meet minimum color contrast ratio',help_url:'https://dequeuniversity.com/rules/axe/color-contrast',nodes:[{target:['#cta'],failure_summary:'Fix contrast'}]}],passes:[{id:'document-title'}],incomplete:[]}){
  const calls=[];
  return {calls,async scan(input){calls.push(structuredClone(input));return structuredClone(result);},async health(){return {status:'UP'};}};
}
const req={projectId:'project_12345678',workId:'work_12345678',workloadIdentityId:'agent_workload_12345678',surfaceRef:'surface://home',surfaceDigestSha256:'a'.repeat(64),requestId:'request_12345678',standard:'WCAG2AA',context:{viewport:'desktop'}};

test('axe-core AccessibilityScannerBackend pins Phase-1.5 baseline and remains mechanism-only',()=>{
  assert.equal(AXE_ACCESSIBILITY_SCANNER_DESCRIPTOR.kind,'AccessibilityScannerBackend');
  assert.equal(AXE_ACCESSIBILITY_SCANNER_DESCRIPTOR.provider,'axe-core');
  assert.equal(AXE_ACCESSIBILITY_SCANNER_DESCRIPTOR.provider_baseline,'4.13.0');
  assert.equal(AXE_ACCESSIBILITY_SCANNER_DESCRIPTOR.semantic_owner,'AXIOM');
  assert.equal(AXE_ACCESSIBILITY_SCANNER_DESCRIPTOR.authority,'MECHANISM_ONLY');
  assert.equal(AXE_ACCESSIBILITY_SCANNER_DESCRIPTOR.compliance_certification_authority,false);
  assert.equal(AXE_ACCESSIBILITY_SCANNER_DESCRIPTOR.release_authority,false);
});

test('scan preserves surface digest and normalizes axe violations without certifying compliance',async()=>{
  const c=client();const backend=createAxeAccessibilityScannerBackend({client:c});const report=await backend.scan(req);
  assert.equal(report.surface_digest_sha256,'a'.repeat(64));
  assert.equal(report.scanner_version,'4.13.0');
  assert.equal(report.violation_count,1);
  assert.equal(report.severity_counts.SERIOUS,1);
  assert.equal(report.violations[0].rule_id,'color-contrast');
  assert.deepEqual(report.violations[0].targets,[['#cta']]);
  assert.equal(report.accessibility_gate_status,'NOT_EVALUATED');
  assert.equal(report.compliance_certified,false);
  assert.equal(report.canonical_evidence,false);
  assert.equal(report.authority_effect,'NONE');
  assert.equal(c.calls[0].surface_digest_sha256,'a'.repeat(64));
});

test('zero automated violations still do not certify WCAG or replace manual/device evidence',async()=>{
  const backend=createAxeAccessibilityScannerBackend({client:client({violations:[],passes:[{id:'document-title'}],incomplete:[]})});
  const report=await backend.scan(req);
  assert.equal(report.violation_count,0);
  assert.equal(report.accessibility_gate_status,'NOT_EVALUATED');
  assert.equal(report.compliance_certified,false);
  assert.equal(report.manual_evidence_required,true);
  assert.equal(report.device_evidence_required,true);
});

test('malformed impact and scanner authority claims fail closed',async()=>{
  const badImpact=createAxeAccessibilityScannerBackend({client:client({violations:[{id:'x',impact:'catastrophic',nodes:[]}],passes:[],incomplete:[]})});
  await assert.rejects(()=>badImpact.scan(req),/impact invalid/);
  for(const key of ['wcag_compliant','accessibility_pass','certified','release_authority','production_authority','waived','allow_deploy']){
    const backend=createAxeAccessibilityScannerBackend({client:client({violations:[],passes:[],incomplete:[],[key]:true})});
    await assert.rejects(()=>backend.scan(req),/forbidden authority/);
  }
});

test('credential-bearing scan context is rejected before provider invocation',async()=>{
  const c=client();const backend=createAxeAccessibilityScannerBackend({client:c});
  await assert.rejects(()=>backend.scan({...req,context:{nested:{access_token:'secret'}}}),/forbidden credential material/);
  assert.equal(c.calls.length,0);
});

test('axe health is provider health only and cannot certify AXIOM',async()=>{
  const health=await createAxeAccessibilityScannerBackend({client:client()}).health();
  assert.equal(health.provider_status,'UP');
  assert.equal(health.scanner_version,'4.13.0');
  assert.equal(health.axiom_authority,'NONE');
  assert.equal(health.axiom_certification,'NOT_PROVEN');
  assert.equal(health.live_runtime_qualification,'NOT_PROVEN');
});
