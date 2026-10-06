import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LPG_NODE_TYPES,
  LPG_EDGE_RELATIONS,
  LPG_CAUSAL_SEMANTICS,
  validateLivingProductGraph,
  createLivingProductGraphPersistence,
} from '../product_intelligence/living_product_graph.js';

const metadata=(projectId='project_12345678')=>({
  project_id:projectId,
  version:1,
  generation:1,
  valid_from:'2026-10-04T15:00:00Z',
  valid_to:null,
  provenance:{source:'phase2-test'},
  evidence_refs:['evidence_12345678'],
  confidence:0.8,
  uncertainty:{kind:'bounded'},
  actor_id:'agent_builder_1',
  risk_class:'S1',
  content_hash:'a'.repeat(64),
  freshness:{as_of:'2026-10-04T15:00:00Z'},
  supersession:{state:'CURRENT',supersedes:[]},
});

const graph=()=>({
  schema:'musitu.axiom.living-product-graph.v1',
  project_id:'project_12345678',
  generation:1,
  impact_state:'NOT_PROVEN',
  nodes:[
    {node_id:'lpg_node_requirement_1',type:'Requirement',metadata:metadata(),data:{title:'Keyboard navigation'}},
    {node_id:'lpg_node_test_1',type:'Test',metadata:metadata(),data:{title:'Keyboard test'}},
  ],
  edges:[
    {edge_id:'lpg_edge_verified_1',from_id:'lpg_node_requirement_1',to_id:'lpg_node_test_1',relation:'VERIFIED_BY',causal_semantics:'NONE',metadata:metadata()},
  ],
});

test('Living Product Graph freezes the Phase-1 node, relation and causal vocabularies',()=>{
  assert.equal(LPG_NODE_TYPES.length,39);
  for(const type of ['Objective','Requirement','Screen','Component','APIContract','Test','Deployment','OutcomeMetric','EvidenceRef']) assert.ok(LPG_NODE_TYPES.includes(type));
  assert.deepEqual(LPG_EDGE_RELATIONS,[
    'DERIVED_FROM','JUSTIFIED_BY','SATISFIES','IMPLEMENTS','DEPENDS_ON','BLOCKED_BY','VERIFIED_BY','MEASURED_BY',
    'DEPLOYED_AS','OBSERVED_AS','SUPERSEDES','AFFECTS','GOVERNED_BY','OWNED_BY','EXECUTED_BY','PRODUCES','REFERENCES','INVALIDATES',
  ]);
  assert.deepEqual(LPG_CAUSAL_SEMANTICS,['NONE','CORRELATION','HYPOTHESIS','QUASI_EXPERIMENTAL','RANDOMIZED_CAUSAL','EXTERNAL_ATTESTED_CAUSAL']);
});

test('Living Product Graph validates project-scoped versioned metadata and rejects cross-project state',()=>{
  assert.equal(validateLivingProductGraph(graph()).ok,true);
  const bad=graph();
  bad.nodes[0].metadata.project_id='project_87654321';
  const result=validateLivingProductGraph(bad);
  assert.equal(result.ok,false);
  assert.ok(result.errors.some(error=>error.includes('cross-project node')));
});

test('Living Product Graph rejects unsupported vocabulary and dangling edges',()=>{
  const badType=graph();
  badType.nodes[0].type='Product';
  assert.equal(validateLivingProductGraph(badType).ok,false);

  const dangling=graph();
  dangling.edges[0].to_id='lpg_node_missing';
  const result=validateLivingProductGraph(dangling);
  assert.equal(result.ok,false);
  assert.ok(result.errors.some(error=>error.includes('edge endpoints')));
});

