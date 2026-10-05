import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPostgresPersistenceBackend,POSTGRES_PERSISTENCE_DESCRIPTOR} from '../product_intelligence/backends/postgres_persistence_backend.js';

const here=dirname(fileURLToPath(import.meta.url));
const migrationPath=resolve(here,'../product_intelligence/migrations/001_living_product_graph.sql');

const metadata=(projectId='project_12345678')=>({
  project_id:projectId,version:1,generation:1,valid_from:'2026-10-04T15:00:00Z',valid_to:null,
  provenance:{source:'phase2-test'},evidence_refs:['evidence_12345678'],confidence:0.8,uncertainty:{kind:'bounded'},
  actor_id:'agent_builder_1',risk_class:'S1',content_hash:'a'.repeat(64),freshness:{as_of:'2026-10-04T15:00:00Z'},
  supersession:{state:'CURRENT',supersedes:[]},
});
const graph=()=>({
  schema:'musitu.axiom.living-product-graph.v1',project_id:'project_12345678',generation:1,impact_state:'NOT_PROVEN',
  nodes:[
    {node_id:'lpg_node_requirement_1',type:'Requirement',metadata:metadata(),data:{title:'Keyboard navigation'}},
    {node_id:'lpg_node_test_1',type:'Test',metadata:metadata(),data:{title:'Keyboard test'}},
  ],
  edges:[{edge_id:'lpg_edge_verified_1',from_id:'lpg_node_requirement_1',to_id:'lpg_node_test_1',relation:'VERIFIED_BY',causal_semantics:'NONE',metadata:metadata()}],
});

function fakePool({headGeneration=null,failOn=null}={}){
  const calls=[];
  const client={
    async query(text,params=[]){
      const sql=String(text).replace(/\s+/g,' ').trim(); calls.push({sql,params:structuredClone(params)});
      if(failOn && sql.includes(failOn)) throw new Error('injected sql failure');
      if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK') return {rows:[],rowCount:0};
      if(sql.includes('SELECT generation FROM axiom_pi.lpg_heads') && sql.includes('FOR UPDATE')) return {rows:headGeneration===null?[]:[{generation:headGeneration}],rowCount:headGeneration===null?0:1};
      if(sql.includes('SELECT generation FROM axiom_pi.lpg_heads') && !sql.includes('FOR UPDATE')) return {rows:headGeneration===null?[]:[{generation:headGeneration}],rowCount:headGeneration===null?0:1};
      if(sql.includes('SELECT schema, impact_state FROM axiom_pi.lpg_generations')) return {rows:[{schema:'musitu.axiom.living-product-graph.v1',impact_state:'NOT_PROVEN'}],rowCount:1};
      if(sql.includes('FROM axiom_pi.lpg_nodes')) return {rows:[
        {node_id:'lpg_node_requirement_1',node_type:'Requirement',metadata:metadata(),data:{title:'Keyboard navigation'}},
        {node_id:'lpg_node_test_1',node_type:'Test',metadata:metadata(),data:{title:'Keyboard test'}},
      ],rowCount:2};
      if(sql.includes('FROM axiom_pi.lpg_edges')) return {rows:[{edge_id:'lpg_edge_verified_1',from_id:'lpg_node_requirement_1',to_id:'lpg_node_test_1',relation:'VERIFIED_BY',causal_semantics:'NONE',metadata:metadata()}],rowCount:1};
      if(sql.includes('COUNT(*)::int AS count')) return {rows:[{count:1}],rowCount:1};
      return {rows:[],rowCount:1};
    },
    release(){calls.push({sql:'RELEASE',params:[]});},
  };
  return {pool:{async connect(){calls.push({sql:'CONNECT',params:[]});return client;}},calls};
}

