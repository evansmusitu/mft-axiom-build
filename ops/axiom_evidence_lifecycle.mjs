import {canonicalJson,sha256Json,verifyTaskCommitments,verifyExecutionResultCommitment} from '../axiom_interface/vnext/execution_integrity.mjs';
import {executionRecord,requireExecutionId,validateExecutionContract} from '../axiom_interface/vnext/execution_contract.mjs';

// Server-only control-plane capability. There are no model/execution actions,
// provider calls, policy defaults granting erasure, or authorization provisioning.
// Apply the separate schema first; provision one exact tenant/action/Work grant
// through the trusted owner. The authorize callback is server-owned, never JSON.
const TABLES=[
  {
    "key": "works",
    "table": "axiom_ec_works",
    "columns": [
      "tenant_id",
      "work_id",
      "project_id",
      "agent_id",
      "request_sha256",
      "contract_sha256",
      "contract_json",
      "state",
      "expires_at",
      "max_compute_calls",
      "max_provider_calls",
      "compute_calls",
      "provider_calls"
    ],
    "where": "r.tenant_id=?1 AND r.work_id=?2",
    "order": "work_id"
  },
  {
    "key": "projects",
    "table": "axiom_ec_projects",
    "columns": [
      "tenant_id",
      "project_id",
      "state"
    ],
    "where": "r.tenant_id=?1 AND r.project_id=(SELECT project_id FROM axiom_ec_works WHERE tenant_id=?1 AND work_id=?2)",
    "order": "project_id"
  },
  {
    "key": "agents",
    "table": "axiom_ec_agents",
    "columns": [
      "tenant_id",
      "agent_id",
      "state"
    ],
    "where": "r.tenant_id=?1 AND r.agent_id=(SELECT agent_id FROM axiom_ec_works WHERE tenant_id=?1 AND work_id=?2)",
    "order": "agent_id"
  },
  {
    "key": "runs",
    "table": "axiom_ec_runs",
    "columns": [
      "tenant_id",
      "task_id",
      "work_id",
      "contract_sha256",
      "status",
      "binding_id",
      "generation",
      "lease_expires_at",
      "started_at",
      "completed_at",
      "result_json"
    ],
    "where": "r.tenant_id=?1 AND r.work_id=?2",
    "order": "task_id"
  },
  {
    "key": "artifacts",
    "table": "axiom_ec_artifacts",
    "columns": [
      "tenant_id",
      "artifact_id",
      "task_id",
      "work_id",
      "content_sha256",
      "content_json",
      "binding_id",
      "generation",
      "created_at"
    ],
    "where": "r.tenant_id=?1 AND r.work_id=?2",
    "order": "artifact_id"
  },
  {
    "key": "evidence",
    "table": "axiom_ec_evidence",
    "columns": [
      "tenant_id",
      "evidence_id",
      "artifact_id",
      "kind",
      "content_sha256",
      "content_json"
    ],
    "where": "r.tenant_id=?1 AND EXISTS(SELECT 1 FROM axiom_ec_artifacts a WHERE a.tenant_id=r.tenant_id AND a.artifact_id=r.artifact_id AND a.work_id=?2)",
    "order": "evidence_id"
  },
  {
    "key": "reservations",
    "table": "axiom_ec_reservations",
    "columns": [
      "tenant_id",
      "reservation_id",
      "work_id",
      "task_id",
      "binding_id",
      "generation",
      "action_kind",
      "operation",
      "compute_calls",
      "provider_calls",
      "created_at"
    ],
    "where": "r.tenant_id=?1 AND r.work_id=?2",
    "order": "reservation_id"
  },
  {
    "key": "invocations",
    "table": "axiom_ec_agent_invocations",
    "columns": [
      "tenant_id",
      "invocation_id",
      "task_id",
      "work_id",
      "contract_sha256",
      "reservation_id",
      "binding_id",
      "generation",
      "stage",
      "provider",
      "model",
      "request_sha256",
      "status",
      "session_id",
      "turn_id",
      "output_json",
      "output_sha256",
      "error_code",
      "reconcile_reads",
      "created_at",
      "updated_at"
    ],
    "where": "r.tenant_id=?1 AND r.work_id=?2",
    "order": "invocation_id"
  },
  {
    "key": "completion_guards",
    "table": "axiom_ec_agent_completion_guards",
    "columns": [
      "tenant_id",
      "task_id",
      "snapshot_json"
    ],
    "where": "r.tenant_id=?1 AND EXISTS(SELECT 1 FROM axiom_ec_runs z WHERE z.tenant_id=r.tenant_id AND z.task_id=r.task_id AND z.work_id=?2)",
    "order": "task_id"
  },
  {
    "key": "holds",
    "table": "axiom_lc_holds",
    "columns": [
      "tenant_id",
      "hold_id",
      "work_id",
      "object_kind",
      "object_id",
      "reason",
      "state",
      "principal_id",
      "authorization_id",
      "created_at",
      "released_at",
      "released_by",
      "released_authorization_id",
      "release_reason"
    ],
    "where": "r.tenant_id=?1 AND r.work_id=?2",
    "order": "hold_id"
  },
  {
    "key": "dependencies",
    "table": "axiom_lc_dependencies",
    "columns": [
      "tenant_id",
      "dependency_id",
      "work_id",
      "dependent_work_id",
      "object_kind",
      "object_id",
      "reason",
      "state",
      "principal_id",
      "authorization_id",
      "created_at",
      "released_at",
      "released_by",
      "released_authorization_id",
      "release_reason"
    ],
    "where": "r.tenant_id=?1 AND r.work_id=?2",
    "order": "dependency_id"
  }
];
const MAX_ROWS=256,MAX_SNAPSHOT_BYTES=524288,MAX_AUDIT_ROWS=4096;
const HEX=/^[0-9a-f]{64}$/;
const ERASED_SCHEMA='musitu.axiom.evidence-erased.v1';
const RECEIPT_SCHEMA='musitu.axiom.evidence-erasure-receipt.v1';
const EXPORT_SCHEMA='musitu.axiom.evidence-export.v1';
const EXPORT_RECEIPT_SCHEMA='musitu.axiom.evidence-export-receipt.v1';
const retainedScope='GOVERNED_D1_LOGICAL_PAYLOADS';
const payloadColumns=Object.freeze([
  'axiom_ec_works.contract_json','axiom_ec_runs.result_json','axiom_ec_artifacts.content_json',
  'axiom_ec_evidence.content_json','axiom_ec_agent_invocations.output_json',
  'axiom_ec_agent_invocations.session_id','axiom_ec_agent_invocations.turn_id',
  'axiom_ec_agent_invocations.error_code','axiom_ec_agent_completion_guards.snapshot_json'
]);
const deny=message=>{throw new DOMException(message,'NotAllowedError');};
const corrupt=message=>{throw new DOMException(message,'DataError');};
const missing=()=>{throw new DOMException('lifecycle object not found','NotFoundError');};
const copy=value=>structuredClone(value);
const rows=result=>result?.results??result;
const normalizedTime=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
function input(value,allowed,label){
  canonicalJson(value);
  return executionRecord(value,allowed,label);
}
function digest(value,label){
  if(typeof value!=='string'||!HEX.test(value))throw new TypeError(label+' must be a SHA-256 commitment');
  return value;
}
function text(value,label){
  if(typeof value!=='string'||value.trim().length<1||value.length>512)throw new TypeError(label+' must be bounded nonempty text');
  return value.trim();
}
function sorted(values){return values.map(value=>canonicalJson(value)).sort();}
function same(left,right){return canonicalJson(left)===canonicalJson(right);}
function parse(value,label){
  try{return JSON.parse(value);}catch{corrupt('stored '+label+' is invalid JSON');}
}
function modelProof(row){
  return {schema:'musitu.axiom.hosted-model-evidence.v1',provider:'openai_agents',invocation_id:row.invocation_id,
    task_id:row.task_id,work_id:row.work_id,contract_sha256:row.contract_sha256,reservation_id:row.reservation_id,
    model:row.model,environment:'openai_hosted',stage:row.stage,session_id:row.session_id,turn_id:row.turn_id,
    request_sha256:row.request_sha256,output_sha256:row.output_sha256,status:'COMPLETED',
    verification_scope:'PROVIDER_OUTPUT_COMMITMENT_NOT_FACTUAL_VALIDATION'};
}
async function validateSnapshot(snapshot,tenant,workId){
  if(!snapshot||typeof snapshot!=='object')corrupt('lifecycle snapshot is invalid');
  for(const table of TABLES){
    if(!Array.isArray(snapshot[table.key]))corrupt('lifecycle snapshot table is missing');
    for(const row of snapshot[table.key])if(row.tenant_id!==tenant)corrupt('lifecycle snapshot tenant mismatch');
  }
  if(snapshot.works.length!==1||snapshot.projects.length!==1||snapshot.agents.length!==1)corrupt('lifecycle Work identity is incomplete');
  const work=snapshot.works[0],contract=parse(work.contract_json,'Work contract');
  await validateExecutionContract(contract);
  if(work.work_id!==workId||contract.tenant_id!==tenant||contract.work_id!==workId||
    contract.project_id!==work.project_id||contract.agent_id!==work.agent_id||contract.contract_sha256!==work.contract_sha256||
    work.expires_at!==contract.expires_at||work.max_compute_calls!==contract.policy.max_compute_calls||
    work.max_provider_calls!==contract.policy.max_provider_calls||snapshot.projects[0].project_id!==work.project_id||
    snapshot.agents[0].agent_id!==work.agent_id)corrupt('stored lifecycle Work projections changed');
  const runs=new Map(snapshot.runs.map(row=>[row.task_id,row]));
  const artifacts=new Map(snapshot.artifacts.map(row=>[row.artifact_id,row]));
  const reservations=new Map(snapshot.reservations.map(row=>[row.reservation_id,row]));
  const totals={compute_calls:0,provider_calls:0};
  for(const reservation of reservations.values()){
    if(reservation.work_id!==workId||(reservation.task_id!==null&&!runs.has(reservation.task_id)))corrupt('stored lifecycle reservation ownership changed');
    for(const key of Object.keys(totals)){
      if(!Number.isSafeInteger(reservation[key])||reservation[key]<0)corrupt('stored lifecycle reservation budget changed');
      totals[key]+=reservation[key];
    }
  }
  if(work.compute_calls!==totals.compute_calls||work.provider_calls!==totals.provider_calls)corrupt('stored lifecycle budget accounting changed');
  for(const artifact of artifacts.values()){
    const run=runs.get(artifact.task_id);
    if(artifact.work_id!==workId||!run||run.status!=='COMPLETED'||artifact.binding_id!==run.binding_id||
      artifact.generation!==run.generation||await sha256Json(parse(artifact.content_json,'Artifact'))!==artifact.content_sha256)corrupt('stored lifecycle Artifact commitment mismatch');
  }
  for(const item of snapshot.evidence){
    if(!artifacts.has(item.artifact_id)||await sha256Json(parse(item.content_json,'Evidence'))!==item.content_sha256)corrupt('stored lifecycle Evidence commitment mismatch');
  }
  for(const invocation of snapshot.invocations){
    const run=runs.get(invocation.task_id),reservation=reservations.get(invocation.reservation_id);
    if(invocation.work_id!==workId||!run||!reservation||reservation.task_id!==invocation.task_id||
      reservation.action_kind!=='model'||reservation.provider_calls<1||reservation.binding_id!==invocation.binding_id||
      reservation.generation!==invocation.generation||run.binding_id!==invocation.binding_id||run.generation!==invocation.generation||
      run.contract_sha256!==invocation.contract_sha256||invocation.contract_sha256!==work.contract_sha256||
      invocation.provider!=='openai_agents')corrupt('stored lifecycle hosted invocation identity mismatch');
    if(invocation.output_json!==null&&await sha256Json(parse(invocation.output_json,'hosted output'))!==invocation.output_sha256)corrupt('stored lifecycle hosted output commitment mismatch');
  }
  for(const run of runs.values()){
    const result=parse(run.result_json,'Run');
    if(run.work_id!==workId||run.contract_sha256!==work.contract_sha256||result.task_id!==run.task_id||
      result.customer_id!==tenant||result.objective!==contract.objective||result.status!==run.status)corrupt('stored lifecycle Run identity mismatch');
    if(run.status!=='COMPLETED')continue;
    if(!same(result.execution_contract,contract)||!await verifyTaskCommitments(result)||!await verifyExecutionResultCommitment(result))corrupt('stored lifecycle completion commitment mismatch');
    const ownArtifacts=snapshot.artifacts.filter(row=>row.task_id===run.task_id);
    if(ownArtifacts.length!==1||ownArtifacts[0].content_sha256!==result.receipt.artifact_sha256||
      !same(parse(ownArtifacts[0].content_json,'Artifact'),result.artifact)||result.receipt.contract_sha256!==work.contract_sha256)corrupt('stored lifecycle completion Artifact mismatch');
    for(const key of ['project_id','work_id','agent_id','contract_sha256'])if(result.artifact[key]!==contract[key])corrupt('stored lifecycle Artifact identity mismatch');
    const sources=result.sources??[];
    if(!Array.isArray(sources)||new Set(sources.map(s=>s.source_id)).size!==sources.length)corrupt('stored lifecycle captured sources are invalid');
    for(const source of sources){
      let url;try{url=new URL(source.url);}catch{corrupt('stored lifecycle source URL is invalid');}
      if(!['http:','https:'].includes(url.protocol)||url.username||url.password||source.instruction_authority!=='NONE_DATA_ONLY')corrupt('stored lifecycle source instruction authority changed');
    }
    const sourceCommitments=await Promise.all(sources.map(async source=>({source_id:source.source_id,sha256:await sha256Json(source)})));
    if(!same(sourceCommitments,result.receipt.source_commitments??[]))corrupt('stored lifecycle source commitment mismatch');
    for(const citation of result.artifact.citations??[])if(!sources.some(source=>same(source,citation)))corrupt('stored lifecycle citation is not captured Evidence');
    const expected=[{kind:'EXECUTION_CONTRACT',content_sha256:await sha256Json(contract)},
      ...sourceCommitments.map(source=>({kind:'CAPTURED_SOURCE_NOT_ENTAILMENT',content_sha256:source.sha256})),
      {kind:'COMPLETION_RECEIPT',content_sha256:await sha256Json(result.receipt)}];
    if(result.execution)expected.push({kind:'EXECUTION_RECORD',content_sha256:await sha256Json(result.execution)});
    for(const item of result.provider_evidence??[])expected.push({kind:'PROVIDER_MODEL_EXECUTION',content_sha256:await sha256Json(item)});
    const actual=snapshot.evidence.filter(row=>row.artifact_id===ownArtifacts[0].artifact_id).map(({kind,content_sha256})=>({kind,content_sha256}));
    if(!same(sorted(expected),sorted(actual)))corrupt('stored lifecycle Evidence set is incomplete or changed');
    const invocations=snapshot.invocations.filter(row=>row.task_id===run.task_id);
    if(!same(sorted(result.provider_evidence??[]),sorted(invocations.map(modelProof)))||
      invocations.some(row=>row.status!=='SUCCEEDED'||!row.output_json||!/^[A-Za-z0-9_-]{1,200}$/.test(row.session_id??'')||!/^[A-Za-z0-9_-]{1,200}$/.test(row.turn_id??'')))corrupt('stored lifecycle hosted Evidence mismatch');
    const guards=snapshot.completion_guards.filter(row=>row.task_id===run.task_id);
    if(guards.length!==1||!same(sorted(parse(guards[0].snapshot_json,'completion guard')),sorted(invocations)))corrupt('stored lifecycle completion snapshot changed');
  }
  for(const guard of snapshot.completion_guards)if(!runs.has(guard.task_id)||runs.get(guard.task_id).status!=='COMPLETED')corrupt('stored lifecycle completion snapshot has no completed Run');
  for(const row of [...snapshot.holds,...snapshot.dependencies])if(row.work_id!==workId||!targetExists(snapshot,row.object_kind,row.object_id,workId))corrupt('stored lifecycle hold/dependency target mismatch');
  return contract;
}
function targetExists(snapshot,kind,id,workId){
  return kind==='WORK'?id===workId:kind==='ARTIFACT'?snapshot.artifacts.some(row=>row.artifact_id===id):
    kind==='EVIDENCE'?snapshot.evidence.some(row=>row.evidence_id===id):false;
}
async function originalCommitments(snapshot){
  const work=snapshot.works[0];
  const committed=async(row,body,erased=[])=>({...body,row_sha256:await sha256Json(row),metadata_sha256:await metadataCommitment(row,erased)});
  return {
    project:{project_id:work.project_id},agent:{agent_id:work.agent_id},
    work:await committed(work,{work_id:work.work_id,contract_sha256:work.contract_sha256,request_sha256:work.request_sha256},['contract_json','state']),
    runs:await Promise.all(snapshot.runs.map(async row=>committed(row,{task_id:row.task_id,contract_sha256:row.contract_sha256,status:row.status,result_sha256:await sha256Json(parse(row.result_json,'Run'))},['result_json']))),
    artifacts:await Promise.all(snapshot.artifacts.map(row=>committed(row,{artifact_id:row.artifact_id,task_id:row.task_id,content_sha256:row.content_sha256},['content_json']))),
    evidence:await Promise.all(snapshot.evidence.map(row=>committed(row,{evidence_id:row.evidence_id,artifact_id:row.artifact_id,kind:row.kind,content_sha256:row.content_sha256},['content_json']))),
    reservations:await Promise.all(snapshot.reservations.map(row=>committed(row,{reservation_id:row.reservation_id,task_id:row.task_id}))),
    invocations:await Promise.all(snapshot.invocations.map(row=>committed(row,{invocation_id:row.invocation_id,task_id:row.task_id,request_sha256:row.request_sha256,output_sha256:row.output_sha256},['output_json','session_id','turn_id','error_code','updated_at']))),
    completion_guards:await Promise.all(snapshot.completion_guards.map(async row=>committed(row,{task_id:row.task_id,snapshot_sha256:await sha256Json(parse(row.snapshot_json,'completion guard'))},['snapshot_json'])))
  };
}
async function metadataCommitment(row,erased){
  return sha256Json(Object.fromEntries(Object.entries(row).filter(([key])=>!erased.includes(key))));
}
function tombstonesFor(commitments){
  return [
    {object_kind:'WORK',object_id:commitments.work.work_id,commitment:commitments.work},
    ...commitments.runs.map(row=>({object_kind:'RUN',object_id:row.task_id,commitment:row})),
    ...commitments.artifacts.map(row=>({object_kind:'ARTIFACT',object_id:row.artifact_id,commitment:row})),
    ...commitments.evidence.map(row=>({object_kind:'EVIDENCE',object_id:row.evidence_id,commitment:row})),
    ...commitments.invocations.map(row=>({object_kind:'AGENT_INVOCATION',object_id:row.invocation_id,commitment:row})),
    ...commitments.completion_guards.map(row=>({object_kind:'COMPLETION_GUARD',object_id:row.task_id,commitment:row}))
  ];
}
async function makePlan(snapshot,tenant,workId){
  const commitments=await originalCommitments(snapshot);
  const blockers=[
    ...snapshot.holds.filter(row=>row.state==='ACTIVE').map(row=>({kind:'LEGAL_HOLD',hold_id:row.hold_id,object_kind:row.object_kind,object_id:row.object_id})),
    ...snapshot.dependencies.filter(row=>row.state==='ACTIVE'&&row.dependent_work_id!==workId).map(row=>({kind:'DEPENDENCY',dependency_id:row.dependency_id,dependent_work_id:row.dependent_work_id,object_kind:row.object_kind,object_id:row.object_id})),
    ...snapshot.runs.filter(row=>row.status==='RUNNING').map(row=>({kind:'ACTIVE_RUN',task_id:row.task_id})),
    ...snapshot.invocations.filter(row=>row.status!=='SUCCEEDED').map(row=>({kind:'UNRESOLVED_PROVIDER_INVOCATION',invocation_id:row.invocation_id}))
  ];
  const body={schema:'musitu.axiom.evidence-impact-plan.v1',tenant_id:tenant,work_id:workId,
    snapshot_sha256:await sha256Json(snapshot),original_commitments:commitments,
    impact:{works:1,runs:snapshot.runs.length,artifacts:snapshot.artifacts.length,evidence:snapshot.evidence.length,
      invocations:snapshot.invocations.length,completion_guards:snapshot.completion_guards.length},
    retained_shared_objects:{project_id:commitments.project.project_id,agent_id:commitments.agent.agent_id},
    payload_columns:[...payloadColumns],blockers,can_delete:blockers.length===0,requires_verified_export:true,
    required_authorization:'lifecycle.delete',erasure_scope:retainedScope,external_erasure_verified:false};
  return {...body,plan_sha256:await sha256Json(body)};
}
async function verifiedReceipt(row,schema){
  if(!row)return null;
  const receipt=parse(row.receipt_json,'lifecycle receipt'),{receipt_sha256,...body}=receipt;
  if(receipt.schema!==schema||receipt_sha256!==row.receipt_sha256||await sha256Json(body)!==receipt_sha256||
    receipt.tenant_id!==row.tenant_id||receipt.work_id!==row.work_id||receipt.request_id!==row.request_id)corrupt('stored lifecycle receipt commitment mismatch');
  return receipt;
}

