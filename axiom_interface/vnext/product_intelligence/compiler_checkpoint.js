import {PRODUCT_COMPILER_IR_SCHEMA,assertProductIRIntegrity,diffProductIR} from './product_compiler_ir.js';

export const PRODUCT_COMPILER_CHECKPOINT_SCHEMA='musitu.axiom.product-compiler-checkpoint.v1';
export const PRODUCT_COMPILER_ROLLBACK_SCHEMA='musitu.axiom.product-compiler-rollback-proposal.v1';

const HASH=/^[a-f0-9]{64}$/i;
const RISK_CLASSES=new Set(['S0','S1','S2','S3','S4','S5']);
const CHECKPOINT_INPUT_KEYS=new Set(['projectId','workId','priorIR','nextIR','diff','actorId','riskClass','evidenceRefs','at','authorization']);
const CHECKPOINT_ENVELOPE_KEYS=new Set(['schema','checkpoint_id','project_id','work_id','created_at','actor_id','risk_class','compiler_version','prior_ir_sha256','next_ir_sha256','diff_sha256','diff_status','impact_state','impact_node_ids','authority_effect','rollback_mode','external_execution_authority','production_authority','builder_attested','independent_verification','evidence_refs','prior_ir_snapshot','checkpoint_sha256','evidence_object','artifact','artifact_verification','artifact_package']);
const isPlainObject=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const clean=(value,max=1000)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);

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
function assertIR(ir,label){
  if(!isPlainObject(ir)||ir.schema!==PRODUCT_COMPILER_IR_SCHEMA) throw new TypeError(`${label} must be ${PRODUCT_COMPILER_IR_SCHEMA}`);
  if(typeof ir.project_id!=='string'||!ir.project_id.trim()) throw new TypeError(`${label} project_id required`);
  if(typeof ir.ir_sha256!=='string'||!HASH.test(ir.ir_sha256)) throw new TypeError(`${label} ir_sha256 required`);
  return ir;
}
function normalizeAt(value){
  const time=Date.parse(value??'');
  if(!Number.isFinite(time)) throw new TypeError('at must be an ISO instant');
  return new Date(time).toISOString();
}
function checkpointHashBody(checkpoint){
  return {
    schema:checkpoint.schema,
    checkpoint_id:checkpoint.checkpoint_id,
    project_id:checkpoint.project_id,
    work_id:checkpoint.work_id,
    created_at:checkpoint.created_at,
    actor_id:checkpoint.actor_id,
    risk_class:checkpoint.risk_class,
    compiler_version:checkpoint.compiler_version,
    prior_ir_sha256:checkpoint.prior_ir_sha256,
    next_ir_sha256:checkpoint.next_ir_sha256,
    diff_sha256:checkpoint.diff_sha256,
    diff_status:checkpoint.diff_status,
    impact_state:checkpoint.impact_state,
    impact_node_ids:checkpoint.impact_node_ids,
    authority_effect:checkpoint.authority_effect,
    rollback_mode:checkpoint.rollback_mode,
    external_execution_authority:checkpoint.external_execution_authority,
    production_authority:checkpoint.production_authority,
    builder_attested:checkpoint.builder_attested,
    independent_verification:checkpoint.independent_verification,
    evidence_refs:checkpoint.evidence_refs,
    prior_ir_snapshot:checkpoint.prior_ir_snapshot,
  };
}
async function resolveServices(services={}){
  const artifactApi=services.artifactApi??await import('../fa14_evidence_native_engine.js');
  const evidenceApi=services.evidenceApi??await import('../foundation_contracts.js');
  for(const name of ['createArtifactRecord','addArtifactVersion','verifyArtifact','buildArtifactOutcomePackage']){
    if(typeof artifactApi?.[name]!=='function') throw new TypeError(`artifactApi.${name} required`);
  }
  if(typeof evidenceApi?.assertAxiomObject!=='function') throw new TypeError('evidenceApi.assertAxiomObject required');
  return {artifactApi,evidenceApi};
}

