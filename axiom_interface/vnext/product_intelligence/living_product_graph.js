import {assertAdapterDescriptor} from './infrastructure_contracts.js';

export const LIVING_PRODUCT_GRAPH_SCHEMA='musitu.axiom.living-product-graph.v1';
export const LPG_NODE_TYPES=Object.freeze([
  'Objective','OutcomeMetric','Constraint','Stakeholder','UserSegment','UserNeed','MarketSignal','ResearchFinding','Requirement','Policy','Regulation','ProductThesis','Journey','ExperienceSurface','Screen','Component','DesignToken','Content','Interaction','DataEntity','APIContract','Service','AgentRole','CapabilityRoute','InfrastructureResource','Test','Evaluation','Threat','Control','Experiment','FeatureFlag','Deployment','TelemetrySignal','CostModel','RevenueEvent','Incident','Decision','ArtifactRef','EvidenceRef',
]);
export const LPG_EDGE_RELATIONS=Object.freeze([
  'DERIVED_FROM','JUSTIFIED_BY','SATISFIES','IMPLEMENTS','DEPENDS_ON','BLOCKED_BY','VERIFIED_BY','MEASURED_BY',
  'DEPLOYED_AS','OBSERVED_AS','SUPERSEDES','AFFECTS','GOVERNED_BY','OWNED_BY','EXECUTED_BY','PRODUCES','REFERENCES','INVALIDATES',
]);
export const LPG_CAUSAL_SEMANTICS=Object.freeze(['NONE','CORRELATION','HYPOTHESIS','QUASI_EXPERIMENTAL','RANDOMIZED_CAUSAL','EXTERNAL_ATTESTED_CAUSAL']);
export const LPG_IMPACT_STATES=Object.freeze(['COMPUTED','NOT_PROVEN']);

const isPlainObject=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const isIso=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const RISK_CLASSES=new Set(['S0','S1','S2','S3','S4','S5']);
const HASH=/^[a-f0-9]{64}$/i;

function validateMetadata(metadata,{projectId,location},errors){
  if(!isPlainObject(metadata)){errors.push(`${location} metadata must be a plain object`);return;}
  const required=['project_id','version','generation','valid_from','valid_to','provenance','evidence_refs','confidence','uncertainty','actor_id','risk_class','content_hash','freshness','supersession'];
  for(const field of required) if(!(field in metadata)) errors.push(`${location} metadata.${field} is required`);
  if(metadata.project_id!==projectId) errors.push(`${location} cross-project ${location.startsWith('node')?'node':'edge'} blocked`);
  if(!Number.isInteger(metadata.version)||metadata.version<1) errors.push(`${location} metadata.version must be a positive integer`);
  if(!Number.isInteger(metadata.generation)||metadata.generation<1) errors.push(`${location} metadata.generation must be a positive integer`);
  if(!isIso(metadata.valid_from)) errors.push(`${location} metadata.valid_from must be an ISO instant`);
  if(!(metadata.valid_to===null||isIso(metadata.valid_to))) errors.push(`${location} metadata.valid_to must be null or an ISO instant`);
  if(!isPlainObject(metadata.provenance)) errors.push(`${location} metadata.provenance must be a plain object`);
  if(!Array.isArray(metadata.evidence_refs)) errors.push(`${location} metadata.evidence_refs must be an array`);
  if(!(metadata.confidence===null||(typeof metadata.confidence==='number'&&metadata.confidence>=0&&metadata.confidence<=1))) errors.push(`${location} metadata.confidence must be null or 0..1`);
  if(!isPlainObject(metadata.uncertainty)) errors.push(`${location} metadata.uncertainty must be a plain object`);
  if(typeof metadata.actor_id!=='string'||!metadata.actor_id.trim()) errors.push(`${location} metadata.actor_id must be non-empty`);
  if(!RISK_CLASSES.has(metadata.risk_class)) errors.push(`${location} metadata.risk_class must be S0..S5`);
  if(typeof metadata.content_hash!=='string'||!HASH.test(metadata.content_hash)) errors.push(`${location} metadata.content_hash must be sha256 hex`);
  if(!isPlainObject(metadata.freshness)) errors.push(`${location} metadata.freshness must be a plain object`);
  if(!isPlainObject(metadata.supersession)) errors.push(`${location} metadata.supersession must be a plain object`);
}

