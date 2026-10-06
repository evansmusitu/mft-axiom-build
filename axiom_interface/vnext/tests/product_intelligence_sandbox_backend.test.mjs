import assert from 'node:assert/strict';
import test from 'node:test';
import {GOVERNED_SANDBOX_DESCRIPTOR,createGovernedSandboxBackend} from '../product_intelligence/backends/governed_sandbox_backend.js';

test('SandboxBackend is frozen as an AXIOM-owned mechanism-only FA-11 seam',()=>{
  assert.equal(GOVERNED_SANDBOX_DESCRIPTOR.kind,'SandboxBackend');
  assert.equal(GOVERNED_SANDBOX_DESCRIPTOR.provider,'axiom-fa11-governed-sandbox');
  assert.equal(GOVERNED_SANDBOX_DESCRIPTOR.provider_baseline,'FA11_S0_S5_V1');
  assert.equal(GOVERNED_SANDBOX_DESCRIPTOR.semantic_owner,'AXIOM');
  assert.equal(GOVERNED_SANDBOX_DESCRIPTOR.authority,'MECHANISM_ONLY');
  assert.equal(GOVERNED_SANDBOX_DESCRIPTOR.default_network_policy,'DENY_ALL_EXTERNAL_NETWORK');
  assert.equal(GOVERNED_SANDBOX_DESCRIPTOR.host_shell_authority,false);
  assert.equal(GOVERNED_SANDBOX_DESCRIPTOR.external_network_authority,false);
  assert.equal(GOVERNED_SANDBOX_DESCRIPTOR.plaintext_secret_access,false);
  assert.equal(GOVERNED_SANDBOX_DESCRIPTOR.release_authority,false);
  assert.equal(GOVERNED_SANDBOX_DESCRIPTOR.production_authority,false);
  assert.equal(GOVERNED_SANDBOX_DESCRIPTOR.certification_authority,false);
  assert.equal(GOVERNED_SANDBOX_DESCRIPTOR.external_process_runtime_qualification,'NOT_PROVEN');
  assert.equal(typeof createGovernedSandboxBackend,'function');
});

const baseCreate={
  projectId:'project_12345678',workId:'work_12345678',agentId:'agent_12345678',workloadIdentityId:'wid_12345678',requestId:'request_12345678',
  baseTreeSha256:'a'.repeat(64),context:{purpose:'isolated-build'},
};
function sandboxClient(overrides={}){
  const calls={create:[],execute:[],verify:[],dispose:[],health:[]};
  return {
    calls,metadata:{name:'axiom-fa11-governed-sandbox',baseline:'FA11_S0_S5_V1'},
    async create(input){calls.create.push(structuredClone(input));return {
      sandbox_id:'sandbox_12345678',project_id:input.project_id,work_id:input.work_id,agent_id:input.agent_id,workload_identity_id:input.workload_identity_id,request_id:input.request_id,
      base_tree_sha256:input.base_tree_sha256,sandbox_mode:'PROJECT_SCOPED_VIRTUAL_SANDBOX',terminal_mode:'BOUNDED_VIRTUAL_TERMINAL_NO_HOST_SHELL',worktree_mode:'ISOLATED_VIRTUAL_WORKTREE_NO_REPO_MUTATION',
      network_policy:'DENY_ALL_EXTERNAL_NETWORK',secrets_policy:'OPAQUE_SHORT_LIVED_OPERATION_SCOPED_NO_PLAINTEXT',resource_limits:{max_file_bytes:262144,max_files:256,max_compute_units:100000},
      external_network_enabled:false,host_shell_enabled:false,plaintext_secret_access:false,created_at:'2026-10-06T04:00:00Z',...structuredClone(overrides.create||{}),
    };},
    async execute(input){calls.execute.push(structuredClone(input));return {sandbox_id:input.sandbox_id,project_id:input.project_id,work_id:input.work_id,agent_id:input.agent_id,workload_identity_id:input.workload_identity_id,request_id:input.request_id,operation:input.operation,status:'COMPLETED',result:{target:input.target,operation:input.operation},rollback_available:input.risk_class==='S1',external_action_executed:false,network_request_performed:false,host_shell_executed:false,plaintext_secret_access:false,completed_at:'2026-10-06T04:01:00Z',...structuredClone(overrides.execute||{})};},
    async verify(input){calls.verify.push(structuredClone(input));return {sandbox_id:input.sandbox_id,project_id:input.project_id,work_id:input.work_id,agent_id:input.agent_id,workload_identity_id:input.workload_identity_id,request_id:input.request_id,status:'PASS',sandbox_mode:'PROJECT_SCOPED_VIRTUAL_SANDBOX',terminal_mode:'BOUNDED_VIRTUAL_TERMINAL_NO_HOST_SHELL',worktree_mode:'ISOLATED_VIRTUAL_WORKTREE_NO_REPO_MUTATION',network_policy:'DENY_ALL_EXTERNAL_NETWORK',secrets_policy:'OPAQUE_SHORT_LIVED_OPERATION_SCOPED_NO_PLAINTEXT',resource_limits:{max_file_bytes:262144,max_files:256,max_compute_units:100000},external_network_enabled:false,host_shell_enabled:false,plaintext_secret_access:false,integrity_sha256:'c'.repeat(64),checked_at:'2026-10-06T04:02:00Z',...structuredClone(overrides.verify||{})};},
    async dispose(input){calls.dispose.push(structuredClone(input));return {sandbox_id:input.sandbox_id,project_id:input.project_id,work_id:input.work_id,agent_id:input.agent_id,workload_identity_id:input.workload_identity_id,request_id:input.request_id,status:'DISPOSED',destroyed:true,disposed_at:'2026-10-06T04:03:00Z',...structuredClone(overrides.dispose||{})};},
    async health(){calls.health.push({});return {status:'UP',...structuredClone(overrides.health||{})};},
  };
}

