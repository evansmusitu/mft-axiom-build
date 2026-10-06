import {LPG_NODE_TYPES,assertLivingProductGraph} from './living_product_graph.js';

export const PRODUCT_COMPILER_IR_SCHEMA='musitu.axiom.product-compiler-ir.v1';
export const PRODUCT_COMPILER_RECONCILIATION_SCHEMA='musitu.axiom.product-compiler-reconciliation.v1';
export const PRODUCT_COMPILER_INFERENCE_SCHEMA='musitu.axiom.product-compiler-inference.v1';

const HASH=/^[a-f0-9]{64}$/i;
const BINDING_KEYS=new Set(['binding_id','node_id','region','external_sha256']);
const OBSERVED_BINDING_KEYS=new Set(['binding_id','external_sha256']);
const OBSERVATION_KEYS=new Set(['observation_id','type','data','source','confidence']);
const OBSERVATION_SOURCE_KEYS=new Set(['kind','uri']);
const FORBIDDEN_CREDENTIAL_KEY=/^(?:access|refresh|id)?_?token$|authorization|api_?key|password|private_?key|client_?secret|secret$/i;
const FORBIDDEN_AUTHORITY_KEY=/^(?:release|production|certification|policy|identity)_authority$|^canonical_evidence$|^allow_(?:release|production)$|^certified$|^authority_effect$/i;
const isPlainObject=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const clean=(value,max=1000)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);
const stableId=(value,max=180)=>clean(value,max).replace(/[^A-Za-z0-9_.:-]+/g,'_').replace(/^_+|_+$/g,'')||'unknown';
function rejectUnknownKeys(value,allowed,label){const extra=Object.keys(value).filter(key=>!allowed.has(key));if(extra.length)throw new DOMException(label+' contains unsupported fields: '+extra.join(','),'SecurityError');}
function rejectSensitivePayload(value,path='payload',depth=0){
  if(depth>10) throw new RangeError(path+' exceeds nesting limit');
  if(value===null||value===undefined||typeof value==='string'||typeof value==='boolean') return;
  if(typeof value==='number'){if(!Number.isFinite(value))throw new TypeError(path+' number must be finite');return;}
  if(Array.isArray(value)){for(const [index,item] of value.entries())rejectSensitivePayload(item,path+'['+index+']',depth+1);return;}
  if(!isPlainObject(value)) throw new TypeError(path+' must be JSON-compatible');
  for(const [key,child] of Object.entries(value)){
    if(FORBIDDEN_CREDENTIAL_KEY.test(key)) throw new DOMException(path+'.'+key+' contains forbidden credential material','SecurityError');
    if(FORBIDDEN_AUTHORITY_KEY.test(key)) throw new DOMException(path+'.'+key+' contains forbidden authority material','SecurityError');
    rejectSensitivePayload(child,path+'.'+key,depth+1);
  }
}

