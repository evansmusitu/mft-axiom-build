export const AUTHORITATIVE_RUNTIME_BLOBS=Object.freeze({
  'axiom_interface/vnext/runtime_task_service.mjs':'dc847eef5d2907d4d3826f7802050ea4e388ad1c',
  'axiom_interface/vnext/identity_session_adapter.js':'1f604097fde1c70a48fc621058a4b9edc4402b30',
  'axiom_interface/vnext/project_work_memory_bridge.js':'cacadac65d6231d76a83f04d9bb4863b16f4b7d1',
  'axiom_interface/vnext/authorization_gateway.js':'41362fb8ed63d182fd44d3d516f79bddebd0d47e',
  'axiom_interface/vnext/capability_router_v2.js':'679417c52d94a679d538a0d07ac15878236f1744',
  'axiom_interface/vnext/execution_store.js':'78b86537b3cff58f8538377fca49e7cf83030c80',
  'axiom_interface/vnext/execution_security.js':'bf7e001cdc45b10a695607c42b5bac922342574e',
  'axiom_interface/vnext/fa18_axiom_build_challenge.mjs':'e4803d3a11dcb8a8519ed3b83df2ab95ad6af08e',
  'axiom_interface/vnext/fa19_external_comparison.mjs':'0ffb572a4fd67415758f81b7f3775784901878e5',
  'axiom_interface/vnext/fa20_release_orchestrator.mjs':'11912c1d6a3eac3c568f1f3fa9aaa9d12ddd0887',
});

function assert(condition,message){if(!condition)throw new DOMException(message,'SecurityError');}

export async function loadAuthoritativeRuntimeBindings(){
  const [router,task,authorization,security,release]=await Promise.all([
    import('../../axiom_interface/vnext/capability_router_v2.js'),
    import('../../axiom_interface/vnext/runtime_task_service.mjs'),
    import('../../axiom_interface/vnext/authorization_gateway.js'),
    import('../../axiom_interface/vnext/execution_security.js'),
    import('../../axiom_interface/vnext/fa20_release_orchestrator.mjs'),
  ]);
  return {router,task,authorization,security,release};
}

function authorityFixture(NETWORK_DENY,SECRET_POLICY){
  return {
    project_id:'project-convergence',actor_id:'human-owner',agent_id:'agent-convergence',workload_identity_id:'workload-convergence',agent_status:'ACTIVE',kill_switch_engaged:false,revoked:false,requester_type:'AGENT',
    grant:{tool_scopes:['project.read','artifact.write','computer.preview'],data_scopes:['project'],network_policy:NETWORK_DENY,secrets_policy:SECRET_POLICY,budget:{max_compute_units:100}},
    usage:{compute_units:0},incident_posture:'NORMAL',jurisdiction:'RECOVERY_TEST',
  };
}