/** Validates an exported package independently of the DB; hashes are local
 * commitments, not signatures or an external custody/rollback anchor. */
export async function verifyEvidenceLifecycleExport({payload,receipt}={}){
  try{
    if(payload?.schema!==EXPORT_SCHEMA||receipt?.schema!==EXPORT_RECEIPT_SCHEMA)return false;
    const {receipt_sha256,...body}=receipt;
    if(!HEX.test(receipt_sha256??'')||await sha256Json(body)!==receipt_sha256||
      await sha256Json(payload)!==receipt.export_sha256||payload.tenant_id!==receipt.tenant_id||
      payload.work_id!==receipt.work_id||payload.exported_at!==receipt.exported_at||
      await sha256Json(payload.snapshot)!==receipt.snapshot_sha256)return false;
    await validateSnapshot(payload.snapshot,receipt.tenant_id,receipt.work_id);
    return same(await originalCommitments(payload.snapshot),receipt.original_commitments)&&same(payload.original_commitments,receipt.original_commitments);
  }catch{return false;}
}

async function lifecycleAuditHead(db,tenant,forMutation=false){
const statement=(sql,...args)=>db.prepare(sql).bind(...args);
  const events=rows(await statement('SELECT * FROM axiom_lc_audit WHERE tenant_id=?1 ORDER BY sequence LIMIT ?2',tenant,MAX_AUDIT_ROWS+1).all());
  if(events.length>MAX_AUDIT_ROWS||(forMutation&&events.length===MAX_AUDIT_ROWS))throw new DOMException('lifecycle audit exceeds bounded verification capacity','QuotaExceededError');
  let previous=null;
  for(const event of events){
    const {sequence,event_sha256,...body}=event;
    if(event.previous_sha256!==previous||await sha256Json(body)!==event_sha256)corrupt('stored lifecycle audit chain changed');
    previous=event_sha256;
  }
  return previous;
}

