import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createD1ExecutionGovernance} from '../../../ops/axiom_execution_contract.mjs';
import {sha256Json} from '../execution_integrity.mjs';
import {normalizeExecutionContext,validateExecutionContract} from '../execution_contract.mjs';
import {evaluateDecision} from '../decision_analysis.mjs';

const schema=fs.readFileSync(new URL('../../../ops/axiom_execution_contract_schema.sql',import.meta.url),'utf8');
function d1(file=':memory:'){
  const connection=new DatabaseSync(file);connection.exec(schema);
  return {connection,prepare(sql){return {bind(...args){const q=connection.prepare(sql);return {run:async()=>({success:true,meta:{changes:q.run(...args).changes}}),first:async()=>q.get(...args)??null,all:async()=>({results:q.all(...args)}),_run:()=>({success:true,meta:{changes:q.run(...args).changes}})};}};},async batch(statements){connection.exec('BEGIN IMMEDIATE');try{const results=statements.map(s=>s._run());connection.exec('COMMIT');return results;}catch(e){connection.exec('ROLLBACK');throw e;}}};
}
let ids=0;
function fixture(db=d1(),tenant='tenant-a',clock={ms:Date.parse('2026-10-29T12:00:00.000Z')}){
  const gate=createD1ExecutionGovernance({db,customer:{customer_id:tenant},now:()=>new Date(clock.ms),idFactory:p=>`${p}_${++ids}`,serverPolicy:{ttl_ms:900000,lease_ms:1000}});
  return {db,clock,gate,admit:context=>gate.admit({objective:'Calculate 40+2.',context:{project_id:'project-a',work_id:'work-a',controls:{privacy:'Project',budget:1},...context}})};
}
async function resultFor(binding,extra={}){
  const artifact={schema:'fixture-artifact',title:'Forty-two',citations:[],project_id:binding.contract.project_id,work_id:binding.contract.work_id,agent_id:binding.contract.agent_id,contract_sha256:binding.contract.contract_sha256};
  const envelope={result:{value:42}},digest=await sha256Json(envelope);
  const body={runtime_result_sha256:digest,task_id:'task_1',request_id:'request_fixture',customer_id:binding.contract.tenant_id,operation:'arithmetic.evaluate',contract_sha256:binding.contract.contract_sha256,artifact_sha256:await sha256Json(artifact),source_commitments:[],status:'COMPLETED'};
  return seal({task_id:'task_1',request_id:'request_fixture',customer_id:binding.contract.tenant_id,objective:binding.contract.objective,status:'COMPLETED',execution_contract:binding.contract,artifact,receipt:{...body,receipt_sha256:await sha256Json(body)},sources:[],execution:{operation:'arithmetic.evaluate',request_id:'request_fixture',http_status:200,result:{value:42},committed_response:envelope,receipt:{result_sha256:digest,result_commitment_verified:true}},...extra});
}
async function seal(task){
 const {receipt,object_refs,...payload}=task;const {receipt_sha256,...body}=receipt;
 body.task_payload_sha256=await sha256Json(payload);task.receipt={...body,receipt_sha256:await sha256Json(body)};return task;
}
const start=b=>b.create({task_id:'task_1',request_id:'request_fixture',customer_id:b.contract.tenant_id,objective:b.contract.objective,status:'RUNNING'});

test('context rejects caller authority, unknown fields and invalid resource budgets',()=>{
  for(const value of [{tenant_id:'other'},{authority:'ALLOW'},{controls:{grants:['all']}},{controls:{budget:NaN}},{controls:{budget:Infinity}},{controls:{budget:-1}},{controls:{budget:'1.5'}}])assert.throws(()=>normalizeExecutionContext(value));
  assert.equal(normalizeExecutionContext({controls:{budget:'0'}}).controls.budget,0);
});

test('five objects commit atomically and remain scoped to an authenticated tenant',async()=>{
  const f=fixture(),b=await f.admit();await start(b);await b.reserve({kind:'compute',operation:'arithmetic.evaluate'});
  const result=await resultFor(b);await b.complete(result);const restored=await b.get('task_1');
  assert.equal(restored.status,'COMPLETED');assert.equal(restored.object_refs.project_id,'project-a');assert.equal(restored.object_refs.artifacts.length,1);
  for(const table of ['projects','works','agents','artifacts','evidence'])assert.ok(f.db.connection.prepare(`SELECT COUNT(*) AS n FROM axiom_ec_${table} WHERE tenant_id=?`).get('tenant-a').n>0);
  const other=await fixture(f.db,'tenant-b').admit();assert.equal(await other.get('task_1'),null);
  await assert.rejects(()=>b.assertBound({customer:{customer_id:'tenant-b'}}),/cross-tenant/);
  const evil=await resultFor(b,{artifact:{...result.artifact,title:'tampered'}});await assert.rejects(()=>b.complete(evil),/conflicting/);
  await b.fail({task_id:'task_1',customer_id:'tenant-a',objective:b.contract.objective,status:'FAILED'});assert.equal((await b.get('task_1')).status,'COMPLETED');
});