test('migration creates portable relational LPG tables with vector extension but no AGE dependency',async()=>{
  const sql=await readFile(migrationPath,'utf8');
  assert.match(sql,/CREATE EXTENSION IF NOT EXISTS vector/i);
  assert.match(sql,/CREATE SCHEMA IF NOT EXISTS axiom_pi/i);
  for(const table of ['lpg_heads','lpg_generations','lpg_nodes','lpg_edges']) assert.match(sql,new RegExp(`CREATE TABLE IF NOT EXISTS axiom_pi\\.${table}`,'i'));
  assert.match(sql,/FOREIGN KEY \(project_id, generation\)/i);
  assert.match(sql,/CHECK \(causal_semantics IN/i);
  assert.doesNotMatch(sql,/apache_age|ag_catalog|cypher\s*\(/i);
});

test('PostgreSQL backend descriptor remains mechanism-only and pins qualified baseline',()=>{
  assert.equal(POSTGRES_PERSISTENCE_DESCRIPTOR.kind,'PersistenceBackend');
  assert.equal(POSTGRES_PERSISTENCE_DESCRIPTOR.provider,'postgresql');
  assert.equal(POSTGRES_PERSISTENCE_DESCRIPTOR.semantic_owner,'AXIOM');
  assert.equal(POSTGRES_PERSISTENCE_DESCRIPTOR.authority,'MECHANISM_ONLY');
  assert.equal(POSTGRES_PERSISTENCE_DESCRIPTOR.provider_baseline,'18.6');
  assert.equal(POSTGRES_PERSISTENCE_DESCRIPTOR.vector_baseline,'0.8.6');
  assert.equal(POSTGRES_PERSISTENCE_DESCRIPTOR.fail_closed,true);
});

test('commitGraph uses an atomic transaction, generation lock and normalized node/edge writes',async()=>{
  const {pool,calls}=fakePool({headGeneration:null});
  const backend=createPostgresPersistenceBackend({pool});
  const saved=await backend.commitGraph('project_12345678',graph(),{expectedGeneration:0});
  assert.equal(saved.generation,1);
  const joined=calls.map(call=>call.sql).join('\n');
  assert.match(joined,/BEGIN/);
  assert.match(joined,/FOR UPDATE/);
  assert.match(joined,/INSERT INTO axiom_pi\.lpg_generations/);
  assert.match(joined,/INSERT INTO axiom_pi\.lpg_nodes/);
  assert.match(joined,/INSERT INTO axiom_pi\.lpg_edges/);
  assert.match(joined,/INSERT INTO axiom_pi\.lpg_heads/);
  assert.match(joined,/COMMIT/);
  assert.ok(joined.indexOf('BEGIN')<joined.indexOf('COMMIT'));
  assert.equal(calls.at(-1).sql,'RELEASE');
});

test('commitGraph rejects stale expectedGeneration before inserts and rolls back',async()=>{
  const {pool,calls}=fakePool({headGeneration:4});
  const backend=createPostgresPersistenceBackend({pool});
  const stale=graph(); stale.generation=4;
  for(const node of stale.nodes) node.metadata.generation=4;
  for(const edge of stale.edges) edge.metadata.generation=4;
  await assert.rejects(()=>backend.commitGraph('project_12345678',stale,{expectedGeneration:3}),/generation conflict/);
  const joined=calls.map(call=>call.sql).join('\n');
  assert.match(joined,/ROLLBACK/);
  assert.doesNotMatch(joined,/INSERT INTO axiom_pi\.lpg_generations/);
  assert.equal(calls.at(-1).sql,'RELEASE');
});

test('commitGraph rolls back injected SQL failure and never commits partial graph',async()=>{
  const {pool,calls}=fakePool({headGeneration:null,failOn:'INSERT INTO axiom_pi.lpg_edges'});
  const backend=createPostgresPersistenceBackend({pool});
  await assert.rejects(()=>backend.commitGraph('project_12345678',graph(),{expectedGeneration:0}),/injected sql failure/);
  const joined=calls.map(call=>call.sql).join('\n');
  assert.match(joined,/ROLLBACK/);
  assert.doesNotMatch(joined,/\nCOMMIT\n/);
  assert.equal(calls.at(-1).sql,'RELEASE');
});

test('loadProjectGraph reconstructs the frozen graph shape from normalized relational rows',async()=>{
  const {pool}=fakePool({headGeneration:1});
  const backend=createPostgresPersistenceBackend({pool});
  const loaded=await backend.loadProjectGraph('project_12345678');
  assert.equal(loaded.schema,'musitu.axiom.living-product-graph.v1');
  assert.equal(loaded.project_id,'project_12345678');
  assert.equal(loaded.generation,1);
  assert.equal(loaded.nodes.length,2);
  assert.equal(loaded.edges.length,1);
  assert.equal(loaded.nodes[0].type,'Requirement');
  assert.equal(loaded.edges[0].relation,'VERIFIED_BY');
});
