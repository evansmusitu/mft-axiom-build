export {verifyOperationScopedExecutionOutcome,createExecutionOutcomeEvidence,reconcileVerifiedExecutionOutcome,verifyExternalWorkerResult,createExternalWorkerResultEvidence,reconcileVerifiedExternalWorkerResult,verifyExternalDestinationStateCorrelation,createExternalDestinationStateCorrelationEvidence,reconcileExternalDestinationStateCorrelation,EXTERNAL_DESTINATION_STATE_CORRELATION_SCHEMA} from './execution_outcome_reconciliation.js';
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
const ENTITY_ID=/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,299}$/;
const GRAPH_KEYS=new Set(['schema','project_id','generation','impact_state','nodes','edges']);
const NODE_KEYS=new Set(['node_id','type','metadata','data']);
const EDGE_KEYS=new Set(['edge_id','from_id','to_id','relation','causal_semantics','metadata']);
const METADATA_KEYS=new Set(['project_id','version','generation','valid_from','valid_to','provenance','evidence_refs','confidence','uncertainty','actor_id','risk_class','content_hash','freshness','supersession']);
const FORBIDDEN_CREDENTIAL_KEY=/^(?:access|refresh|id)?_?token$|authorization|api_?key|password|private_?key|client_?secret|secret$/i;
const AUTHORITY_KEYS=new Set(['authority','release_authority','production_authority','certification_authority','policy_authority','identity_authority','canonical_evidence','allow_release','allow_production','certified']);
const INTEGRITY_STATUSES=new Set(['PASS','FAIL','NOT_PROVEN']);
function inspectCredentialMaterial(value,path,errors,depth=0){
  if(depth>10){errors.push(path+' exceeds metadata nesting limit');return;}
  if(!value||typeof value!=='object') return;
  for(const [key,child] of Object.entries(value)){
    if(FORBIDDEN_CREDENTIAL_KEY.test(key)) errors.push(path+'.'+key+' contains forbidden credential material');
    inspectCredentialMaterial(child,path+'.'+key,errors,depth+1);
  }
}
function rejectMechanismEscalation(value,path='mechanism',depth=0,{skipKeys=new Set()}={}){
  if(depth>10) throw new RangeError(path+' exceeds mechanism envelope nesting limit');
  if(!value||typeof value!=='object') return;
  for(const [key,child] of Object.entries(value)){
    if(skipKeys.has(key)) continue;
    if(FORBIDDEN_CREDENTIAL_KEY.test(key)) throw new DOMException(path+'.'+key+' contains forbidden credential material','SecurityError');
    if(AUTHORITY_KEYS.has(key)&&child!==undefined&&child!==null&&child!==false&&child!=='NONE'&&child!=='NOT_PROVEN'&&child!=='MECHANISM_ONLY') throw new DOMException(path+'.'+key+' attempted forbidden authority','SecurityError');
    rejectMechanismEscalation(child,path+'.'+key,depth+1);
  }
}
const rejectUnknown=(value,allowed,location,errors)=>{const extra=Object.keys(value).filter(key=>!allowed.has(key));if(extra.length)errors.push(`${location} contains unsupported fields: ${extra.join(',')}`);};

function validateMetadata(metadata,{projectId,graphGeneration,location},errors){
  if(!isPlainObject(metadata)){errors.push(`${location} metadata must be a plain object`);return;}
  rejectUnknown(metadata,METADATA_KEYS,`${location} metadata`,errors);
  inspectCredentialMaterial(metadata,`${location} metadata`,errors);
  const required=[...METADATA_KEYS];
  for(const field of required) if(!(field in metadata)) errors.push(`${location} metadata.${field} is required`);
  if(typeof metadata.project_id!=='string'||!ENTITY_ID.test(metadata.project_id)) errors.push(`${location} metadata.project_id invalid`);
  if(metadata.project_id!==projectId) errors.push(`${location} cross-project ${location.startsWith('node')?'node':'edge'} blocked`);
  if(!Number.isInteger(metadata.version)||metadata.version<1) errors.push(`${location} metadata.version must be a positive integer`);
  if(!Number.isInteger(metadata.generation)||metadata.generation<1) errors.push(`${location} metadata.generation must be a positive integer`);
  else if(Number.isInteger(graphGeneration)&&metadata.generation!==graphGeneration) errors.push(`${location} metadata.generation must equal graph generation`);
  if(!isIso(metadata.valid_from)) errors.push(`${location} metadata.valid_from must be an ISO instant`);
  if(!(metadata.valid_to===null||isIso(metadata.valid_to))) errors.push(`${location} metadata.valid_to must be null or an ISO instant`);
  if(isIso(metadata.valid_from)&&isIso(metadata.valid_to)&&Date.parse(metadata.valid_to)<Date.parse(metadata.valid_from)) errors.push(`${location} metadata validity window reversed`);
  if(!isPlainObject(metadata.provenance)) errors.push(`${location} metadata.provenance must be a plain object`);
  if(!Array.isArray(metadata.evidence_refs)) errors.push(`${location} metadata.evidence_refs must be an array`);
  else {
    const seen=new Set();
    for(const ref of metadata.evidence_refs){
      if(typeof ref!=='string'||!ENTITY_ID.test(ref)) errors.push(`${location} metadata.evidence_refs contains invalid reference`);
      else if(seen.has(ref)) errors.push(`${location} metadata.evidence_refs contains duplicate reference`);
      else seen.add(ref);
    }
  }
  if(!(metadata.confidence===null||(typeof metadata.confidence==='number'&&metadata.confidence>=0&&metadata.confidence<=1))) errors.push(`${location} metadata.confidence must be null or 0..1`);
  if(!isPlainObject(metadata.uncertainty)) errors.push(`${location} metadata.uncertainty must be a plain object`);
  if(typeof metadata.actor_id!=='string'||!ENTITY_ID.test(metadata.actor_id)) errors.push(`${location} metadata.actor_id invalid`);
  if(!RISK_CLASSES.has(metadata.risk_class)) errors.push(`${location} metadata.risk_class must be S0..S5`);
  if(typeof metadata.content_hash!=='string'||!HASH.test(metadata.content_hash)) errors.push(`${location} metadata.content_hash must be sha256 hex`);
  if(!isPlainObject(metadata.freshness)) errors.push(`${location} metadata.freshness must be a plain object`);
  if(!isPlainObject(metadata.supersession)) errors.push(`${location} metadata.supersession must be a plain object`);
}

