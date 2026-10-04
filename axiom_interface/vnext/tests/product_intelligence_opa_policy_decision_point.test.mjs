import assert from 'node:assert/strict';
import test from 'node:test';
import {OPA_POLICY_DECISION_DESCRIPTOR,createOpaPolicyDecisionPoint} from '../product_intelligence/backends/opa_policy_decision_point.js';

const request=()=>({
  schema:'musitu.axiom.product-change-admission-request.v1',project_id:'project_12345678',work_id:'work_12345678',checkpoint_id:'checkpoint_12345678',checkpoint_sha256:'a'.repeat(64),
  builder_actor_id:'agent_builder_1',requested_action:'EXTERNAL_REVERSIBLE_WRITE',risk_class:'S3',required_verifications:['TESTS','SECURITY','INDEPENDENT_VERIFIER'],human_approval_required:false,
  policy_engine_authority:'MECHANISM_ONLY',builder_may_approve:false,external_execution_authority:false,production_authority:false,created_at:'2026-10-04T17:30:00.000Z',request_sha256:'b'.repeat(64),
});
function client(result={decision:'ALLOW',policy_sha256:'c'.repeat(64),reasons:['policy matched']}){
  const calls=[]; return {calls,async evaluate(payload){calls.push(structuredClone(payload));return {result};},async health(){return {status:'UP'};}};
}

test('OPA PolicyDecisionPoint pins Phase-1.5 baseline and remains mechanism-only',()=>{
  assert.equal(OPA_POLICY_DECISION_DESCRIPTOR.kind,'PolicyDecisionPoint');
  assert.equal(OPA_POLICY_DECISION_DESCRIPTOR.provider,'open-policy-agent');
  assert.equal(OPA_POLICY_DECISION_DESCRIPTOR.policy_engine_baseline,'1.21.1');
  assert.equal(OPA_POLICY_DECISION_DESCRIPTOR.semantic_owner,'AXIOM');
  assert.equal(OPA_POLICY_DECISION_DESCRIPTOR.authority,'MECHANISM_ONLY');
  assert.equal(OPA_POLICY_DECISION_DESCRIPTOR.release_authority,false);
  assert.equal(OPA_POLICY_DECISION_DESCRIPTOR.production_authority,false);
  assert.equal(OPA_POLICY_DECISION_DESCRIPTOR.live_runtime_qualification,'NOT_PROVEN');
});

test('OPA decision binds exact admission request and emits only admission input',async()=>{
  const c=client(); const pdp=createOpaPolicyDecisionPoint({client:c}); const r=request();
  const out=await pdp.evaluate(r,{context:{environment:'isolated-dev'}});
  assert.deepEqual(out,{decision:'ALLOW',request_sha256:r.request_sha256,policy_sha256:'c'.repeat(64),reasons:['policy matched'],engine:'OPA',engine_version:'1.21.1',authority_effect:'NONE',release_authority:false,production_authority:false,certification_authority:false,human_approval:false});
  assert.equal(c.calls.length,1);
  assert.equal(c.calls[0].path,'data/musitu/axiom/change_admission/decision');
  assert.equal(c.calls[0].input.request.request_sha256,r.request_sha256);
});

test('OPA DENY and NEEDS_HUMAN remain policy decisions, not execution authority',async()=>{
  for(const decision of ['DENY','NEEDS_HUMAN']){
    const pdp=createOpaPolicyDecisionPoint({client:client({decision,policy_sha256:'d'.repeat(64),reasons:[decision]})});
    const out=await pdp.evaluate(request());
    assert.equal(out.decision,decision); assert.equal(out.authority_effect,'NONE'); assert.equal(out.release_authority,false);
  }
});

test('OPA authority-like outputs fail closed instead of escalating privileges',async()=>{
  for(const field of ['release_authority','production_authority','certification_authority','human_approval']){
    const row={decision:'ALLOW',policy_sha256:'e'.repeat(64),reasons:['malicious'],[field]:true};
    const pdp=createOpaPolicyDecisionPoint({client:client(row)});
    await assert.rejects(()=>pdp.evaluate(request()),/OPA attempted forbidden authority/);
  }
});

test('OPA adapter rejects credential material and provider failure',async()=>{
  const pdp=createOpaPolicyDecisionPoint({client:client()});
  await assert.rejects(()=>pdp.evaluate(request(),{context:{api_key:'secret'}}),/forbidden credential material/);
  const bad={calls:[],async evaluate(){throw new Error('opa unavailable');},async health(){return {status:'DOWN'};}};
  await assert.rejects(()=>createOpaPolicyDecisionPoint({client:bad}).evaluate(request()),/opa unavailable/);
});

test('OPA health reports provider state only and never certifies AXIOM',async()=>{
  const health=await createOpaPolicyDecisionPoint({client:client()}).health();
  assert.equal(health.provider_status,'UP');
  assert.equal(health.engine_version,'1.21.1');
  assert.equal(health.axiom_authority,'NONE');
  assert.equal(health.axiom_certification,'NOT_PROVEN');
});
