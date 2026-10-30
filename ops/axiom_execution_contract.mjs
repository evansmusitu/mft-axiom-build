import {ATOMIC_OPERATIONS} from '../axiom_interface/vnext/capability_registry.js';
import {canonicalJson,sha256Json,verifyTaskCommitments,verifyExecutionResultCommitment} from '../axiom_interface/vnext/execution_integrity.mjs';
import {EXECUTION_CONTRACT_SCHEMA,EXECUTION_AGENT_ID,EXECUTION_BUDGET_UNIT,normalizeExecutionContext,requiredExecutionOutcomes,requireExecutionId,executionRecord,validateExecutionContract} from '../axiom_interface/vnext/execution_contract.mjs';

const clone=v=>structuredClone(v),hex=/^[0-9a-f]{64}$/;
const deny=message=>{throw new DOMException(message,'NotAllowedError');};
function deepFreeze(value){if(value&&typeof value==='object'){for(const v of Object.values(value))deepFreeze(v);Object.freeze(value);}return value;}
function changed(result){return Number(result?.meta?.changes??result?.changes??0);}
function integer(value,fallback,label,max=1000000){const n=value??fallback;if(!Number.isSafeInteger(n)||n<0||n>max)throw new TypeError(`${label} must be a bounded nonnegative integer`);return n;}

export async function readD1ExecutionRun({db,customer,taskId}={}){
  const tenant=requireExecutionId(customer?.customer_id,'authenticated customer');requireExecutionId(taskId,'task id');
  const query=(sql,...args)=>db.prepare(sql).bind(...args);
  const row=await query('SELECT r.*,w.project_id,w.agent_id,w.contract_json FROM axiom_ec_runs r JOIN axiom_ec_works w ON w.tenant_id=r.tenant_id AND w.work_id=r.work_id WHERE r.tenant_id=?1 AND r.task_id=?2',tenant,taskId).first();
  if(!row)return null;
  const result=JSON.parse(row.result_json),contract=JSON.parse(row.contract_json);await validateExecutionContract(contract);
  if(contract.tenant_id!==tenant||contract.work_id!==row.work_id||contract.contract_sha256!==row.contract_sha256)throw new DOMException('stored execution identity mismatch','DataError');
  const artifactsReply=await query('SELECT artifact_id,content_sha256,content_json FROM axiom_ec_artifacts WHERE tenant_id=?1 AND task_id=?2',tenant,taskId).all();
  const artifacts=artifactsReply.results??artifactsReply,evidence=[];
  for(const artifact of artifacts){
    if(await sha256Json(JSON.parse(artifact.content_json))!==artifact.content_sha256)throw new DOMException('stored artifact commitment mismatch','DataError');
    const reply=await query('SELECT evidence_id,kind,content_sha256,content_json FROM axiom_ec_evidence WHERE tenant_id=?1 AND artifact_id=?2',tenant,artifact.artifact_id).all();
    for(const item of reply.results??reply){
      if(await sha256Json(JSON.parse(item.content_json))!==item.content_sha256)throw new DOMException('stored evidence commitment mismatch','DataError');
      evidence.push({evidence_id:item.evidence_id,kind:item.kind,content_sha256:item.content_sha256});
    }
  }
  if(row.status==='COMPLETED'){
    if(!await verifyExecutionResultCommitment(result))throw new DOMException('stored execution result commitment mismatch','DataError');
    const snapshots=await Promise.all((result.sources??[]).map(async source=>({source_id:source.source_id,sha256:await sha256Json(source)})));
    const expected=[{kind:'EXECUTION_CONTRACT',content_sha256:await sha256Json(contract)},...snapshots.map(s=>({kind:'CAPTURED_SOURCE_NOT_ENTAILMENT',content_sha256:s.sha256})),{kind:'COMPLETION_RECEIPT',content_sha256:await sha256Json(result.receipt)}];
    if(result.execution)expected.push({kind:'EXECUTION_RECORD',content_sha256:await sha256Json(result.execution)});
    const ordered=rows=>rows.map(({kind,content_sha256})=>({kind,content_sha256})).sort((a,b)=>canonicalJson(a).localeCompare(canonicalJson(b)));
    if(!await verifyTaskCommitments(result)||result.receipt.contract_sha256!==row.contract_sha256||canonicalJson(result.execution_contract)!==canonicalJson(contract)||canonicalJson(snapshots)!==canonicalJson(result.receipt.source_commitments??[])||artifacts.length!==1||artifacts[0].content_sha256!==result.receipt.artifact_sha256||canonicalJson(ordered(expected))!==canonicalJson(ordered(evidence)))throw new DOMException('stored completion proof mismatch','DataError');
  }
  return {...result,status:row.status,object_refs:{tenant_id:tenant,project_id:row.project_id,work_id:row.work_id,agent_id:row.agent_id,contract_sha256:row.contract_sha256,artifacts:artifacts.map(({artifact_id,content_sha256})=>({artifact_id,content_sha256})),evidence}};
}

