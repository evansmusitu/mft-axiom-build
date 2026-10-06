import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PRODUCT_COMPILER_IR_SCHEMA,
  compileProductIR,
  diffProductIR,
  reconcileProductIR,
  createInferredGraphPatch,
} from '../product_intelligence/product_compiler_ir.js';
import {validateLivingProductGraph} from '../product_intelligence/living_product_graph.js';

const meta=(nodeId,generation=1)=>({
  project_id:'project_12345678',version:1,generation,valid_from:'2026-10-04T15:00:00Z',valid_to:null,
  provenance:{source:'compiler-test'},evidence_refs:['evidence_12345678'],confidence:1,
  uncertainty:{kind:'bounded'},actor_id:'agent_builder_1',risk_class:'S1',
  content_hash:(nodeId.charCodeAt(0)%16).toString(16).repeat(64),freshness:{as_of:'2026-10-04T15:00:00Z'},
  supersession:{state:'CURRENT',supersedes:[]},
});

const graph=(generation=1)=>({
  schema:'musitu.axiom.living-product-graph.v1',project_id:'project_12345678',generation,impact_state:'NOT_PROVEN',
  nodes:[
    {node_id:'objective_1',type:'Objective',metadata:meta('o',generation),data:{title:'Ship verified product'}},
    {node_id:'requirement_1',type:'Requirement',metadata:meta('r',generation),data:{title:'Keyboard navigation'}},
    {node_id:'screen_1',type:'Screen',metadata:meta('s',generation),data:{name:'Home'}},
    {node_id:'component_1',type:'Component',metadata:meta('c',generation),data:{name:'ObjectiveComposer'}},
    {node_id:'api_1',type:'APIContract',metadata:meta('a',generation),data:{method:'POST',path:'/objective'}},
    {node_id:'service_1',type:'Service',metadata:meta('v',generation),data:{name:'ObjectiveService'}},
    {node_id:'test_1',type:'Test',metadata:meta('t',generation),data:{name:'keyboard traversal'}},
    {node_id:'deployment_1',type:'Deployment',metadata:meta('d',generation),data:{stage:'candidate'}},
    {node_id:'outcome_1',type:'OutcomeMetric',metadata:meta('m',generation),data:{metric:'completion'}},
  ],
  edges:[
    {edge_id:'e1',from_id:'objective_1',to_id:'requirement_1',relation:'SATISFIES',causal_semantics:'NONE',metadata:meta('e',generation)},
    {edge_id:'e2',from_id:'requirement_1',to_id:'screen_1',relation:'IMPLEMENTS',causal_semantics:'NONE',metadata:meta('f',generation)},
    {edge_id:'e3',from_id:'screen_1',to_id:'component_1',relation:'DEPENDS_ON',causal_semantics:'NONE',metadata:meta('g',generation)},
    {edge_id:'e4',from_id:'component_1',to_id:'api_1',relation:'DEPENDS_ON',causal_semantics:'NONE',metadata:meta('h',generation)},
    {edge_id:'e5',from_id:'api_1',to_id:'service_1',relation:'IMPLEMENTS',causal_semantics:'NONE',metadata:meta('i',generation)},
    {edge_id:'e6',from_id:'requirement_1',to_id:'test_1',relation:'VERIFIED_BY',causal_semantics:'NONE',metadata:meta('j',generation)},
    {edge_id:'e7',from_id:'service_1',to_id:'deployment_1',relation:'DEPLOYED_AS',causal_semantics:'NONE',metadata:meta('k',generation)},
    {edge_id:'e8',from_id:'objective_1',to_id:'outcome_1',relation:'MEASURED_BY',causal_semantics:'NONE',metadata:meta('l',generation)},
  ],
});

const bindings=[
  {binding_id:'binding_component_1',node_id:'component_1',region:'src/components/ObjectiveComposer.js',external_sha256:'1'.repeat(64)},
  {binding_id:'binding_api_1',node_id:'api_1',region:'src/api/objective.js',external_sha256:'2'.repeat(64)},
];

