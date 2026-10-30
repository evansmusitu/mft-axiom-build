import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FA20_CURRENT_PRODUCTION,
  FA20_FROZEN_RELEASE_POLICY,
  FA20_INCIDENT_STEPS,
  FA20_RELEASE_POLICY_SHA256,
  FA20_RELEASE_STAGES,
  FA20_SOURCE_COMMIT,
  advanceIncidentWork,
  advanceRelease,
  createIncidentWorkContract,
  createProductionApprovalRequest,
  createReleasePlan,
  runIndependentReleaseControlVerification,
  runReleaseControlQualification,
  sealIncidentStepReceipt,
  sealStageReceipt,
  validateStageReceipt,
  verifyFrozenReleasePolicy,
  verifyIncidentWorkContract,
  verifyIndependentReleaseControlAttestation,
  verifyReleaseControlEvidence,
  verifyReleasePlan,
} from '../fa20_release_orchestrator.mjs';

const candidateCommit='f'.repeat(40);
const artifactSha256='1'.repeat(64);

async function receipt(plan,stage,overrides={}){
  const external=['STAGING','SMOKE','CANARY','ROLLBACK_REHEARSAL','STAGING_RESTORED','PRODUCTION','MONITORING','ROLLBACK_PROOF','PRODUCTION_RESTORED'].includes(stage);
  const body={
    schema:'musitu.axiom.fa20.stage-receipt.v1',
    release_id:plan.release_id,
    candidate_commit:plan.candidate_commit,
    candidate_artifact_sha256:plan.candidate_artifact_sha256,
    release_policy_sha256:FA20_RELEASE_POLICY_SHA256,
    stage,
    status:'PASS',
    actor_identity:'fa20-release-runner',
    verifier_identity:'fa20-stage-verifier',
    evidence_sha256:'2'.repeat(64),
    observed_at:'2026-09-16T10:00:00.000Z',
    secrets_recorded:false,
    external_execution:external,
    environment:stage==='STAGING'?'ISOLATED_STAGING':stage==='CANARY'?'ISOLATED_CANARY':'LOCAL_QUALIFICATION',
    all_required_checks_passed:['SMOKE','MONITORING','EVIDENCE_SEALED'].includes(stage),
    rollback_succeeded:['ROLLBACK_REHEARSAL','ROLLBACK_PROOF'].includes(stage),
    rollback_source_commit:['ROLLBACK_REHEARSAL','ROLLBACK_PROOF'].includes(stage)?FA20_CURRENT_PRODUCTION.source_candidate:null,
    candidate_restored:['STAGING_RESTORED','PRODUCTION_RESTORED'].includes(stage),
    monitoring_samples:stage==='MONITORING'?5:0,
    unsupported_claims_published:false,
    production_authority_proven:stage==='PRODUCTION',
    ...overrides,
  };
  return sealStageReceipt(body);
}

async function advanceThroughStagingRestored(plan){
  for(const stage of ['TESTS','ADVERSARIAL','STAGING','SMOKE','CANARY','ROLLBACK_REHEARSAL','STAGING_RESTORED'])plan=await advanceRelease(plan,await receipt(plan,stage));
  return plan;
}

async function incidentReceipt(work,step,overrides={}){
  return sealIncidentStepReceipt({
    schema:'musitu.axiom.fa20.incident-step-receipt.v1',
    contract_id:work.contract_id,
    step,
    status:'PASS',
    evidence_sha256:'3'.repeat(64),
    observed_at:'2026-09-16T11:00:00.000Z',
    repair_actor_identity:'fa20-repair-builder',
    verifier_identity:step==='INDEPENDENT_VERIFY'?'fa20-independent-incident-verifier':null,
    new_candidate_commit:step==='NEW_RELEASE_CANDIDATE'?'e'.repeat(40):null,
    production_patch_executed:false,
    ...overrides,
  });
}

test('FA-20 release policy and immutable current-production rollback origin are hash frozen',async()=>{
  assert.equal(FA20_SOURCE_COMMIT,'9de2da15d9e532eff9f992354d25995ff9a76c7a');
  assert.match(FA20_RELEASE_POLICY_SHA256,/^[0-9a-f]{64}$/);
  assert.equal(await verifyFrozenReleasePolicy(),true);
  assert.equal(FA20_CURRENT_PRODUCTION.production_hostname,'axiom.mftintelligence.com');
  assert.equal(FA20_CURRENT_PRODUCTION.source_candidate,'4c99c4ccbc4a9e34f4e446f30c31f4d428359818');
  assert.equal(FA20_CURRENT_PRODUCTION.runtime_operation_count,74);
  assert.equal(FA20_CURRENT_PRODUCTION.production_evidence_sha256,'d82dae88d967a5c466c03dd5698ec575f05c5434230494d2fa39fb7bfba4afa8');
  assert.equal(FA20_CURRENT_PRODUCTION.immutable_rollback_origin,true);
});

test('new release plan retains the old app and exposes no production authority',async()=>{
  const plan=await createReleasePlan({candidateCommit,artifactSha256});
  assert.deepEqual(plan.completed_stages,['DEVELOPMENT']);
  assert.equal(plan.old_app_retained,true);
  assert.equal(plan.staging_executed,false);
  assert.equal(plan.production_executed,false);
  assert.equal(plan.production_execution_allowed,false);
  assert.equal(plan.phase_exit_earned,false);
  assert.equal(await verifyReleasePlan(plan),true);
});

test('release stage order is exact and a skipped stage fails closed',async()=>{
  const plan=await createReleasePlan({candidateCommit,artifactSha256});
  const skipped=await receipt(plan,'STAGING');
  await assert.rejects(()=>advanceRelease(plan,skipped),/invalid TESTS receipt/i);
  const tests=await receipt(plan,'TESTS');
  const advanced=await advanceRelease(plan,tests);
  assert.deepEqual(advanced.completed_stages,['DEVELOPMENT','TESTS']);
  assert.equal(await verifyReleasePlan({...advanced,status:'tampered'}),false);
});

