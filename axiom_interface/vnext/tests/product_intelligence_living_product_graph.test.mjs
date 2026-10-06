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
