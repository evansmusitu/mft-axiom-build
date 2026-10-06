import {assertLivingProductGraph} from './living_product_graph.js';

const PROJECT_SCHEMA='musitu.axiom.project.v1';
const OUTCOME_SCHEMA='musitu.axiom.outcome-contract.v1';
const HASH=/^[a-f0-9]{64}$/i;
const OUTCOME_CONTRACT_KEYS=new Set(['schema','project_id','contract_id','contract_sha256','project_object_id','title','outcome','success_criteria','constraints','execution_boundary','supersedes_contract_id','created_at','created_by']);
const OUTCOME_CONSTRAINT_KEYS=new Set(['privacy','evidence','autonomy','approval','deadline','compute_budget']);
const APPROVAL_RECEIPT_KEYS=new Set(['receipt_id','edge_id','contract_id','contract_sha256','provenance']);
const APPROVAL_PROVENANCE_KEYS=new Set(['source','actor_id','created_at']);
const clean=(value,max=4000)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);
const isPlainObject=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
function rejectUnknownKeys(value,allowed,label){const extra=Object.keys(value).filter(key=>!allowed.has(key));if(extra.length)throw new DOMException(label+' contains unsupported fields: '+extra.join(','),'SecurityError');}
function validateConstraintTypes(constraints){
  for(const key of ['privacy','evidence','autonomy','approval','deadline']){
    const value=constraints[key];
    if(value!==null&&value!==undefined&&typeof value!=='string') throw new TypeError('Outcome Contract constraint '+key+' must be a string or null');
  }
  const budget=constraints.compute_budget;
  if(budget!==null&&budget!==undefined&&(typeof budget!=='number'||!Number.isFinite(budget)||budget<0)) throw new TypeError('Outcome Contract constraint compute_budget must be a finite non-negative number or null');
}
function canonical(value){
  if(Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if(value&&typeof value==='object') return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
async function sha256(value){
  const bytes=new TextEncoder().encode(canonical(value));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');
}
const stable=(value,max=120)=>clean(value,max).replace(/[^a-zA-Z0-9_-]+/g,'_').replace(/^_+|_+$/g,'')||'unknown';

async function metadata({projectId,actorId,at,data,evidenceRefs=[],generation}){
  return {
    project_id:projectId,
    version:1,
    generation,
    valid_from:at,
    valid_to:null,
    provenance:{source:'outcome-contract-compiler',actor_id:actorId,compiled_at:at},
    evidence_refs:[...new Set(evidenceRefs)],
    confidence:1,
    uncertainty:{kind:'SOURCE_CONTRACT_BOUND',measurement_state:'NOT_PROVEN'},
    actor_id:actorId,
    risk_class:'S0',
    content_hash:await sha256(data),
    freshness:{as_of:at},
    supersession:{state:'CURRENT',supersedes:[]},
  };
}

async function edge({id,fromId,toId,relation,projectId,actorId,at,generation,evidenceRefs,causalSemantics='NONE'}){
  const data={from_id:fromId,to_id:toId,relation,causal_semantics:causalSemantics};
  return {
    edge_id:id,
    from_id:fromId,
    to_id:toId,
    relation,
    causal_semantics:causalSemantics,
    metadata:await metadata({projectId,actorId,at,data,evidenceRefs,generation}),
  };
}

export async function compileObjectiveOutcomeGraph({project,contract,contractVerified,approval=null,generation,actorId,at=new Date().toISOString()}={}){
  if(!isPlainObject(project)||project.schema!==PROJECT_SCHEMA) throw new TypeError('qualified Project record required');
  if(!isPlainObject(contract)||contract.schema!==OUTCOME_SCHEMA) throw new TypeError('qualified Outcome Contract required');
  rejectUnknownKeys(contract,OUTCOME_CONTRACT_KEYS,'Outcome Contract');
  if(contract.project_id!==project.project_id) throw new DOMException('cross-project outcome contract blocked','SecurityError');
  if(contractVerified!==true) throw new DOMException('contract integrity must be verified','DataError');
  if(typeof contract.contract_sha256!=='string'||!HASH.test(contract.contract_sha256)) throw new TypeError('verified Outcome Contract sha256 required');
  if(!Number.isInteger(generation)||generation<1) throw new TypeError('generation must be a positive integer');
  actorId=clean(actorId,120);
  if(!actorId) throw new TypeError('actorId required');
  if(!Number.isFinite(Date.parse(at))) throw new TypeError('at must be an ISO instant');
  if(!Array.isArray(contract.success_criteria)||!contract.success_criteria.length) throw new TypeError('Outcome Contract success criteria required');
  if(!isPlainObject(contract.constraints)) throw new TypeError('Outcome Contract constraints required');
  rejectUnknownKeys(contract.constraints,OUTCOME_CONSTRAINT_KEYS,'Outcome Contract constraints');
  validateConstraintTypes(contract.constraints);
  if(approval!==null){
    if(!isPlainObject(approval)) throw new TypeError('approval receipt must bind the verified Outcome Contract');
    rejectUnknownKeys(approval,APPROVAL_RECEIPT_KEYS,'approval receipt');
    if(typeof approval.receipt_id!=='string'||!clean(approval.receipt_id,180)||typeof approval.edge_id!=='string'||!clean(approval.edge_id,180)) throw new TypeError('approval receipt receipt_id and edge_id are required');
    if(approval.contract_id!==contract.contract_id||approval.contract_sha256!==contract.contract_sha256) throw new TypeError('approval receipt must bind the verified Outcome Contract');
    if(!isPlainObject(approval.provenance)) throw new TypeError('approval provenance required');
    rejectUnknownKeys(approval.provenance,APPROVAL_PROVENANCE_KEYS,'approval provenance');
    if(typeof approval.provenance.source!=='string'||!clean(approval.provenance.source,180)||typeof approval.provenance.actor_id!=='string'||!clean(approval.provenance.actor_id,120)||typeof approval.provenance.created_at!=='string'||!Number.isFinite(Date.parse(approval.provenance.created_at))) throw new TypeError('approval provenance source actor_id and created_at are required');
  }

  const projectId=project.project_id;
  const evidenceRefs=[`contract:${contract.contract_id}`,`sha256:${contract.contract_sha256}`];
  if(approval?.receipt_id) evidenceRefs.push(`approval:${approval.receipt_id}`);
  const nodes=[];
  const edges=[];
  const objectiveId=`lpg_objective_${stable(contract.contract_id)}`;
  const objectiveData={
    title:clean(contract.title,180),
    objective:clean(contract.outcome,4000),
    project_goal:clean(project.goal,4000),
    contract_id:contract.contract_id,
    contract_sha256:contract.contract_sha256,
    approval_state:approval?'APPROVED_POLICY_INTENT':'NOT_APPROVED',
    execution_boundary:contract.execution_boundary,
    external_execution_authority:false,
  };
  nodes.push({node_id:objectiveId,type:'Objective',data:objectiveData,metadata:await metadata({projectId,actorId,at,data:objectiveData,evidenceRefs,generation})});

  for(const [index,criterionRaw] of contract.success_criteria.entries()){
    if(typeof criterionRaw!=='string') throw new TypeError('Outcome Contract success criteria must be strings');
    const criterion=clean(criterionRaw,1000);
    if(!criterion) throw new TypeError('Outcome Contract success criteria cannot be empty');
    const nodeId=`lpg_outcome_${stable(contract.contract_id)}_${index+1}`;
    const data={criterion,index:index+1,measurement_state:'NOT_PROVEN',observed_value:null,success_state:'NOT_PROVEN'};
    nodes.push({node_id:nodeId,type:'OutcomeMetric',data,metadata:await metadata({projectId,actorId,at,data,evidenceRefs,generation})});
    edges.push(await edge({id:`lpg_edge_measure_${stable(contract.contract_id)}_${index+1}`,fromId:objectiveId,toId:nodeId,relation:'MEASURED_BY',projectId,actorId,at,generation,evidenceRefs}));
  }

  const constraints=[
    ['privacy',contract.constraints.privacy],
    ['evidence',contract.constraints.evidence],
    ['autonomy',contract.constraints.autonomy],
    ['approval',contract.constraints.approval],
    ['deadline',contract.constraints.deadline],
    ['compute_budget',contract.constraints.compute_budget],
  ].filter(([,value])=>value!==null&&value!==undefined&&String(value).trim()!=='');
  for(const [index,[key,value]] of constraints.entries()){
    const nodeId=`lpg_constraint_${stable(contract.contract_id)}_${stable(key)}`;
    const data={constraint:key,value,source:'OutcomeContract.constraints'};
    nodes.push({node_id:nodeId,type:'Constraint',data,metadata:await metadata({projectId,actorId,at,data,evidenceRefs,generation})});
    edges.push(await edge({id:`lpg_edge_constraint_${stable(contract.contract_id)}_${index+1}`,fromId:objectiveId,toId:nodeId,relation:'GOVERNED_BY',projectId,actorId,at,generation,evidenceRefs}));
  }

  const evidenceId=`lpg_evidence_contract_${stable(contract.contract_id)}`;
  const evidenceData={kind:'OutcomeContract',contract_id:contract.contract_id,sha256:contract.contract_sha256,integrity:'VERIFIED',project_object_id:contract.project_object_id??null};
  nodes.push({node_id:evidenceId,type:'EvidenceRef',data:evidenceData,metadata:await metadata({projectId,actorId,at,data:evidenceData,evidenceRefs,generation})});
  edges.push(await edge({id:`lpg_edge_evidence_${stable(contract.contract_id)}`,fromId:objectiveId,toId:evidenceId,relation:'JUSTIFIED_BY',projectId,actorId,at,generation,evidenceRefs}));

  if(approval){
    const decisionId=`lpg_decision_${stable(approval.receipt_id)}`;
    const decisionData={receipt_id:approval.receipt_id,contract_id:contract.contract_id,approval_state:'RECORDED',authority_effect:'POLICY_INTENT_ONLY',external_execution_authority:false,provenance:approval.provenance??null};
    nodes.push({node_id:decisionId,type:'Decision',data:decisionData,metadata:await metadata({projectId,actorId,at,data:decisionData,evidenceRefs,generation})});
    edges.push(await edge({id:`lpg_edge_approval_${stable(approval.receipt_id)}`,fromId:objectiveId,toId:decisionId,relation:'JUSTIFIED_BY',projectId,actorId,at,generation,evidenceRefs}));
    edges.push(await edge({id:`lpg_edge_approval_evidence_${stable(approval.receipt_id)}`,fromId:decisionId,toId:evidenceId,relation:'REFERENCES',projectId,actorId,at,generation,evidenceRefs}));
  }

  const graph={schema:'musitu.axiom.living-product-graph.v1',project_id:projectId,generation,impact_state:'NOT_PROVEN',nodes,edges};
  assertLivingProductGraph(graph);
  return graph;
}

export function createProjectProductIntelligenceBridge({projectStore,outcomeStore,projectFacade,persistence,actorId='local-user',clock=()=>new Date().toISOString()}={}){
  if(!projectStore||typeof projectStore.getProject!=='function') throw new TypeError('qualified ProjectStore.getProject required');
  if(!outcomeStore||typeof outcomeStore.get!=='function'||typeof outcomeStore.verify!=='function'||typeof outcomeStore.approval!=='function') throw new TypeError('qualified OutcomeContractStore required');
  if(!projectFacade?.store||projectFacade.store!==projectStore) throw new TypeError('Project facade must bind the same ProjectStore');
  if(!persistence||typeof persistence.commitForProject!=='function') throw new TypeError('Living Product Graph persistence seam required');
  actorId=clean(actorId,120);
  if(!actorId) throw new TypeError('actorId required');

  return Object.freeze({
    async compileOutcomeContract(contractId,{expectedGeneration=0}={}){
      contractId=clean(contractId,180);
      if(!contractId) throw new TypeError('contractId required');
      if(!Number.isInteger(expectedGeneration)||expectedGeneration<0) throw new TypeError('expectedGeneration must be a non-negative integer');
      const contract=await outcomeStore.get(contractId);
      const verified=await outcomeStore.verify(contractId);
      if(verified!==true) throw new DOMException('contract integrity must be verified','DataError');
      const project=await projectStore.getProject(contract.project_id);
      if(!project) throw new DOMException('project not found','NotFoundError');
      const approval=await outcomeStore.approval(projectFacade,contractId);
      const graph=await compileObjectiveOutcomeGraph({project,contract,contractVerified:true,approval,generation:expectedGeneration+1,actorId,at:clock()});
      return persistence.commitForProject(project.project_id,graph,{expectedGeneration});
    },
  });
}
