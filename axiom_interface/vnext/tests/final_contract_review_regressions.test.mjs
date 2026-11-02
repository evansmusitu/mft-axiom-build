import test from 'node:test';
import assert from 'node:assert/strict';
import {sqliteD1,applyExecutionSchema} from '../../tests/execution_test_helpers.mjs';
import {handleRuntimeTaskApi} from '../../../ops/axiom_runtime_task_api.mjs';
import {createD1ExecutionGovernance} from '../../../ops/axiom_execution_contract.mjs';
import {ATOMIC_OPERATIONS} from '../capability_registry.js';
import {sha256Json} from '../execution_integrity.mjs';
import {normalizeExecutionContext} from '../execution_contract.mjs';

const origin='https://review-fixture.example';
const customer={customer_id:'tenant-review'};
const submissionId='review-submission';

function fixture(t){
  const db=applyExecutionSchema(sqliteD1()),jobs=[],calls=[];
  db.exec('CREATE TABLE api_keys(id TEXT PRIMARY KEY,customer_id TEXT,key_hash TEXT,key_prefix TEXT,label TEXT,status TEXT,created_at TEXT,last_used_at TEXT,expires_at TEXT,revoked_at TEXT); CREATE TABLE usage_events(request_id TEXT,customer_id TEXT,key_id TEXT,operation TEXT,compute_units INTEGER,http_status INTEGER,result_sha256 TEXT);');
  const runtime={async fetch(url,init={}){
    const path=new URL(url).pathname;calls.push(path);
    if(path==='/health')return Response.json({ok:true,build_id:'review-fixture',operation_count:74});
    if(path==='/v1/tools')return Response.json({build_id:'review-fixture',operation_count:74,tools:ATOMIC_OPERATIONS});
    assert.equal(path,'/v1/compute','review fixture must not make an unexpected runtime request');
    const input=JSON.parse(init.body);
    assert.equal(input.operation,'arithmetic.evaluate');
    assert.equal(input.args.expression,'40+2.');
    const key=db.connection.prepare('SELECT * FROM api_keys').get();
    const requestId=init.headers['x-musitu-request-id'];
    const body={result:{value:42}},digest=await sha256Json(body);
    db.connection.prepare('INSERT INTO usage_events VALUES(?,?,?,?,?,?,?)').run(requestId,key.customer_id,key.id,input.operation,1,200,digest);
    return Response.json({...body,receipt:{customer_id:key.customer_id,request_id:requestId,operation:input.operation,result_sha256:digest}});
  }};
  const env={AXIOM_DB:db,AXIOM_RUNTIME:runtime,TASK_RATE_LIMITER:{limit:async()=>({success:true})}};
  const payload={objective:'Calculate 40+2.',submission_id:submissionId,execution_context:{project_id:'project-review',work_id:'work-review',controls:{autonomy:'Policy-bounded',privacy:'Private',evidence:'Verified',budget:1}}};
  const options={customer,origin,executionCtx:{waitUntil(p){jobs.push(p);}},fetchImpl:async()=>{throw new Error('external provider calls are forbidden in review regressions');}};
  const post=()=>handleRuntimeTaskApi(new Request(origin+'/vnext/api/tasks',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(payload)}),env,options);
  const read=()=>handleRuntimeTaskApi(new Request(`${origin}/vnext/api/submissions/${submissionId}`),env,{customer,origin});
  t.after(async()=>{await Promise.allSettled(jobs);db.connection.close();});
  return {db,calls,payload,post,read};
}

async function complete(f){
  const response=await f.post();assert.equal(response.status,200);
  const stream=await response.text();assert.match(stream,/event: complete/);
  const readback=await f.read();assert.equal(readback.status,200);
  const saved=await readback.json();assert.equal(saved.status,'COMPLETED');
  assert.deepEqual(saved.execution.result,{value:42});
  return saved;
}

async function bindingFixture(t){
  const db=applyExecutionSchema(sqliteD1());
  t.after(()=>db.connection.close());
  const binding=await createD1ExecutionGovernance({db,customer}).admit({
    objective:'Calculate 40+2.',
    context:{project_id:'project-review',work_id:'work-review',controls:{privacy:'Project',budget:1}},
  });
  await binding.create({task_id:'task_projection_review',request_id:'request-projection-review',customer_id:customer.customer_id,objective:binding.contract.objective,execution_contract:binding.contract,status:'RUNNING'});
  return {db,binding};
}

test('submission readback rejects a changed task identity or objective under an unchanged proof',async t=>{
  for(const [field,value] of Object.entries({task_id:'task_forged',customer_id:'tenant-forged',objective:'A different objective'})){
    await t.test(field,async child=>{
      const f=fixture(child);await complete(f);
      const row=f.db.connection.prepare('SELECT result_json FROM axiom_ec_runs').get();
      const result=JSON.parse(row.result_json);result[field]=value;
      f.db.connection.prepare('UPDATE axiom_ec_runs SET result_json=?').run(JSON.stringify(result));
      const response=await f.read();
      assert.equal(response.status,503,`changed ${field} must invalidate restored completion proof`);
    });
  }
});

test('submission readback rejects changed compute arguments with an unchanged result and receipt',async t=>{
  const f=fixture(t),saved=await complete(f);
  const row=f.db.connection.prepare('SELECT result_json FROM axiom_ec_runs').get();
  const result=JSON.parse(row.result_json);
  result.plan.operation_args.expression='1000/0';
  assert.equal(result.receipt.receipt_sha256,saved.receipt.receipt_sha256);
  assert.deepEqual(result.execution.result,{value:42});
  f.db.connection.prepare('UPDATE axiom_ec_runs SET result_json=?').run(JSON.stringify(result));
  const response=await f.read();
  assert.equal(response.status,503,'changed admitted compute input must invalidate restored completion proof');
});

