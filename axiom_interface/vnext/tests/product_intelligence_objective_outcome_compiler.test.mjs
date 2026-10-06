import assert from 'node:assert/strict';
import test from 'node:test';
import {compileObjectiveOutcomeGraph,createProjectProductIntelligenceBridge} from '../product_intelligence/objective_outcome_compiler.js';
import {validateLivingProductGraph} from '../product_intelligence/living_product_graph.js';

const project=()=>({
  schema:'musitu.axiom.project.v1',project_id:'prj_123',name:'Investment Decision Pack',goal:'Produce a verified investment decision product',
  owner_id:'local-user',permissions:[{principal_id:'local-user',role:'owner'}],provenance:{source:'user',actor_id:'local-user',created_at:'2026-10-04T15:00:00Z'},
});
const contract=()=>({
  schema:'musitu.axiom.outcome-contract.v1',project_id:'prj_123',contract_id:'oc_123',contract_sha256:'b'.repeat(64),project_object_id:'obj_task_1',
  title:'Verified outcome',outcome:'Deliver an independently verifiable decision pack',
  success_criteria:['All material claims cite evidence','Security gates remain fail closed'],
  constraints:{privacy:'Project',evidence:'Independent validation',autonomy:'Preview only',approval:'Before consequential action',deadline:null,compute_budget:25},
  execution_boundary:'PREVIEW_ONLY_NO_EXTERNAL_CONSEQUENTIAL_ACTIONS',supersedes_contract_id:null,created_at:'2026-10-04T15:01:00Z',created_by:'local-user',
});
const approval=()=>({receipt_id:'obj_decision_1',edge_id:'edge_approval_1',contract_id:'oc_123',contract_sha256:'b'.repeat(64),provenance:{source:'explicit-user-approval',actor_id:'local-user',created_at:'2026-10-04T15:02:00Z'}});

test('compiler maps verified Project + Outcome Contract into a valid Project-scoped Living Product Graph',async()=>{
  const graph=await compileObjectiveOutcomeGraph({project:project(),contract:contract(),contractVerified:true,approval:approval(),generation:1,actorId:'local-user',at:'2026-10-04T15:03:00Z'});
  assert.equal(validateLivingProductGraph(graph).ok,true);
  assert.equal(graph.project_id,'prj_123');
  assert.equal(graph.generation,1);
  assert.equal(graph.impact_state,'NOT_PROVEN');
  assert.equal(graph.nodes.filter(n=>n.type==='Objective').length,1);
  assert.equal(graph.nodes.filter(n=>n.type==='OutcomeMetric').length,2);
  assert.equal(graph.nodes.filter(n=>n.type==='Constraint').length,5);
  assert.equal(graph.nodes.filter(n=>n.type==='EvidenceRef').length,1);
  assert.equal(graph.nodes.filter(n=>n.type==='Decision').length,1);
  assert.equal(graph.edges.filter(e=>e.relation==='MEASURED_BY').length,2);
  assert.ok(graph.nodes.every(n=>n.metadata.project_id==='prj_123' && /^[a-f0-9]{64}$/.test(n.metadata.content_hash)));
  const objective=graph.nodes.find(n=>n.type==='Objective');
  assert.equal(objective.data.execution_boundary,'PREVIEW_ONLY_NO_EXTERNAL_CONSEQUENTIAL_ACTIONS');
});

test('compiler fails closed on unverified or cross-project Outcome Contract',async()=>{
  await assert.rejects(()=>compileObjectiveOutcomeGraph({project:project(),contract:contract(),contractVerified:false,generation:1,actorId:'local-user'}),/contract integrity must be verified/);
  const other=contract(); other.project_id='prj_other';
  await assert.rejects(()=>compileObjectiveOutcomeGraph({project:project(),contract:other,contractVerified:true,generation:1,actorId:'local-user'}),/cross-project outcome contract blocked/);
});

test('absence of approval is represented truthfully and never inferred from contract existence',async()=>{
  const graph=await compileObjectiveOutcomeGraph({project:project(),contract:contract(),contractVerified:true,approval:null,generation:1,actorId:'local-user',at:'2026-10-04T15:03:00Z'});
  assert.equal(graph.nodes.some(n=>n.type==='Decision'),false);
  const objective=graph.nodes.find(n=>n.type==='Objective');
  assert.equal(objective.data.approval_state,'NOT_APPROVED');
});