test('createSandbox binds exact Project Work Agent workload identity and fixed FA-11 boundaries',async()=>{
  const client=sandboxClient();
  const backend=createGovernedSandboxBackend({client});
  const one=await backend.createSandbox(baseCreate);
  const two=await backend.createSandbox(baseCreate);
  assert.equal(client.calls.create.length,2);
  assert.deepEqual(client.calls.create[0],{
    project_id:'project_12345678',work_id:'work_12345678',agent_id:'agent_12345678',workload_identity_id:'wid_12345678',request_id:'request_12345678',
    base_tree_sha256:'a'.repeat(64),context:{purpose:'isolated-build'},
    sandbox_mode:'PROJECT_SCOPED_VIRTUAL_SANDBOX',terminal_mode:'BOUNDED_VIRTUAL_TERMINAL_NO_HOST_SHELL',worktree_mode:'ISOLATED_VIRTUAL_WORKTREE_NO_REPO_MUTATION',
    network_policy:'DENY_ALL_EXTERNAL_NETWORK',secrets_policy:'OPAQUE_SHORT_LIVED_OPERATION_SCOPED_NO_PLAINTEXT',resource_limits:{max_file_bytes:262144,max_files:256,max_compute_units:100000},
    external_network_allowed:false,host_shell_allowed:false,plaintext_secret_access:false,
  });
  assert.equal(one.schema,'musitu.axiom.sandbox-handle.v1');
  assert.equal(one.project_id,'project_12345678'); assert.equal(one.work_id,'work_12345678'); assert.equal(one.agent_id,'agent_12345678'); assert.equal(one.workload_identity_id,'wid_12345678');
  assert.equal(one.sandbox_id,'sandbox_12345678'); assert.equal(one.network_policy,'DENY_ALL_EXTERNAL_NETWORK');
  assert.equal(one.host_shell_authority,false); assert.equal(one.external_network_authority,false); assert.equal(one.plaintext_secret_access,false);
  assert.equal(one.external_process_runtime_qualification,'NOT_PROVEN'); assert.equal(one.canonical_evidence,false); assert.equal(one.authority_effect,'NONE');
  assert.match(one.sandbox_sha256,/^[a-f0-9]{64}$/); assert.equal(one.sandbox_sha256,two.sandbox_sha256);
});

test('createSandbox rejects unknown schema, caller boundary overrides and credential material before provider use',async()=>{
  const cases=[
    {...baseCreate,unexpected:true},
    {...baseCreate,networkPolicy:{mode:'ALLOWLIST',hosts:['evil.test']}},
    {...baseCreate,hostShellAllowed:true},
    {...baseCreate,context:{nested:{api_key:'must-not-cross'}}},
    {...baseCreate,context:[]},
    {...baseCreate,baseTreeSha256:'not-a-digest'},
  ];
  for(const input of cases){
    const client=sandboxClient();
    const backend=createGovernedSandboxBackend({client});
    await assert.rejects(()=>backend.createSandbox(input));
    assert.equal(client.calls.create.length,0);
  }
});