export async function runRuntimeConvergenceGate({router,task,authorization,security,release}={}){
  if(!router||!task||!authorization||!security||!release)throw new TypeError('authoritative runtime bindings required');
  const {CAPABILITY_TRUTH,classifyCapabilityReference,routeCapabilityV2}=router;
  const {RUNTIME_TASK_BOUNDARY}=task;
  const {evaluateAuthorization}=authorization;
  const {RISK_CLASSES,NETWORK_DENY,SECRET_POLICY,requiredApprovalRoles}=security;
  const {FA20_CURRENT_PRODUCTION,FA20_FROZEN_RELEASE_POLICY,FA20_RELEASE_STAGES}=release;

  assert(CAPABILITY_TRUTH.certified_atomic_runtime_operations===74,'certified atomic runtime count drift');
  assert(CAPABILITY_TRUTH.public_axiom_plugin_tools===108,'public AXIOM tool count drift');
  assert(CAPABILITY_TRUTH.registered_native_derived_compositions===2400,'derived composition count drift');
  assert(CAPABILITY_TRUTH.discovered_candidate_dags===2235,'candidate DAG count drift');
  assert(CAPABILITY_TRUTH.wolfram_parity==='NOT_CERTIFIED','Wolfram parity overclaim');
  assert(CAPABILITY_TRUTH.superiority==='NOT_CERTIFIED','superiority overclaim');

  assert(RUNTIME_TASK_BOUNDARY.protected_runtime_required===true,'protected Task runtime requirement lost');
  assert(RUNTIME_TASK_BOUNDARY.exact_operation_catalog_size===74,'Task service operation count drift');
  assert(RUNTIME_TASK_BOUNDARY.browser_credential_access===false,'browser credential access enabled');
  assert(RUNTIME_TASK_BOUNDARY.retrieved_content_instruction_authority===false,'retrieved content authority enabled');
  assert(RUNTIME_TASK_BOUNDARY.production_authority===false,'Task service production authority enabled');

  assert(JSON.stringify(RISK_CLASSES)===JSON.stringify(['S0','S1','S2','S3','S4','S5']),'S0-S5 risk classes drift');
  assert(JSON.stringify(requiredApprovalRoles('S3'))===JSON.stringify(['HUMAN_APPROVER']),'S3 approval policy drift');
  assert(JSON.stringify(requiredApprovalRoles('S4'))===JSON.stringify(['HUMAN_RELEASE_APPROVER','INDEPENDENT_VERIFIER']),'S4 approval policy drift');
  assert(JSON.stringify(requiredApprovalRoles('S5'))===JSON.stringify(['HUMAN_SECURITY_APPROVER','INDEPENDENT_VERIFIER']),'S5 approval policy drift');

  const candidate=classifyCapabilityReference('AXD-0001');
  const candidateRoute=routeCapabilityV2('AXD-0001');
  assert(candidate.qualification_class==='DISCOVERED_CANDIDATE','candidate classification drift');
  assert(candidateRoute.policy.decision==='DENY','uncertified candidate execution admitted');

  const authority=authorityFixture(NETWORK_DENY,SECRET_POLICY);
  const retrievedWrite=await evaluateAuthorization(authority,{operation:'file.write',risk_class:'S1',target:'artifact.txt',payload:{content:'safe'},compute_units:1,instruction_provenance:'RETRIEVED_DATA'});
  assert(retrievedWrite.status==='DENIED','retrieved data authorized a side effect');

  const s4=await evaluateAuthorization(authority,{operation:'publish.deploy',risk_class:'S4',target:'candidate',payload:{},destination:'https://example.invalid/',compute_units:1,instruction_provenance:'GOVERNED_PLAN'});
  assert(['DENIED','AWAITING_APPROVAL'].includes(s4.status),'S4 action bypassed governed authorization');
  assert(s4.execution_allowed===false,'S4 action execution admitted without exact approval');

  assert(FA20_CURRENT_PRODUCTION.immutable_rollback_origin===true,'current production rollback origin no longer immutable');
  assert(FA20_CURRENT_PRODUCTION.runtime_operation_count===74,'production rollback origin operation count drift');
  assert(FA20_FROZEN_RELEASE_POLICY.production.production_execution_allowed===false,'legacy release controller grants production execution');
  assert(FA20_FROZEN_RELEASE_POLICY.production.live_approval_binding_status==='PENDING_FUTURE_EXACT_S4_GATE','legacy S4 binding status drift');
  assert(FA20_FROZEN_RELEASE_POLICY.production.rollback_proof_required===true,'rollback proof no longer required');
  assert(FA20_RELEASE_STAGES.includes('ROLLBACK_REHEARSAL')&&FA20_RELEASE_STAGES.includes('PRODUCTION'),'release stage contract drift');

  return Object.freeze({schema:'musitu.axiom.recovery.runtime-convergence.v1',status:'SOURCE_RUNTIME_CONVERGENCE_PASS',authoritative_blob_count:Object.keys(AUTHORITATIVE_RUNTIME_BLOBS).length,certified_atomic_runtime_operations:74,public_axiom_plugin_tools:108,registered_native_derived_compositions:2400,discovered_candidate_dags:2235,retrieved_data_side_effect_blocked:true,s4_exact_approval_required:true,rollback_origin_preserved:true,provider_execution_performed:false,production_mutated:false,production_authority:false,wolfram_parity:'NOT_CERTIFIED',superiority:'NOT_CERTIFIED'});
}