test('preproduction can reach staging restoration without touching production',async()=>{
  let plan=await createReleasePlan({candidateCommit,artifactSha256});
  plan=await advanceThroughStagingRestored(plan);
  assert.equal(plan.completed_stages.at(-1),'STAGING_RESTORED');
  assert.equal(plan.staging_executed,true);
  assert.equal(plan.canary_executed,true);
  assert.equal(plan.candidate_restored_after_rollback,true);
  assert.equal(plan.old_app_retained,true);
  assert.equal(plan.production_executed,false);
  assert.equal(plan.production_execution_allowed,false);
  assert.equal(await verifyReleasePlan(plan),true);
});

test('S4 request exists only after smoke canary rollback rehearsal and restoration',async()=>{
  const fresh=await createReleasePlan({candidateCommit,artifactSha256});
  await assert.rejects(()=>createProductionApprovalRequest(fresh),/staging smoke canary rollback rehearsal/i);
  const ready=await advanceThroughStagingRestored(fresh);
  const request=await createProductionApprovalRequest(ready);
  assert.equal(request.status,'AWAITING_S4_APPROVAL');
  assert.equal(request.exact_confirmation,'APPROVE FA20 S4 PRODUCTION PROMOTION');
  assert.deepEqual(request.required_distinct_roles,['HUMAN_RELEASE_APPROVER','INDEPENDENT_VERIFIER']);
  assert.equal(request.rollback_origin_evidence_sha256,FA20_CURRENT_PRODUCTION.production_evidence_sha256);
  assert.equal(request.production_execution_allowed,false);
  assert.equal(request.tablet_evidence,'DEFERRED_PENDING_FUTURE_CUSTOMER');
  assert.equal(request.superiority,'NOT_CERTIFIED');
});

test('production remains impossible in v1 even with a structurally valid production receipt',async()=>{
  const ready=await advanceThroughStagingRestored(await createReleasePlan({candidateCommit,artifactSha256}));
  const production=await receipt(ready,'PRODUCTION');
  assert.equal((await validateStageReceipt(production,{plan:ready,expectedStage:'PRODUCTION'})).valid,true);
  await assert.rejects(()=>advanceRelease(ready,production),/exact live S4 production approval not bound/i);
  assert.equal(ready.old_app_retained,true);
  assert.equal(ready.production_executed,false);
});

test('high-severity incident becomes a hash-bound Work Contract with rollback required',async()=>{
  const plan=await createReleasePlan({candidateCommit,artifactSha256});
  const work=await createIncidentWorkContract({plan,title:'Candidate smoke regression',severity:'HIGH',triggerEvidenceSha256:'4'.repeat(64)});
  assert.equal(work.schema,'musitu.axiom.fa20.incident-work-contract.v1');
  assert.equal(work.rollback_required,true);
  assert.equal(work.production_promotion_frozen,true);
  assert.equal(work.silent_production_patch,false);
  assert.equal(work.production_patch_executed,false);
  assert.equal(await verifyIncidentWorkContract(work),true);
});

test('continuous repair requires every step and produces only a new requalification candidate',async()=>{
  const plan=await createReleasePlan({candidateCommit,artifactSha256});
  let work=await createIncidentWorkContract({plan,title:'Injected release failure',severity:'CRITICAL',triggerEvidenceSha256:'5'.repeat(64)});
  for(const step of FA20_INCIDENT_STEPS)work=await advanceIncidentWork(work,await incidentReceipt(work,step));
  assert.deepEqual(work.completed_steps,FA20_INCIDENT_STEPS);
  assert.equal(work.status,'READY_FOR_NEW_RELEASE_REQUALIFICATION');
  assert.equal(work.new_candidate_requalification_required,true);
  assert.equal(work.production_patch_executed,false);
  assert.equal(await verifyIncidentWorkContract(work),true);
});

test('independent verifier replays release control without claiming staging or production',async()=>{
  const builder=await runReleaseControlQualification({candidateCommit,builderIdentity:'fa20-builder'});
  assert.equal(builder.status,'FA20_RELEASE_CONTROL_VERIFIED_STAGING_AUTHORITY_PENDING');
  assert.equal(builder.release_control_qualification_earned,true);
  assert.equal(builder.staging_executed,false);
  assert.equal(builder.old_app_retained,true);
  assert.equal(builder.phase_exit_earned,false);
  assert.equal(await verifyReleaseControlEvidence(builder),true);
  const verifier=await runIndependentReleaseControlVerification({builderEvidence:builder,verifierIdentity:'fa20-verifier'});
  assert.equal(verifier.status,'INDEPENDENT_VERIFIED_FA20_RELEASE_CONTROL_STAGING_NOT_EXECUTED');
  assert.equal(verifier.builder_and_verifier_distinct,true);
  assert.equal(verifier.production_credentials_present,false);
  assert.equal(verifier.production_authority,false);
  assert.equal(await verifyIndependentReleaseControlAttestation(verifier),true);
});

test('authoritative stage and incident sequences remain complete',()=>{
  assert.deepEqual(FA20_FROZEN_RELEASE_POLICY.stage_sequence,FA20_RELEASE_STAGES);
  assert.deepEqual(FA20_FROZEN_RELEASE_POLICY.incident_sequence,FA20_INCIDENT_STEPS);
  assert.equal(FA20_RELEASE_STAGES.at(-1),'EVIDENCE_SEALED');
  assert.equal(FA20_INCIDENT_STEPS.at(-1),'NEW_RELEASE_CANDIDATE');
});