async function verifyDeletedSnapshot({db,tenant,workId,receipt}){
const statement=(sql,...args)=>db.prepare(sql).bind(...args);
const auditHead=()=>lifecycleAuditHead(db,tenant);
  if(!receipt||receipt.status!=='ERASED'||receipt.erasure_scope!==retainedScope)corrupt('stored lifecycle deletion receipt is invalid');
  await auditHead();
  const exportRow=await statement('SELECT * FROM axiom_lc_exports WHERE tenant_id=?1 AND work_id=?2 AND receipt_sha256=?3',tenant,workId,receipt.export_receipt_sha256).first();
  const exported=await verifiedReceipt(exportRow,EXPORT_RECEIPT_SCHEMA);
  if(!exported||exported.snapshot_sha256!==receipt.original_snapshot_sha256||exported.export_sha256!==receipt.export_sha256||!same(exported.original_commitments,receipt.original_commitments))corrupt('stored lifecycle export/deletion binding changed');
  const events=rows(await statement("SELECT payload_json FROM axiom_lc_audit WHERE tenant_id=?1 AND work_id=?2 AND event_type='work.erase'",tenant,workId).all());
  if(events.length!==1||parse(events[0].payload_json,'lifecycle audit').receipt_sha256!==receipt.receipt_sha256)corrupt('stored lifecycle deletion audit binding changed');
  const tombstones=rows(await statement('SELECT * FROM axiom_lc_tombstones WHERE tenant_id=?1 AND work_id=?2 ORDER BY object_kind,object_id',tenant,workId).all());
  const expected=tombstonesFor(receipt.original_commitments);
  if(tombstones.length!==expected.length)corrupt('stored lifecycle tombstone set changed');
  for(const tombstone of tombstones){
    const original=expected.find(row=>row.object_kind===tombstone.object_kind&&row.object_id===tombstone.object_id);
    if(!original||tombstone.receipt_sha256!==receipt.receipt_sha256||tombstone.request_id!==receipt.request_id||
      tombstone.erased_at!==receipt.erased_at||!same(parse(tombstone.original_commitment_json,'tombstone'),original.commitment))corrupt('stored lifecycle tombstone commitment changed');
  }
  const marker=canonicalJson({schema:ERASED_SCHEMA,work_id:workId,receipt_sha256:receipt.receipt_sha256});
  const work=await statement('SELECT * FROM axiom_ec_works WHERE tenant_id=?1 AND work_id=?2',tenant,workId).first();
  const committed=receipt.original_commitments;
  if(!work||work.contract_json!==marker||work.state!=='REVOKED'||work.contract_sha256!==committed.work.contract_sha256||
    work.request_sha256!==committed.work.request_sha256||work.project_id!==committed.project.project_id||work.agent_id!==committed.agent.agent_id||
    await metadataCommitment(work,['contract_json','state'])!==committed.work.metadata_sha256)corrupt('erased Work payload or retained commitment changed');
  for(const [table,key,id] of [['projects','project_id',work.project_id],['agents','agent_id',work.agent_id]])if(!await statement('SELECT 1 AS n FROM axiom_ec_'+table+' WHERE tenant_id=?1 AND '+key+'=?2',tenant,id).first())corrupt('erased Work shared identity is missing');
  for(const [key,column,id] of [['runs','result_json','task_id'],['artifacts','content_json','artifact_id'],['evidence','content_json','evidence_id'],['invocations','output_json','invocation_id'],['completion_guards','snapshot_json','task_id']]){
    const table=TABLES.find(table=>table.key===key);
    const actual=rows(await statement('SELECT r.* FROM '+table.table+' r WHERE '+table.where+' ORDER BY r.'+table.order,tenant,workId).all());
    const original=committed[key];
    if(actual.length!==original.length)corrupt('erased Work object set changed');
    for(const row of actual){
      const proof=original.find(item=>item[id]===row[id]);
      if(!proof)corrupt('erased Work object identity changed');
      const erased=key==='invocations'?['output_json','session_id','turn_id','error_code','updated_at']:[column];
      if(await metadataCommitment(row,erased)!==proof.metadata_sha256)corrupt('erased Work retained metadata changed');
      if(key==='invocations'){
        if(row.output_json!==null||row.session_id!==null||row.turn_id!==null||row.error_code!=='LIFECYCLE_ERASED'||row.output_sha256!==proof.output_sha256||row.request_sha256!==proof.request_sha256)corrupt('erased hosted payload or commitment changed');
      }else if(row[column]!==marker)corrupt('erased Work still has a governed payload');
      if(key==='runs'&&(row.status!==proof.status||row.contract_sha256!==proof.contract_sha256))corrupt('erased Run commitment changed');
      if((key==='artifacts'||key==='evidence')&&row.content_sha256!==proof.content_sha256)corrupt('erased object commitment changed');
    }
  }
  const reservations=rows(await statement('SELECT * FROM axiom_ec_reservations WHERE tenant_id=?1 AND work_id=?2 ORDER BY reservation_id',tenant,workId).all());
  if(reservations.length!==committed.reservations.length)corrupt('erased Work reservation set changed');
  for(const reservation of reservations){
    const proof=committed.reservations.find(row=>row.reservation_id===reservation.reservation_id);
    if(!proof||await sha256Json(reservation)!==proof.row_sha256)corrupt('erased Work reservation commitment changed');
  }
  if(await statement('SELECT 1 AS n FROM axiom_lc_guards WHERE tenant_id=?1 AND work_id=?2',tenant,workId).first())corrupt('erased Work retained a plaintext comparison snapshot');
  return {status:'VERIFIED_LOGICAL_ERASURE',tenant_id:tenant,work_id:workId,receipt_sha256:receipt.receipt_sha256,
    original_commitments:copy(committed),erasure_scope:retainedScope,external_erasure_verified:false};
}