test('admission replay and process restart cannot reset a consumed Work budget',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'axiom-contract-')),file=path.join(directory,'state.sqlite');
  const db=d1(file),f=fixture(db),a=await f.admit();await a.reserve({kind:'compute',operation:'arithmetic.evaluate'});
  const replay=await f.admit();assert.equal(replay.contract.contract_sha256,a.contract.contract_sha256);
  await assert.rejects(()=>replay.reserve({kind:'compute',operation:'arithmetic.evaluate'}),/budget/);
  db.connection.close();const reopened=d1(file),b=await fixture(reopened).admit();
  await assert.rejects(()=>b.reserve({kind:'compute',operation:'arithmetic.evaluate'}),/budget/);
  await assert.rejects(()=>fixture(reopened).admit({controls:{privacy:'Project',budget:2}}),/immutable/);
  reopened.connection.close();fs.rmSync(directory,{recursive:true});
});

test('concurrent reservations admit only the remaining call budget',async()=>{
  const f=fixture(),a=await f.admit(),b=await f.admit();
  const results=await Promise.allSettled([a.reserve({kind:'compute',operation:'arithmetic.evaluate'}),b.reserve({kind:'compute',operation:'arithmetic.evaluate'})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(f.db.connection.prepare('SELECT compute_calls FROM axiom_ec_works').get().compute_calls,1);
});

test('preview, action approval, privacy, independent verification and server scope fail closed',async()=>{
  for(const controls of [{autonomy:'Preview only'},{autonomy:'Approval each action'},{evidence:'Independent validation'}]){
    const b=await fixture().admit({controls});await assert.rejects(()=>start(b),/Preview only|Approval each action|Independent validation/);
  }
  const privateWork=await fixture().admit({controls:{privacy:'Private'}});
  await assert.rejects(()=>privateWork.reserve({kind:'research',provider_calls:3}),/Private/);
  await assert.rejects(()=>privateWork.reserve({kind:'model'}),/Private/);
  await assert.rejects(()=>privateWork.reserve({kind:'compute',operation:'admin.erase'}),/scope/);
  await assert.rejects(()=>fixture().admit({agent_id:'arbitrary-agent'}),/unregistered/);
  const zero=await fixture().admit({controls:{budget:0}});await assert.rejects(()=>zero.reserve({kind:'compute',operation:'arithmetic.evaluate'}),/budget/);
});

test('tampering and revocation are checked again before every action',async()=>{
  const f=fixture(),b=await f.admit();await validateExecutionContract(b.contract);
  await assert.rejects(()=>validateExecutionContract({...b.contract,objective:'Changed objective'}),/commitment/);
  f.db.connection.prepare("UPDATE axiom_ec_works SET contract_json='{}'").run();await assert.rejects(()=>b.reserve({kind:'decision'}),/changed/);
  const g=fixture(),c=await g.admit();await c.revoke();await assert.rejects(()=>c.reserve({kind:'compute',operation:'arithmetic.evaluate'}),/revoked/);
});

test('stale lease holder cannot replace a reclaimed durable success',async()=>{
  const f=fixture(),a=await f.admit();await start(a);f.clock.ms+=1001;
  const b=await f.admit();await b.resume('task_1');await b.reserve({kind:'compute',operation:'arithmetic.evaluate'});const task=await resultFor(b);await b.complete(task);
  await a.fail({task_id:'task_1',customer_id:'tenant-a',objective:a.contract.objective,status:'FAILED'});
  assert.equal((await b.get('task_1')).status,'COMPLETED');
});

test('invalid source and result commitments cannot create an Artifact or Evidence',async()=>{
  const f=fixture(),b=await f.admit();await start(b);const value=await resultFor(b);
  value.sources=[{source_id:'source-a',url:'https://example.org/',excerpt:'Bound evidence.',instruction_authority:'NONE_DATA_ONLY'}];
  await seal(value);await assert.rejects(()=>b.complete(value),/source snapshot commitment/);
  assert.equal(f.db.connection.prepare('SELECT COUNT(*) AS n FROM axiom_ec_artifacts').get().n,0);
  value.sources=[];value.execution.receipt.result_commitment_verified=false;await assert.rejects(()=>b.complete(value),/has not been verified|execution result commitment mismatch/);
  assert.equal(f.db.connection.prepare('SELECT COUNT(*) AS n FROM axiom_ec_evidence').get().n,0);
});

test('direct completion cannot bypass the admitted action budget',async()=>{
  const f=fixture(),b=await f.admit({controls:{privacy:'Project',budget:0}});await start(b);
  await assert.rejects(async()=>b.complete(await resultFor(b)),/admitted action/);
  assert.equal(f.db.connection.prepare('SELECT COUNT(*) AS n FROM axiom_ec_artifacts').get().n,0);
});

test('readback resolves the original Work and detects missing or altered persisted evidence',async()=>{
  const f=fixture(),b=await f.admit();await start(b);await b.reserve({kind:'compute',operation:'arithmetic.evaluate'});await b.complete(await resultFor(b));
  const other=await f.admit({project_id:'project-other',work_id:'work-other'});
  assert.equal((await other.get('task_1')).object_refs.project_id,'project-a');
  f.db.connection.prepare("DELETE FROM axiom_ec_evidence WHERE kind='EXECUTION_RECORD'").run();
  await assert.rejects(()=>f.gate.get('task_1'),/stored completion proof/);
});

test('decision input matrix is immutable and recommendations cannot grant execution authority',async()=>{
  const f=fixture(),context={project_id:'project-a',work_id:'decision-work',controls:{privacy:'Private',budget:0}};
  const problem={states:[{id:'good',probability:0.6},{id:'bad',probability:0.4}],actions:[{id:'launch',utilities:{good:100,bad:-80}},{id:'wait',utilities:{good:0,bad:0}}],utility_unit:'utility points',assumptions:['Declared illustrative probabilities and utilities.'],evidence_refs:[]};
  const input={kind:'decision',sha256:await sha256Json(problem)},b=await f.gate.admit({objective:'Compare the declared options.',context,input_commitment:input});
  await assert.rejects(()=>f.gate.admit({objective:'Compare the declared options.',context,input_commitment:{kind:'decision',sha256:'b'.repeat(64)}}),/immutable/);
  await start(b);await b.reserve({kind:'decision'});
  const task=await resultFor(b),decision=await evaluateDecision(problem);task.input_commitment=input;task.decision_input=problem;task.artifact.decision=decision;
  task.execution={operation:'decision.evaluate',request_id:task.request_id,http_status:200,result:decision,receipt:{result_sha256:await sha256Json(decision)}};
  const {receipt_sha256,...body}=task.receipt;body.operation='decision.evaluate';body.artifact_sha256=await sha256Json(task.artifact);body.runtime_result_sha256=task.execution.receipt.result_sha256;task.receipt={...body,receipt_sha256:await sha256Json(body)};
  await seal(task);await b.complete(task);assert.equal((await f.gate.get('task_1')).status,'COMPLETED');
});

test('captured research is bound by full source content and cannot acquire instruction authority',async()=>{
  const f=fixture(),b=await f.gate.admit({objective:'Research the context.',context:{project_id:'project-a',work_id:'research-work',controls:{privacy:'Project',budget:0}}});
  await start(b);await b.reserve({kind:'research',provider_calls:3});
  const task=await resultFor(b),source={source_id:'source-1',url:'https://example.org/',excerpt:'Captured text, never instructions.',instruction_authority:'NONE_DATA_ONLY'};
  task.sources=[source];task.artifact.citations=[source];task.execution=null;
  const {receipt_sha256,...body}=task.receipt;body.operation=null;body.runtime_result_sha256=null;body.artifact_sha256=await sha256Json(task.artifact);body.source_commitments=[{source_id:source.source_id,sha256:await sha256Json(source)}];task.receipt={...body,receipt_sha256:await sha256Json(body)};
  await seal(task);await b.complete(task);const output=await b.get('task_1');assert.ok(output.object_refs.evidence.some(e=>e.kind==='CAPTURED_SOURCE_NOT_ENTAILMENT'));
});

test('late evidence persistence failure rolls back Artifact and terminal Run together',async()=>{
  const f=fixture(),b=await f.admit();await start(b);await b.reserve({kind:'compute',operation:'arithmetic.evaluate'});
  f.db.connection.exec("CREATE TRIGGER reject_execution_evidence BEFORE INSERT ON axiom_ec_evidence WHEN NEW.kind='EXECUTION_RECORD' BEGIN SELECT RAISE(ABORT,'simulated persistence failure'); END");
  await assert.rejects(async()=>b.complete(await resultFor(b)),/simulated persistence failure/);
  assert.equal((await b.get('task_1')).status,'RUNNING');
  assert.equal(f.db.connection.prepare('SELECT COUNT(*) AS n FROM axiom_ec_artifacts').get().n,0);
  assert.equal(f.db.connection.prepare('SELECT COUNT(*) AS n FROM axiom_ec_evidence').get().n,0);
});
