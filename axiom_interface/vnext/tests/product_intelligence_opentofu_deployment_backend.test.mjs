import assert from 'node:assert/strict';
import test from 'node:test';
import {OPENTOFU_DEPLOYMENT_DESCRIPTOR,createOpenTofuDeploymentBackend} from '../product_intelligence/backends/opentofu_deployment_backend.js';

const baseRaw={
  project_id:'project_12345678',work_id:'work_12345678',workload_identity_id:'agent_workload_12345678',request_id:'request_12345678',
  tool_version:'1.13.1',configuration_digest_sha256:'a'.repeat(64),provider_lock_digest_sha256:'b'.repeat(64),
  planfile_sha256:'c'.repeat(64),plan_json_sha256:'d'.repeat(64),planned_at:'2026-10-05T20:30:00Z',
  resource_changes:[
    {address:'terraform_data.alpha',actions:['create']},
    {address:'terraform_data.beta',actions:['update']},
    {address:'terraform_data.gamma',actions:['delete','create']},
  ],
  diagnostics:[],
};
function client(result={}){const calls=[];return {calls,async plan(input){calls.push(structuredClone(input));return {...structuredClone(baseRaw),...structuredClone(result)};},async health(){return {status:'UP',version:'1.13.1'};}};}
const req={projectId:'project_12345678',workId:'work_12345678',workloadIdentityId:'agent_workload_12345678',requestId:'request_12345678',configurationRef:'workspace://infra/main',configurationDigestSha256:'a'.repeat(64),providerLockDigestSha256:'b'.repeat(64),context:{environment:'isolated-dev'}};

test('OpenTofu implements frozen DeploymentBackend seam as plan-only mechanism',()=>{
  assert.equal(OPENTOFU_DEPLOYMENT_DESCRIPTOR.kind,'DeploymentBackend');
  assert.equal(OPENTOFU_DEPLOYMENT_DESCRIPTOR.provider,'opentofu');
  assert.equal(OPENTOFU_DEPLOYMENT_DESCRIPTOR.provider_baseline,'1.13.1');
  assert.equal(OPENTOFU_DEPLOYMENT_DESCRIPTOR.semantic_owner,'AXIOM');
  assert.equal(OPENTOFU_DEPLOYMENT_DESCRIPTOR.authority,'MECHANISM_ONLY');
  assert.equal(OPENTOFU_DEPLOYMENT_DESCRIPTOR.apply_authority,false);
  assert.equal(OPENTOFU_DEPLOYMENT_DESCRIPTOR.release_authority,false);
  assert.ok(OPENTOFU_DEPLOYMENT_DESCRIPTOR.unsupported_operations.includes('apply'));
  assert.ok(OPENTOFU_DEPLOYMENT_DESCRIPTOR.unsupported_operations.includes('destroy'));
});

test('plan binds exact project/work/config/lock digests and normalizes change summary without execution authority',async()=>{
  const c=client(); const backend=createOpenTofuDeploymentBackend({client:c}); const out=await backend.plan(req);
  assert.equal(c.calls.length,1);
  assert.deepEqual(c.calls[0],{
    project_id:req.projectId,work_id:req.workId,workload_identity_id:req.workloadIdentityId,request_id:req.requestId,
    configuration_ref:req.configurationRef,expected_configuration_digest_sha256:req.configurationDigestSha256,
    expected_provider_lock_digest_sha256:req.providerLockDigestSha256,mode:'PLAN_ONLY',refresh:false,lock_state:false,input:false,context:req.context,
  });
  assert.equal(out.schema,'musitu.axiom.opentofu-plan.v1');
  assert.equal(out.project_id,req.projectId); assert.equal(out.work_id,req.workId);
  assert.equal(out.configuration_digest_sha256,'a'.repeat(64)); assert.equal(out.provider_lock_digest_sha256,'b'.repeat(64));
  assert.equal(out.planfile_sha256,'c'.repeat(64)); assert.equal(out.plan_json_sha256,'d'.repeat(64));
  assert.deepEqual(out.change_summary,{create:1,update:1,delete:0,replace:1,total:3});
  assert.deepEqual(out.resource_change_addresses,['terraform_data.alpha','terraform_data.beta','terraform_data.gamma']);
  assert.equal(out.plan_state,'PLANNED'); assert.equal(out.admission_state,'NOT_EVALUATED');
  assert.equal(out.apply_allowed,false); assert.equal(out.external_action_executed,false); assert.equal(out.state_mutated,false);
  assert.equal(out.authority_effect,'NONE'); assert.equal(out.release_authority,false); assert.equal(out.production_authority,false);
  assert.equal(out.required_next_gate,'CHANGE_ADMISSION');
});