/**
 * Read-only normal task-read seam. The customer identity must come from the
 * existing authenticated server session. It grants no lifecycle action and
 * returns only that tenant's retained proof; control-plane reads still require
 * lifecycle.read. Legacy unmigrated ordinary rows return null. Any erasure
 * marker without its complete migrated proof fails closed.
 */
export async function readD1EvidenceLifecycleErasure({db,customer,taskId,workId}={}){
  if(!db?.prepare)throw new TypeError('D1 lifecycle read store required');
  const tenant=requireExecutionId(customer?.customer_id,'authenticated customer');
  if((taskId===undefined)===(workId===undefined))throw new TypeError('one taskId or workId required');
  if(taskId!==undefined)requireExecutionId(taskId,'taskId');else requireExecutionId(workId,'workId');
  const statement=(sql,...args)=>db.prepare(sql).bind(...args);
  const row=taskId!==undefined?
    await statement('SELECT w.work_id,w.contract_json,r.result_json FROM axiom_ec_runs r JOIN axiom_ec_works w ON w.tenant_id=r.tenant_id AND w.work_id=r.work_id WHERE r.tenant_id=?1 AND r.task_id=?2',tenant,taskId).first():
    await statement('SELECT work_id,contract_json,NULL AS result_json FROM axiom_ec_works WHERE tenant_id=?1 AND work_id=?2',tenant,workId).first();
  if(!row)return null;
  const marked=[row.contract_json,row.result_json].some(value=>value!==null&&parse(value,'erasure marker')?.schema===ERASED_SCHEMA);
  let schema;
  try{schema=await statement('SELECT version FROM axiom_lc_schema').first();}
  catch(error){
    if(!/no such table/i.test(String(error?.message)))throw error;
    if(marked)corrupt('erased Work lifecycle proof migration is missing');
    return null;
  }
  if(schema?.version!==1)corrupt('erased Work lifecycle proof migration changed');
  const deletion=await statement('SELECT * FROM axiom_lc_delete_requests WHERE tenant_id=?1 AND work_id=?2',tenant,row.work_id).first();
  if(!deletion){if(marked)corrupt('erased Work lifecycle receipt is missing');return null;}
  const receipt=await verifiedReceipt(deletion,RECEIPT_SCHEMA);
  const verified=await verifyDeletedSnapshot({db,tenant,workId:row.work_id,receipt});
  return {status:'ERASED',tenant_id:tenant,work_id:row.work_id,...(taskId===undefined?{}:{task_id:taskId}),
    deletion_receipt:receipt,retained_commitments:verified.original_commitments,
    erasure_scope:retainedScope,external_erasure_verified:false};
}