test('persistence binding preserves AXIOM graph semantics and project scope',async()=>{
  const rows=new Map();
  const backend={
    descriptor:{
      kind:'PersistenceBackend',adapter_version:'1.0.0',provider:'fake-memory',semantic_owner:'AXIOM',authority:'MECHANISM_ONLY',
      capabilities:['load','commit','verify','export'],unsupported_operations:['production_mutation'],timeout_ms:1000,
      retry:{max_attempts:1,backoff:'NONE'},idempotency:{mode:'REQUIRED_FOR_WRITES'},data_classification:['project-private'],
      egress:{required:false,allowed_origins:[]},identity_binding:{required:true,mode:'AXIOM_WORKLOAD_ID'},
      evidence_envelope:{schema:'musitu.axiom.evidence.v1',required:true},health:{mode:'EXPLICIT'},migration_export:{supported:true,format:'JSONL'},fail_closed:true,
    },
    async loadProjectGraph(projectId){return rows.get(projectId) ?? null;},
    async commitGraph(projectId,value,{expectedGeneration}){
      const prior=rows.get(projectId);
      if(prior && prior.generation!==expectedGeneration) throw new Error('generation conflict');
      rows.set(projectId,structuredClone(value));
      return structuredClone(value);
    },
    async verifyIntegrity(projectId){return {status:rows.has(projectId)?'PASS':'NOT_PROVEN',project_id:projectId};},
    async exportProject(projectId){return {project_id:projectId,graph:rows.get(projectId) ?? null};},
  };
  const persistence=createLivingProductGraphPersistence(backend);
  const saved=await persistence.commit(graph(),{expectedGeneration:0});
  assert.equal(saved.project_id,'project_12345678');
  assert.equal((await persistence.load('project_12345678')).generation,1);
  assert.equal((await persistence.verify('project_12345678')).status,'PASS');

  const cross=graph();
  cross.project_id='project_87654321';
  await assert.rejects(()=>persistence.commitForProject('project_12345678',cross,{expectedGeneration:1}),/cross-project graph commit blocked/);
});

test('Living Product Graph rejects unknown structural fields fail-closed',()=>{
  const cases=[];
  const top=graph(); top.unexpected=true; cases.push(top);
  const node=graph(); node.nodes[0].unexpected=true; cases.push(node);
  const edge=graph(); edge.edges[0].unexpected=true; cases.push(edge);
  const meta=graph(); meta.nodes[0].metadata.unexpected=true; cases.push(meta);
  for(const candidate of cases){
    const result=validateLivingProductGraph(candidate);
    assert.equal(result.ok,false);
    assert.ok(result.errors.some(error=>error.includes('unsupported fields')));
  }
});

test('node and edge metadata generation must match the enclosing graph generation',()=>{
  for(const mutate of [
    candidate=>{candidate.nodes[0].metadata.generation=2;},
    candidate=>{candidate.edges[0].metadata.generation=2;},
  ]){
    const candidate=graph(); mutate(candidate);
    const result=validateLivingProductGraph(candidate);
    assert.equal(result.ok,false);
    assert.ok(result.errors.some(error=>error.includes('metadata.generation must equal graph generation')));
  }
});

test('persistence mechanism outputs cannot grant authority or return credential material',async()=>{
  const descriptor={
    kind:'PersistenceBackend',adapter_version:'1.0.0',provider:'adversarial-memory',semantic_owner:'AXIOM',authority:'MECHANISM_ONLY',
    capabilities:['load','commit','verify','export'],unsupported_operations:['production_mutation'],timeout_ms:1000,
    retry:{max_attempts:1,backoff:'NONE'},idempotency:{mode:'REQUIRED_FOR_WRITES'},data_classification:['project-private'],
    egress:{required:false,allowed_origins:[]},identity_binding:{required:true,mode:'AXIOM_WORKLOAD_ID'},
    evidence_envelope:{schema:'musitu.axiom.evidence.v1',required:true},health:{mode:'EXPLICIT'},migration_export:{supported:true,format:'JSONL'},fail_closed:true,
  };
  const baseBackend={descriptor,async loadProjectGraph(){return null;},async commitGraph(_projectId,value){return value;}};
  for(const result of [
    {status:'PASS',project_id:'project_12345678',release_authority:true},
    {status:'PASS',project_id:'project_12345678',nested:{api_key:'must-not-cross'}},
  ]){
    const persistence=createLivingProductGraphPersistence({...baseBackend,async verifyIntegrity(){return result;},async exportProject(projectId){return {project_id:projectId,graph:null};}});
    await assert.rejects(()=>persistence.verify('project_12345678'),/authority|credential/i);
  }
  for(const result of [
    {project_id:'project_12345678',graph:null,production_authority:true},
    {project_id:'project_12345678',graph:null,client_secret:'must-not-cross'},
  ]){
    const persistence=createLivingProductGraphPersistence({...baseBackend,async verifyIntegrity(projectId){return {status:'NOT_PROVEN',project_id:projectId};},async exportProject(){return result;}});
    await assert.rejects(()=>persistence.exportProject('project_12345678'),/authority|credential/i);
  }
});

