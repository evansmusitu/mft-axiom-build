import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createD1ExecutionGovernance} from '../../../ops/axiom_execution_contract.mjs';
import {executeAnalyticalTask} from '../runtime_analytical_service.mjs';
import {sha256Json,verifyTaskCommitments} from '../execution_integrity.mjs';
import {ANALYTICAL_WORKFLOWS} from '../analytical_workflows.mjs';
import {cases} from './fixtures/analytical_inputs.mjs';
const schema=readFileSync(new URL('../../../ops/axiom_execution_contract_schema.sql',import.meta.url),'utf8');
const objective='Compare declared analytical inputs.';let sequence=0;
function fixture(t,workflow='bayesian-updating',{budget=1,tenant='tenant-a'}={}){
  const connection=new DatabaseSync(':memory:');connection.exec(schema);t.after(()=>connection.close());
  const db={prepare(sql){const query=connection.prepare(sql);let args=[];const s={bind(...values){args=values;return s;},run:async()=>({meta:{changes:query.run(...args).changes}}),first:async()=>query.get(...args)??null,all:async()=>({results:query.all(...args)}),_run:()=>({meta:{changes:query.run(...args).changes}})};return s;},async batch(statements){connection.exec('BEGIN IMMEDIATE');try{const out=statements.map(s=>s._run());connection.exec('COMMIT');return out;}catch(error){connection.exec('ROLLBACK');throw error;}}};
  const customer={customer_id:tenant},input={workflow,data:structuredClone(cases[workflow])},context={project_id:'project-analysis',work_id:'analysis-'+(++sequence),controls:{privacy:'Private',budget}};
  const gate=createD1ExecutionGovernance({db,customer});
  return {connection,db,customer,input,context,gate,async admit(extra={}){return gate.admit({objective,context,input_commitment:{kind:'analysis',sha256:await sha256Json(input)},...extra});}};
}
test('all registered analytical workflows persist five-object commitments and replayable receipts',async t=>{
  for(const workflow of ANALYTICAL_WORKFLOWS){
    const calls=workflow==='analytical-pipeline'?3:1,f=fixture(t,workflow,{budget:calls}),governance=await f.admit();
    const result=await executeAnalyticalTask({objective,customer:f.customer,input:f.input,governance});
    assert.equal(result.status,'COMPLETED',workflow);assert.equal(await verifyTaskCommitments(result),true);
    const restored=await f.gate.get(result.task_id);assert.equal(restored.object_refs.artifacts.length,1);assert.equal(restored.receipt.receipt_sha256,result.receipt.receipt_sha256);
    const usage=f.connection.prepare('SELECT compute_calls,provider_calls FROM axiom_ec_works').get();assert.deepEqual({...usage},{compute_calls:calls,provider_calls:0});
    assert.equal((await createD1ExecutionGovernance({db:f.db,customer:{customer_id:'other'}}).get(result.task_id)),null);
  }
});
test('admission binds exact input and cannot borrow another tenant or persistence store',async t=>{
  const f=fixture(t),governance=await f.admit();
  const changed=structuredClone(f.input);changed.data.states[0].likelihood=.1;
  await assert.rejects(()=>executeAnalyticalTask({objective,customer:f.customer,input:changed,governance}),/differs/);
  await assert.rejects(()=>executeAnalyticalTask({objective,customer:{customer_id:'other'},input:f.input,governance}),/cross-tenant/);
  await assert.rejects(()=>executeAnalyticalTask({objective,customer:f.customer,input:f.input,governance,store:{}}),/one admitted/);
  assert.equal(f.connection.prepare('SELECT COUNT(*) n FROM axiom_ec_runs').get().n,0);
});
test('local analysis consumes the admitted call budget and cannot substitute provider calls',async t=>{
  const f=fixture(t,'bayesian-updating',{budget:0}),governance=await f.admit();
  await assert.rejects(()=>executeAnalyticalTask({objective,customer:f.customer,input:f.input,governance}),/budget/);
  assert.equal(f.connection.prepare('SELECT status FROM axiom_ec_runs').get().status,'FAILED');
  assert.equal(f.connection.prepare('SELECT COUNT(*) n FROM axiom_ec_artifacts').get().n,0);
  const p=fixture(t,'analytical-pipeline',{budget:2}),bound=await p.admit();
  await assert.rejects(()=>executeAnalyticalTask({objective,customer:p.customer,input:p.input,governance:bound}),/budget/);
  assert.equal(p.connection.prepare('SELECT compute_calls FROM axiom_ec_works').get().compute_calls,2);
  await assert.rejects(()=>p.admit({context:{...p.context,controls:{budget:3}}}),/immutable/);
});
test('revocation and action approval deny analytical runs before computation',async t=>{
  const f=fixture(t),governance=await f.admit();await governance.revoke();
  await assert.rejects(()=>executeAnalyticalTask({objective,customer:f.customer,input:f.input,governance}),/revoked/);
  const p=fixture(t),b=await p.admit({context:{...p.context,controls:{budget:1,approval:'Every tool action'}}});
  await assert.rejects(()=>executeAnalyticalTask({objective,customer:p.customer,input:p.input,governance:b}),/requires an admitted/);
});
test('changed analytical input fails persisted readback',async t=>{
  const f=fixture(t),governance=await f.admit(),task=await executeAnalyticalTask({objective,customer:f.customer,input:f.input,governance});
  f.connection.prepare('UPDATE axiom_ec_runs SET result_json=? WHERE task_id=?').run(JSON.stringify({...task,analysis_input:{...f.input,data:{states:[]}}}),task.task_id);
  await assert.rejects(()=>f.gate.get(task.task_id),/commitment/);
});
test('forged analytical output with recomputed hashes cannot bypass numerical replay',async t=>{
  const f=fixture(t),bound=await f.admit(),capture={...bound,complete:async()=>{}};
  const task=await executeAnalyticalTask({objective,customer:f.customer,input:f.input,governance:capture});
  task.execution.result.result.posterior.fault=.99;
  task.execution.receipt.result_sha256=await sha256Json(task.execution.result);
  task.receipt.runtime_result_sha256=task.execution.receipt.result_sha256;
  task.receipt.artifact_sha256=await sha256Json(task.artifact);
  const {receipt,...payload}=task,{receipt_sha256,...body}=receipt;body.task_payload_sha256=await sha256Json(payload);task.receipt={...body,receipt_sha256:await sha256Json(body)};
  assert.equal(await verifyTaskCommitments(task),true,'ordinary content commitments alone are insufficient');
  await assert.rejects(()=>bound.complete(task),/execution result commitment/);
  assert.equal(f.connection.prepare('SELECT COUNT(*) n FROM axiom_ec_artifacts').get().n,0);
});
test('observer disconnect cannot overwrite a committed analytical success',async t=>{
  const f=fixture(t),governance=await f.admit(),task=await executeAnalyticalTask({objective,customer:f.customer,input:f.input,governance,emit(){throw new Error('observer disconnected');}});
  await governance.fail({...task,status:'FAILED'});assert.equal((await f.gate.get(task.task_id)).status,'COMPLETED');
});
test('ordinary task contracts cannot reserve an analytical action without bound analytical input',async t=>{
  const f=fixture(t),bound=await f.gate.admit({objective,context:f.context});
  await assert.rejects(()=>bound.reserve({kind:'analysis',operation:'bayesian-updating'}),/unregistered/);
  const analytical=await f.admit({context:{...f.context,work_id:'other-work'}});
  await assert.rejects(()=>analytical.reserve({kind:'analysis',operation:'admin.publish'}),/scope/);
});