export function createD1ExecutionGovernance({db,customer,now=()=>new Date(),idFactory=prefix=>`${prefix}_${crypto.randomUUID().replaceAll('-','')}`,serverPolicy={}}={}){
  if(!db?.prepare||!db?.batch)throw new TypeError('transactional D1 execution store required');
  const tenant=requireExecutionId(customer?.customer_id,'authenticated customer');
  executionRecord(serverPolicy,['max_compute_calls','max_provider_calls','ttl_ms','lease_ms','allowed_operations'],'server execution policy');
  const ceiling=integer(serverPolicy.max_compute_calls,100,'max_compute_calls');
  const providers=integer(serverPolicy.max_provider_calls,5,'max_provider_calls');
  const ttl=integer(serverPolicy.ttl_ms,900000,'ttl_ms',86400000),leaseMs=integer(serverPolicy.lease_ms,120000,'lease_ms',3600000);
  if(!ttl||!leaseMs)throw new TypeError('positive execution lifetimes required');
  const allowed=serverPolicy.allowed_operations??[...ATOMIC_OPERATIONS];
  if(!Array.isArray(allowed)||new Set(allowed).size!==allowed.length||allowed.some(x=>!ATOMIC_OPERATIONS.includes(x)))throw new TypeError('server operation scope must use registered operations');
  const instant=()=>{const d=now();if(!(d instanceof Date)||!Number.isFinite(d.getTime()))throw new TypeError('valid execution clock required');return d.toISOString();};
  const makeId=prefix=>requireExecutionId(idFactory(prefix),`${prefix} id`);
  const statement=(sql,...args)=>db.prepare(sql).bind(...args);

  return Object.freeze({get:taskId=>readD1ExecutionRun({db,customer:{customer_id:tenant},taskId}),async admit({objective,context={},input_commitment=null}={}){
    if(typeof objective!=='string'||objective.trim().length<3||objective.length>2000)throw new TypeError('bounded objective required');
    objective=objective.trim();
    if(input_commitment!==null){executionRecord(input_commitment,['kind','sha256'],'server input commitment');if(input_commitment.kind!=='decision'||!hex.test(input_commitment.sha256))throw new TypeError('server decision input commitment invalid');input_commitment=clone(input_commitment);}
    const proposal=normalizeExecutionContext(context),workId=proposal.work_id??makeId('work');
    if(proposal.agent_id!==EXECUTION_AGENT_ID)deny('unregistered execution agent');
    if(proposal.controls.budget>ceiling)deny('compute call budget exceeds server policy');
    const request={tenant_id:tenant,objective,...proposal,work_id:workId,input_commitment,server_policy:{max_provider_calls:providers,allowed_operations:allowed}};
    const requestHash=await sha256Json(request),created=instant();
    const prior=await statement('SELECT * FROM axiom_ec_works WHERE tenant_id=?1 AND work_id=?2',tenant,workId).first();
    let contract;
    if(prior){
      if(prior.request_sha256!==requestHash)deny('immutable Work contract does not match this objective or policy');
      contract=JSON.parse(prior.contract_json);
    }else{
      const body={schema:EXECUTION_CONTRACT_SCHEMA,tenant_id:tenant,project_id:proposal.project_id,work_id:workId,agent_id:EXECUTION_AGENT_ID,objective,
        success_criteria:proposal.success_criteria,required_outcomes:[...requiredExecutionOutcomes(objective),...(input_commitment?['decision']:[])],input_commitment,
        policy:{autonomy:proposal.controls.autonomy,privacy:proposal.controls.privacy,evidence:proposal.controls.evidence,budget_unit:EXECUTION_BUDGET_UNIT,max_compute_calls:proposal.controls.budget,max_provider_calls:providers,allowed_operations:clone(allowed),allowed_actions:['compute','research','model','decision']},
        issued_at:created,expires_at:new Date(Date.parse(created)+ttl).toISOString()};
      contract={...body,contract_sha256:await sha256Json(body)};
      await db.batch([
        statement("INSERT OR IGNORE INTO axiom_ec_projects(tenant_id,project_id,state) VALUES(?1,?2,'ACTIVE')",tenant,contract.project_id),
        statement("INSERT OR IGNORE INTO axiom_ec_agents(tenant_id,agent_id,state) VALUES(?1,?2,'ACTIVE')",tenant,contract.agent_id),
        statement("INSERT OR IGNORE INTO axiom_ec_works(tenant_id,work_id,project_id,agent_id,request_sha256,contract_sha256,contract_json,state,expires_at,max_compute_calls,max_provider_calls) VALUES(?1,?2,?3,?4,?5,?6,?7,'ACTIVE',?8,?9,?10)",tenant,workId,contract.project_id,contract.agent_id,requestHash,contract.contract_sha256,canonicalJson(contract),contract.expires_at,contract.policy.max_compute_calls,contract.policy.max_provider_calls),
      ]);
      const persisted=await statement('SELECT * FROM axiom_ec_works WHERE tenant_id=?1 AND work_id=?2',tenant,workId).first();
      if(!persisted||persisted.request_sha256!==requestHash)deny('immutable Work admission conflict');
      contract=JSON.parse(persisted.contract_json);
    }
    await validateExecutionContract(contract);contract=deepFreeze(contract);
    const bindingId=makeId('binding');let activeRun=null;

    async function assertBound(input={}){
      if(input.customer&&input.customer.customer_id!==tenant)deny('cross-tenant execution binding');
      if(input.objective!==undefined&&input.objective!==contract.objective)deny('execution objective mismatch');
      await validateExecutionContract(contract);
      const row=await statement("SELECT w.*,p.state AS project_state,a.state AS agent_state FROM axiom_ec_works w JOIN axiom_ec_projects p ON p.tenant_id=w.tenant_id AND p.project_id=w.project_id JOIN axiom_ec_agents a ON a.tenant_id=w.tenant_id AND a.agent_id=w.agent_id WHERE w.tenant_id=?1 AND w.work_id=?2",tenant,workId).first();
      if(!row||row.contract_sha256!==contract.contract_sha256||row.contract_json!==canonicalJson(contract)||row.state!=='ACTIVE'||row.project_state!=='ACTIVE'||row.agent_state!=='ACTIVE'||row.expires_at<=instant())deny('execution authority expired, revoked or changed');
      if(contract.policy.autonomy==='Preview only')deny('Preview only does not authorize execution');
      if(contract.policy.autonomy==='Approval each action')deny('Approval each action requires an admitted action approval');
      if(contract.policy.evidence==='Independent validation')deny('Independent validation requires a qualified independent verifier');
      if(activeRun){
        const run=await statement('SELECT status,binding_id,generation,lease_expires_at FROM axiom_ec_runs WHERE tenant_id=?1 AND task_id=?2',tenant,activeRun.task_id).first();
        if(!run||run.status!=='RUNNING'||run.binding_id!==bindingId||run.generation!==activeRun.generation||run.lease_expires_at<=instant())deny('execution lease is no longer active');
      }
      return true;
    }

    async function get(taskId){
      return readD1ExecutionRun({db,customer:{customer_id:tenant},taskId});
    }

    return Object.freeze({contract,assertBound,
      async reserve(action={}){
        executionRecord(action,['kind','operation','provider_calls'],'execution action');
        await assertBound();
        if(!contract.policy.allowed_actions.includes(action.kind))deny('unregistered execution action');
        if(action.kind==='compute'&&(!contract.policy.allowed_operations.includes(action.operation)||!allowed.includes(action.operation)))deny('compute operation is outside the registered agent scope');
        if(['research','model'].includes(action.kind)&&contract.policy.privacy==='Private')deny('Private work does not permit external research or model processing');
        const providerCost=integer(action.provider_calls,['research','model'].includes(action.kind)?1:0,'provider_calls');
        if(!['research','model'].includes(action.kind)&&providerCost!==0)throw new TypeError('local action cannot declare provider calls');
        if(['research','model'].includes(action.kind)&&providerCost<1)throw new TypeError('external action must reserve its provider calls');
        const computeCost=action.kind==='compute'?1:0,time=instant();
        const results=await db.batch([
          statement("UPDATE axiom_ec_works SET compute_calls=compute_calls+?3,provider_calls=provider_calls+?4 WHERE tenant_id=?1 AND work_id=?2 AND contract_sha256=?5 AND state='ACTIVE' AND expires_at>?6 AND compute_calls+?3<=max_compute_calls AND provider_calls+?4<=max_provider_calls AND EXISTS(SELECT 1 FROM axiom_ec_projects p WHERE p.tenant_id=?1 AND p.project_id=axiom_ec_works.project_id AND p.state='ACTIVE') AND EXISTS(SELECT 1 FROM axiom_ec_agents a WHERE a.tenant_id=?1 AND a.agent_id=axiom_ec_works.agent_id AND a.state='ACTIVE')",tenant,workId,computeCost,providerCost,contract.contract_sha256,time),
          statement('INSERT INTO axiom_ec_reservations(tenant_id,reservation_id,work_id,task_id,binding_id,generation,action_kind,operation,compute_calls,provider_calls,created_at) SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11 WHERE changes()=1',tenant,makeId('reservation'),workId,activeRun?.task_id??null,bindingId,activeRun?.generation??null,action.kind,action.operation??null,computeCost,providerCost,time),
        ]);
        if(changed(results[0])!==1||changed(results[1])!==1)deny('execution call budget exhausted or authority revoked');
        if(activeRun){
          const until=new Date(Math.min(Date.parse(contract.expires_at),Date.parse(time)+leaseMs)).toISOString();
          const refreshed=await statement("UPDATE axiom_ec_runs SET lease_expires_at=?5 WHERE tenant_id=?1 AND task_id=?2 AND binding_id=?3 AND generation=?4 AND status='RUNNING' AND lease_expires_at>?6",tenant,activeRun.task_id,bindingId,activeRun.generation,until,time).run();
          if(changed(refreshed)!==1)deny('execution lease changed during reservation');
        }
        return {kind:action.kind,compute_calls:computeCost,provider_calls:providerCost,budget_unit:EXECUTION_BUDGET_UNIT};
      },
      async create(task){
        await assertBound({customer:{customer_id:task?.customer_id},objective:task?.objective});
        const taskId=requireExecutionId(task.task_id,'task id');
        requireExecutionId(task.request_id,'request id');
        if(task.status!=='RUNNING')throw new TypeError('new task must be RUNNING');
        const time=instant(),until=new Date(Math.min(Date.parse(contract.expires_at),Date.parse(time)+leaseMs)).toISOString();
        await statement("INSERT INTO axiom_ec_runs(tenant_id,task_id,work_id,contract_sha256,status,binding_id,generation,lease_expires_at,started_at,result_json) VALUES(?1,?2,?3,?4,'RUNNING',?5,1,?6,?7,?8)",tenant,taskId,workId,contract.contract_sha256,bindingId,until,time,canonicalJson(task)).run();
        activeRun={task_id:taskId,generation:1};return clone(task);
      },
      async resume(taskId){
        requireExecutionId(taskId,'task id');await assertBound();const time=instant();
        const run=await statement('SELECT * FROM axiom_ec_runs WHERE tenant_id=?1 AND task_id=?2 AND work_id=?3',tenant,taskId,workId).first();
        if(!run||run.status!=='RUNNING'||run.lease_expires_at>time)deny('only an expired running lease can be reclaimed');
        const until=new Date(Math.min(Date.parse(contract.expires_at),Date.parse(time)+leaseMs)).toISOString();
        const result=await statement("UPDATE axiom_ec_runs SET binding_id=?4,generation=generation+1,lease_expires_at=?5 WHERE tenant_id=?1 AND task_id=?2 AND work_id=?3 AND status='RUNNING' AND generation=?6 AND lease_expires_at<=?7",tenant,taskId,workId,bindingId,until,run.generation,time).run();
        if(changed(result)!==1)deny('execution lease already reclaimed');activeRun={task_id:taskId,generation:run.generation+1};return get(taskId);
      },
      async complete(task){
        if(!task||task.customer_id!==tenant||task.objective!==contract.objective||!activeRun||task.task_id!==activeRun.task_id)deny('task does not belong to this execution binding');
        const existing=await statement('SELECT status,result_json FROM axiom_ec_runs WHERE tenant_id=?1 AND task_id=?2',tenant,task.task_id).first();
        if(existing?.status==='COMPLETED'){
          if(canonicalJson(task)!==existing.result_json)deny('conflicting completion replay');return get(task.task_id);
        }
        await assertBound();
        const initial=JSON.parse(existing?.result_json??'{}');
        if(!await verifyExecutionResultCommitment(task))throw new DOMException('execution result commitment mismatch','DataError');
        if(task.status!=='COMPLETED'||task.request_id!==initial.request_id||task.receipt?.request_id!==task.request_id||task.receipt?.task_id!==task.task_id||task.receipt?.customer_id!==tenant||task.receipt?.status!=='COMPLETED'||task.receipt?.operation!==(task.execution?.operation??null)||task.receipt?.contract_sha256!==contract.contract_sha256||canonicalJson(task.execution_contract)!==canonicalJson(contract)||!await verifyTaskCommitments(task))throw new DOMException('task, contract, artifact or receipt commitment mismatch','DataError');
        for(const key of ['project_id','work_id','agent_id','contract_sha256'])if(task.artifact[key]!==contract[key])throw new DOMException('artifact object identity mismatch','DataError');
        const sources=task.sources??[];
        if(!Array.isArray(sources)||sources.some(s=>typeof s?.source_id!=='string')||new Set(sources.map(s=>s.source_id)).size!==sources.length)throw new TypeError('unique captured sources required');
        for(const source of sources){let url;try{url=new URL(source.url);}catch{throw new TypeError('captured source URL invalid');}if(!['http:','https:'].includes(url.protocol)||url.username||url.password||source.instruction_authority!=='NONE_DATA_ONLY')throw new DOMException('captured source cannot grant instruction authority or contain credential URLs','DataError');}
        const commitments=await Promise.all(sources.map(async s=>({source_id:s.source_id,sha256:await sha256Json(s)})));
        if(canonicalJson(task.receipt.source_commitments??[])!==canonicalJson(commitments))throw new DOMException('source snapshot commitment mismatch','DataError');
        const sourceMap=new Map(sources.map(s=>[s.source_id,s]));
        for(const citation of task.artifact.citations??[])if(!sourceMap.has(citation.source_id)||canonicalJson(citation)!==canonicalJson(sourceMap.get(citation.source_id)))throw new DOMException('artifact citation does not match captured evidence','DataError');
        if(contract.required_outcomes.includes('research')&&(!sources.length||!task.artifact.citations?.length))throw new DOMException('required research evidence is absent','DataError');
        if(contract.required_outcomes.includes('compute')&&!task.execution)throw new DOMException('required compute outcome is absent','DataError');
        if(contract.input_commitment&&(canonicalJson(task.input_commitment)!==canonicalJson(contract.input_commitment)||task.execution?.operation!=='decision.evaluate'))throw new DOMException('required decision input or outcome commitment mismatch','DataError');
        if(task.execution?.operation==='decision.evaluate'&&(task.execution.http_status!==200||task.execution.result?.recommendation_only!==true||task.execution.result?.authority_granted!==false))throw new DOMException('decision output must remain recommendation-only','DataError');
        if(task.execution?.operation&&task.execution.operation!=='decision.evaluate'){
          if(!contract.policy.allowed_operations.includes(task.execution.operation)||task.execution.http_status!==200||task.execution.receipt?.result_commitment_verified!==true||!hex.test(task.execution.receipt.result_sha256??''))throw new DOMException('protected execution commitment has not been verified','DataError');
          if(task.execution.request_id!==task.request_id)throw new DOMException('protected execution request mismatch','DataError');
        }
        const admitted=await statement('SELECT action_kind,operation FROM axiom_ec_reservations WHERE tenant_id=?1 AND task_id=?2 AND binding_id=?3 AND generation=?4',tenant,task.task_id,bindingId,activeRun.generation).all(),actions=admitted.results??admitted;
        if(!actions.length)deny('completed task has no admitted action reservation');
        if(task.execution?.operation&&task.execution.operation!=='decision.evaluate'&&!actions.some(a=>a.action_kind==='compute'&&a.operation===task.execution.operation))deny('compute result has no admitted action reservation');
        if(task.execution?.operation==='decision.evaluate'&&!actions.some(a=>a.action_kind==='decision'))deny('decision result has no admitted action reservation');
        if(sources.length&&!actions.some(a=>a.action_kind==='research'))deny('captured research has no admitted action reservation');
        const artifactId=`artifact_${task.task_id}`,time=instant(),evidence=[{id:`evidence_${task.task_id}_contract`,kind:'EXECUTION_CONTRACT',content:contract},...sources.map((s,i)=>({id:`evidence_${task.task_id}_source_${i}`,kind:'CAPTURED_SOURCE_NOT_ENTAILMENT',content:s}))];
        if(task.execution)evidence.push({id:`evidence_${task.task_id}_execution`,kind:'EXECUTION_RECORD',content:task.execution});
        evidence.push({id:`evidence_${task.task_id}_receipt`,kind:'COMPLETION_RECEIPT',content:task.receipt});
        const statements=[statement('INSERT INTO axiom_ec_artifacts(tenant_id,artifact_id,task_id,work_id,content_sha256,content_json,binding_id,generation,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)',tenant,artifactId,task.task_id,workId,task.receipt.artifact_sha256,canonicalJson(task.artifact),bindingId,activeRun.generation,time)];
        for(const row of evidence)statements.push(statement('INSERT INTO axiom_ec_evidence(tenant_id,evidence_id,artifact_id,kind,content_sha256,content_json) VALUES(?1,?2,?3,?4,?5,?6)',tenant,row.id,artifactId,row.kind,await sha256Json(row.content),canonicalJson(row.content)));
        statements.push(statement("UPDATE axiom_ec_runs SET status='COMPLETED',completed_at=?5,result_json=?6 WHERE tenant_id=?1 AND task_id=?2 AND binding_id=?3 AND generation=?4 AND status='RUNNING'",tenant,task.task_id,bindingId,activeRun.generation,time,canonicalJson(task)));
        const results=await db.batch(statements);
        if(changed(results.at(-1))!==1)throw new DOMException('terminal execution update was not applied','InvalidStateError');
        return get(task.task_id);
      },
      async fail(task){
        if(!activeRun||task?.task_id!==activeRun.task_id||task.customer_id!==tenant||task.objective!==contract.objective)deny('failure does not belong to this execution binding');
        const time=instant();
        await statement("UPDATE axiom_ec_runs SET status='FAILED',completed_at=?5,result_json=?6 WHERE tenant_id=?1 AND task_id=?2 AND binding_id=?3 AND generation=?4 AND status='RUNNING' AND lease_expires_at>?5",tenant,task.task_id,bindingId,activeRun.generation,time,canonicalJson({...task,status:'FAILED'})).run();
        return get(task.task_id);
      },
      get,
      async revoke(){await statement("UPDATE axiom_ec_works SET state='REVOKED' WHERE tenant_id=?1 AND work_id=?2 AND contract_sha256=?3",tenant,workId,contract.contract_sha256).run();},
    });
  }});
}