test('sandbox provider cannot escalate authority or weaken containment during creation',async()=>{
  const cases=[
    {create:{release_authority:true}},
    {create:{production_authority:true}},
    {create:{certification_authority:true}},
    {create:{external_network_enabled:true}},
    {create:{host_shell_enabled:true}},
    {create:{plaintext_secret_access:true}},
    {create:{network_policy:'ALLOW_ALL'}},
    {create:{provider_metadata:{nested:{allow_deploy:true}}}},
  ];
  for(const overrides of cases){
    const client=sandboxClient(overrides);
    const backend=createGovernedSandboxBackend({client});
    await assert.rejects(()=>backend.createSandbox(baseCreate),/(authority|boundary|network policy|forbidden)/i);
    assert.equal(client.calls.create.length,1);
  }
});

test('execute runs only bounded local S0/S1 under exact sandbox identity and produces deterministic non-authoritative evidence',async()=>{
  const client=sandboxClient();
  const backend=createGovernedSandboxBackend({client});
  const handle=await backend.createSandbox(baseCreate);
  const request={requestId:'exec_12345678',operation:'file.write',target:'src/app.js',payload:{content:'hello sandbox'},computeUnits:5,instructionProvenance:'GOVERNED_PLAN'};
  const one=await backend.execute(handle,request);
  const two=await backend.execute(handle,request);
  assert.equal(client.calls.execute.length,2);
  assert.deepEqual(client.calls.execute[0],{
    sandbox_id:'sandbox_12345678',project_id:'project_12345678',work_id:'work_12345678',agent_id:'agent_12345678',workload_identity_id:'wid_12345678',request_id:'exec_12345678',
    operation:'file.write',risk_class:'S1',target:'src/app.js',payload:{content:'hello sandbox'},compute_units:5,instruction_provenance:'GOVERNED_PLAN',
    sandbox_mode:'PROJECT_SCOPED_VIRTUAL_SANDBOX',terminal_mode:'BOUNDED_VIRTUAL_TERMINAL_NO_HOST_SHELL',worktree_mode:'ISOLATED_VIRTUAL_WORKTREE_NO_REPO_MUTATION',network_policy:'DENY_ALL_EXTERNAL_NETWORK',secrets_policy:'OPAQUE_SHORT_LIVED_OPERATION_SCOPED_NO_PLAINTEXT',
    external_network_allowed:false,host_shell_allowed:false,plaintext_secret_access:false,
  });
  assert.equal(one.schema,'musitu.axiom.sandbox-execution-receipt.v1');
  assert.equal(one.risk_class,'S1'); assert.equal(one.status,'COMPLETED'); assert.equal(one.rollback_available,true);
  assert.equal(one.external_action_executed,false); assert.equal(one.network_request_performed,false); assert.equal(one.host_shell_executed,false); assert.equal(one.plaintext_secret_access,false);
  assert.equal(one.canonical_evidence,false); assert.equal(one.authority_effect,'NONE'); assert.equal(one.release_authority,false); assert.equal(one.production_authority,false); assert.equal(one.certification_authority,false);
  assert.match(one.result_sha256,/^[a-f0-9]{64}$/); assert.match(one.execution_sha256,/^[a-f0-9]{64}$/); assert.equal(one.execution_sha256,two.execution_sha256);
});

test('external, consequential and unknown operations fail closed before the sandbox provider',async()=>{
  for(const operation of ['network.read','repo.mutate','network.write','publish.deploy','secret.use','identity.change','security.policy.change','data.destroy','mystery.root']){
    const client=sandboxClient();
    const backend=createGovernedSandboxBackend({client});
    const handle=await backend.createSandbox(baseCreate);
    await assert.rejects(
      ()=>backend.execute(handle,{requestId:'exec_blocked_1234',operation,target:'target',computeUnits:1,instructionProvenance:'GOVERNED_PLAN'}),
      /QUALIFIED_EXTERNAL_EXECUTOR_REQUIRED/,
    );
    assert.equal(client.calls.execute.length,0);
  }
});