test('Project Product Intelligence bridge reads earned stores, verifies contract, and commits through PersistenceBackend seam',async()=>{
  const commits=[];
  const projectStore={async getProject(id){assert.equal(id,'prj_123');return project();}};
  const outcomeStore={
    async get(id){assert.equal(id,'oc_123');return contract();},
    async verify(id){assert.equal(id,'oc_123');return true;},
    async approval(facade,id){assert.equal(facade.store,projectStore);assert.equal(id,'oc_123');return approval();},
  };
  const persistence={async commitForProject(projectId,graph,{expectedGeneration}){commits.push({projectId,graph,expectedGeneration});return graph;}};
  const bridge=createProjectProductIntelligenceBridge({projectStore,outcomeStore,projectFacade:{store:projectStore},persistence,actorId:'local-user',clock:()=> '2026-10-04T15:03:00Z'});
  const saved=await bridge.compileOutcomeContract('oc_123',{expectedGeneration:0});
  assert.equal(saved.project_id,'prj_123');
  assert.equal(commits.length,1);
  assert.equal(commits[0].expectedGeneration,0);
  assert.equal(commits[0].graph.generation,1);
});

test('bridge stops before persistence when contract verification fails',async()=>{
  let persisted=false;
  const projectStore={async getProject(){return project();}};
  const outcomeStore={async get(){return contract();},async verify(){return false;},async approval(){throw new Error('approval must not be read');}};
  const persistence={async commitForProject(){persisted=true;}};
  const bridge=createProjectProductIntelligenceBridge({projectStore,outcomeStore,projectFacade:{store:projectStore},persistence,actorId:'local-user'});
  await assert.rejects(()=>bridge.compileOutcomeContract('oc_123',{expectedGeneration:0}),/contract integrity must be verified/);
  assert.equal(persisted,false);
});


test('unknown Outcome Contract fields fail closed instead of being silently ignored',async()=>{
  const bad=contract();
  bad.unexpected=true;
  await assert.rejects(
    ()=>compileObjectiveOutcomeGraph({project:project(),contract:bad,contractVerified:true,approval:null,generation:1,actorId:'local-user',at:'2026-10-04T15:03:00Z'}),
    /unsupported fields|Outcome Contract/i,
  );
});


test('Outcome Contract success criteria must be strings and are never coerced from malformed values',async()=>{
  const bad=contract();
  bad.success_criteria=['valid criterion',42];
  await assert.rejects(
    ()=>compileObjectiveOutcomeGraph({project:project(),contract:bad,contractVerified:true,approval:null,generation:1,actorId:'local-user',at:'2026-10-04T15:03:00Z'}),
    /success criteria.*string|string.*success criteria/i,
  );
});


test('Outcome Contract constraint schema rejects unknown fields fail closed',async()=>{
  const bad=contract();
  bad.constraints.unexpected='must-not-be-ignored';
  await assert.rejects(
    ()=>compileObjectiveOutcomeGraph({project:project(),contract:bad,contractVerified:true,approval:null,generation:1,actorId:'local-user',at:'2026-10-04T15:03:00Z'}),
    /constraints.*unsupported fields|unsupported fields.*constraints/i,
  );
});


test('Outcome Contract constraint values reject structured or credential-bearing values instead of coercing them',async()=>{
  const bad=contract();
  bad.constraints.privacy={api_key:'must-not-cross'};
  await assert.rejects(
    ()=>compileObjectiveOutcomeGraph({project:project(),contract:bad,contractVerified:true,approval:null,generation:1,actorId:'local-user',at:'2026-10-04T15:03:00Z'}),
    /constraint.*privacy|privacy.*constraint|string/i,
  );
});


test('approval receipts reject unknown authority-bearing fields fail closed',async()=>{
  const bad=approval();
  bad.release_authority=true;
  await assert.rejects(
    ()=>compileObjectiveOutcomeGraph({project:project(),contract:contract(),contractVerified:true,approval:bad,generation:1,actorId:'local-user',at:'2026-10-04T15:03:00Z'}),
    /approval receipt.*unsupported fields|unsupported fields.*approval receipt/i,
  );
});


test('approval receipts require stable receipt and edge identities',async()=>{
  for(const field of ['receipt_id','edge_id']){
    const bad=approval();
    delete bad[field];
    await assert.rejects(
      ()=>compileObjectiveOutcomeGraph({project:project(),contract:contract(),contractVerified:true,approval:bad,generation:1,actorId:'local-user',at:'2026-10-04T15:03:00Z'}),
      /approval receipt.*(receipt_id|edge_id)|receipt_id|edge_id/i,
    );
  }
});