export function validateLivingProductGraph(candidate){
  const errors=[];
  if(!isPlainObject(candidate)) return Object.freeze({ok:false,errors:Object.freeze(['graph must be a plain object'])});
  if(candidate.schema!==LIVING_PRODUCT_GRAPH_SCHEMA) errors.push(`schema must equal ${LIVING_PRODUCT_GRAPH_SCHEMA}`);
  const projectId=typeof candidate.project_id==='string'?candidate.project_id.trim():'';
  if(!projectId) errors.push('project_id is required');
  if(!Number.isInteger(candidate.generation)||candidate.generation<1) errors.push('generation must be a positive integer');
  if(!LPG_IMPACT_STATES.includes(candidate.impact_state)) errors.push('impact_state must be COMPUTED or NOT_PROVEN');
  if(!Array.isArray(candidate.nodes)) errors.push('nodes must be an array');
  if(!Array.isArray(candidate.edges)) errors.push('edges must be an array');

  const nodes=Array.isArray(candidate.nodes)?candidate.nodes:[];
  const edges=Array.isArray(candidate.edges)?candidate.edges:[];
  const nodeIds=new Set();
  for(const [index,node] of nodes.entries()){
    const location=`node[${index}]`;
    if(!isPlainObject(node)){errors.push(`${location} must be a plain object`);continue;}
    if(typeof node.node_id!=='string'||!node.node_id.trim()) errors.push(`${location} node_id is required`);
    else if(nodeIds.has(node.node_id)) errors.push(`${location} duplicate node_id`);
    else nodeIds.add(node.node_id);
    if(!LPG_NODE_TYPES.includes(node.type)) errors.push(`${location} type is not in the frozen vocabulary`);
    if(!isPlainObject(node.data)) errors.push(`${location} data must be a plain object`);
    validateMetadata(node.metadata,{projectId,location},errors);
  }

  const edgeIds=new Set();
  for(const [index,edge] of edges.entries()){
    const location=`edge[${index}]`;
    if(!isPlainObject(edge)){errors.push(`${location} must be a plain object`);continue;}
    if(typeof edge.edge_id!=='string'||!edge.edge_id.trim()) errors.push(`${location} edge_id is required`);
    else if(edgeIds.has(edge.edge_id)) errors.push(`${location} duplicate edge_id`);
    else edgeIds.add(edge.edge_id);
    if(!nodeIds.has(edge.from_id)||!nodeIds.has(edge.to_id)||edge.from_id===edge.to_id) errors.push(`${location} edge endpoints must be distinct in-project nodes`);
    if(!LPG_EDGE_RELATIONS.includes(edge.relation)) errors.push(`${location} relation is not in the frozen vocabulary`);
    if(!LPG_CAUSAL_SEMANTICS.includes(edge.causal_semantics)) errors.push(`${location} causal_semantics is not in the frozen vocabulary`);
    validateMetadata(edge.metadata,{projectId,location},errors);
  }
  return Object.freeze({ok:errors.length===0,errors:Object.freeze([...new Set(errors)])});
}

export function assertLivingProductGraph(candidate){
  const result=validateLivingProductGraph(candidate);
  if(!result.ok) throw new TypeError(`Living Product Graph contract violation: ${result.errors.join('; ')}`);
  return candidate;
}

const REQUIRED_BACKEND_METHODS=Object.freeze(['loadProjectGraph','commitGraph','verifyIntegrity','exportProject']);

export function createLivingProductGraphPersistence(backend){
  if(!backend||typeof backend!=='object') throw new TypeError('PersistenceBackend implementation required');
  assertAdapterDescriptor(backend.descriptor,{expectedKind:'PersistenceBackend'});
  for(const method of REQUIRED_BACKEND_METHODS) if(typeof backend[method]!=='function') throw new TypeError(`PersistenceBackend.${method} is required`);

  const ensureProject=projectId=>{
    const value=String(projectId??'').trim();
    if(!value) throw new TypeError('project id required');
    return value;
  };
  const verifyLoaded=(projectId,value)=>{
    if(value===null) return null;
    assertLivingProductGraph(value);
    if(value.project_id!==projectId) throw new DOMException('cross-project graph load blocked','SecurityError');
    return value;
  };

  const api={
    descriptor:backend.descriptor,
    async load(projectId){
      projectId=ensureProject(projectId);
      return verifyLoaded(projectId,await backend.loadProjectGraph(projectId));
    },
    async commit(graph,{expectedGeneration}={}){
      assertLivingProductGraph(graph);
      return api.commitForProject(graph.project_id,graph,{expectedGeneration});
    },
    async commitForProject(projectId,graph,{expectedGeneration}={}){
      projectId=ensureProject(projectId);
      if(!graph||typeof graph!=='object'||Array.isArray(graph)) throw new TypeError('Living Product Graph object required');
      if(graph.project_id!==projectId) throw new DOMException('cross-project graph commit blocked','SecurityError');
      assertLivingProductGraph(graph);
      if(!Number.isInteger(expectedGeneration)||expectedGeneration<0) throw new TypeError('expectedGeneration must be a non-negative integer');
      const saved=await backend.commitGraph(projectId,structuredClone(graph),{expectedGeneration});
      return verifyLoaded(projectId,saved);
    },
    async verify(projectId){
      projectId=ensureProject(projectId);
      const result=await backend.verifyIntegrity(projectId);
      if(!result||typeof result!=='object'||Array.isArray(result)||typeof result.status!=='string') throw new TypeError('PersistenceBackend.verifyIntegrity returned invalid result');
      return result;
    },
    async exportProject(projectId){
      projectId=ensureProject(projectId);
      const exported=await backend.exportProject(projectId);
      if(!exported||typeof exported!=='object'||Array.isArray(exported)||exported.project_id!==projectId) throw new DOMException('cross-project graph export blocked','SecurityError');
      if(exported.graph!==null&&exported.graph!==undefined) verifyLoaded(projectId,exported.graph);
      return exported;
    },
  };
  return Object.freeze(api);
}