test('persistence integrity PASS is project-bound mechanism evidence only and cannot become AXIOM certification',async()=>{
  const descriptor={
    kind:'PersistenceBackend',adapter_version:'1.0.0',provider:'integrity-memory',semantic_owner:'AXIOM',authority:'MECHANISM_ONLY',
    capabilities:['load','commit','verify','export'],unsupported_operations:['production_mutation'],timeout_ms:1000,
    retry:{max_attempts:1,backoff:'NONE'},idempotency:{mode:'REQUIRED_FOR_WRITES'},data_classification:['project-private'],
    egress:{required:false,allowed_origins:[]},identity_binding:{required:true,mode:'AXIOM_WORKLOAD_ID'},
    evidence_envelope:{schema:'musitu.axiom.evidence.v1',required:true},health:{mode:'EXPLICIT'},migration_export:{supported:true,format:'JSONL'},fail_closed:true,
  };
  const make=result=>createLivingProductGraphPersistence({
    descriptor,async loadProjectGraph(){return null;},async commitGraph(_projectId,value){return value;},
    async verifyIntegrity(){return result;},async exportProject(projectId){return {project_id:projectId,graph:null};},
  });
  await assert.rejects(()=>make({status:'PASS',project_id:'project_other_12345678'}).verify('project_12345678'),/cross-project|identity/i);
  await assert.rejects(()=>make({status:'CERTIFIED',project_id:'project_12345678'}).verify('project_12345678'),/status/i);
  const out=await make({status:'PASS',project_id:'project_12345678',generation:1,node_count:2,edge_count:1}).verify('project_12345678');
  assert.equal(out.status,'PASS');
  assert.equal(out.verification_scope,'PERSISTENCE_MECHANISM_INTEGRITY');
  assert.equal(out.canonical_evidence,false);
  assert.equal(out.authority_effect,'NONE');
  assert.equal(out.release_authority,false);
  assert.equal(out.production_authority,false);
  assert.equal(out.certification_authority,false);
});

test('Living Product Graph identifiers, evidence references and validity windows are fail-closed',()=>{
  const cases=[];
  const badNode=graph(); badNode.nodes[0].node_id='bad node id'; cases.push(badNode);
  const badEdge=graph(); badEdge.edges[0].edge_id='bad edge id'; cases.push(badEdge);
  const badActor=graph(); badActor.nodes[0].metadata.actor_id='bad actor id'; cases.push(badActor);
  const badEvidence=graph(); badEvidence.nodes[0].metadata.evidence_refs=['']; cases.push(badEvidence);
  const duplicateEvidence=graph(); duplicateEvidence.nodes[0].metadata.evidence_refs=['evidence_a','evidence_a']; cases.push(duplicateEvidence);
  const reversed=graph(); reversed.nodes[0].metadata.valid_to='2026-10-04T14:59:59Z'; cases.push(reversed);
  for(const candidate of cases){
    const result=validateLivingProductGraph(candidate);
    assert.equal(result.ok,false);
  }
});