test('an exact completed submission replays its committed result after its execution authority expires',async t=>{
  const f=fixture(t),NativeDate=globalThis.Date;
  let saved;
  globalThis.Date=class extends NativeDate{
    constructor(...args){super(...(args.length?args:[NativeDate.now()-20*60*1000]));}
    static now(){return NativeDate.now()-20*60*1000;}
  };
  try{saved=await complete(f);}finally{globalThis.Date=NativeDate;}
  const readback=await f.read();assert.equal(readback.status,200,'expired execution authority must preserve completed readback');
  assert.equal((await readback.json()).receipt.receipt_sha256,saved.receipt.receipt_sha256);
  const response=await f.post();
  assert.equal(response.status,200,'a completed retry must return the prior proof without requiring a new active execution lease');
  const stream=await response.text();assert.match(stream,/event: complete/);assert.ok(stream.includes(saved.receipt.receipt_sha256));
  assert.equal(f.calls.filter(path=>path==='/v1/compute').length,1,'exact completed replay must not dispatch another compute call');
});

test('execution context preserves explicit Work approval and deadline constraints',()=>{
  const deadline='2026-11-01T12:00:00.000Z';
  assert.equal(normalizeExecutionContext({}).controls.approval,'Before consequential action');
  const context=normalizeExecutionContext({controls:{approval:'Every tool action',deadline}});
  assert.equal(context.controls.approval,'Every tool action');
  assert.equal(context.controls.deadline,deadline);
});

test('Every tool action approval prevents dispatch until an admitted approval is available',async t=>{
  const f=fixture(t);f.payload.execution_context.controls.approval='Every tool action';
  const response=await f.post();
  assert.equal(response.status,403);
  assert.deepEqual(f.calls,[],'approval must be enforced before any runtime request');
  assert.equal(f.db.connection.prepare('SELECT COUNT(*) AS n FROM axiom_ec_runs').get().n,0);
});

test('an expired Work deadline prevents admission and dispatch',async t=>{
  const f=fixture(t);f.payload.execution_context.controls.deadline=new Date(Date.now()-60_000).toISOString();
  const response=await f.post();
  assert.equal(response.status,403);
  assert.deepEqual(f.calls,[],'deadline must be enforced before any runtime request');
  assert.equal(f.db.connection.prepare('SELECT COUNT(*) AS n FROM axiom_ec_runs').get().n,0);
});

test('a future Work deadline caps the admitted execution lifetime',async t=>{
  const f=fixture(t),deadline=new Date(Date.now()+60_000).toISOString();
  f.payload.execution_context.controls.deadline=deadline;
  const saved=await complete(f);
  assert.equal(saved.execution_contract.policy.deadline,deadline);
  assert.equal(saved.execution_contract.expires_at,deadline);
});

test('lowering a persisted call counter cannot reopen a consumed durable action budget',async t=>{
  for(const [counter,action] of [['compute_calls',{kind:'compute',operation:'arithmetic.evaluate'}],['provider_calls',{kind:'model'}]]){
    await t.test(counter,async child=>{
      const {db,binding}=await bindingFixture(child);
      await binding.reserve(action);
      db.connection.prepare(`UPDATE axiom_ec_works SET ${counter}=0`).run();
      await assert.rejects(()=>binding.reserve(action),'counter drift from durable reservations must reject further action admission');
      assert.equal(db.connection.prepare('SELECT COUNT(*) AS n FROM axiom_ec_reservations').get().n,1,'corrupt counters must not authorize another reservation');
    });
  }
});

test('mutable Work policy projections cannot replace values committed in the execution contract',async t=>{
  const changes={max_compute_calls:2,max_provider_calls:6,expires_at:new Date(Date.now()+60*60*1000).toISOString(),project_id:'project-other',agent_id:'agent-other'};
  for(const [field,value] of Object.entries(changes)){
    await t.test(field,async child=>{
      const {db,binding}=await bindingFixture(child);
      if(field==='project_id')db.connection.prepare("INSERT INTO axiom_ec_projects(tenant_id,project_id,state) VALUES(?,?,'ACTIVE')").run(customer.customer_id,value);
      if(field==='agent_id')db.connection.prepare("INSERT INTO axiom_ec_agents(tenant_id,agent_id,state) VALUES(?,?,'ACTIVE')").run(customer.customer_id,value);
      db.connection.prepare(`UPDATE axiom_ec_works SET ${field}=?`).run(value);
      await assert.rejects(()=>binding.reserve({kind:'compute',operation:'arithmetic.evaluate'}),'Work projections must agree with the immutable admitted policy before dispatch');
      assert.equal(db.connection.prepare('SELECT COUNT(*) AS n FROM axiom_ec_reservations').get().n,0);
    });
  }
});

test('reservation checks committed limits and durable counters atomically with admission',async t=>{
  for(const mutation of ['raise_compute_limit','lower_compute_counter']){
    await t.test(mutation,async child=>{
      const {db,binding}=await bindingFixture(child);
      const action={kind:'compute',operation:'arithmetic.evaluate'};
      await binding.reserve(action);
      const originalBatch=db.batch.bind(db);
      db.batch=async statements=>{
        db.batch=originalBatch;
        db.connection.prepare(mutation==='raise_compute_limit'
          ? 'UPDATE axiom_ec_works SET max_compute_calls=2'
          : 'UPDATE axiom_ec_works SET compute_calls=0').run();
        return originalBatch(statements);
      };
      await assert.rejects(()=>binding.reserve(action),'a change after the authority read must not reopen the committed budget');
      assert.equal(db.connection.prepare('SELECT COUNT(*) AS n FROM axiom_ec_reservations').get().n,1);
    });
  }
});
