import test from 'node:test';
import assert from 'node:assert/strict';
import {sqliteD1,applyExecutionSchema} from '../../tests/execution_test_helpers.mjs';
import {handleRuntimeTaskApi} from '../../../ops/axiom_runtime_task_api.mjs';
import {ATOMIC_OPERATIONS} from '../capability_registry.js';
import {sha256Json} from '../execution_integrity.mjs';

const origin='https://fixture.example',customer={customer_id:'tenant-a'};
const problem={states:[{id:'good',probability:0.6},{id:'bad',probability:0.4}],actions:[{id:'launch',utilities:{good:100,bad:-80}},{id:'wait',utilities:{good:0,bad:0}}],utility_unit:'utility points',assumptions:['Declared illustrative probabilities and utilities.'],evidence_refs:[]};
function environment(){
  const db=applyExecutionSchema(sqliteD1()),calls=[],jobs=[];
  db.exec('CREATE TABLE api_keys(id TEXT PRIMARY KEY,customer_id TEXT,key_hash TEXT,key_prefix TEXT,label TEXT,status TEXT,created_at TEXT,last_used_at TEXT,expires_at TEXT,revoked_at TEXT); CREATE TABLE usage_events(request_id TEXT,customer_id TEXT,key_id TEXT,operation TEXT,compute_units INTEGER,http_status INTEGER,result_sha256 TEXT);');
  const service={async fetch(url,init={}){
    const path=new URL(url).pathname;calls.push(path);
    if(path==='/health')return Response.json({ok:true,build_id:'fixture',operation_count:74});
    if(path==='/v1/tools')return Response.json({build_id:'fixture',operation_count:74,tools:ATOMIC_OPERATIONS});
    assert.equal(path,'/v1/compute');
    const key=db.connection.prepare('SELECT * FROM api_keys').get(),rid=init.headers['x-musitu-request-id'],body={result:{value:42}},hash=await sha256Json(body);
    db.connection.prepare('INSERT INTO usage_events VALUES(?,?,?,?,?,?,?)').run(rid,key.customer_id,key.id,'arithmetic.evaluate',1,200,hash);
    return Response.json({...body,receipt:{customer_id:key.customer_id,request_id:rid,operation:'arithmetic.evaluate',result_sha256:hash}});
  }};
  return {db,calls,jobs,env:{AXIOM_DB:db,AXIOM_RUNTIME:service,TASK_RATE_LIMITER:{limit:async()=>({success:true})}},ctx:{waitUntil(p){jobs.push(p);}}};
}
function payload(extra={}){return {objective:'Calculate 40+2.',submission_id:'submission-one',execution_context:{project_id:'project-one',work_id:'work-one',controls:{privacy:'Private',budget:1}},...extra};}
async function post(f,body,principal=customer){return handleRuntimeTaskApi(new Request(origin+'/vnext/api/tasks',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)}),f.env,{customer:principal,origin,executionCtx:f.ctx,fetchImpl:async()=>{throw new Error('unexpected external provider call');}});}
async function read(f,principal=customer){return handleRuntimeTaskApi(new Request(origin+'/vnext/api/submissions/submission-one'),f.env,{customer:principal,origin});}

test('API enforces policy before dispatch, including zero budget and unavailable approval',async()=>{
  for(const controls of [{autonomy:'Preview only'},{autonomy:'Approval each action'},{evidence:'Independent validation'}]){
    const f=environment(),body=payload();Object.assign(body.execution_context.controls,controls);
    const response=await post(f,body);assert.equal(response.status,403);assert.equal(f.calls.length,0);
  }
  const f=environment(),body=payload();body.execution_context.controls.budget=0;
  assert.match(await (await post(f,body)).text(),/budget exhausted/);
  assert.equal(f.calls.filter(p=>p==='/v1/compute').length,0);
  assert.equal((await (await read(f)).json()).status,'FAILED');
});
test('completed retry returns original proof without another compute call and tenant readback is isolated',async()=>{
  const f=environment(),first=await (await post(f,payload())).text();assert.match(first,/event: complete/);
  const saved=await (await read(f)).json();assert.equal(saved.status,'COMPLETED');
  assert.equal(saved.object_refs.project_id,'project-one');assert.ok(saved.object_refs.evidence.length>=3);
  assert.match(await (await post(f,payload())).text(),new RegExp(saved.receipt.receipt_sha256));
  assert.equal(f.calls.filter(p=>p==='/v1/compute').length,1);
  assert.equal((await read(f,{customer_id:'tenant-b'})).status,404);
});
test('cancelled observer preserves completion and exact submission can be reconciled',async()=>{
  const f=environment(),response=await post(f,payload());await response.body.cancel();await Promise.all(f.jobs);
  const saved=await (await read(f)).json();assert.equal(saved.status,'COMPLETED');
  assert.equal(f.db.connection.prepare('SELECT COUNT(*) AS n FROM axiom_ec_artifacts').get().n,1);
});
test('decision workflow executes locally, replays its numeric result and rejects a changed input under same Work',async()=>{
  const f=environment(),body=payload({objective:'Compare the declared options.',decision:problem});body.execution_context.controls.budget=0;
  assert.match(await (await post(f,body)).text(),/event: complete/);
  const saved=await (await read(f)).json();assert.equal(saved.artifact.decision.expected_utilities.launch,28);assert.equal(saved.artifact.decision.evpi,32);assert.equal(saved.artifact.decision.authority_granted,false);assert.equal(f.calls.length,0);
  const changed=structuredClone(body);changed.decision.actions[0].utilities.good=1000;
  assert.equal((await post(f,changed)).status,403);
  saved.execution.result.evpi=999;
  f.db.connection.prepare('UPDATE axiom_ec_runs SET result_json=?').run(JSON.stringify(saved));
  assert.equal((await read(f)).status,503);
});
