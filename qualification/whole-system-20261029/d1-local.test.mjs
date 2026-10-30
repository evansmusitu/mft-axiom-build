/** Isolated workerd/D1 compatibility. No hosted account, deployment or provider calls. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createD1ExecutionGovernance} from '../../ops/axiom_execution_contract.mjs';
import {executeDecisionTask} from '../../axiom_interface/vnext/runtime_decision_service.mjs';
import {handleRuntimeTaskApi} from '../../ops/axiom_runtime_task_api.mjs';
import {sha256Json} from '../../axiom_interface/vnext/execution_integrity.mjs';

const {Miniflare}=await import(process.env.AXIOM_MINIFLARE_MODULE||'miniflare');
const schema=readFileSync(new URL('../../ops/axiom_execution_contract_schema.sql',import.meta.url),'utf8');
const problem=JSON.parse(readFileSync(new URL('../../frontier_v5/fixtures/decision_analysis_v1.json',import.meta.url),'utf8')).cases[0].problem;
const objective='Compare the declared alternatives.';
const customer={customer_id:'tenant-alpha'};
const context={project_id:'project-one',work_id:'work-one',controls:{privacy:'Private',budget:1}};
const options=persist=>({modules:true,compatibilityDate:'2026-07-01',cf:false,
  script:'export default {fetch(){return new Response("isolated-local-only")}}',
  d1Databases:{EXECUTION_DB:'00000000-0000-4000-8000-000000000055'},
  ...(persist?{d1Persist:persist}:{})});

async function fixture(t,{persist}={}){
  let mf=new Miniflare(options(persist));
  let db=await mf.getD1Database('EXECUTION_DB');
  t.after(async()=>{if(mf)await mf.dispose();});
  // D1 exec consumes complete statements per line; retain the trigger body.
  const ddl=schema.split('\n').filter(line=>!line.trimStart().startsWith('--')).join('\n').trim()
    .split(/\n(?=(?:PRAGMA|CREATE (?:TABLE|TRIGGER|INDEX))\b)/u)
    .map(sql=>sql.replace(/\s+/g,' ').trim()).join('\n');
  await db.exec(ddl);
  await db.exec(ddl); // Applying the candidate schema twice must preserve data.
  const clock={ms:Date.parse('2026-10-30T10:00:00.000Z')};
  const gate=(tenant=customer.customer_id)=>createD1ExecutionGovernance({db,customer:{customer_id:tenant},now:()=>new Date(clock.ms),serverPolicy:{lease_ms:1000}});
  const admit=async(tenant=customer.customer_id,extra={})=>gate(tenant).admit({objective,context,...extra,input_commitment:{kind:'decision',sha256:await sha256Json(problem)}});
  const run=async(binding,taskId='task_one',emit)=>executeDecisionTask({objective,customer:{customer_id:binding.contract.tenant_id},problem,governance:binding,idFactory:()=>taskId,now:()=>new Date(clock.ms),emit});
  const count=async table=>(await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n;
  return {get db(){return db;},clock,gate,admit,run,count,reapplySchema:()=>db.exec(ddl),async restart(){await mf.dispose();mf=null;mf=new Miniflare(options(persist));db=await mf.getD1Database('EXECUTION_DB');}};
}

test('workerd D1: real decision completion links all five objects and tenant-scopes equal IDs',{timeout:30000},async t=>{
  const f=await fixture(t),a=await f.admit(),b=await f.admit('tenant-beta');
  const first=await f.run(a),second=await f.run(b);
  assert.equal(first.execution.result.expected_utilities.launch,28);
  assert.equal(first.execution.result.authority_granted,false);
  assert.equal(second.customer_id,'tenant-beta');
  await f.reapplySchema();
  const saved=await f.gate().get(first.task_id);
  assert.equal(saved.receipt.receipt_sha256,first.receipt.receipt_sha256);
  assert.equal(saved.object_refs.artifacts.length,1);
  assert.deepEqual(saved.object_refs.evidence.map(x=>x.kind).sort(),['COMPLETION_RECEIPT','EXECUTION_CONTRACT','EXECUTION_RECORD']);
  for(const table of ['projects','works','agents','runs','artifacts'])assert.equal(await f.count('axiom_ec_'+table),2,table);
  assert.equal(await f.count('axiom_ec_evidence'),6);
  assert.equal(await f.gate('tenant-unrelated').get(first.task_id),null);
});

test('workerd D1: concurrent reservations admit exactly one call under a one-call budget',{timeout:30000},async t=>{
  const f=await fixture(t),binding=await f.admit();
  await binding.create({task_id:'task_race',request_id:'request_race',customer_id:customer.customer_id,objective,status:'RUNNING',execution_contract:binding.contract});
  const results=await Promise.allSettled(Array.from({length:12},()=>binding.reserve({kind:'compute',operation:'arithmetic.evaluate'})));
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(await f.count('axiom_ec_reservations'),1);
  assert.equal((await f.db.prepare('SELECT compute_calls FROM axiom_ec_works').first()).compute_calls,1);
});

test('workerd D1: a failed evidence insert rolls back artifact and completion together',{timeout:30000},async t=>{
  const f=await fixture(t),binding=await f.admit();
  await f.db.exec("CREATE TRIGGER qualification_fail_evidence BEFORE INSERT ON axiom_ec_evidence BEGIN SELECT RAISE(ABORT,'forced_evidence_failure'); END;");
  await assert.rejects(()=>f.run(binding),/forced_evidence_failure/);
  assert.equal(await f.count('axiom_ec_artifacts'),0);
  assert.equal(await f.count('axiom_ec_evidence'),0);
  assert.equal(await f.count('axiom_ec_reservations'),1,'uncertain action consumption remains durable');
  assert.equal((await f.gate().get('task_one')).status,'FAILED');
});

test('workerd D1: observer failure preserves a replayable durable success',{timeout:30000},async t=>{
  const f=await fixture(t),binding=await f.admit();
  const saved=await f.run(binding,'task_observer',()=>{throw new Error('observer disconnected');});
  assert.equal((await f.gate().get(saved.task_id)).status,'COMPLETED');
  assert.equal(await f.count('axiom_ec_reservations'),1);
});

test('workerd D1: expired lease reclamation fences stale writes without resetting consumption',{timeout:30000},async t=>{
  const f=await fixture(t),old=await f.admit();
  const initial={task_id:'task_recovery',request_id:'request_recovery',customer_id:customer.customer_id,objective,status:'RUNNING',execution_contract:old.contract};
  await old.create(initial);await old.reserve({kind:'compute',operation:'arithmetic.evaluate'});
  f.clock.ms+=1001;
  const fresh=await f.admit();await fresh.resume(initial.task_id);
  await assert.rejects(()=>old.reserve({kind:'compute',operation:'arithmetic.evaluate'}));
  await old.fail({...initial,error_message:'stale failure'});
  assert.equal((await f.gate().get(initial.task_id)).status,'RUNNING');
  assert.equal((await f.db.prepare('SELECT generation FROM axiom_ec_runs').first()).generation,2);
  await assert.rejects(()=>fresh.reserve({kind:'compute',operation:'arithmetic.evaluate'}));
  assert.equal(await f.count('axiom_ec_reservations'),1);
});

test('workerd D1: revocation and persisted counter tampering deny further admission',{timeout:30000},async t=>{
  const f=await fixture(t),binding=await f.admit();
  await assert.rejects(()=>binding.assertBound({customer:{customer_id:'tenant-beta'}}));
  assert.equal(await binding.assertBound(),true,'the untouched same-tenant binding remains valid');
  await binding.reserve({kind:'compute',operation:'arithmetic.evaluate'});
  await f.db.prepare('UPDATE axiom_ec_works SET compute_calls=0').run();
  await assert.rejects(()=>binding.reserve({kind:'compute',operation:'arithmetic.evaluate'}));
  assert.equal(await f.count('axiom_ec_reservations'),1);
  await binding.revoke();await assert.rejects(()=>binding.assertBound());
  await assert.rejects(()=>binding.assertBound({customer:{customer_id:'tenant-beta'}}));
});

test('workerd D1: persisted completion survives a runtime restart and rejects content mutation',{timeout:30000},async t=>{
  const directory=mkdtempSync(join(tmpdir(),'axiom-execution-d1-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const f=await fixture(t,{persist:directory}),binding=await f.admit();
  const original=await f.run(binding);await f.restart();
  const saved=await f.gate().get(original.task_id);
  assert.equal(saved.receipt.receipt_sha256,original.receipt.receipt_sha256);
  assert.equal(await f.count('axiom_ec_reservations'),1);
  const row=await f.db.prepare('SELECT result_json FROM axiom_ec_runs').first(),changed=JSON.parse(row.result_json);
  changed.decision_input.states[0].probability=0.9;
  await f.db.prepare('UPDATE axiom_ec_runs SET result_json=?').bind(JSON.stringify(changed)).run();
  await assert.rejects(()=>f.gate().get(original.task_id),/commitment|proof/);
});

test('workerd D1: HTTP decision submission replays once and tenant-scopes saved readback',{timeout:30000},async t=>{
  const f=await fixture(t),jobs=[],origin='https://isolated-qualification.example';
  const env={AXIOM_DB:f.db,TASK_RATE_LIMITER:{limit:async()=>({success:true})}};
  const payload={objective,submission_id:'d1-submission-one',execution_context:context,decision:problem};
  const request=()=>new Request(origin+'/vnext/api/tasks',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(payload)});
  const args={customer,origin,executionCtx:{waitUntil(job){jobs.push(job);}},fetchImpl:async()=>{throw new Error('external providers forbidden');}};
  const response=await handleRuntimeTaskApi(request(),env,args);
  assert.equal(response.status,200);assert.match(await response.text(),/event: complete/);await Promise.all(jobs);
  const lookup=new Request(origin+'/vnext/api/submissions/'+payload.submission_id);
  const saved=await handleRuntimeTaskApi(lookup,env,{customer,origin});assert.equal(saved.status,200);
  const result=await saved.json();assert.equal(result.status,'COMPLETED');assert.equal(result.execution.result.expected_utilities.launch,28);
  const replay=await handleRuntimeTaskApi(request(),env,args);assert.equal(replay.status,200);assert.ok((await replay.text()).includes(result.receipt.receipt_sha256));
  assert.equal(await f.count('axiom_ec_reservations'),1);assert.equal(await f.count('axiom_ec_runs'),1);
  const denied=await handleRuntimeTaskApi(lookup,env,{customer:{customer_id:'tenant-beta'},origin});assert.equal(denied.status,404);
});

test('workerd D1: cancelled HTTP observer can reconcile the original durable decision',{timeout:30000},async t=>{
  const f=await fixture(t),jobs=[],origin='https://isolated-qualification.example';
  const env={AXIOM_DB:f.db,TASK_RATE_LIMITER:{limit:async()=>({success:true})}};
  const payload={objective,submission_id:'d1-disconnected-submission',execution_context:context,decision:problem};
  const response=await handleRuntimeTaskApi(new Request(origin+'/vnext/api/tasks',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(payload)}),env,{customer,origin,executionCtx:{waitUntil(job){jobs.push(job);}},fetchImpl:async()=>{throw new Error('external providers forbidden');}});
  assert.equal(response.status,200);await response.body.cancel();await Promise.all(jobs);
  const readback=await handleRuntimeTaskApi(new Request(origin+'/vnext/api/submissions/'+payload.submission_id),env,{customer,origin});
  assert.equal(readback.status,200);assert.equal((await readback.json()).status,'COMPLETED');
  assert.equal(await f.count('axiom_ec_reservations'),1);assert.equal(await f.count('axiom_ec_artifacts'),1);
});

test('workerd D1: maximum supported range proof remains bounded and replayable',{timeout:30000},async t=>{
  const f=await fixture(t),large=structuredClone(problem);
  large.probability_range={state_id:'favorable',lower:0,upper:1};
  large.actions=Array.from({length:20},(_,i)=>({id:`action_${i}_`+'x'.repeat(80),utilities:{favorable:(i+1)/101,unfavorable:i%2?Number.MIN_VALUE:-(i+1)/103}}));
  const binding=await f.gate().admit({objective,context,input_commitment:{kind:'decision',sha256:await sha256Json(large)}});
  const result=await executeDecisionTask({objective,customer,problem:large,governance:binding,idFactory:()=> 'task_range_size',now:()=>new Date(f.clock.ms)});
  assert.equal(result.execution.result.robustness.pairwise_break_even.length,190);
  assert.ok(Buffer.byteLength(JSON.stringify(result))<500_000,'the exact-threshold task proof must remain bounded');
  assert.equal((await f.gate().get(result.task_id)).receipt.receipt_sha256,result.receipt.receipt_sha256);
  assert.equal(await f.count('axiom_ec_artifacts'),1);
});