export async function createCompilerCheckpoint(input={},services={}){
  if(!isPlainObject(input)) throw new TypeError('checkpoint input must be a plain object');
  const extra=Object.keys(input).filter(key=>!CHECKPOINT_INPUT_KEYS.has(key));
  if(extra.length) throw new DOMException('checkpoint input contains unsupported fields: '+extra.join(','),'SecurityError');
  if(typeof input.projectId!=='string') throw new TypeError('projectId must be a string');
  if(input.workId!==undefined&&typeof input.workId!=='string') throw new TypeError('workId must be a string');
  if(typeof input.actorId!=='string') throw new TypeError('actorId must be a string');
  if(input.evidenceRefs!==undefined&&(!Array.isArray(input.evidenceRefs)||input.evidenceRefs.some(value=>typeof value!=='string'))) throw new TypeError('evidence references must be strings');
  const {
    projectId,workId='',priorIR,nextIR,diff,actorId,riskClass='S1',evidenceRefs=[],at=new Date().toISOString(),authorization=null,
  }=input;
  const project_id=clean(projectId,180),work_id=clean(workId,180),actor_id=clean(actorId,180);
  if(!project_id) throw new TypeError('projectId required');
  if(!actor_id) throw new TypeError('actorId required');
  if(!RISK_CLASSES.has(riskClass)) throw new TypeError('riskClass must be S0..S5');
  if(['S4','S5'].includes(riskClass)&&authorization) throw new DOMException('checkpoint cannot self-authorize S4/S5 execution','NotAllowedError');
  if(!Array.isArray(evidenceRefs)||!evidenceRefs.length) throw new TypeError('at least one evidence reference required');
  const evidence_refs=[...new Set(evidenceRefs.map(value=>clean(value,180)).filter(Boolean))];
  if(!evidence_refs.length) throw new TypeError('at least one evidence reference required');
  const created_at=normalizeAt(at);

  assertIR(priorIR,'priorIR');
  assertIR(nextIR,'nextIR');
  if(priorIR.project_id!==project_id||nextIR.project_id!==project_id) throw new DOMException('cross-project compiler checkpoint blocked','SecurityError');
  if(priorIR.compiler_version!==nextIR.compiler_version) throw new TypeError('compiler version mismatch requires migration before checkpoint');
  await assertProductIRIntegrity(priorIR,'priorIR');
  await assertProductIRIntegrity(nextIR,'nextIR');
  if(!isPlainObject(diff)) throw new TypeError('compiler diff required');
  if(diff.prior_ir_sha256!==priorIR.ir_sha256||diff.next_ir_sha256!==nextIR.ir_sha256) throw new TypeError('diff hash binding mismatch');
  if(!['CHANGED','UNCHANGED'].includes(diff.status)) throw new TypeError('compiler diff status invalid');
  if(!['COMPUTED','NOT_PROVEN'].includes(diff.impact_state)) throw new TypeError('compiler diff impact state invalid');
  const expected_diff=await diffProductIR(priorIR,nextIR);
  if(canonical(diff)!==canonical(expected_diff)) throw new DOMException('compiler diff semantic mismatch','DataError');
  const impact_node_ids=Array.isArray(diff.impact_node_ids)?[...diff.impact_node_ids]:[];
  const diff_sha256=await sha256(diff);
  const seed=await sha256({project_id,prior_ir_sha256:priorIR.ir_sha256,next_ir_sha256:nextIR.ir_sha256,diff_sha256,created_at,actor_id});
  const checkpoint_id=`checkpoint_${seed.slice(0,24)}`;
  const body={
    schema:PRODUCT_COMPILER_CHECKPOINT_SCHEMA,
    checkpoint_id,
    project_id,
    work_id,
    created_at,
    actor_id,
    risk_class:riskClass,
    compiler_version:nextIR.compiler_version,
    prior_ir_sha256:priorIR.ir_sha256,
    next_ir_sha256:nextIR.ir_sha256,
    diff_sha256,
    diff_status:diff.status,
    impact_state:diff.impact_state,
    impact_node_ids,
    authority_effect:'NONE',
    rollback_mode:'PREPARE_ONLY',
    external_execution_authority:false,
    production_authority:false,
    builder_attested:true,
    independent_verification:'NOT_PROVEN',
    evidence_refs,
    prior_ir_snapshot:structuredClone(priorIR),
  };
  const checkpoint_sha256=await sha256(body);

  const {artifactApi,evidenceApi}=await resolveServices(services);
  const evidence_id=`evidence_${checkpoint_sha256.slice(0,24)}`;
  const evidence_object={
    schema:'musitu.axiom.evidence.v1',
    type:'Evidence',
    id:evidence_id,
    version:1,
    created_at,
    updated_at:created_at,
    data:{
      inputs:[{kind:'ProductCompilerIR',sha256:priorIR.ir_sha256},{kind:'ProductCompilerIR',sha256:nextIR.ir_sha256}],
      sources:[...evidence_refs],
      capability_chain:['ProductCompilerIR','CompilerCheckpoint'],
      calculations:[{kind:'compiler-diff',sha256:diff_sha256,status:diff.status,impact_state:diff.impact_state,impact_node_ids:[...impact_node_ids]}],
      actions:[{kind:'CHECKPOINT_CREATED',authority_effect:'NONE',rollback_mode:'PREPARE_ONLY'}],
      policies:['BUILDER_NOT_VERIFIER','NO_SELF_AUTHORIZATION','ROLLBACK_PREPARE_ONLY'],
      approvals:[],
      hashes:[priorIR.ir_sha256,nextIR.ir_sha256,diff_sha256,checkpoint_sha256],
      receipts:[{schema:PRODUCT_COMPILER_CHECKPOINT_SCHEMA,checkpoint_id,checkpoint_sha256}],
      verification:{builder_attested:true,independent_verification:'NOT_PROVEN',publication_execution_allowed:false},
      failures:[],
      timestamps:[created_at],
      versions:[{version:1,checkpoint_sha256}],
    },
  };
  evidenceApi.assertAxiomObject(evidence_object,{expectedType:'Evidence'});

  const artifact=artifactApi.createArtifactRecord({
    artifactId:`artifact:compiler-checkpoint:${checkpoint_id}`,
    projectId:project_id,
    workId:work_id,
    title:`Product Compiler checkpoint ${checkpoint_id}`,
    kind:'product-compiler-checkpoint',
    evidenceRefs:[...evidence_refs,evidence_id],
    provenance:[
      {type:'compiler-ir-prior',ref:`sha256:${priorIR.ir_sha256}`,sha256:priorIR.ir_sha256},
      {type:'compiler-ir-next',ref:`sha256:${nextIR.ir_sha256}`,sha256:nextIR.ir_sha256},
      {type:'compiler-diff',ref:`sha256:${diff_sha256}`,sha256:diff_sha256},
    ],
  });
  artifactApi.addArtifactVersion(artifact,{contentSha256:checkpoint_sha256,summary:`Reversible Product Compiler checkpoint; ${diff.status}; ${diff.impact_state}`});
  const artifact_verification=artifactApi.verifyArtifact(artifact);
  if(artifact_verification?.status!=='PASS_ARTIFACT_LINEAGE_GATE') throw new Error('checkpoint artifact failed AXIOM Artifact lineage gate');
  const artifact_package=artifactApi.buildArtifactOutcomePackage(artifact);
  if(artifact_package?.publication_execution_allowed!==false) throw new Error('checkpoint artifact package attempted publication authority');

  return Object.freeze({...body,checkpoint_sha256,evidence_object,artifact,artifact_verification,artifact_package});
}

