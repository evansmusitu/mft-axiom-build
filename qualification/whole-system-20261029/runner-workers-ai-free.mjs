/** Real Workers AI; local SQLite governance. No deployment or hosted D1 claim. */
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {sqliteD1,applyExecutionSchema} from '../../axiom_interface/tests/execution_test_helpers.mjs';
import {handleRuntimeTaskApi,createWorkersAIModel} from '../../ops/axiom_runtime_task_api.mjs';
import {createD1ExecutionGovernance} from '../../ops/axiom_execution_contract.mjs';
import {ATOMIC_OPERATIONS} from '../../axiom_interface/vnext/capability_registry.js';
import {sha256Json,verifyTaskCommitments} from '../../axiom_interface/vnext/execution_integrity.mjs';
import {FREE_MODEL} from './workers-ai-free-preflight.mjs';
import {readAINeurons,createBoundedWorkersAI} from './workers-ai-free-client.mjs';

const repo='evansmusitu/mft-axiom-build',claimName='axiom-workers-ai-dispatch-20261101-01';
assert.equal(process.env.GITHUB_REPOSITORY,repo);assert.equal(process.env.GITHUB_RUN_ATTEMPT,'1');
assert.equal(process.env.AXIOM_FREE_AUTHORIZATION,'user-just-use-that-account-20261101');
const out=resolve(process.env.AXIOM_FREE_OUTPUT||'qualification/whole-system-20261029/workers-ai-free-results');mkdirSync(out,{recursive:true});
const write=(name,data)=>writeFileSync(resolve(out,name),JSON.stringify(data,null,2)+'\n');
async function github(path){
  const response=await fetch('https://api.github.com/repos/'+repo+path,{headers:{authorization:'Bearer '+process.env.GH_TOKEN,accept:'application/vnd.github+json'},redirect:'error',signal:AbortSignal.timeout(15000)});
  assert.equal(response.ok,true,'dispatch claim must be readable');return response.json();
}
if(process.argv.includes('--claim')){
  const existing=await github('/actions/artifacts?per_page=100&name='+claimName);assert.equal(existing.total_count,0,'a prior dispatch claim exists; do not resend');
  write('dispatch-claim.json',{name:claimName,source_sha:process.env.AXIOM_ACCEPTANCE_SOURCE_SHA,run_id:process.env.GITHUB_RUN_ID,status:'RESERVED_BEFORE_INFERENCE',release_authorized:false});
}else{
  const claim=await github('/actions/artifacts/'+process.env.AXIOM_REMOTE_CLAIM_ID);assert.equal(claim.name,claimName);assert.equal(String(claim.workflow_run.id),process.env.GITHUB_RUN_ID);assert.equal(claim.expired,false);
  const report={schema:'musitu.axiom.workers-ai-acceptance.v1',source_sha:process.env.AXIOM_ACCEPTANCE_SOURCE_SHA,workflow_run_id:process.env.GITHUB_RUN_ID,remote_claim_id:claim.id,
    scope:'REAL_WORKERS_AI_WITH_LOCAL_SQLITE_GOVERNANCE',started_at:new Date().toISOString(),checks:{},inference_calls:0,model:FREE_MODEL,
    hosted_d1_qualified:false,openai_agents_qualified:false,independent_custody_certified:false,anti_rollback_certified:false,release_authorized:false,billing_changes:0,deployments:0};
  const save=()=>write('acceptance.json',report);save();let db,transport;
  const dbPath=resolve(out,'execution.sqlite');
  try{
    report.usage_before=await readAINeurons({token:process.env.CLOUDFLARE_API_TOKEN});save();
    transport=createBoundedWorkersAI({token:process.env.CLOUDFLARE_API_TOKEN,usage:report.usage_before,observe:calls=>{report.inference_calls=calls.length;write('provider-observations.json',calls);save();}});report.limits=transport.limits;save();
    db=applyExecutionSchema(sqliteD1(dbPath));db.exec(readFileSync('ops/axiom_evidence_lifecycle_schema.sql','utf8'));
    const customer={customer_id:'workers-ai-acceptance'},origin='https://isolated-workers-ai.test',waits=[];
    const env={AXIOM_DB:db,AI:transport.AI,AI_MODEL:FREE_MODEL,TASK_RATE_LIMITER:{limit:async()=>({success:true})},
      AXIOM_RUNTIME:{fetch:async url=>{const path=new URL(url).pathname;assert.ok(['/health','/v1/tools'].includes(path),'no protected compute substitute is admitted');return Response.json(path==='/health'?{ok:true,build_id:'QUALIFICATION_CATALOG_ONLY_NO_COMPUTE',operation_count:74}:{tools:ATOMIC_OPERATIONS,operation_count:74,build_id:'QUALIFICATION_CATALOG_ONLY_NO_COMPUTE'});}}};
    const request=(path,options={})=>handleRuntimeTaskApi(new Request(origin+path,options),env,{customer,origin,executionCtx:{waitUntil:p=>waits.push(p)}});
    const nonce=randomBytes(12).toString('hex'),objective=`Return a short acknowledgement containing marker ${nonce}. Select operation null. Include the marker in the final summary.`,payload={objective,submission_id:'free-acceptance-one',execution_context:{project_id:'workers-ai-project',work_id:'workers-ai-output',controls:{privacy:'Project',budget:0}}};
    const response=await request('/vnext/api/tasks',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(payload)});assert.equal(response.status,200);
    const reader=response.body.getReader();const first=await reader.read();assert.match(new TextDecoder().decode(first.value),/ACCEPTED/);await reader.cancel('intentional observer interruption');
    await Promise.all(waits);
    const recovered=await request('/vnext/api/submissions/'+payload.submission_id);assert.equal(recovered.status,200);const result=await recovered.json();write('recovered-task.json',result);
    assert.equal(result.status,'COMPLETED');assert.equal(await verifyTaskCommitments(result),true);assert.ok(result.artifact.summary.includes(nonce),'actual model summary must contain the unseen marker');assert.equal(result.execution,null);assert.equal(transport.calls.length,2);assert.equal(result.object_refs.artifacts.length,1);assert.equal(result.object_refs.evidence.length,2);
    report.checks.output_receipt_observer_recovery={status:'CONFIRMED',task_id:result.task_id,actual_summary:result.artifact.summary,nonce_matches:true,receipt_sha256:result.receipt.receipt_sha256,artifact_sha256:result.receipt.artifact_sha256,provider_calls:2,inputs_resent:false};save();
    const replay=await request('/vnext/api/tasks',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(payload)});assert.equal(replay.status,200);assert.ok((await replay.text()).includes(result.receipt.receipt_sha256));assert.equal(transport.calls.length,2);
    const other=await createD1ExecutionGovernance({db,customer:{customer_id:'unrelated-tenant'}}).get(result.task_id);assert.equal(other,null);
    report.checks.replay_and_tenant_readback={status:'CONFIRMED',extra_model_calls:0,other_tenant_result:null};
    const fence=await createD1ExecutionGovernance({db,customer,serverPolicy:{max_compute_calls:0,max_provider_calls:0}}).admit({objective:'Budget denial acceptance.',context:{project_id:'workers-ai-project',work_id:'workers-ai-budget',controls:{privacy:'Project',budget:0}}});
    await assert.rejects(()=>fence.reserve({kind:'model'}),/budget/);assert.equal(transport.calls.length,2);report.checks.call_budget_denial={status:'CONFIRMED',extra_model_calls:0};
    db.connection.close();db=null;
    const child=spawnSync(process.execPath,['--input-type=module','-e',`import {sqliteD1} from './axiom_interface/tests/execution_test_helpers.mjs';import {createD1ExecutionGovernance} from './ops/axiom_execution_contract.mjs';const db=sqliteD1(process.argv[1]);const task=await createD1ExecutionGovernance({db,customer:{customer_id:'workers-ai-acceptance'}}).get(process.argv[2]);console.log(JSON.stringify({status:task.status,receipt_sha256:task.receipt.receipt_sha256}));db.connection.close();`,dbPath,result.task_id],{encoding:'utf8',timeout:15000});
    assert.equal(child.status,0,child.stderr);const fresh=JSON.parse(child.stdout);assert.equal(fresh.receipt_sha256,result.receipt.receipt_sha256);report.checks.fresh_process_readback={status:'CONFIRMED',...fresh,extra_model_calls:0};write('fresh-process-readback.json',fresh);
    db=sqliteD1(dbPath);
    const gate=createD1ExecutionGovernance({db,customer,serverPolicy:{max_compute_calls:0,max_provider_calls:1}}),controlObjective='Bounded cancellation control.';
    const bound=await gate.admit({objective:controlObjective,context:{project_id:'workers-ai-project',work_id:'workers-ai-cancel',controls:{privacy:'Project',budget:0}}});
    const base={schema:'musitu.axiom.runtime-task.v1',task_id:'task_workers_ai_cancel',request_id:'WORKERS-AI-CANCEL',customer_id:customer.customer_id,objective:controlObjective,execution_contract:bound.contract,status:'RUNNING',started_at:new Date().toISOString()};await bound.create(base);await bound.reserve({kind:'model'});
    const abort=new AbortController();const stream=await transport.request(FREE_MODEL,{messages:[{role:'user',content:'Print integers 1 through 5000 in order, one per line.'}],max_tokens:1800,stream:true},{signal:abort.signal});
    const sse=stream.body.getReader(),decoder=new TextDecoder();let pending='',observed=false;
    try{while(!observed){const next=await sse.read();assert.equal(next.done,false,'the provider must still be streaming');pending+=decoder.decode(next.value,{stream:true});assert.ok(pending.length<100000);const lines=pending.split('\n');pending=lines.pop();for(const line of lines){if(!line.startsWith('data:')||line.slice(5).trim()==='[DONE]')continue;const chunk=JSON.parse(line.slice(5));const delta=chunk.choices?.[0]?.delta?.content??chunk.response;if(typeof delta==='string'&&delta.length&&!chunk.choices?.[0]?.finish_reason&&!chunk.done){observed=true;break;}}}
      await bound.revoke();abort.abort();await sse.cancel().catch(()=>{});
    }finally{sse.releaseLock();}
    await assert.rejects(()=>bound.assertBound(),/revoked/);await assert.rejects(()=>createWorkersAIModel(env,{governance:bound})({stage:'planning'}),/revoked/);
    await bound.fail({...base,status:'FAILED',completed_at:new Date().toISOString(),error_code:'WORK_REVOKED_DURING_STREAM',error_message:'Operator revoked this acceptance control after a real content delta.'});
    const cancelled=await gate.get(base.task_id);assert.equal(cancelled.status,'FAILED');assert.equal(cancelled.object_refs.artifacts.length,0);assert.equal(cancelled.object_refs.evidence.length,0);assert.equal(transport.calls.length,3);
    transport.calls.at(-1).status='CLIENT_STREAM_ABORTED_AFTER_CONTENT_DELTA';write('provider-observations.json',transport.calls);
    report.checks.active_stream_abort_and_work_revocation={status:'CONFIRMED_CLIENT_AND_APPLICATION_SCOPE',content_delta_observed:true,abort_signal:true,work_revoked:true,terminal_application_status:'FAILED',successful_artifacts:0,extra_dispatch_after_revocation:0,provider_terminal_cancellation:'UNATTESTED_NO_PROVIDER_TURN_CANCEL_READBACK'};
    report.usage_after=await readAINeurons({token:process.env.CLOUDFLARE_API_TOKEN});assert.ok(report.usage_after.neurons<10000);report.checks.free_allowance_observation={status:'CONFIRMED_ANALYTICS_SCOPE',before:report.usage_before.neurons,after:report.usage_after.neurons,invoice_or_atomic_spend_proof:false};
    report.status='CONFIRMED_BOUNDED_COMPONENT_SCOPE';
  }catch(error){report.status='FAILED_OR_BLOCKED';report.error={name:error.name,code:error.code??null,message:error.message,details:error.details??null};process.exitCode=1;}
  finally{
    if(db){const rows={};for(const table of ['axiom_ec_works','axiom_ec_runs','axiom_ec_reservations','axiom_ec_artifacts','axiom_ec_evidence'])rows[table]=(await db.prepare('SELECT * FROM '+table).bind().all()).results;write('governance-journal.json',rows);db.connection.close();}
    for(const suffix of ['','-wal','-shm'])rmSync(dbPath+suffix,{force:true});report.cleanup={local_database_removed:true,cloud_resources_created:0};report.completed_at=new Date().toISOString();save();console.log(JSON.stringify(report));
  }
}