test('Product Compiler emits deterministic versioned content-addressed semantic IR',async()=>{
  const input=graph();
  assert.equal(validateLivingProductGraph(input).ok,true);
  const first=await compileProductIR(input,{bindings,compilerVersion:'1.0.0'});
  const second=await compileProductIR(structuredClone(input),{bindings:[...bindings].reverse(),compilerVersion:'1.0.0'});
  assert.equal(first.schema,PRODUCT_COMPILER_IR_SCHEMA);
  assert.equal(first.project_id,'project_12345678');
  assert.equal(first.source_lpg_generation,1);
  assert.equal(first.compiler_version,'1.0.0');
  assert.equal(first.units.length,input.nodes.length);
  assert.equal(first.relations.length,input.edges.length);
  assert.match(first.ir_sha256,/^[a-f0-9]{64}$/);
  assert.equal(first.ir_sha256,second.ir_sha256);
  assert.ok(first.units.every(unit=>/^[a-f0-9]{64}$/.test(unit.unit_sha256)));
  assert.deepEqual(first.units.map(unit=>unit.node_id),[...first.units.map(unit=>unit.node_id)].sort());
  assert.deepEqual(first.bindings.map(binding=>binding.binding_id),['binding_api_1','binding_component_1']);
});

test('incremental diff marks only changed units directly and computes a conservative downstream impact set',async()=>{
  const priorGraph=graph(1);
  const nextGraph=graph(2);
  const component=nextGraph.nodes.find(node=>node.node_id==='component_1');
  component.data.name='ObjectiveComposerV2';
  component.metadata.generation=2;
  component.metadata.content_hash='f'.repeat(64);
  const prior=await compileProductIR(priorGraph,{bindings,compilerVersion:'1.0.0'});
  const next=await compileProductIR(nextGraph,{bindings,compilerVersion:'1.0.0'});
  const diff=await diffProductIR(prior,next);
  assert.equal(diff.status,'CHANGED');
  assert.deepEqual(diff.operations.filter(op=>op.operation==='UPDATE').map(op=>op.node_id),['component_1']);
  assert.equal(diff.operations.filter(op=>op.operation==='ADD').length,0);
  assert.equal(diff.operations.filter(op=>op.operation==='REMOVE').length,0);
  assert.equal(diff.impact_state,'COMPUTED');
  for(const id of ['component_1','api_1','service_1','deployment_1']) assert.ok(diff.impact_node_ids.includes(id),`missing impact ${id}`);
  assert.equal(diff.impact_node_ids.includes('outcome_1'),false);
});

test('incremental diff preserves removals and never represents unknown impact as empty',async()=>{
  const prior=await compileProductIR(graph(1),{bindings,compilerVersion:'1.0.0'});
  const nextGraph=graph(2);
  nextGraph.edges=nextGraph.edges.filter(edge=>!['e6'].includes(edge.edge_id));
  nextGraph.nodes=nextGraph.nodes.filter(node=>node.node_id!=='test_1');
  const next=await compileProductIR(nextGraph,{bindings,compilerVersion:'1.0.0'});
  const diff=await diffProductIR(prior,next);
  assert.deepEqual(diff.operations.filter(op=>op.operation==='REMOVE').map(op=>op.node_id),['test_1']);
  assert.ok(diff.impact_node_ids.includes('test_1'));
  assert.equal(diff.impact_state,'COMPUTED');
});

test('round-trip reconciliation never auto-overwrites manual or out-of-binding changes',async()=>{
  const ir=await compileProductIR(graph(),{bindings,compilerVersion:'1.0.0'});
  const match=await reconcileProductIR(ir,bindings.map(({binding_id,external_sha256})=>({binding_id,external_sha256})));
  assert.equal(match.status,'MATCH');
  assert.equal(match.auto_apply,false);
  const changed=await reconcileProductIR(ir,[
    {binding_id:'binding_component_1',external_sha256:'9'.repeat(64)},
    {binding_id:'binding_api_1',external_sha256:'2'.repeat(64)},
    {binding_id:'outside_manual_region',external_sha256:'8'.repeat(64)},
  ]);
  assert.equal(changed.status,'DIFF_REQUIRES_RECONCILIATION');
  assert.equal(changed.auto_apply,false);
  assert.deepEqual(changed.changed_binding_ids,['binding_component_1']);
  assert.deepEqual(changed.unbound_observed_ids,['outside_manual_region']);
});