export function validateLivingProductGraph(candidate){
  const errors=[];
  if(!isPlainObject(candidate)) return Object.freeze({ok:false,errors:Object.freeze(['graph must be a plain object'])});
  rejectUnknown(candidate,GRAPH_KEYS,'graph',errors);
  if(candidate.schema!==LIVING_PRODUCT_GRAPH_SCHEMA) errors.push(`schema must equal ${LIVING_PRODUCT_GRAPH_SCHEMA}`);
  const projectId=typeof candidate.project_id==='string'?candidate.project_id.trim():'';
  if(!projectId) errors.push('project_id is required');
  else if(!ENTITY_ID.test(projectId)) errors.push('project_id invalid');
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
    rejectUnknown(node,NODE_KEYS,location,errors);
    if(typeof node.node_id!=='string'||!ENTITY_ID.test(node.node_id)) errors.push(`${location} node_id invalid`);
    else if(nodeIds.has(node.node_id)) errors.push(`${location} duplicate node_id`);
    else nodeIds.add(node.node_id);
    if(!LPG_NODE_TYPES.includes(node.type)) errors.push(`${location} type is not in the frozen vocabulary`);
    if(!isPlainObject(node.data)) errors.push(`${location} data must be a plain object`);
    validateMetadata(node.metadata,{projectId,graphGeneration:candidate.generation,location},errors);
  }

  const edgeIds=new Set();
  for(const [index,edge] of edges.entries()){
    const location=`edge[${index}]`;
    if(!isPlainObject(edge)){errors.push(`${location} must be a plain object`);continue;}
    rejectUnknown(edge,EDGE_KEYS,location,errors);
    if(typeof edge.edge_id!=='string'||!ENTITY_ID.test(edge.edge_id)) errors.push(`${location} edge_id invalid`);
    else if(edgeIds.has(edge.edge_id)) errors.push(`${location} duplicate edge_id`);
    else edgeIds.add(edge.edge_id);
    if(typeof edge.from_id!=='string'||!ENTITY_ID.test(edge.from_id)||typeof edge.to_id!=='string'||!ENTITY_ID.test(edge.to_id)) errors.push(`${location} edge endpoint identity invalid`);
    if(!nodeIds.has(edge.from_id)||!nodeIds.has(edge.to_id)||edge.from_id===edge.to_id) errors.push(`${location} edge endpoints must be distinct in-project nodes`);
    if(!LPG_EDGE_RELATIONS.includes(edge.relation)) errors.push(`${location} relation is not in the frozen vocabulary`);
    if(!LPG_CAUSAL_SEMANTICS.includes(edge.causal_semantics)) errors.push(`${location} causal_semantics is not in the frozen vocabulary`);
    validateMetadata(edge.metadata,{projectId,graphGeneration:candidate.generation,location},errors);
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
      rejectMechanismEscalation(result,'PersistenceBackend.verifyIntegrity');
      if(!result||typeof result!=='object'||Array.isArray(result)||typeof result.status!=='string') throw new TypeError('PersistenceBackend.verifyIntegrity returned invalid result');
      if(!INTEGRITY_STATUSES.has(result.status)) throw new TypeError('PersistenceBackend.verifyIntegrity status must be PASS, FAIL or NOT_PROVEN');
      if(result.project_id!==projectId) throw new DOMException('cross-project persistence integrity result blocked','SecurityError');
      return Object.freeze({...structuredClone(result),verification_scope:'PERSISTENCE_MECHANISM_INTEGRITY',canonical_evidence:false,authority_effect:'NONE',release_authority:false,production_authority:false,certification_authority:false});
    },
    async exportProject(projectId){
      projectId=ensureProject(projectId);
      const exported=await backend.exportProject(projectId);
      rejectMechanismEscalation(exported,'PersistenceBackend.exportProject',0,{skipKeys:new Set(['graph'])});
      if(!exported||typeof exported!=='object'||Array.isArray(exported)||exported.project_id!==projectId) throw new DOMException('cross-project graph export blocked','SecurityError');
      if(exported.graph!==null&&exported.graph!==undefined) verifyLoaded(projectId,exported.graph);
      return Object.freeze({...structuredClone(exported),export_scope:'PERSISTENCE_MIGRATION_EXPORT',canonical_evidence:false,authority_effect:'NONE',release_authority:false,production_authority:false,certification_authority:false});
    },
  };
  return Object.freeze(api);
}
