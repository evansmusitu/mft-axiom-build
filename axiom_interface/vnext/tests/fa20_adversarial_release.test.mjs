import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  FA20_CURRENT_PRODUCTION,
  FA20_RELEASE_POLICY_SHA256,
  advanceIncidentWork,
  advanceRelease,
  createIncidentWorkContract,
  createReleasePlan,
  runIndependentReleaseControlVerification,
  runReleaseControlQualification,
  sealIncidentStepReceipt,
  sealStageReceipt,
  verifyIndependentReleaseControlAttestation,
  verifyReleaseControlEvidence,
  verifyReleasePlan,
} from '../fa20_release_orchestrator.mjs';

const candidateCommit='a'.repeat(40);
const artifactSha256='b'.repeat(64);

async function stageReceipt(plan,stage,overrides={}){
  return sealStageReceipt({
    schema:'musitu.axiom.fa20.stage-receipt.v1',release_id:plan.release_id,
    candidate_commit:plan.candidate_commit,candidate_artifact_sha256:plan.candidate_artifact_sha256,
    release_policy_sha256:FA20_RELEASE_POLICY_SHA256,stage,status:'PASS',actor_identity:'runner',
    verifier_identity:'verifier',evidence_sha256:'c'.repeat(64),observed_at:'2026-09-16T12:00:00Z',
    secrets_recorded:false,external_execution:false,production_authority_proven:false,...overrides,
  });
}

test('plan and receipt tampering are rejected',async()=>{
  const plan=await createReleasePlan({candidateCommit,artifactSha256});
  assert.equal(await verifyReleasePlan({...plan,old_app_retained:false}),false);
  const receipt=await stageReceipt(plan,'TESTS');
  await assert.rejects(()=>advanceRelease(plan,{...receipt,status:'PASS',evidence_sha256:'d'.repeat(64)}),/receipt_integrity/i);
});

test('same stage actor and verifier cannot certify a release stage',async()=>{
  const plan=await createReleasePlan({candidateCommit,artifactSha256});
  const receipt=await stageReceipt(plan,'TESTS',{actor_identity:'same-person',verifier_identity:'same-person'});
  await assert.rejects(()=>advanceRelease(plan,receipt),/actor_verifier_separation/i);
});

test('approval-shaped production input cannot bypass the unbound live S4 gate',async()=>{
  let plan=await createReleasePlan({candidateCommit,artifactSha256});
  const fixtures={
    TESTS:{external_execution:false},ADVERSARIAL:{external_execution:false},
    STAGING:{external_execution:true,environment:'ISOLATED_STAGING'},
    SMOKE:{external_execution:true,all_required_checks_passed:true},
    CANARY:{external_execution:true,environment:'ISOLATED_CANARY'},
    ROLLBACK_REHEARSAL:{external_execution:true,rollback_succeeded:true,rollback_source_commit:FA20_CURRENT_PRODUCTION.source_candidate},
    STAGING_RESTORED:{external_execution:true,candidate_restored:true},
  };
  for(const [stage,extra] of Object.entries(fixtures))plan=await advanceRelease(plan,await stageReceipt(plan,stage,extra));
  const production=await stageReceipt(plan,'PRODUCTION',{external_execution:true,production_authority_proven:true});
  await assert.rejects(()=>advanceRelease(plan,production),/live S4 production approval not bound/i);
  assert.equal(plan.old_app_retained,true);
  assert.equal(plan.production_executed,false);
});

test('builder evidence cannot invent staging authority and verifier self-approval fails',async()=>{
  const evidence=await runReleaseControlQualification({candidateCommit,builderIdentity:'fa20-builder'});
  assert.equal(await verifyReleaseControlEvidence({...evidence,staging_authority_present:true}),false);
  await assert.rejects(
    ()=>runIndependentReleaseControlVerification({builderEvidence:evidence,verifierIdentity:'fa20-builder'}),
    /distinct FA-20 verifier/i,
  );
});

test('independent evidence tampering fails integrity',async()=>{
  const evidence=await runReleaseControlQualification({candidateCommit,builderIdentity:'fa20-builder'});
  const attestation=await runIndependentReleaseControlVerification({builderEvidence:evidence,verifierIdentity:'fa20-verifier'});
  assert.equal(await verifyIndependentReleaseControlAttestation({...attestation,production_authority:true}),false);
  assert.equal(await verifyIndependentReleaseControlAttestation({...attestation,old_app_retained:false}),false);
});