function canonical(value){
  if(Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if(value&&typeof value==='object') return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
async function sha256(value){
  const bytes=new TextEncoder().encode(typeof value==='string'?value:canonical(value));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');
}
function uniqueSorted(values){return [...new Set(values)].sort();}
function assertCompilerIR(ir,label='compiler IR'){
  if(!isPlainObject(ir)||ir.schema!==PRODUCT_COMPILER_IR_SCHEMA) throw new TypeError(`${label} must be ${PRODUCT_COMPILER_IR_SCHEMA}`);
  if(typeof ir.project_id!=='string'||!ir.project_id) throw new TypeError(`${label} project_id required`);
  if(!Array.isArray(ir.units)||!Array.isArray(ir.relations)||!Array.isArray(ir.bindings)) throw new TypeError(`${label} units, relations and bindings required`);
  if(typeof ir.ir_sha256!=='string'||!HASH.test(ir.ir_sha256)) throw new TypeError(`${label} ir_sha256 required`);
  return ir;
}
async function assertCompilerIRIntegrity(ir,label='compiler IR'){
  assertCompilerIR(ir,label);
  for(const [index,unit] of ir.units.entries()){
    if(!isPlainObject(unit)||typeof unit.unit_sha256!=='string'||!HASH.test(unit.unit_sha256)) throw new TypeError(`${label} unit[${index}] unit_sha256 required`);
    const {unit_sha256,...body}=unit;
    if(await sha256(body)!==unit_sha256) throw new DOMException(`${label} unit[${index}] integrity hash mismatch`,'DataError');
  }
  for(const [index,relation] of ir.relations.entries()){
    if(!isPlainObject(relation)||typeof relation.relation_sha256!=='string'||!HASH.test(relation.relation_sha256)) throw new TypeError(`${label} relation[${index}] relation_sha256 required`);
    const {relation_sha256,...body}=relation;
    if(await sha256(body)!==relation_sha256) throw new DOMException(`${label} relation[${index}] integrity hash mismatch`,'DataError');
  }
  const {ir_sha256,...body}=ir;
  if(await sha256(body)!==ir_sha256) throw new DOMException(`${label} integrity hash mismatch`,'DataError');
  return ir;
}
function normalizeBindings(bindings,nodeIds){
  if(!Array.isArray(bindings)) throw new TypeError('bindings must be an array');
  const ids=new Set();
  return bindings.map((binding,index)=>{
    if(!isPlainObject(binding)) throw new TypeError(`binding[${index}] must be a plain object`);
    rejectUnknownKeys(binding,BINDING_KEYS,`binding[${index}]`);
    for(const key of BINDING_KEYS) if(typeof binding[key]!=='string') throw new TypeError(`binding[${index}] ${key} must be a string`);
    const binding_id=clean(binding.binding_id,180),node_id=clean(binding.node_id,180),region=clean(binding.region,1000),external_sha256=clean(binding.external_sha256,64).toLowerCase();
    if(!binding_id||ids.has(binding_id)) throw new TypeError(`binding[${index}] binding_id must be unique and non-empty`);
    ids.add(binding_id);
    if(!nodeIds.has(node_id)) throw new TypeError(`binding[${index}] node_id must reference an IR unit`);
    if(!region) throw new TypeError(`binding[${index}] region required`);
    if(!HASH.test(external_sha256)) throw new TypeError(`binding[${index}] external_sha256 must be sha256 hex`);
    return {binding_id,node_id,region,external_sha256,authority:'DECLARED_BINDING'};
  }).sort((a,b)=>a.binding_id.localeCompare(b.binding_id));
}
function semanticNodeBody(node){
  return {
    node_id:node.node_id,
    type:node.type,
    data:node.data,
    provenance:node.metadata?.provenance??null,
    evidence_refs:Array.isArray(node.metadata?.evidence_refs)?[...node.metadata.evidence_refs].sort():[],
    confidence:node.metadata?.confidence??null,
    uncertainty:node.metadata?.uncertainty??null,
    risk_class:node.metadata?.risk_class??null,
    content_hash:node.metadata?.content_hash??null,
    supersession:node.metadata?.supersession??null,
  };
}
function semanticEdgeBody(edge){
  return {
    edge_id:edge.edge_id,
    from_id:edge.from_id,
    to_id:edge.to_id,
    relation:edge.relation,
    causal_semantics:edge.causal_semantics,
    provenance:edge.metadata?.provenance??null,
    evidence_refs:Array.isArray(edge.metadata?.evidence_refs)?[...edge.metadata.evidence_refs].sort():[],
    confidence:edge.metadata?.confidence??null,
    uncertainty:edge.metadata?.uncertainty??null,
    risk_class:edge.metadata?.risk_class??null,
    content_hash:edge.metadata?.content_hash??null,
    supersession:edge.metadata?.supersession??null,
  };
}

export async function compileProductIR(graph,{bindings=[],compilerVersion='1.0.0'}={}){
  assertLivingProductGraph(graph);
  compilerVersion=clean(compilerVersion,80);
  if(!compilerVersion) throw new TypeError('compilerVersion required');

  const units=[];
  for(const node of [...graph.nodes].sort((a,b)=>a.node_id.localeCompare(b.node_id))){
    const body=semanticNodeBody(node);
    units.push({...body,unit_sha256:await sha256(body)});
  }
  const nodeIds=new Set(units.map(unit=>unit.node_id));
  const relations=[];
  for(const edge of [...graph.edges].sort((a,b)=>a.edge_id.localeCompare(b.edge_id))){
    const body=semanticEdgeBody(edge);
    relations.push({...body,relation_sha256:await sha256(body)});
  }
  const normalizedBindings=normalizeBindings(bindings,nodeIds);
  const body={
    schema:PRODUCT_COMPILER_IR_SCHEMA,
    project_id:graph.project_id,
    source_lpg_generation:graph.generation,
    source_impact_state:graph.impact_state,
    compiler_version:compilerVersion,
    units,
    relations,
    bindings:normalizedBindings,
    round_trip_policy:'DECLARED_BINDINGS_ONLY',
    unbound_change_policy:'DIFF_REQUIRES_RECONCILIATION',
    incremental_policy:'CONTENT_ADDRESSED_IMPACT_SET',
  };
  return Object.freeze({...body,ir_sha256:await sha256(body)});
}

function relationMap(ir){
  const map=new Map();
  for(const relation of ir.relations){
    if(!map.has(relation.from_id)) map.set(relation.from_id,[]);
    map.get(relation.from_id).push(relation.to_id);
  }
  for(const values of map.values()) values.sort();
  return map;
}
function downstream(startIds,relationMaps){
  const seen=new Set(startIds),queue=[...startIds];
  while(queue.length){
    const id=queue.shift();
    for(const map of relationMaps){
      for(const next of map.get(id)??[]){
        if(!seen.has(next)){seen.add(next);queue.push(next);}
      }
    }
  }
  return [...seen].sort();
}

export async function diffProductIR(prior,next){
  await assertCompilerIRIntegrity(prior,'prior compiler IR');
  await assertCompilerIRIntegrity(next,'next compiler IR');
  if(prior.project_id!==next.project_id) throw new DOMException('cross-project compiler diff blocked','SecurityError');
  if(prior.compiler_version!==next.compiler_version) throw new TypeError('compiler version change requires explicit migration');
  if(prior.ir_sha256===next.ir_sha256){
    return Object.freeze({status:'UNCHANGED',operations:Object.freeze([]),impact_state:'COMPUTED',impact_node_ids:Object.freeze([]),prior_ir_sha256:prior.ir_sha256,next_ir_sha256:next.ir_sha256});
  }

  const before=new Map(prior.units.map(unit=>[unit.node_id,unit]));
  const after=new Map(next.units.map(unit=>[unit.node_id,unit]));
  const operations=[];
  for(const id of uniqueSorted([...before.keys(),...after.keys()])){
    const oldUnit=before.get(id),newUnit=after.get(id);
    if(!oldUnit) operations.push({operation:'ADD',node_id:id,before_sha256:null,after_sha256:newUnit.unit_sha256});
    else if(!newUnit) operations.push({operation:'REMOVE',node_id:id,before_sha256:oldUnit.unit_sha256,after_sha256:null});
    else if(oldUnit.unit_sha256!==newUnit.unit_sha256) operations.push({operation:'UPDATE',node_id:id,before_sha256:oldUnit.unit_sha256,after_sha256:newUnit.unit_sha256});
  }

  const priorRelations=new Map(prior.relations.map(relation=>[relation.edge_id,relation]));
  const nextRelations=new Map(next.relations.map(relation=>[relation.edge_id,relation]));
  const relationOperations=[];
  for(const id of uniqueSorted([...priorRelations.keys(),...nextRelations.keys()])){
    const oldRelation=priorRelations.get(id),newRelation=nextRelations.get(id);
    if(!oldRelation) relationOperations.push({operation:'ADD',edge_id:id,before_sha256:null,after_sha256:newRelation.relation_sha256,from_id:newRelation.from_id,to_id:newRelation.to_id});
    else if(!newRelation) relationOperations.push({operation:'REMOVE',edge_id:id,before_sha256:oldRelation.relation_sha256,after_sha256:null,from_id:oldRelation.from_id,to_id:oldRelation.to_id});
    else if(oldRelation.relation_sha256!==newRelation.relation_sha256) relationOperations.push({operation:'UPDATE',edge_id:id,before_sha256:oldRelation.relation_sha256,after_sha256:newRelation.relation_sha256,from_id:newRelation.from_id,to_id:newRelation.to_id});
  }

  const priorBindings=new Map(prior.bindings.map(binding=>[binding.binding_id,binding]));
  const nextBindings=new Map(next.bindings.map(binding=>[binding.binding_id,binding]));
  const bindingOperations=[];
  for(const id of uniqueSorted([...priorBindings.keys(),...nextBindings.keys()])){
    const oldBinding=priorBindings.get(id),newBinding=nextBindings.get(id);
    if(!oldBinding) bindingOperations.push({operation:'ADD',binding_id:id,node_id:newBinding.node_id});
    else if(!newBinding) bindingOperations.push({operation:'REMOVE',binding_id:id,node_id:oldBinding.node_id});
    else if(canonical(oldBinding)!==canonical(newBinding)) bindingOperations.push({operation:'UPDATE',binding_id:id,node_id:newBinding.node_id});
  }

  const changedIds=[
    ...operations.map(operation=>operation.node_id),
    ...relationOperations.flatMap(operation=>[operation.from_id,operation.to_id]),
    ...bindingOperations.map(operation=>operation.node_id),
  ];
  if(!operations.length&&!relationOperations.length&&!bindingOperations.length){
    return Object.freeze({status:'UNCHANGED',operations:Object.freeze([]),relation_operations:Object.freeze([]),binding_operations:Object.freeze([]),impact_state:'COMPUTED',impact_node_ids:Object.freeze([]),prior_ir_sha256:prior.ir_sha256,next_ir_sha256:next.ir_sha256});
  }
  const impactNodeIds=downstream(uniqueSorted(changedIds),[relationMap(prior),relationMap(next)]);
  return Object.freeze({
    status:'CHANGED',
    operations:Object.freeze(operations),
    relation_operations:Object.freeze(relationOperations),
    binding_operations:Object.freeze(bindingOperations),
    impact_state:impactNodeIds.length?'COMPUTED':'NOT_PROVEN',
    impact_node_ids:Object.freeze(impactNodeIds.length?impactNodeIds:['NOT_PROVEN']),
    prior_ir_sha256:prior.ir_sha256,
    next_ir_sha256:next.ir_sha256,
  });
}

export async function reconcileProductIR(ir,observedBindings=[]){
  await assertCompilerIRIntegrity(ir);
  if(!Array.isArray(observedBindings)) throw new TypeError('observedBindings must be an array');
  const observed=new Map();
  for(const [index,item] of observedBindings.entries()){
    if(!isPlainObject(item)) throw new TypeError(`observed binding[${index}] must be a plain object`);
    rejectUnknownKeys(item,OBSERVED_BINDING_KEYS,`observed binding[${index}]`);
    for(const key of OBSERVED_BINDING_KEYS) if(typeof item[key]!=='string') throw new TypeError(`observed binding[${index}] ${key} must be a string`);
    const binding_id=clean(item.binding_id,180),external_sha256=clean(item.external_sha256,64).toLowerCase();
    if(!binding_id||observed.has(binding_id)) throw new TypeError(`observed binding[${index}] binding_id must be unique and non-empty`);
    if(!HASH.test(external_sha256)) throw new TypeError(`observed binding[${index}] external_sha256 must be sha256 hex`);
    observed.set(binding_id,{binding_id,external_sha256});
  }
  const declared=new Map(ir.bindings.map(binding=>[binding.binding_id,binding]));
  const changed=[],missing=[];
  for(const [id,binding] of declared){
    const actual=observed.get(id);
    if(!actual) missing.push(id);
    else if(actual.external_sha256!==binding.external_sha256) changed.push(id);
  }
  const unbound=[...observed.keys()].filter(id=>!declared.has(id)).sort();
  const status=changed.length||missing.length||unbound.length?'DIFF_REQUIRES_RECONCILIATION':'MATCH';
  return Object.freeze({
    schema:PRODUCT_COMPILER_RECONCILIATION_SCHEMA,
    project_id:ir.project_id,
    ir_sha256:ir.ir_sha256,
    status,
    auto_apply:false,
    changed_binding_ids:Object.freeze(changed.sort()),
    missing_binding_ids:Object.freeze(missing.sort()),
    unbound_observed_ids:Object.freeze(unbound),
    authority_effect:'NONE',
  });
}

export async function createInferredGraphPatch({projectId,generation,actorId,at=new Date().toISOString(),observations=[]}={}){
  projectId=clean(projectId,180); actorId=clean(actorId,120);
  if(!projectId) throw new TypeError('projectId required');
  if(!Number.isInteger(generation)||generation<1) throw new TypeError('generation must be a positive integer');
  if(!actorId) throw new TypeError('actorId required');
  if(!Number.isFinite(Date.parse(at))) throw new TypeError('at must be an ISO instant');
  if(!Array.isArray(observations)||!observations.length) throw new TypeError('observations required');

  const ids=new Set(),nodes=[];
  for(const [index,observation] of observations.entries()){
    if(!isPlainObject(observation)) throw new TypeError(`observation[${index}] must be a plain object`);
    rejectUnknownKeys(observation,OBSERVATION_KEYS,`observation[${index}]`);
    if(typeof observation.observation_id!=='string') throw new TypeError(`observation[${index}] observation_id must be a string`);
    const observationId=clean(observation.observation_id,180);
    if(!observationId||ids.has(observationId)) throw new TypeError(`observation[${index}] id must be unique and non-empty`);
    ids.add(observationId);
    if(typeof observation.type!=='string'||!LPG_NODE_TYPES.includes(observation.type)) throw new TypeError(`observation[${index}] type is not in the frozen LPG vocabulary`);
    if(!isPlainObject(observation.data)) throw new TypeError(`observation[${index}] data must be a plain object`);
    rejectSensitivePayload(observation.data,`observation[${index}].data`);
    if(!isPlainObject(observation.source)) throw new TypeError(`observation[${index}] source required`);
    rejectUnknownKeys(observation.source,OBSERVATION_SOURCE_KEYS,`observation[${index}].source`);
    if(typeof observation.source.kind!=='string'||!clean(observation.source.kind,80)||typeof observation.source.uri!=='string'||!clean(observation.source.uri,1000)) throw new TypeError(`observation[${index}] source kind and uri must be strings`);
    if(typeof observation.confidence!=='number'||!Number.isFinite(observation.confidence)||observation.confidence<0||observation.confidence>1) throw new TypeError(`observation[${index}] confidence must be finite 0..1`);
    const data={...structuredClone(observation.data),verification_state:'INFERRED_REQUIRES_VERIFICATION',inference_source:structuredClone(observation.source),observation_id:observationId};
    const metadata={
      project_id:projectId,version:1,generation,valid_from:at,valid_to:null,
      provenance:{source:'reverse-inference',observation_id:observationId,origin:structuredClone(observation.source)},
      evidence_refs:[],confidence:observation.confidence,
      uncertainty:{kind:'REVERSE_INFERENCE',verification_state:'INFERRED_REQUIRES_VERIFICATION'},
      actor_id:actorId,risk_class:'S0',content_hash:await sha256(data),freshness:{as_of:at},supersession:{state:'CURRENT',supersedes:[]},
    };
    nodes.push({node_id:`lpg_inferred_${stableId(observationId)}`,type:observation.type,data,metadata});
  }
  const body={schema:PRODUCT_COMPILER_INFERENCE_SCHEMA,project_id:projectId,generation,status:'INFERRED_REQUIRES_VERIFICATION',authority_effect:'NONE',can_overwrite_verified_nodes:false,nodes:nodes.sort((a,b)=>a.node_id.localeCompare(b.node_id)),edges:[]};
  return Object.freeze({...body,patch_sha256:await sha256(body)});
}