test('Living Product Graph metadata cannot persist credential material',()=>{
  for(const mutate of [
    candidate=>{candidate.nodes[0].metadata.provenance.api_key='must-not-cross';},
    candidate=>{candidate.edges[0].metadata.uncertainty={nested:{client_secret:'must-not-cross'}};},
  ]){
    const candidate=graph(); mutate(candidate);
    const result=validateLivingProductGraph(candidate);
    assert.equal(result.ok,false);
    assert.ok(result.errors.some(error=>error.includes('credential material')));
  }
});

test('persistence export is explicitly migration-only and carries no AXIOM authority',async()=>{
  const descriptor={
    kind:'PersistenceBackend',adapter_version:'1.0.0',provider:'export-memory',semantic_owner:'AXIOM',authority:'MECHANISM_ONLY',
    capabilities:['load','commit','verify','export'],unsupported_operations:['production_mutation'],timeout_ms:1000,
    retry:{max_attempts:1,backoff:'NONE'},idempotency:{mode:'REQUIRED_FOR_WRITES'},data_classification:['project-private'],
    egress:{required:false,allowed_origins:[]},identity_binding:{required:true,mode:'AXIOM_WORKLOAD_ID'},
    evidence_envelope:{schema:'musitu.axiom.evidence.v1',required:true},health:{mode:'EXPLICIT'},migration_export:{supported:true,format:'JSONL'},fail_closed:true,
  };
  const persistence=createLivingProductGraphPersistence({
    descriptor,async loadProjectGraph(){return null;},async commitGraph(_projectId,value){return value;},
    async verifyIntegrity(projectId){return {status:'NOT_PROVEN',project_id:projectId};},
    async exportProject(projectId){return {project_id:projectId,graph:null};},
  });
  const out=await persistence.exportProject('project_12345678');
  assert.equal(out.project_id,'project_12345678');
  assert.equal(out.export_scope,'PERSISTENCE_MIGRATION_EXPORT');
  assert.equal(out.canonical_evidence,false);
  assert.equal(out.authority_effect,'NONE');
  assert.equal(out.release_authority,false);
  assert.equal(out.production_authority,false);
  assert.equal(out.certification_authority,false);
});