test('provider version or identity/digest mismatch fails closed',async()=>{
  for(const result of [
    {tool_version:'1.13.2'}, {project_id:'project_other'}, {work_id:'work_other'},
    {configuration_digest_sha256:'e'.repeat(64)}, {provider_lock_digest_sha256:'f'.repeat(64)},
    {planfile_sha256:'bad'}, {plan_json_sha256:'bad'}
  ]){
    const backend=createOpenTofuDeploymentBackend({client:client(result)});
    await assert.rejects(()=>backend.plan(req));
  }
});

test('provider authority/execution claims are rejected rather than promoted',async()=>{
  for(const key of ['apply_executed','state_mutated','release_authority','production_authority','allow_deploy','certified']){
    const backend=createOpenTofuDeploymentBackend({client:client({[key]:true})});
    await assert.rejects(()=>backend.plan(req),/forbidden authority|forbidden execution/i);
  }
});

test('credential-bearing context and malformed resource changes are rejected before/after provider invocation',async()=>{
  const c=client(); const backend=createOpenTofuDeploymentBackend({client:c});
  await assert.rejects(()=>backend.plan({...req,context:{api_key:'secret'}}),/forbidden credential material/);
  assert.equal(c.calls.length,0);
  await assert.rejects(()=>createOpenTofuDeploymentBackend({client:client({resource_changes:[{address:'x',actions:['apply']}]})}).plan(req),/actions invalid/);
});

test('raw plan/state/value payloads and extra resource fields are rejected to prevent sensitive-value leakage',async()=>{
  for(const key of ['plan_json','planned_values','prior_state','configuration','variables','values','sensitive_values','raw_plan','state']){
    const backend=createOpenTofuDeploymentBackend({client:client({[key]:{secretish:'value'}})});
    await assert.rejects(()=>backend.plan(req),/forbidden raw plan payload/);
  }
  const backend=createOpenTofuDeploymentBackend({client:client({resource_changes:[{address:'terraform_data.x',actions:['create'],after:{password:'do-not-cross-boundary'}}]})});
  await assert.rejects(()=>backend.plan(req),/forbidden raw plan fields/);
});

test('duplicate resource addresses, duplicate actions, invalid timestamps and health authority claims fail closed',async()=>{
  await assert.rejects(()=>createOpenTofuDeploymentBackend({client:client({resource_changes:[{address:'x',actions:['create']},{address:'x',actions:['update']}]})}).plan(req),/duplicate/);
  await assert.rejects(()=>createOpenTofuDeploymentBackend({client:client({resource_changes:[{address:'x',actions:['create','create']}]})}).plan(req),/actions invalid/);
  await assert.rejects(()=>createOpenTofuDeploymentBackend({client:client({planned_at:'not-a-time'})}).plan(req),/planned_at/);
  const badHealth={async plan(input){return {...structuredClone(baseRaw),...input};},async health(){return {status:'UP',version:'1.13.1',release_authority:true};}};
  await assert.rejects(()=>createOpenTofuDeploymentBackend({client:badHealth}).health(),/forbidden authority/);
});

test('backend exposes no apply/destroy method and health cannot certify or qualify AXIOM',async()=>{
  const backend=createOpenTofuDeploymentBackend({client:client()});
  assert.equal(backend.apply,undefined); assert.equal(backend.destroy,undefined);
  const health=await backend.health();
  assert.equal(health.provider_status,'UP'); assert.equal(health.tool,'OPENTOFU'); assert.equal(health.tool_version,'1.13.1');
  assert.equal(health.axiom_authority,'NONE'); assert.equal(health.axiom_certification,'NOT_PROVEN'); assert.equal(health.live_runtime_qualification,'NOT_PROVEN');
});