test('local sandbox execution rejects path escape, shell escape, retrieved-data side effects and quota/secret violations before provider use',async()=>{
  const invalid=[
    {requestId:'bad_path_12345678',operation:'file.read',target:'../outside.txt'},
    {requestId:'bad_shell_1234567',operation:'terminal.read',target:'cat src/app.js; rm -rf /'},
    {requestId:'bad_prov_12345678',operation:'file.write',target:'src/a.js',payload:{content:'safe'},instructionProvenance:'RETRIEVED_DATA'},
    {requestId:'bad_secret_123456',operation:'file.write',target:'src/a.js',payload:{content:'password: hunter2'}},
    {requestId:'bad_size_12345678',operation:'file.write',target:'src/a.js',payload:{content:'x'.repeat(262145)}},
    {requestId:'bad_payload_123456',operation:'file.write',target:'src/a.js',payload:{content:'safe',unexpected:true}},
  ];
  for(const request of invalid){
    const client=sandboxClient();
    const backend=createGovernedSandboxBackend({client});
    const handle=await backend.createSandbox(baseCreate);
    await assert.rejects(()=>backend.execute(handle,{computeUnits:1,instructionProvenance:'GOVERNED_PLAN',...request}));
    assert.equal(client.calls.execute.length,0);
  }
});

test('tampered handles and provider result/identity/boundary attacks fail closed',async()=>{
  {
    const client=sandboxClient();
    const backend=createGovernedSandboxBackend({client});
    const handle=await backend.createSandbox(baseCreate);
    await assert.rejects(()=>backend.execute({...handle,work_id:'work_other_12345678'},{requestId:'tamper_handle_123',operation:'file.read',target:'src/a.js'}),/handle.*(digest|integrity)|tamper/i);
    assert.equal(client.calls.execute.length,0);
  }
  for(const execute of [
    {result:{password:'hunter2'}},
    {project_id:'project_other_12345678'},
    {external_action_executed:true},
    {network_request_performed:true},
    {host_shell_executed:true},
    {plaintext_secret_access:true},
    {release_authority:true},
  ]){
    const client=sandboxClient({execute});
    const backend=createGovernedSandboxBackend({client});
    const handle=await backend.createSandbox(baseCreate);
    await assert.rejects(()=>backend.execute(handle,{requestId:'provider_attack_123',operation:'file.read',target:'src/a.js'}));
    assert.equal(client.calls.execute.length,1);
  }
});

test('verifySandbox checks exact boundary integrity without turning provider PASS into certification',async()=>{
  const client=sandboxClient();
  const backend=createGovernedSandboxBackend({client});
  const handle=await backend.createSandbox(baseCreate);
  const one=await backend.verifySandbox(handle,{requestId:'verify_12345678'});
  const two=await backend.verifySandbox(handle,{requestId:'verify_12345678'});
  assert.equal(client.calls.verify.length,2);
  assert.deepEqual(client.calls.verify[0],{
    sandbox_id:'sandbox_12345678',project_id:'project_12345678',work_id:'work_12345678',agent_id:'agent_12345678',workload_identity_id:'wid_12345678',request_id:'verify_12345678',
    expected_sandbox_sha256:handle.sandbox_sha256,network_policy:'DENY_ALL_EXTERNAL_NETWORK',secrets_policy:'OPAQUE_SHORT_LIVED_OPERATION_SCOPED_NO_PLAINTEXT',sandbox_mode:'PROJECT_SCOPED_VIRTUAL_SANDBOX',terminal_mode:'BOUNDED_VIRTUAL_TERMINAL_NO_HOST_SHELL',worktree_mode:'ISOLATED_VIRTUAL_WORKTREE_NO_REPO_MUTATION',
  });
  assert.equal(one.schema,'musitu.axiom.sandbox-integrity-verification.v1'); assert.equal(one.sandbox_integrity_status,'PASS'); assert.equal(one.sandbox_integrity_sha256,'c'.repeat(64));
  assert.equal(one.qualification_effect,'SANDBOX_BOUNDARY_INTEGRITY_ONLY'); assert.equal(one.certification,'NOT_CERTIFIED'); assert.equal(one.independent_qualification,'NOT_PROVEN');
  assert.equal(one.external_process_containment,'NOT_PROVEN'); assert.equal(one.live_runtime_qualification,'NOT_PROVEN'); assert.equal(one.authority_effect,'NONE');
  assert.match(one.verification_sha256,/^[a-f0-9]{64}$/); assert.equal(one.verification_sha256,two.verification_sha256);

  for(const verify of [
    {network_policy:'ALLOW_ALL'},
    {external_network_enabled:true},
    {host_shell_enabled:true},
    {plaintext_secret_access:true},
    {release_authority:true},
    {certified:true},
    {project_id:'project_other_12345678'},
    {integrity_sha256:'bad'},
  ]){
    const attackClient=sandboxClient({verify});
    const attackBackend=createGovernedSandboxBackend({client:attackClient});
    const attackHandle=await attackBackend.createSandbox(baseCreate);
    await assert.rejects(()=>attackBackend.verifySandbox(attackHandle,{requestId:'verify_attack_123'}));
    assert.equal(attackClient.calls.verify.length,1);
  }
});