test('verified FA-11 completed receipt becomes AXIOM Evidence without gaining authority',async()=>{
  const module=await import('../product_intelligence/living_product_graph.js');
  const security=await import('../execution_security.js');
  const contracts=await import('../foundation_contracts.js');
  assert.equal(typeof module.verifyOperationScopedExecutionOutcome,'function','execution outcome verifier must exist');
  assert.equal(typeof module.createExecutionOutcomeEvidence,'function','execution outcome evidence builder must exist');

  const at='2026-10-06T12:30:00.000Z';
  const requestBody={
    schema:'musitu.axiom.execution-request.browser.v1',
    project_id:'project_12345678',
    actor_id:'agent_operator_1',
    agent_id:'agent_executor_1',
    workload_identity_id:'workload_executor_1',
    operation:'file.write',
    computed_risk_class:'S1',
    risk_class:'S1',
    effect:'LOCAL_WRITE',
    reversible:true,
    external:false,
    required_tool_scope:'artifact.write',
    target:'src/example.txt',
    payload:{content:'verified change'},
    destination:null,
    compute_units:1,
    instruction_provenance:'GOVERNED_PLAN',
    requested_at:at,
    authority_sha256:'a'.repeat(64),
    execution_mode:'BROWSER_LOCAL_GOVERNED_EXECUTION_SUBSTRATE',
  };
  const executionRequest={...requestBody,request_sha256:await security.sha256(requestBody)};
  const handoffBody={
    schema:'musitu.axiom.product-operation-scoped-executor-handoff.v1',
    scope:'SINGLE_OPERATION',
    project_id:'project_12345678',
    work_id:'work_12345678',
    checkpoint_sha256:'b'.repeat(64),
    change_admission_request_sha256:'c'.repeat(64),
    change_admission_evaluation_sha256:'d'.repeat(64),
    authority_sha256:executionRequest.authority_sha256,
    actor_id:'agent_operator_1',
    agent_id:'agent_executor_1',
    workload_identity_id:'workload_executor_1',
    builder_actor_id:'agent_builder_1',
    risk_class:'S1',
    operation:'file.write',
    execution_request:executionRequest,
    authority_effect:'NONE',
    execution_authority:false,
    external_execution_authority:false,
    release_authority:false,
    production_authority:false,
    certification_authority:false,
    created_at:at,
  };
  const handoff={...handoffBody,handoff_sha256:await security.sha256(handoffBody)};
  const receiptBody={
    schema:'musitu.axiom.execution-receipt.browser.v1',
    receipt_id:'execution-receipt_12345678',
    project_id:'project_12345678',
    sandbox_id:'sandbox_12345678',
    request_sha256:executionRequest.request_sha256,
    risk_class:'S1',
    status:'COMPLETED',
    result:{path:'src/example.txt',content_sha256:'e'.repeat(64),bytes:15},
    rollback_available:true,
    external_action_executed:false,
    network_request_performed:false,
    host_shell_executed:false,
    plaintext_secret_access:false,
    created_at:at,
  };
  const receipt={...receiptBody,receipt_sha256:await security.sha256(receiptBody)};
  const integrityBody={
    schema:'musitu.axiom.execution-integrity.browser.v1',
    project_id:'project_12345678',
    status:'PASS',
    errors:[],
    event_count:3,
    network_policy:'DENY_ALL_EXTERNAL_NETWORK',
    secrets_policy:'OPAQUE_SHORT_LIVED_OPERATION_SCOPED_NO_PLAINTEXT',
  };
  const executionIntegrity={...integrityBody,integrity_sha256:await security.sha256(integrityBody)};

  const verified=await module.verifyOperationScopedExecutionOutcome({
    handoff,receipt,executionIntegrity,verifierActorId:'agent_verifier_2',at,
  });
  assert.equal(verified.schema,'musitu.axiom.product-execution-outcome-verification.v1');
  assert.equal(verified.status,'VERIFIED_COMPLETED');
  assert.equal(verified.execution_status,'COMPLETED');
  assert.equal(verified.receipt_sha256,receipt.receipt_sha256);
  assert.equal(verified.handoff_sha256,handoff.handoff_sha256);
  assert.equal(verified.request_sha256,executionRequest.request_sha256);
  assert.equal(verified.verifier_actor_id,'agent_verifier_2');
  assert.equal(verified.independent_verification,'PASS');
  assert.equal(verified.rollback_available,true);
  assert.equal(verified.failure_state,'NONE');
  assert.equal(verified.authority_effect,'NONE');
  assert.equal(verified.release_authority,false);
  assert.equal(verified.production_authority,false);
  assert.equal(verified.certification_authority,false);

  const evidence=await module.createExecutionOutcomeEvidence(verified);
  assert.doesNotThrow(()=>contracts.assertAxiomObject(evidence,{expectedType:'Evidence'}));
  assert.ok(evidence.data.hashes.includes(receipt.receipt_sha256));
  assert.ok(evidence.data.hashes.includes(handoff.handoff_sha256));
  assert.equal(evidence.data.failures.length,0);
  assert.equal(evidence.data.verification.independent_verification,'PASS');
  assert.equal(evidence.data.verification.release_authority,false);
  assert.equal(evidence.data.verification.production_authority,false);
  assert.equal(evidence.data.verification.certification_authority,false);
});


