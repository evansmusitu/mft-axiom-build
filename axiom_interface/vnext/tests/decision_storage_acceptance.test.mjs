import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sqliteD1,applyExecutionSchema} from '../../tests/execution_test_helpers.mjs';
import {handleRuntimeTaskApi} from '../../../ops/axiom_runtime_task_api.mjs';

const base=JSON.parse(readFileSync(new URL('../../../frontier_v5/fixtures/decision_analysis_v1.json',import.meta.url),'utf8')).cases[0].problem;
const customer={customer_id:'tenant-decision-storage'},origin='https://decision-qualification.example';

function fixture(t,problem=structuredClone(base)){
  const db=applyExecutionSchema(sqliteD1()),jobs=[];
  t.after(async()=>{await Promise.allSettled(jobs);db.connection.close();});
  const payload={objective:'Compare the declared alternatives.',submission_id:'decision-storage-submission',execution_context:{project_id:'project-decision',work_id:'work-decision',controls:{privacy:'Private',budget:0}},decision:problem};
  const env={AXIOM_DB:db,TASK_RATE_LIMITER:{limit:async()=>({success:true})}};
  const args={customer,origin,executionCtx:{waitUntil(job){jobs.push(job);}},fetchImpl:async()=>{throw new Error('local decisions must not call providers');}};
  const submit=()=>handleRuntimeTaskApi(new Request(origin+'/vnext/api/tasks',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(payload)}),env,args);
  const read=()=>handleRuntimeTaskApi(new Request(origin+'/vnext/api/submissions/'+payload.submission_id),env,{customer,origin});
  return {db,jobs,payload,submit,read};
}

test('a governed local decision needs no protected runtime or model binding',async t=>{
  const f=fixture(t),response=await f.submit();
  assert.equal(response.status,200);assert.match(await response.text(),/event: complete/);await Promise.all(f.jobs);
  const saved=await f.read();assert.equal(saved.status,200);
  const value=await saved.json();assert.equal(value.status,'COMPLETED');assert.equal(value.execution.result.expected_utilities.launch,28);
  assert.equal(value.execution.result.authority_granted,false);
  const replay=await f.submit();assert.equal(replay.status,200);assert.ok((await replay.text()).includes(value.receipt.receipt_sha256));
  assert.equal(f.db.connection.prepare('SELECT COUNT(*) AS n FROM axiom_ec_reservations').get().n,1);
});

test('probability robustness is committed and replayed by the governed HTTP decision path',async t=>{
  const problem=structuredClone(base);problem.probability_range={state_id:'favorable',lower:0.2,upper:0.8};
  const f=fixture(t,problem),response=await f.submit();
  assert.equal(response.status,200);assert.match(await response.text(),/event: complete/);await Promise.all(f.jobs);
  const read=await f.read();assert.equal(read.status,200);const saved=await read.json();
  assert.ok(saved.execution.result.robustness,'range analysis must survive committed storage and full result replay');
  assert.equal(saved.execution.result.robustness.lower,0.2);
  assert.equal(saved.execution.result.robustness.upper,0.8);
  assert.deepEqual(saved.decision_input.probability_range,problem.probability_range);
  f.payload.decision.probability_range.upper=0.9;
  assert.equal((await f.submit()).status,403,'a changed range cannot reuse the immutable Work');
  assert.equal(f.db.connection.prepare('SELECT COUNT(*) AS n FROM axiom_ec_reservations').get().n,1);
  const row=f.db.connection.prepare('SELECT result_json FROM axiom_ec_runs').get(),changed=JSON.parse(row.result_json);
  changed.decision_input.probability_range.upper=0.9;
  f.db.connection.prepare('UPDATE axiom_ec_runs SET result_json=?').run(JSON.stringify(changed));
  assert.equal((await f.read()).status,503,'stored range tampering must invalidate replay');
});