test('continuous repair rejects skipped steps and silent production patching',async()=>{
  const plan=await createReleasePlan({candidateCommit,artifactSha256});
  const work=await createIncidentWorkContract({plan,title:'Adversarial incident',triggerEvidenceSha256:'e'.repeat(64)});
  const skipped=await sealIncidentStepReceipt({
    schema:'musitu.axiom.fa20.incident-step-receipt.v1',contract_id:work.contract_id,step:'REPAIR',status:'PASS',
    evidence_sha256:'f'.repeat(64),observed_at:'2026-09-16T12:01:00Z',production_patch_executed:false,
  });
  await assert.rejects(()=>advanceIncidentWork(work,skipped),/invalid incident step receipt/i);
  const patched=await sealIncidentStepReceipt({
    schema:'musitu.axiom.fa20.incident-step-receipt.v1',contract_id:work.contract_id,step:'CONTAIN',status:'PASS',
    evidence_sha256:'f'.repeat(64),observed_at:'2026-09-16T12:01:00Z',production_patch_executed:true,
  });
  await assert.rejects(()=>advanceIncidentWork(work,patched),/cannot silently patch production/i);
});

test('release-control module has no network transport host executor or deploy command',()=>{
  const source=fs.readFileSync(new URL('../fa20_release_orchestrator.mjs',import.meta.url),'utf8');
  for(const pattern of [/\bfetch\s*\(/,/WebSocket\s*\(/,/XMLHttpRequest/,/child_process/,/\bspawn\s*\(/,/\bexec\s*\(/,/wrangler\s+deploy/,/kubectl\s+apply/,/terraform\s+apply/])assert.equal(pattern.test(source),false,String(pattern));
  for(const text of ["staging_authority_present:false","production_authority:false","old_app_retained:true","tablet_evidence:'DEFERRED_PENDING_FUTURE_CUSTOMER'","external_comparison:'DEFERRED_NO_PAID_PROVIDER_ACCESS'"])assert.ok(source.includes(text),text);
});

test('qualification workflows are credential-free read-only and reproducible',()=>{
  const root=new URL('../../../',import.meta.url);
  const builder=fs.readFileSync(new URL('.github/workflows/axiom-fa20-release-control.yml',root),'utf8');
  const verifier=fs.readFileSync(new URL('.github/workflows/axiom-fa20-independent-verifier.yml',root),'utf8');
  for(const workflow of [builder,verifier]){
    assert.match(workflow,/permissions:\n\s+contents: read\n\s+actions: read/);
    assert.equal(/^\s*(?:contents|actions|deployments|packages|id-token):\s*write\s*$/m.test(workflow),false);
    assert.equal(/uses:\s*[^\s#]+@(?![0-9a-f]{40}(?:\s|$))/.test(workflow),false);
  }
  assert.ok(builder.includes('(cd fa20-release-control-evidence && sha256sum fa20-release-control.json > fa20-release-control.sha256)'));
  assert.ok(verifier.includes('(cd fa20-independent-evidence && sha256sum fa20-independent-verifier.json > fa20-independent-verifier.sha256)'));
});

test('inactive staging workflow is isolated and cannot mutate production',()=>{
  const root=new URL('../../../',import.meta.url);
  const workflow=fs.readFileSync(new URL('.github/workflows/axiom-fa20-staging-canary.yml',root),'utf8');
  assert.ok(workflow.includes("- 'docs/axiom_final_product/FA20_STAGE_AUTHORITY.json'"));
  assert.ok(workflow.includes('START FA20 STAGING AND CANARY'));
  assert.ok(workflow.includes('musitu-axiom-fa20-staging'));
  assert.ok(workflow.includes('musitu-axiom-fa20-canary'));
  assert.equal(workflow.includes('axiom.mftintelligence.com'),false);
  assert.equal(workflow.includes('musitu-axiom-fa13-production-ui-edge'),false);
  assert.equal(workflow.includes('routes ='),false);
  assert.equal(workflow.includes('custom_domains'),false);
});