test('disposeSandbox requires exact identity and verified destruction without granting authority',async()=>{
  const client=sandboxClient();
  const backend=createGovernedSandboxBackend({client});
  const handle=await backend.createSandbox(baseCreate);
  const one=await backend.disposeSandbox(handle,{requestId:'dispose_12345678'});
  const two=await backend.disposeSandbox(handle,{requestId:'dispose_12345678'});
  assert.equal(client.calls.dispose.length,2);
  assert.deepEqual(client.calls.dispose[0],{
    sandbox_id:'sandbox_12345678',project_id:'project_12345678',work_id:'work_12345678',agent_id:'agent_12345678',workload_identity_id:'wid_12345678',request_id:'dispose_12345678',expected_sandbox_sha256:handle.sandbox_sha256,
  });
  assert.equal(one.schema,'musitu.axiom.sandbox-disposal-receipt.v1'); assert.equal(one.status,'DISPOSED'); assert.equal(one.destroyed,true);
  assert.equal(one.canonical_evidence,false); assert.equal(one.authority_effect,'NONE'); assert.equal(one.release_authority,false); assert.equal(one.production_authority,false); assert.equal(one.certification_authority,false);
  assert.match(one.disposal_sha256,/^[a-f0-9]{64}$/); assert.equal(one.disposal_sha256,two.disposal_sha256);

  for(const dispose of [{destroyed:false},{status:'PENDING'},{release_authority:true},{project_id:'other_project'}]){
    const attackClient=sandboxClient({dispose});
    const attackBackend=createGovernedSandboxBackend({client:attackClient});
    const attackHandle=await attackBackend.createSandbox(baseCreate);
    await assert.rejects(()=>attackBackend.disposeSandbox(attackHandle,{requestId:'dispose_attack_123'}));
    assert.equal(attackClient.calls.dispose.length,1);
  }
});


test('health reports mechanism state only and can never certify or grant authority',async()=>{
  const client=sandboxClient();
  const backend=createGovernedSandboxBackend({client});
  const health=await backend.health();
  assert.equal(health.provider_status,'UP'); assert.equal(health.provider,'axiom-fa11-governed-sandbox');
  assert.equal(health.axiom_authority,'NONE'); assert.equal(health.axiom_certification,'NOT_PROVEN');
  assert.equal(health.external_process_runtime_qualification,'NOT_PROVEN'); assert.equal(health.live_runtime_qualification,'NOT_PROVEN');
  assert.equal(health.release_authority,false); assert.equal(health.production_authority,false); assert.equal(health.certification_authority,false);
  for(const attack of [{release_authority:true},{production_authority:true},{certified:true},{authority:'RELEASE'}]){
    const attackBackend=createGovernedSandboxBackend({client:sandboxClient({health:attack})});
    await assert.rejects(()=>attackBackend.health(),/authority/i);
  }
});


test('sandbox client identity is bound to the qualified provider baseline and provider swaps fail closed',async()=>{
  let name='axiom-fa11-governed-sandbox';
  const client=sandboxClient();
  Object.defineProperty(client,'metadata',{get(){return {name,baseline:'FA11_S0_S5_V1'};}});
  const backend=createGovernedSandboxBackend({client});
  const handle=await backend.createSandbox(baseCreate);
  name='unqualified-sandbox-provider';
  await assert.rejects(()=>backend.execute(handle,{requestId:'provider_swap_123',operation:'file.read',target:'src/a.js'}),/provider identity mismatch/i);
  assert.equal(client.calls.execute.length,0);
});