test('reverse inference creates verification-required graph patch and cannot claim earned authority',async()=>{
  const patch=await createInferredGraphPatch({
    projectId:'project_12345678',generation:3,actorId:'agent_reverse_1',at:'2026-10-04T16:00:00Z',
    observations:[
      {observation_id:'obs_1',type:'Screen',data:{name:'Imported Home'},source:{kind:'code',uri:'src/Home.js'},confidence:0.72},
      {observation_id:'obs_2',type:'Component',data:{name:'Imported Card'},source:{kind:'dom',uri:'browser://candidate'},confidence:0.61},
    ],
  });
  assert.equal(patch.status,'INFERRED_REQUIRES_VERIFICATION');
  assert.equal(patch.authority_effect,'NONE');
  assert.equal(patch.nodes.length,2);
  assert.ok(patch.nodes.every(node=>node.data.verification_state==='INFERRED_REQUIRES_VERIFICATION'));
  assert.ok(patch.nodes.every(node=>node.metadata.risk_class==='S0'));
  assert.equal(patch.can_overwrite_verified_nodes,false);
});

test('relation-only changes produce explicit relation operations and conservative endpoint impact',async()=>{
  const prior=await compileProductIR(graph(1),{bindings,compilerVersion:'1.0.0'});
  const nextGraph=graph(2);
  const relation=nextGraph.edges.find(edge=>edge.edge_id==='e4');
  relation.relation='REFERENCES';
  relation.metadata.content_hash='e'.repeat(64);
  const next=await compileProductIR(nextGraph,{bindings,compilerVersion:'1.0.0'});
  const diff=await diffProductIR(prior,next);
  assert.equal(diff.status,'CHANGED');
  assert.deepEqual(diff.operations,[]);
  assert.deepEqual(diff.relation_operations.map(operation=>[operation.operation,operation.edge_id]),[['UPDATE','e4']]);
  for(const id of ['component_1','api_1','service_1','deployment_1']) assert.ok(diff.impact_node_ids.includes(id),`missing relation impact ${id}`);
  assert.equal(diff.impact_state,'COMPUTED');
});

test('generation-only recompilation does not trigger semantic rebuild work',async()=>{
  const prior=await compileProductIR(graph(1),{bindings,compilerVersion:'1.0.0'});
  const next=await compileProductIR(graph(2),{bindings,compilerVersion:'1.0.0'});
  const diff=await diffProductIR(prior,next);
  assert.equal(diff.status,'UNCHANGED');
  assert.deepEqual(diff.operations,[]);
  assert.deepEqual(diff.impact_node_ids,[]);
});


test('tampered IR semantic content cannot reuse stale hashes to produce an UNCHANGED diff',async()=>{
  const prior=await compileProductIR(graph(1),{bindings,compilerVersion:'1.0.0'});
  const tampered=structuredClone(prior);
  tampered.units[0].data={...tampered.units[0].data,title:'tampered after compile'};
  await assert.rejects(
    async()=>diffProductIR(prior,tampered),
    /integrity|hash|sha256|tamper/i,
  );
});


test('reconciliation rejects tampered IR instead of issuing MATCH from a stale envelope hash',async()=>{
  const ir=await compileProductIR(graph(),{bindings,compilerVersion:'1.0.0'});
  const tampered=structuredClone(ir);
  tampered.units[0].data={...tampered.units[0].data,title:'tampered before reconciliation'};
  await assert.rejects(
    async()=>reconcileProductIR(tampered,bindings.map(({binding_id,external_sha256})=>({binding_id,external_sha256}))),
    /integrity|hash|sha256|tamper/i,
  );
});