/**
 * Required server-owned authorize({tenant_id,action,work_id}) -> {principal_id,
 * authorization_id}; the referenced persisted grant must independently be ACTIVE,
 * unexpired and exact tenant/action/Work. No API here creates or broadens grants.
 * All operations are bounded to 256 rows/512 KiB per Work and 4096 audit events.
 * Erasure is logical governed-D1 payload redaction. Export recipients, provider
 * retention, replicas, physical pages and backup destruction are outside scope.
 */
export function createD1EvidenceLifecycle({db,customer,authorize,now=()=>new Date(),idFactory=prefix=>prefix+'_'+crypto.randomUUID().replaceAll('-','')}={}){
  if(!db?.prepare||!db?.batch)throw new TypeError('transactional D1 lifecycle store required');
  if(typeof authorize!=='function')throw new TypeError('explicit trusted server lifecycle authorizer required');
  const tenant=requireExecutionId(customer?.customer_id,'authenticated customer');
  const statement=(sql,...args)=>db.prepare(sql).bind(...args);
  const instant=()=>{const date=now();if(!(date instanceof Date)||!Number.isFinite(date.getTime()))throw new TypeError('valid lifecycle clock required');return date.toISOString();};
  const makeId=prefix=>requireExecutionId(idFactory(prefix),prefix+' id');
  async function ready(){
    let version;
    try{version=await statement('SELECT version FROM axiom_lc_schema').all();}
    catch{throw new DOMException('evidence lifecycle migration is required','NotSupportedError');}
    if(!same(rows(version).map(row=>row.version),[1]))throw new DOMException('unsupported evidence lifecycle migration','NotSupportedError');
    for(const table of TABLES.filter(table=>table.table.startsWith('axiom_ec_'))){
      const columns=rows(await statement('PRAGMA table_info('+table.table+')').all()).map(row=>row.name).sort();
      if(!same(columns,[...table.columns].sort()))throw new DOMException('governed lifecycle schema changed; explicit migration required','NotSupportedError');
    }
  }
  async function authority(action,workId){
    const answer=await authorize(Object.freeze({tenant_id:tenant,action,work_id:workId}));
    if(!answer)deny('explicit lifecycle owner authorization required');
    input(answer,['principal_id','authorization_id'],'trusted server lifecycle authorization');
    const principal=requireExecutionId(answer.principal_id,'server principal'),id=requireExecutionId(answer.authorization_id,'server authorization');
    const time=instant(),grant=await statement("SELECT * FROM axiom_lc_authorizations WHERE tenant_id=?1 AND authorization_id=?2 AND principal_id=?3 AND action=?4 AND work_id=?5 AND state='ACTIVE'",tenant,id,principal,action,workId).first();
    if(!grant||!normalizedTime(grant.expires_at)||grant.expires_at<=time)deny('explicit lifecycle owner authorization required');
    return {principal_id:principal,authorization_id:id,created_at:time};
  }
  async function begin(action,workId){requireExecutionId(workId,'work_id');await ready();return authority(action,workId);}
  async function snapshot(workId){
    if(await statement("SELECT 1 AS n FROM axiom_lc_tombstones WHERE tenant_id=?1 AND work_id=?2 AND object_kind='WORK'",tenant,workId).first())throw new DOMException('Work has been erased; use its lifecycle receipt','InvalidStateError');
    const result={};
    let count=0;
    for(const table of TABLES){
      const reply=await statement('SELECT r.* FROM '+table.table+' r WHERE '+table.where+' ORDER BY r.'+table.order+' LIMIT ?3',tenant,workId,MAX_ROWS+1).all();
      result[table.key]=rows(reply);count+=result[table.key].length;
      if(count>MAX_ROWS)throw new DOMException('Work exceeds bounded lifecycle row capacity','QuotaExceededError');
    }
    if(result.works.length===0)missing();
    if(new TextEncoder().encode(canonicalJson(result)).length>MAX_SNAPSHOT_BYTES)throw new DOMException('Work exceeds bounded lifecycle snapshot capacity','QuotaExceededError');
    await validateSnapshot(result,tenant,workId);
    return result;
  }
  const auditHead=()=>lifecycleAuditHead(db,tenant);
  async function mutate({action,workId,source,exportReceiptSha=null,eventType,build}){
    const auth=await authority(action,workId),head=await lifecycleAuditHead(db,tenant,true),guardId=makeId('lc_guard');
    const snapshotSha=await sha256Json(source);
    const built=await build({auth,guardId,time:auth.created_at,snapshotSha});
    const body={tenant_id:tenant,event_id:makeId('lc_event'),work_id:workId,event_type:eventType,
      principal_id:auth.principal_id,authorization_id:auth.authorization_id,payload_json:canonicalJson(built.audit),
      previous_sha256:head,created_at:auth.created_at};
    const eventSha=await sha256Json(body);
    const statements=[
      statement('INSERT INTO axiom_lc_guards(tenant_id,guard_id,work_id,action,principal_id,authorization_id,created_at,snapshot_json,snapshot_sha256,export_receipt_sha256) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)',tenant,guardId,workId,action,auth.principal_id,auth.authorization_id,auth.created_at,canonicalJson(source),snapshotSha,exportReceiptSha),
      ...built.statements,
      statement('INSERT INTO axiom_lc_audit(tenant_id,event_id,work_id,event_type,principal_id,authorization_id,payload_json,previous_sha256,event_sha256,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)',tenant,body.event_id,workId,eventType,auth.principal_id,auth.authorization_id,body.payload_json,head,eventSha,auth.created_at),
      statement('DELETE FROM axiom_lc_guards WHERE tenant_id=?1 AND guard_id=?2',tenant,guardId)
    ];
    const result=await db.batch(statements);
    if(!Array.isArray(result)||result.some(item=>item?.success===false)||Number(result.at(-1)?.meta?.changes??result.at(-1)?.changes??0)!==1)corrupt('lifecycle atomic transaction did not complete');
    return copy(built.value);
  }
  const deleteRow=(workId,requestId)=>statement('SELECT * FROM axiom_lc_delete_requests WHERE tenant_id=?1 AND work_id=?2'+(requestId===undefined?'':' AND request_id=?3'),...([tenant,workId,...(requestId===undefined?[]:[requestId])])).first();
  const verifyDeletion=(workId,receipt)=>verifyDeletedSnapshot({db,tenant,workId,receipt});
  async function manageReference(kind,operation,value){
    const hold=kind==='hold',idKey=hold?'hold_id':'dependency_id';
    const allowed=operation==='release'?['work_id',idKey,'reason']:['work_id',idKey,'object_kind','object_id','reason',...(hold?[]:['dependent_work_id'])];
    input(value,allowed,'lifecycle '+kind);
    const workId=requireExecutionId(value.work_id,'work_id'),id=requireExecutionId(value[idKey],idKey),reason=text(value.reason,'lifecycle reason');
    await begin('lifecycle.'+(hold?'hold':'dependency'),workId);
    await auditHead();
    const source=await snapshot(workId),table=hold?'axiom_lc_holds':'axiom_lc_dependencies',list=source[hold?'holds':'dependencies'];
    const prior=list.find(row=>row[idKey]===id);
    if(operation==='release'){
      if(!prior)missing();
      if(prior.state==='RELEASED'){
        if(prior.release_reason!==reason)deny('lifecycle request conflicts with retained history');
        return copy(prior);
      }
    }else{
      const objectKind=value.object_kind??'WORK',objectId=value.object_id??workId;
      requireExecutionId(objectId,'object_id');
      if(!targetExists(source,objectKind,objectId,workId))missing();
      if(!hold){
        requireExecutionId(value.dependent_work_id,'dependent_work_id');
        if(!await statement('SELECT 1 AS n FROM axiom_ec_works WHERE tenant_id=?1 AND work_id=?2',tenant,value.dependent_work_id).first())missing();
      }
      if(prior){
        if(prior.state!=='ACTIVE'||prior.reason!==reason||prior.object_kind!==objectKind||prior.object_id!==objectId||(!hold&&prior.dependent_work_id!==value.dependent_work_id))deny('lifecycle request conflicts with retained history');
        return copy(prior);
      }
    }
    return mutate({action:'lifecycle.'+(hold?'hold':'dependency'),workId,source,eventType:kind+'.'+operation,
      build:async({auth,time})=>{
        let output,mutation;
        if(operation==='release'){
          output={...prior,state:'RELEASED',released_at:time,released_by:auth.principal_id,released_authorization_id:auth.authorization_id,release_reason:reason};
          mutation=statement('UPDATE '+table+" SET state='RELEASED',released_at=?3,released_by=?4,released_authorization_id=?5,release_reason=?6 WHERE tenant_id=?1 AND "+idKey+"=?2 AND state='ACTIVE'",tenant,id,time,auth.principal_id,auth.authorization_id,reason);
        }else{
          output={tenant_id:tenant,[idKey]:id,work_id:workId,object_kind:value.object_kind??'WORK',object_id:value.object_id??workId,reason,state:'ACTIVE',principal_id:auth.principal_id,authorization_id:auth.authorization_id,created_at:time,released_at:null,released_by:null,released_authorization_id:null,release_reason:null,...(hold?{}:{dependent_work_id:value.dependent_work_id})};
          const columns=Object.keys(output),params=columns.map((_,i)=>'?'+(i+1));
          mutation=statement('INSERT INTO '+table+'('+columns.join(',')+') VALUES('+params.join(',')+')',...columns.map(key=>output[key]));
        }
        return {value:output,statements:[mutation],audit:{[idKey]:id,operation,object_kind:output.object_kind,object_id:output.object_id,reason,snapshot_sha256:await sha256Json(source),...(hold?{}:{dependent_work_id:output.dependent_work_id})}};
      }});
  }
  return Object.freeze({
    async planWork(value={}){
      input(value,['work_id'],'lifecycle impact request');
      await begin('lifecycle.plan',value.work_id);await auditHead();
      return makePlan(await snapshot(value.work_id),tenant,value.work_id);
    },
    async exportWork(value={}){
      input(value,['work_id','request_id'],'lifecycle export request');
      const workId=requireExecutionId(value.work_id,'work_id'),requestId=requireExecutionId(value.request_id,'request_id');
      await begin('lifecycle.export',workId);
      const requestSha=await sha256Json({work_id:workId,request_id:requestId});
      const prior=await statement('SELECT * FROM axiom_lc_exports WHERE tenant_id=?1 AND request_id=?2',tenant,requestId).first();
      if(prior&&(prior.work_id!==workId||prior.request_sha256!==requestSha))deny('lifecycle request_id conflicts with retained history');
      const source=await snapshot(workId),commitments=await originalCommitments(source);
      const replay=async row=>{
        const receipt=await verifiedReceipt(row,EXPORT_RECEIPT_SCHEMA);
        const payload={schema:EXPORT_SCHEMA,tenant_id:tenant,work_id:workId,exported_at:receipt.exported_at,snapshot:source,original_commitments:commitments};
        if(!await verifyEvidenceLifecycleExport({payload,receipt}))corrupt('export source changed; use a new export request');
        await auditHead();return copy({payload,receipt});
      };
      if(prior)return replay(prior);
      try{return await mutate({action:'lifecycle.export',workId,source,eventType:'work.export',build:async({auth,time,snapshotSha})=>{
        const payload={schema:EXPORT_SCHEMA,tenant_id:tenant,work_id:workId,exported_at:time,snapshot:source,original_commitments:commitments};
        const body={schema:EXPORT_RECEIPT_SCHEMA,status:'EXPORTED',tenant_id:tenant,work_id:workId,request_id:requestId,
          snapshot_sha256:snapshotSha,export_sha256:await sha256Json(payload),original_commitments:commitments,
          exported_at:time,principal_id:auth.principal_id,authorization_id:auth.authorization_id};
        const receipt={...body,receipt_sha256:await sha256Json(body)};
        return {value:{payload,receipt},statements:[statement('INSERT INTO axiom_lc_exports(tenant_id,request_id,work_id,request_sha256,snapshot_sha256,export_sha256,receipt_sha256,receipt_json,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)',tenant,requestId,workId,requestSha,snapshotSha,body.export_sha256,receipt.receipt_sha256,canonicalJson(receipt),time)],
          audit:{request_id:requestId,receipt_sha256:receipt.receipt_sha256,snapshot_sha256:snapshotSha,export_sha256:body.export_sha256,original_commitments:commitments}};
      }});}catch(error){
        const row=await statement('SELECT * FROM axiom_lc_exports WHERE tenant_id=?1 AND request_id=?2',tenant,requestId).first();
        if(row&&row.work_id===workId&&row.request_sha256===requestSha)return replay(row);
        throw error;
      }
    },
    placeHold:value=>manageReference('hold','place',value),
    releaseHold:value=>manageReference('hold','release',value),
    registerDependency:value=>manageReference('dependency','register',value),
    releaseDependency:value=>manageReference('dependency','release',value),
    async deleteWork(value={}){
      input(value,['work_id','request_id','reason_code','plan_sha256','export_receipt_sha256'],'lifecycle deletion request');
      const workId=requireExecutionId(value.work_id,'work_id'),requestId=requireExecutionId(value.request_id,'request_id');
      const reason=requireExecutionId(value.reason_code,'reason_code'),planSha=digest(value.plan_sha256,'plan_sha256'),exportSha=digest(value.export_receipt_sha256,'export_receipt_sha256');
      await begin('lifecycle.delete',workId);
      const requestSha=await sha256Json(value);
      const replay=async row=>{
        if(row.work_id!==workId||row.request_sha256!==requestSha)deny('lifecycle request_id conflicts with retained history');
        const receipt=await verifiedReceipt(row,RECEIPT_SCHEMA);await verifyDeletion(workId,receipt);return receipt;
      };
      const prior=await statement('SELECT * FROM axiom_lc_delete_requests WHERE tenant_id=?1 AND request_id=?2',tenant,requestId).first();
      if(prior)return replay(prior);
      const source=await snapshot(workId),plan=await makePlan(source,tenant,workId);
      if(plan.plan_sha256!==planSha)deny('lifecycle impact plan changed; review a new plan');
      if(!plan.can_delete)deny('lifecycle legal hold, dependency, active Run or unresolved provider invocation blocks deletion');
      const exportRow=await statement('SELECT * FROM axiom_lc_exports WHERE tenant_id=?1 AND work_id=?2 AND receipt_sha256=?3',tenant,workId,exportSha).first();
      const exported=await verifiedReceipt(exportRow,EXPORT_RECEIPT_SCHEMA);
      if(!exported||exported.snapshot_sha256!==plan.snapshot_sha256||!same(exported.original_commitments,plan.original_commitments))deny('verified export of the exact lifecycle impact snapshot required');
      try{
        const receipt=await mutate({action:'lifecycle.delete',workId,source,exportReceiptSha:exportSha,eventType:'work.erase',build:async({auth,time,guardId,snapshotSha})=>{
          const body={schema:RECEIPT_SCHEMA,status:'ERASED',tenant_id:tenant,work_id:workId,request_id:requestId,reason_code:reason,
            erased_at:time,principal_id:auth.principal_id,authorization_id:auth.authorization_id,plan_sha256:planSha,
            original_snapshot_sha256:snapshotSha,export_receipt_sha256:exportSha,export_sha256:exported.export_sha256,
            original_commitments:plan.original_commitments,erasure_scope:retainedScope,payload_columns:[...payloadColumns],external_erasure_verified:false};
          const receipt={...body,receipt_sha256:await sha256Json(body)};
          const marker=canonicalJson({schema:ERASED_SCHEMA,work_id:workId,receipt_sha256:receipt.receipt_sha256});
          const tombstones=tombstonesFor(plan.original_commitments).map(row=>({...row,original_commitment_json:canonicalJson(row.commitment)}));
          const statements=[
            statement("UPDATE axiom_ec_works SET state='REVOKED',contract_json=?3 WHERE tenant_id=?1 AND work_id=?2",tenant,workId,marker),
            statement('UPDATE axiom_ec_runs SET result_json=?3 WHERE tenant_id=?1 AND work_id=?2',tenant,workId,marker),
            statement('UPDATE axiom_ec_artifacts SET content_json=?3 WHERE tenant_id=?1 AND work_id=?2',tenant,workId,marker),
            statement('UPDATE axiom_ec_evidence SET content_json=?3 WHERE tenant_id=?1 AND artifact_id IN(SELECT artifact_id FROM axiom_ec_artifacts WHERE tenant_id=?1 AND work_id=?2)',tenant,workId,marker),
            statement("UPDATE axiom_ec_agent_invocations SET output_json=NULL,session_id=NULL,turn_id=NULL,error_code='LIFECYCLE_ERASED',updated_at=?3 WHERE tenant_id=?1 AND work_id=?2",tenant,workId,time),
            statement('UPDATE axiom_ec_agent_completion_guards SET snapshot_json=?3 WHERE tenant_id=?1 AND task_id IN(SELECT task_id FROM axiom_ec_runs WHERE tenant_id=?1 AND work_id=?2)',tenant,workId,marker),
            statement("INSERT INTO axiom_lc_tombstones(tenant_id,work_id,object_kind,object_id,original_commitment_json,request_id,receipt_sha256,erased_at,guard_id) SELECT ?1,?2,json_extract(j.value,'$.object_kind'),json_extract(j.value,'$.object_id'),json_extract(j.value,'$.original_commitment_json'),?3,?4,?5,?6 FROM json_each(?7) j",tenant,workId,requestId,receipt.receipt_sha256,time,guardId,canonicalJson(tombstones)),
            statement('INSERT INTO axiom_lc_delete_requests(tenant_id,request_id,work_id,request_sha256,receipt_sha256,receipt_json,created_at,guard_id) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)',tenant,requestId,workId,requestSha,receipt.receipt_sha256,canonicalJson(receipt),time,guardId)
          ];
          return {value:receipt,statements,audit:{receipt_sha256:receipt.receipt_sha256,plan_sha256:planSha,original_snapshot_sha256:snapshotSha,original_commitments:plan.original_commitments,export_receipt_sha256:exportSha}};
        }});
        await verifyDeletion(workId,receipt);return receipt;
      }catch(error){
        const row=await statement('SELECT * FROM axiom_lc_delete_requests WHERE tenant_id=?1 AND request_id=?2',tenant,requestId).first();
        if(row&&row.work_id===workId&&row.request_sha256===requestSha)return replay(row);
        throw error;
      }
    },
    async getDeletionReceipt(value={}){
      input(value,['work_id','request_id'],'lifecycle receipt request');await begin('lifecycle.read',value.work_id);
      if(value.request_id!==undefined)requireExecutionId(value.request_id,'request_id');
      const receipt=await verifiedReceipt(await deleteRow(value.work_id,value.request_id),RECEIPT_SCHEMA);
      await auditHead();return receipt;
    },
    async getExportReceipt(value={}){
      input(value,['work_id','request_id'],'lifecycle export receipt request');await begin('lifecycle.read',value.work_id);
      requireExecutionId(value.request_id,'request_id');
      const row=await statement('SELECT * FROM axiom_lc_exports WHERE tenant_id=?1 AND work_id=?2 AND request_id=?3',tenant,value.work_id,value.request_id).first();
      const receipt=await verifiedReceipt(row,EXPORT_RECEIPT_SCHEMA);await auditHead();return receipt;
    },
    async verifyWorkDeletion(value={}){
      input(value,['work_id'],'lifecycle erasure verification request');await begin('lifecycle.read',value.work_id);
      const receipt=await verifiedReceipt(await deleteRow(value.work_id),RECEIPT_SCHEMA);
      if(!receipt)missing();return verifyDeletion(value.work_id,receipt);
    }
  });
}