test('blocked external execution remains failure evidence and cannot be forged completed',async()=>{
  const module=await import('../product_intelligence/living_product_graph.js');
  const security=await import('../execution_security.js');
  const at='2026-10-06T12:40:00.000Z';
  const requestBody={
    schema:'musitu.axiom.execution-request.browser.v1',project_id:'project_12345678',
    actor_id:'agent_operator_1',agent_id:'agent_executor_1',workload_identity_id:'workload_executor_1',
    operation:'repo.mutate',computed_risk_class:'S3',risk_class:'S3',effect:'EXTERNAL_REVERSIBLE_WRITE',
    reversible:true,external:true,required_tool_scope:'artifact.write',target:'frontier/change-set',
    payload:{change_sha256:'a'.repeat(64)},destination:'https://github.example.test/api/v1/change',
    compute_units:1,instruction_provenance:'GOVERNED_PLAN',requested_at:at,authority_sha256:'b'.repeat(64),
    execution_mode:'BROWSER_LOCAL_GOVERNED_EXECUTION_SUBSTRATE',
  };
  const executionRequest={...requestBody,request_sha256:await security.sha256(requestBody)};
  const handoffBody={
    schema:'musitu.axiom.product-operation-scoped-executor-handoff.v1',scope:'SINGLE_OPERATION',
    project_id:'project_12345678',work_id:'work_12345678',checkpoint_sha256:'c'.repeat(64),
    change_admission_request_sha256:'d'.repeat(64),change_admission_evaluation_sha256:'e'.repeat(64),
    authority_sha256:executionRequest.authority_sha256,actor_id:'agent_operator_1',agent_id:'agent_executor_1',
    workload_identity_id:'workload_executor_1',builder_actor_id:'agent_builder_1',risk_class:'S3',
    operation:'repo.mutate',execution_request:executionRequest,authority_effect:'NONE',execution_authority:false,
    external_execution_authority:false,release_authority:false,production_authority:false,certification_authority:false,
    created_at:at,
  };
  const handoff={...handoffBody,handoff_sha256:await security.sha256(handoffBody)};
  const blockedBody={
    schema:'musitu.axiom.execution-receipt.browser.v1',receipt_id:'execution-receipt_blocked_1',
    project_id:'project_12345678',sandbox_id:'sandbox_12345678',request_sha256:executionRequest.request_sha256,
    risk_class:'S3',status:'BLOCKED',reason:'QUALIFIED_EXTERNAL_EXECUTOR_REQUIRED',rollback_available:false,
    external_action_executed:false,network_request_performed:false,host_shell_executed:false,
    plaintext_secret_access:false,created_at:at,
  };
  const blocked={...blockedBody,receipt_sha256:await security.sha256(blockedBody)};
  const integrityBody={schema:'musitu.axiom.execution-integrity.browser.v1',project_id:'project_12345678',status:'PASS',
    errors:[],event_count:4,network_policy:'DENY_ALL_EXTERNAL_NETWORK',secrets_policy:'OPAQUE_SHORT_LIVED_OPERATION_SCOPED_NO_PLAINTEXT'};
  const executionIntegrity={...integrityBody,integrity_sha256:await security.sha256(integrityBody)};

  const verified=await module.verifyOperationScopedExecutionOutcome({
    handoff,receipt:blocked,executionIntegrity,verifierActorId:'agent_verifier_2',at,
  });
  assert.equal(verified.status,'VERIFIED_BLOCKED');
  assert.equal(verified.execution_status,'BLOCKED');
  assert.equal(verified.failure_state,'BLOCKED');
  assert.equal(verified.failure_reason,'QUALIFIED_EXTERNAL_EXECUTOR_REQUIRED');
  assert.equal(verified.rollback_available,false);
  const evidence=await module.createExecutionOutcomeEvidence(verified);
  assert.deepEqual(evidence.data.failures,[{status:'BLOCKED',reason:'QUALIFIED_EXTERNAL_EXECUTOR_REQUIRED'}]);

  const forgedCompletedBody={
    schema:'musitu.axiom.execution-receipt.browser.v1',receipt_id:'execution-receipt_forged_1',
    project_id:'project_12345678',sandbox_id:'sandbox_12345678',request_sha256:executionRequest.request_sha256,
    risk_class:'S3',status:'COMPLETED',result:{commit_sha256:'f'.repeat(64)},rollback_available:true,
    external_action_executed:false,network_request_performed:false,host_shell_executed:false,
    plaintext_secret_access:false,created_at:at,
  };
  const forgedCompleted={...forgedCompletedBody,receipt_sha256:await security.sha256(forgedCompletedBody)};
  await assert.rejects(
    ()=>module.verifyOperationScopedExecutionOutcome({
      handoff,receipt:forgedCompleted,executionIntegrity,verifierActorId:'agent_verifier_2',at,
    }),
    /cannot complete external|external operation|browser-local/i,
  );
});