export async function verifyCompilerCheckpoint(checkpoint){
  try{
    if(!isPlainObject(checkpoint)||checkpoint.schema!==PRODUCT_COMPILER_CHECKPOINT_SCHEMA) return false;
    if(Object.keys(checkpoint).some(key=>!CHECKPOINT_ENVELOPE_KEYS.has(key))) return false;
    if(typeof checkpoint.checkpoint_sha256!=='string'||!HASH.test(checkpoint.checkpoint_sha256)) return false;
    if(checkpoint.authority_effect!=='NONE'||checkpoint.rollback_mode!=='PREPARE_ONLY'||checkpoint.external_execution_authority!==false||checkpoint.production_authority!==false) return false;
    if(checkpoint.builder_attested!==true||checkpoint.independent_verification!=='NOT_PROVEN') return false;
    await assertProductIRIntegrity(checkpoint.prior_ir_snapshot,'checkpoint prior IR');
    if(checkpoint.prior_ir_snapshot.project_id!==checkpoint.project_id||checkpoint.prior_ir_snapshot.ir_sha256!==checkpoint.prior_ir_sha256) return false;
    return (await sha256(checkpointHashBody(checkpoint)))===checkpoint.checkpoint_sha256;
  }catch{return false;}
}

export async function prepareCompilerRollback(checkpoint,{currentIR,actorId,at=new Date().toISOString()}={}){
  if(!(await verifyCompilerCheckpoint(checkpoint))) throw new DOMException('checkpoint integrity failure','DataError');
  await assertProductIRIntegrity(currentIR,'currentIR');
  if(currentIR.project_id!==checkpoint.project_id) throw new DOMException('cross-project compiler rollback blocked','SecurityError');
  if(currentIR.ir_sha256!==checkpoint.next_ir_sha256) throw new DOMException('current IR does not match checkpoint head','InvalidStateError');
  const actor_id=clean(actorId,180);
  if(!actor_id) throw new TypeError('actorId required');
  const created_at=normalizeAt(at);
  const body={
    schema:PRODUCT_COMPILER_ROLLBACK_SCHEMA,
    project_id:checkpoint.project_id,
    checkpoint_id:checkpoint.checkpoint_id,
    checkpoint_sha256:checkpoint.checkpoint_sha256,
    created_at,
    actor_id,
    expected_current_ir_sha256:checkpoint.next_ir_sha256,
    target_ir_sha256:checkpoint.prior_ir_sha256,
    restore_ir:structuredClone(checkpoint.prior_ir_snapshot),
    execution_mode:'PREPARE_ONLY',
    external_execution_authority:false,
    production_authority:false,
    authority_effect:'NONE',
    required_next_gate:'GOVERNED_WRITE_AUTHORIZATION',
    independent_verification:'NOT_PROVEN',
  };
  return Object.freeze({...body,proposal_sha256:await sha256(body)});
}
