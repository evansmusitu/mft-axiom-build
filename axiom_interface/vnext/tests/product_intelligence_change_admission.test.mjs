import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CHANGE_RISK_MODEL,
  createChangeAdmissionRequest,
  evaluateChangeAdmission,
} from '../product_intelligence/change_admission.js';

const at='2026-10-04T17:20:00Z';
const checkpoint={
  schema:'musitu.axiom.product-compiler-checkpoint.v1',
  checkpoint_id:'checkpoint_1234567890abcdef',
  checkpoint_sha256:'a'.repeat(64),
  project_id:'project_12345678',
  next_ir_sha256:'b'.repeat(64),
  prior_ir_sha256:'c'.repeat(64),
  authority_effect:'NONE',
  rollback_mode:'PREPARE_ONLY',
  external_execution_authority:false,
  production_authority:false,
};

const pass=(kind,actor='agent_verifier_1')=>({kind,status:'PASS',actor_id:actor,artifact_sha256:'d'.repeat(64)});

async function request(riskClass='S3'){
  return createChangeAdmissionRequest({
    projectId:'project_12345678',workId:'work_12345678',checkpoint,
    builderActorId:'agent_builder_1',requestedAction:CHANGE_RISK_MODEL[riskClass].action,
    riskClass,at,
  });
}

test('change admission freezes AXIOM S0-S5 meanings and escalating verification requirements',()=>{
  assert.deepEqual(Object.keys(CHANGE_RISK_MODEL),['S0','S1','S2','S3','S4','S5']);
  assert.equal(CHANGE_RISK_MODEL.S0.action,'READ_COMPUTE');
  assert.equal(CHANGE_RISK_MODEL.S1.action,'PRIVATE_REVERSIBLE_WRITE');
  assert.equal(CHANGE_RISK_MODEL.S2.action,'EXTERNAL_READ');
  assert.equal(CHANGE_RISK_MODEL.S3.action,'EXTERNAL_REVERSIBLE_WRITE');
  assert.equal(CHANGE_RISK_MODEL.S4.action,'PUBLICATION_OR_PRODUCTION_DEPLOYMENT');
  assert.equal(CHANGE_RISK_MODEL.S5.action,'SECRETS_IDENTITY_SECURITY_OR_DESTRUCTIVE');
  assert.deepEqual(CHANGE_RISK_MODEL.S3.required_verifications,['TESTS','SECURITY','INDEPENDENT_VERIFIER']);
  assert.equal(CHANGE_RISK_MODEL.S4.human_approval_required,true);
  assert.equal(CHANGE_RISK_MODEL.S5.human_approval_required,true);
});

test('admission request binds one compiler checkpoint and keeps policy engine mechanism-only',async()=>{
  const r=await request('S3');
  assert.equal(r.schema,'musitu.axiom.product-change-admission-request.v1');
  assert.equal(r.project_id,'project_12345678');
  assert.equal(r.checkpoint_sha256,checkpoint.checkpoint_sha256);
  assert.equal(r.builder_actor_id,'agent_builder_1');
  assert.deepEqual(r.required_verifications,['TESTS','SECURITY','INDEPENDENT_VERIFIER']);
  assert.equal(r.policy_engine_authority,'MECHANISM_ONLY');
  assert.equal(r.builder_may_approve,false);
  assert.equal(r.external_execution_authority,false);
  assert.match(r.request_sha256,/^[a-f0-9]{64}$/);
});

test('policy ALLOW cannot bypass missing or builder-self-issued independent verification',async()=>{
  const r=await request('S3');
  const policy={decision:'ALLOW',request_sha256:r.request_sha256,policy_sha256:'e'.repeat(64),reasons:['bounded Phase-2 write']};
  const incomplete=await evaluateChangeAdmission({request:r,policyDecision:policy,verificationEvidence:[pass('TESTS'),pass('SECURITY')],at});
  assert.equal(incomplete.status,'BLOCKED_VERIFICATION');
  assert.equal(incomplete.admitted_to_executor,false);

  await assert.rejects(()=>evaluateChangeAdmission({request:r,policyDecision:policy,verificationEvidence:[pass('TESTS'),pass('SECURITY'),pass('INDEPENDENT_VERIFIER','agent_builder_1')],at}),/independent verifier must differ from builder/);
});

test('S3 admission requires tests security and independent verifier and still does not execute',async()=>{
  const r=await request('S3');
  const policy={decision:'ALLOW',request_sha256:r.request_sha256,policy_sha256:'e'.repeat(64),reasons:['bounded external reversible write']};
  const result=await evaluateChangeAdmission({request:r,policyDecision:policy,verificationEvidence:[pass('TESTS'),pass('SECURITY'),pass('INDEPENDENT_VERIFIER')],at});
  assert.equal(result.status,'ADMITTED_TO_EXECUTOR');
  assert.equal(result.admitted_to_executor,true);
  assert.equal(result.authority_effect,'ADMISSION_ONLY');
  assert.equal(result.external_execution_authority,false);
  assert.equal(result.required_next_gate,'OPERATION_SCOPED_EXECUTOR');
  assert.equal(result.independent_verification,'PASS');
});

test('S4 policy ALLOW cannot replace human approval and valid human receipt only admits next gate',async()=>{
  const r=await request('S4');
  const policy={decision:'ALLOW',request_sha256:r.request_sha256,policy_sha256:'e'.repeat(64),reasons:['release policy passed']};
  const verification=[pass('TESTS'),pass('SECURITY'),pass('INDEPENDENT_VERIFIER')];
  const blocked=await evaluateChangeAdmission({request:r,policyDecision:policy,verificationEvidence:verification,at});
  assert.equal(blocked.status,'BLOCKED_HUMAN_APPROVAL');
  assert.equal(blocked.admitted_to_executor,false);

  const admitted=await evaluateChangeAdmission({
    request:r,policyDecision:policy,verificationEvidence:verification,
    humanApproval:{decision:'ALLOW',request_sha256:r.request_sha256,actor_id:'user_final_authority',receipt_id:'approval_12345678',at},at,
  });
  assert.equal(admitted.status,'ADMITTED_TO_EXECUTOR');
  assert.equal(admitted.human_approval,'PASS');
  assert.equal(admitted.external_execution_authority,false);
  assert.equal(admitted.required_next_gate,'OPERATION_SCOPED_EXECUTOR');
});

test('DENY and policy/request hash mismatch fail closed',async()=>{
  const r=await request('S1');
  const denied=await evaluateChangeAdmission({request:r,policyDecision:{decision:'DENY',request_sha256:r.request_sha256,policy_sha256:'e'.repeat(64),reasons:['policy denied']},verificationEvidence:[pass('TESTS')],at});
  assert.equal(denied.status,'DENIED');
  assert.equal(denied.admitted_to_executor,false);

  await assert.rejects(()=>evaluateChangeAdmission({request:r,policyDecision:{decision:'ALLOW',request_sha256:'f'.repeat(64),policy_sha256:'e'.repeat(64),reasons:[]},verificationEvidence:[pass('TESTS')],at}),/policy decision is not bound to admission request/);
});


test('admission request rejects an unverified checkpoint look-alike even when its surface fields appear valid',async()=>{
  await assert.rejects(
    ()=>createChangeAdmissionRequest({
      projectId:'project_12345678',workId:'work_12345678',checkpoint,
      builderActorId:'agent_builder_1',requestedAction:CHANGE_RISK_MODEL.S3.action,riskClass:'S3',at,
    }),
    /checkpoint.*integrity|verified.*checkpoint|checkpoint.*verification/i,
  );
});
