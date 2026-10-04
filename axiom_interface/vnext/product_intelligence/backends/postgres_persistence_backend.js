import {assertAdapterDescriptor} from '../infrastructure_contracts.js';
import {assertLivingProductGraph} from '../living_product_graph.js';

export const POSTGRES_PERSISTENCE_DESCRIPTOR=Object.freeze({
  kind:'PersistenceBackend',
  adapter_version:'1.0.0',
  provider:'postgresql',
  provider_baseline:'18.6',
  vector_baseline:'0.8.6',
  semantic_owner:'AXIOM',
  authority:'MECHANISM_ONLY',
  capabilities:Object.freeze(['load','commit','verify','export','relational-graph','transaction','generation-lock']),
  unsupported_operations:Object.freeze(['production_mutation_without_policy_gate','authority_grant','silent_fallback']),
  timeout_ms:15000,
  retry:Object.freeze({max_attempts:1,backoff:'CALLER_GOVERNED'}),
  idempotency:Object.freeze({mode:'GENERATION_COMPARE_AND_SWAP'}),
  data_classification:Object.freeze(['project-private','evidence-referenced']),
  egress:Object.freeze({required:false,allowed_origins:Object.freeze([])}),
  identity_binding:Object.freeze({required:true,mode:'AXIOM_WORKLOAD_ID'}),
  evidence_envelope:Object.freeze({schema:'musitu.axiom.evidence.v1',required:true}),
  health:Object.freeze({mode:'EXPLICIT'}),
  migration_export:Object.freeze({supported:true,format:'LPG_JSON_V1'}),
  fail_closed:true,
});
assertAdapterDescriptor(POSTGRES_PERSISTENCE_DESCRIPTOR,{expectedKind:'PersistenceBackend'});

const ensureProject=projectId=>{
  const value=String(projectId??'').trim();
  if(!value) throw new TypeError('project id required');
  return value;
};
const ensureGeneration=value=>{
  if(!Number.isInteger(value)||value<0) throw new TypeError('expectedGeneration must be a non-negative integer');
  return value;
};

export function createPostgresPersistenceBackend({pool}={}){
  if(!pool||typeof pool.connect!=='function') throw new TypeError('PostgreSQL pool.connect implementation required');

  async function withClient(work){
    const client=await pool.connect();
    if(!client||typeof client.query!=='function') throw new TypeError('PostgreSQL client.query implementation required');
    try{return await work(client);}finally{if(typeof client.release==='function') client.release();}
  }

  const backend={
    descriptor:POSTGRES_PERSISTENCE_DESCRIPTOR,

    async loadProjectGraph(projectId){
      projectId=ensureProject(projectId);
      return withClient(async client=>{
        const head=await client.query('SELECT generation FROM axiom_pi.lpg_heads WHERE project_id = $1',[projectId]);
        if(!head.rows?.length) return null;
        const generation=Number(head.rows[0].generation);
        const header=await client.query('SELECT schema, impact_state FROM axiom_pi.lpg_generations WHERE project_id = $1 AND generation = $2',[projectId,generation]);
        if(header.rows?.length!==1) throw new Error('LPG generation header missing');
        const nodes=await client.query('SELECT node_id, node_type, metadata, data FROM axiom_pi.lpg_nodes WHERE project_id = $1 AND generation = $2 ORDER BY node_id',[projectId,generation]);
        const edges=await client.query('SELECT edge_id, from_id, to_id, relation, causal_semantics, metadata FROM axiom_pi.lpg_edges WHERE project_id = $1 AND generation = $2 ORDER BY edge_id',[projectId,generation]);
        const graph={
          schema:header.rows[0].schema,
          project_id:projectId,
          generation,
          impact_state:header.rows[0].impact_state,
          nodes:(nodes.rows??[]).map(row=>({node_id:row.node_id,type:row.node_type,metadata:row.metadata,data:row.data})),
          edges:(edges.rows??[]).map(row=>({edge_id:row.edge_id,from_id:row.from_id,to_id:row.to_id,relation:row.relation,causal_semantics:row.causal_semantics,metadata:row.metadata})),
        };
        assertLivingProductGraph(graph);
        return graph;
      });
    },

    async commitGraph(projectId,graph,{expectedGeneration}={}){
      projectId=ensureProject(projectId);
      expectedGeneration=ensureGeneration(expectedGeneration);
      if(!graph||typeof graph!=='object'||Array.isArray(graph)) throw new TypeError('Living Product Graph object required');
      if(graph.project_id!==projectId) throw new DOMException('cross-project graph commit blocked','SecurityError');
      assertLivingProductGraph(graph);
      if(graph.generation!==expectedGeneration+1) throw new Error(`graph generation must equal expectedGeneration + 1`);

      return withClient(async client=>{
        let transaction=false;
        try{
          await client.query('BEGIN'); transaction=true;
          const locked=await client.query('SELECT generation FROM axiom_pi.lpg_heads WHERE project_id = $1 FOR UPDATE',[projectId]);
          const current=locked.rows?.length?Number(locked.rows[0].generation):0;
          if(current!==expectedGeneration) throw new Error(`generation conflict: expected ${expectedGeneration}, current ${current}`);

          await client.query(
            'INSERT INTO axiom_pi.lpg_generations (project_id, generation, schema, impact_state) VALUES ($1,$2,$3,$4)',
            [projectId,graph.generation,graph.schema,graph.impact_state],
          );
          for(const node of graph.nodes){
            await client.query(
              'INSERT INTO axiom_pi.lpg_nodes (project_id, generation, node_id, node_type, metadata, data) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb)',
              [projectId,graph.generation,node.node_id,node.type,JSON.stringify(node.metadata),JSON.stringify(node.data)],
            );
          }
          for(const edge of graph.edges){
            await client.query(
              'INSERT INTO axiom_pi.lpg_edges (project_id, generation, edge_id, from_id, to_id, relation, causal_semantics, metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',
              [projectId,graph.generation,edge.edge_id,edge.from_id,edge.to_id,edge.relation,edge.causal_semantics,JSON.stringify(edge.metadata)],
            );
          }
          await client.query(
            'INSERT INTO axiom_pi.lpg_heads (project_id, generation, updated_at) VALUES ($1,$2,CURRENT_TIMESTAMP) ON CONFLICT (project_id) DO UPDATE SET generation = EXCLUDED.generation, updated_at = CURRENT_TIMESTAMP',
            [projectId,graph.generation],
          );
          await client.query('COMMIT'); transaction=false;
          return structuredClone(graph);
        }catch(error){
          if(transaction){try{await client.query('ROLLBACK');}catch{}}
          throw error;
        }
      });
    },

    async verifyIntegrity(projectId){
      projectId=ensureProject(projectId);
      try{
        const graph=await backend.loadProjectGraph(projectId);
        if(!graph) return Object.freeze({status:'NOT_PROVEN',project_id:projectId,reason:'NO_GRAPH'});
        assertLivingProductGraph(graph);
        return Object.freeze({status:'PASS',project_id:projectId,generation:graph.generation,node_count:graph.nodes.length,edge_count:graph.edges.length});
      }catch(error){
        return Object.freeze({status:'FAIL',project_id:projectId,reason:String(error?.message??error)});
      }
    },

    async exportProject(projectId){
      projectId=ensureProject(projectId);
      return Object.freeze({project_id:projectId,graph:await backend.loadProjectGraph(projectId)});
    },
  };
  return Object.freeze(backend);
}