test('verified execution outcome reconciles one deterministic EvidenceRef and replays idempotently',async()=>{
  const module=await import('../product_intelligence/living_product_graph.js');
  const security=await import('../execution_security.js');
  assert.equal(typeof module.reconcileVerifiedExecutionOutcome,'function','execution outcome graph reconciler must exist');

  const at='2026-10-06T12:45:00.000Z';
  const verifiedBody={
    schema:'musitu.axiom.product-execution-outcome-verification.v1',
    project_id:'project_12345678',work_id:'work_12345678',checkpoint_sha256:'a'.repeat(64),
    handoff_sha256:'b'.repeat(64),request_sha256:'c'.repeat(64),receipt_id:'execution-receipt_12345678',
    receipt_sha256:'d'.repeat(64),execution_integrity_sha256:'e'.repeat(64),operation:'file.write',risk_class:'S1',
    execution_status:'COMPLETED',status:'VERIFIED_COMPLETED',verifier_actor_id:'agent_verifier_2',
    independent_verification:'PASS',rollback_available:true,failure_state:'NONE',failure_reason:null,
    external_action_executed:false,network_request_performed:false,host_shell_executed:false,plaintext_secret_access:false,
    authority_effect:'NONE',release_authority:false,production_authority:false,certification_authority:false,created_at:at,
  };
  const verifiedOutcome={...verifiedBody,verification_sha256:await security.sha256(verifiedBody)};
  const rows=new Map([['project_12345678',graph()]]);
  let commits=0;
  const backend={
    descriptor:{
      kind:'PersistenceBackend',adapter_version:'1.0.0',provider:'reconciliation-memory',semantic_owner:'AXIOM',authority:'MECHANISM_ONLY',
      capabilities:['load','commit','verify','export'],unsupported_operations:['production_mutation'],timeout_ms:1000,
      retry:{max_attempts:1,backoff:'NONE'},idempotency:{mode:'REQUIRED_FOR_WRITES'},data_classification:['project-private'],
      egress:{required:false,allowed_origins:[]},identity_binding:{required:true,mode:'AXIOM_WORKLOAD_ID'},
      evidence_envelope:{schema:'musitu.axiom.evidence.v1',required:true},health:{mode:'EXPLICIT'},migration_export:{supported:true,format:'JSONL'},fail_closed:true,
    },
    async loadProjectGraph(projectId){return structuredClone(rows.get(projectId)??null);},
    async commitGraph(projectId,value,{expectedGeneration}){
      const prior=rows.get(projectId);
      assert.equal(prior?.generation??0,expectedGeneration);
      commits+=1; rows.set(projectId,structuredClone(value)); return structuredClone(value);
    },
    async verifyIntegrity(projectId){return {status:rows.has(projectId)?'PASS':'NOT_PROVEN',project_id:projectId};},
    async exportProject(projectId){return {project_id:projectId,graph:structuredClone(rows.get(projectId)??null)};},
  };
  const persistence=module.createLivingProductGraphPersistence(backend);
  const first=await module.reconcileVerifiedExecutionOutcome({persistence,verifiedOutcome,at});
  assert.equal(first.status,'RECONCILED');
  assert.equal(first.graph.generation,2);
  assert.equal(commits,1);
  assert.equal(first.authority_effect,'NONE');
  assert.equal(first.release_authority,false);
  assert.equal(first.production_authority,false);
  assert.equal(first.certification_authority,false);
  const evidenceNode=first.graph.nodes.find(node=>node.type==='EvidenceRef'&&node.data.receipt_sha256===verifiedOutcome.receipt_sha256);
  assert.ok(evidenceNode);
  assert.equal(evidenceNode.data.evidence_id,first.evidence.id);
  assert.equal(evidenceNode.metadata.evidence_refs.includes(first.evidence.id),true);

  const replay=await module.reconcileVerifiedExecutionOutcome({persistence,verifiedOutcome,at});
  assert.equal(replay.status,'IDEMPOTENT_REPLAY');
  assert.equal(replay.graph.generation,2);
  assert.equal(replay.evidence.id,first.evidence.id);
  assert.equal(commits,1);
});


test('reconciliation rejects a different receipt for an already reconciled execution request',async()=>{
  const module=await import('../product_intelligence/living_product_graph.js');
  const security=await import('../execution_security.js');
  const at='2026-10-06T12:50:00.000Z';
  const makeVerified=async(receiptSha,verificationSeed)=>{
    const body={
      schema:'musitu.axiom.product-execution-outcome-verification.v1',
      project_id:'project_12345678',work_id:'work_12345678',checkpoint_sha256:'a'.repeat(64),
      handoff_sha256:'b'.repeat(64),request_sha256:'c'.repeat(64),receipt_id:`execution-receipt_${verificationSeed}`,
      receipt_sha256:receiptSha,execution_integrity_sha256:'e'.repeat(64),operation:'file.write',risk_class:'S1',
      execution_status:'COMPLETED',status:'VERIFIED_COMPLETED',verifier_actor_id:'agent_verifier_2',
      independent_verification:'PASS',rollback_available:true,failure_state:'NONE',failure_reason:null,
      external_action_executed:false,network_request_performed:false,host_shell_executed:false,plaintext_secret_access:false,
      authority_effect:'NONE',release_authority:false,production_authority:false,certification_authority:false,created_at:at,
    };
    return {...body,verification_sha256:await security.sha256(body)};
  };
  const firstOutcome=await makeVerified('d'.repeat(64),'one');
  const conflictingOutcome=await makeVerified('f'.repeat(64),'two');
  const rows=new Map([['project_12345678',graph()]]);
  const backend={
    descriptor:{
      kind:'PersistenceBackend',adapter_version:'1.0.0',provider:'replay-memory',semantic_owner:'AXIOM',authority:'MECHANISM_ONLY',
      capabilities:['load','commit','verify','export'],unsupported_operations:['production_mutation'],timeout_ms:1000,
      retry:{max_attempts:1,backoff:'NONE'},idempotency:{mode:'REQUIRED_FOR_WRITES'},data_classification:['project-private'],
      egress:{required:false,allowed_origins:[]},identity_binding:{required:true,mode:'AXIOM_WORKLOAD_ID'},
      evidence_envelope:{schema:'musitu.axiom.evidence.v1',required:true},health:{mode:'EXPLICIT'},migration_export:{supported:true,format:'JSONL'},fail_closed:true,
    },
    async loadProjectGraph(projectId){return structuredClone(rows.get(projectId)??null);},
    async commitGraph(projectId,value,{expectedGeneration}){
      const prior=rows.get(projectId);assert.equal(prior?.generation??0,expectedGeneration);
      rows.set(projectId,structuredClone(value));return structuredClone(value);
    },
    async verifyIntegrity(projectId){return {status:rows.has(projectId)?'PASS':'NOT_PROVEN',project_id:projectId};},
    async exportProject(projectId){return {project_id:projectId,graph:structuredClone(rows.get(projectId)??null)};},
  };
  const persistence=module.createLivingProductGraphPersistence(backend);
  await module.reconcileVerifiedExecutionOutcome({persistence,verifiedOutcome:firstOutcome,at});
  await assert.rejects(
    ()=>module.reconcileVerifiedExecutionOutcome({persistence,verifiedOutcome:conflictingOutcome,at}),
    /conflicting execution replay|request.*receipt|different receipt|canonical outcome/i,
  );
});
