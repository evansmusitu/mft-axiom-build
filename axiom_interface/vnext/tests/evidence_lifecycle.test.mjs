import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createD1ExecutionGovernance} from '../../../ops/axiom_execution_contract.mjs';
import {createD1EvidenceLifecycle,readD1EvidenceLifecycleErasure,verifyEvidenceLifecycleExport} from '../../../ops/axiom_evidence_lifecycle.mjs';
import {canonicalJson,sha256Json} from '../execution_integrity.mjs';

const executionSchema=fs.readFileSync(new URL('../../../ops/axiom_execution_contract_schema.sql',import.meta.url),'utf8');
const lifecycleSchema=()=>fs.readFileSync(new URL('../../../ops/axiom_evidence_lifecycle_schema.sql',import.meta.url),'utf8');
const actions=['plan','export','hold','dependency','delete','read'].map(x=>`lifecycle.${x}`);

function d1(file=':memory:',migrate=true){
  const connection=new DatabaseSync(file);connection.exec(executionSchema);
  if(migrate)connection.exec(lifecycleSchema());
  const db={connection,beforeBatch:null,prepare(sql){return {bind(...args){const q=connection.prepare(sql);return {
    run:async()=>({success:true,meta:{changes:q.run(...args).changes}}),
    first:async()=>q.get(...args)??null,all:async()=>({results:q.all(...args)}),
    _run:()=>({success:true,meta:{changes:q.run(...args).changes}})
  };}};},async batch(statements){
    if(db.beforeBatch){const hook=db.beforeBatch;db.beforeBatch=null;await hook();}
    connection.exec('BEGIN IMMEDIATE');
    try{const out=statements.map(s=>s._run());connection.exec('COMMIT');return out;}
    catch(error){connection.exec('ROLLBACK');throw error;}
  }};
  return db;
}
let id=0;
async function fixture({db=d1(),tenant='tenant-a',work='work-a',complete=true,grant=true,hosted=false,authorize}={}){
  const clock={ms:Date.parse('2026-10-29T12:00:00.000Z')};
  const now=()=>new Date(clock.ms);
  const gate=createD1ExecutionGovernance({db,customer:{customer_id:tenant},now,idFactory:p=>`${p}_${++id}`});
  const binding=await gate.admit({objective:'Calculate 40+2.',context:{project_id:'project-a',work_id:work,controls:{privacy:hosted?'Project':'Private',budget:1}}});
  const taskId=`task_${++id}`;
  await binding.create({task_id:taskId,request_id:`request_${taskId}`,customer_id:tenant,objective:binding.contract.objective,status:'RUNNING'});
  const providerEvidence=[];
  if(hosted){
    // Seed a local persisted provider-output fixture. No provider is invoked.
    await binding.reserve({kind:'model'});
    const reservation=db.connection.prepare("SELECT * FROM axiom_ec_reservations WHERE tenant_id=? AND work_id=? AND action_kind='model'").get(tenant,work);
    const invocation=`invocation_${++id}`,output={summary:'Sensitive hosted original output'},outputSha=await sha256Json(output),requestSha='a'.repeat(64);
    db.connection.prepare('INSERT INTO axiom_ec_agent_invocations(tenant_id,invocation_id,task_id,work_id,contract_sha256,reservation_id,binding_id,generation,stage,provider,model,request_sha256,status,session_id,turn_id,output_json,output_sha256,error_code,reconcile_reads,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)').run(tenant,invocation,taskId,work,binding.contract.contract_sha256,reservation.reservation_id,reservation.binding_id,reservation.generation,'planning','openai_agents','local-output-fixture',requestSha,complete?'SUCCEEDED':'UNCERTAIN','session_fixture','turn_fixture',complete?canonicalJson(output):null,complete?outputSha:null,null,now().toISOString(),now().toISOString());
    if(complete)providerEvidence.push({schema:'musitu.axiom.hosted-model-evidence.v1',provider:'openai_agents',invocation_id:invocation,task_id:taskId,work_id:work,contract_sha256:binding.contract.contract_sha256,reservation_id:reservation.reservation_id,model:'local-output-fixture',environment:'openai_hosted',stage:'planning',session_id:'session_fixture',turn_id:'turn_fixture',request_sha256:requestSha,output_sha256:outputSha,status:'COMPLETED',verification_scope:'PROVIDER_OUTPUT_COMMITMENT_NOT_FACTUAL_VALIDATION'});
  }
  if(complete){
    await binding.reserve({kind:'compute',operation:'arithmetic.evaluate'});
    const artifact={schema:'fixture-artifact',title:'Sensitive original evidence payload',citations:[],project_id:binding.contract.project_id,work_id:work,agent_id:binding.contract.agent_id,contract_sha256:binding.contract.contract_sha256};
    const envelope={result:{value:42}},digest=await sha256Json(envelope);
    const task={task_id:taskId,request_id:`request_${taskId}`,customer_id:tenant,objective:binding.contract.objective,status:'COMPLETED',execution_contract:binding.contract,artifact,sources:[],execution:{operation:'arithmetic.evaluate',request_id:`request_${taskId}`,http_status:200,result:{value:42},committed_response:envelope,receipt:{result_sha256:digest,result_commitment_verified:true}},...(hosted?{provider_evidence:providerEvidence}:{})};
    const body={runtime_result_sha256:digest,task_id:taskId,request_id:task.request_id,customer_id:tenant,operation:'arithmetic.evaluate',contract_sha256:binding.contract.contract_sha256,artifact_sha256:await sha256Json(artifact),source_commitments:[],status:'COMPLETED',task_payload_sha256:await sha256Json(task)};
    task.receipt={...body,receipt_sha256:await sha256Json(body)};
    await binding.complete(task);
  }
  if(grant)for(const action of actions)db.connection.prepare("INSERT INTO axiom_lc_authorizations(tenant_id,authorization_id,principal_id,action,work_id,state,expires_at) VALUES(?,?,?,?,?,'ACTIVE',?)").run(tenant,`${work}:${action}`,'server-owner',action,work,'2026-11-29T12:00:00.000Z');
  const lifecycle=createD1EvidenceLifecycle({db,customer:{customer_id:tenant},now,idFactory:p=>`${p}_${++id}`,authorize:authorize??(async({action,work_id})=>({principal_id:'server-owner',authorization_id:`${work_id}:${action}`}))});
  return {db,clock,now,gate,binding,tenant,work,taskId,lifecycle};
}
const plan=f=>f.lifecycle.planWork({work_id:f.work});
const exported=f=>f.lifecycle.exportWork({work_id:f.work,request_id:'export-1'});
async function prepared(f){const impact=await plan(f),bundle=await exported(f);return {work_id:f.work,request_id:'delete-1',reason_code:'fixture-erasure',plan_sha256:impact.plan_sha256,export_receipt_sha256:bundle.receipt.receipt_sha256};}
const owner=(db,f)=>createD1EvidenceLifecycle({db,customer:{customer_id:f.tenant},now:f.now,idFactory:p=>`${p}_${++id}`,authorize:async({action,work_id})=>({principal_id:'server-owner',authorization_id:`${work_id}:${action}`})});
const counts=f=>Object.fromEntries(['axiom_lc_delete_requests','axiom_lc_tombstones','axiom_lc_guards'].map(table=>[table,f.db.connection.prepare(`SELECT COUNT(*) n FROM ${table} WHERE tenant_id=?`).get(f.tenant).n]));
function assertUnchanged(f){
  assert.deepEqual(counts(f),{axiom_lc_delete_requests:0,axiom_lc_tombstones:0,axiom_lc_guards:0});
  assert.equal(f.db.connection.prepare('SELECT content_json FROM axiom_ec_artifacts WHERE tenant_id=? AND work_id=?').get(f.tenant,f.work).content_json.includes('Sensitive original evidence payload'),true);
}

test('an actual Work export precedes logical erasure while original five-object commitments survive',async()=>{
  const f=await fixture(),impact=await plan(f),bundle=await exported(f);
  assert.equal(impact.tenant_id,'tenant-a');assert.equal(impact.can_delete,true);
  assert.equal(impact.impact.artifacts,1);assert.ok(impact.impact.evidence>=3);
  assert.equal(await verifyEvidenceLifecycleExport(bundle),true);
  assert.equal(bundle.payload.snapshot.artifacts[0].content_json.includes('Sensitive original evidence payload'),true);
  const receipt=await f.lifecycle.deleteWork(await prepared(f));
  assert.equal(receipt.status,'ERASED');assert.equal(receipt.external_erasure_verified,false);
  assert.equal(receipt.original_commitments.work.contract_sha256,f.binding.contract.contract_sha256);
  const verified=await f.lifecycle.verifyWorkDeletion({work_id:f.work});
  assert.equal(verified.status,'VERIFIED_LOGICAL_ERASURE');
  assert.equal(f.db.connection.prepare('SELECT COUNT(*) n FROM axiom_ec_projects').get().n,1);
  assert.equal(f.db.connection.prepare('SELECT COUNT(*) n FROM axiom_ec_agents').get().n,1);
  assert.equal(f.db.connection.prepare('SELECT contract_sha256,state FROM axiom_ec_works').get().state,'REVOKED');
  for(const table of ['works','runs','artifacts','evidence','agent_completion_guards']){
    const rows=f.db.connection.prepare(`SELECT * FROM axiom_ec_${table}`).all();
    assert.equal(JSON.stringify(rows).includes('Sensitive original evidence payload'),false);
  }
  assert.equal(f.db.connection.prepare('SELECT COUNT(*) n FROM axiom_lc_guards').get().n,0);
});

test('server authorization never defaults to execution authority or caller flags',async()=>{
  const f=await fixture({grant:false});
  assert.throws(()=>createD1EvidenceLifecycle({db:f.db,customer:{customer_id:f.tenant}}),/trusted server/);
  assert.equal(f.db.connection.prepare('SELECT COUNT(*) n FROM axiom_lc_authorizations').get().n,0);
  await assert.rejects(()=>plan(f),/explicit lifecycle owner authorization/);
  await assert.rejects(()=>exported(f),/explicit lifecycle owner authorization/);
  await assert.rejects(()=>f.lifecycle.planWork({work_id:f.work,authorized:true}),/unsupported field/);
  await assert.rejects(()=>f.lifecycle.deleteWork({work_id:f.work,delete_authorized:true}),/unsupported field/);
  assert.deepEqual(f.binding.contract.policy.allowed_actions,['compute','research','model','decision']);
  const running=await fixture({complete:false,grant:false});
  await assert.rejects(()=>running.binding.reserve({kind:'lifecycle.delete'}),/unregistered/);
  assertUnchanged(f);
});

test('persisted grants bind the exact tenant, action, Work, principal and lifetime',async()=>{
  const f=await fixture(),other=await fixture({db:f.db,work:'work-other'});
  const wrong=createD1EvidenceLifecycle({db:f.db,customer:{customer_id:f.tenant},now:f.now,authorize:async()=>({principal_id:'server-owner',authorization_id:`${other.work}:lifecycle.plan`})});
  await assert.rejects(()=>wrong.planWork({work_id:f.work}),/explicit lifecycle owner authorization/);
  const wrongAction=createD1EvidenceLifecycle({db:f.db,customer:{customer_id:f.tenant},now:f.now,authorize:async()=>({principal_id:'server-owner',authorization_id:`${f.work}:lifecycle.plan`})});
  await assert.rejects(()=>wrongAction.exportWork({work_id:f.work,request_id:'wrong-action'}),/explicit lifecycle owner authorization/);
  const wrongPrincipal=createD1EvidenceLifecycle({db:f.db,customer:{customer_id:f.tenant},now:f.now,authorize:async()=>({principal_id:'untrusted-principal',authorization_id:`${f.work}:lifecycle.plan`})});
  await assert.rejects(()=>wrongPrincipal.planWork({work_id:f.work}),/explicit lifecycle owner authorization/);
  f.db.connection.prepare("UPDATE axiom_lc_authorizations SET expires_at=? WHERE tenant_id=? AND work_id=? AND action='lifecycle.plan'").run(f.now().toISOString(),f.tenant,f.work);
  await assert.rejects(()=>plan(f),/explicit lifecycle owner authorization/);
  const foreign=owner(f.db,{...f,tenant:'tenant-missing'});
  for(const work_id of [f.work,'unknown-work'])await assert.rejects(()=>foreign.planWork({work_id}),error=>error.name==='NotAllowedError'&&error.message==='explicit lifecycle owner authorization required');
});

test('absent or expanded schemas fail closed before lifecycle data changes',async()=>{
  const f=await fixture({db:d1(':memory:',false),grant:false});
  await assert.rejects(()=>plan(f),/migration is required/);
  assert.equal(await readD1EvidenceLifecycleErasure({db:f.db,customer:{customer_id:f.tenant},taskId:f.taskId}),null);
  const g=await fixture();g.db.connection.exec('ALTER TABLE axiom_ec_artifacts ADD COLUMN unregistered_payload TEXT');
  await assert.rejects(()=>plan(g),/schema changed/);
  assertUnchanged(g);
});

test('active Runs and unresolved provider invocations cannot be erased',async()=>{
  const f=await fixture({complete:false,hosted:true}),impact=await plan(f);
  assert.equal(impact.can_delete,false);assert.equal(impact.blockers[0].kind,'ACTIVE_RUN');
  assert.equal(impact.blockers[1].kind,'UNRESOLVED_PROVIDER_INVOCATION');
  await assert.rejects(async()=>f.lifecycle.deleteWork(await prepared(f)),/active Run/);
  assert.equal(counts(f).axiom_lc_delete_requests,0);
});

test('hosted-output fixtures erase all duplicated payloads but retain invocation and Evidence commitments',async()=>{
  const f=await fixture({hosted:true}),bundle=await exported(f),request=await prepared(f);
  assert.equal(await verifyEvidenceLifecycleExport(bundle),true);
  assert.equal(bundle.payload.snapshot.invocations[0].output_json.includes('Sensitive hosted original output'),true);
  const receipt=await f.lifecycle.deleteWork(request),proof=await f.lifecycle.verifyWorkDeletion({work_id:f.work});
  assert.equal(proof.status,'VERIFIED_LOGICAL_ERASURE');
  const invocation=f.db.connection.prepare('SELECT * FROM axiom_ec_agent_invocations WHERE tenant_id=?').get(f.tenant);
  assert.equal(invocation.output_json,null);assert.equal(invocation.session_id,null);assert.equal(invocation.turn_id,null);
  assert.equal(invocation.output_sha256,receipt.original_commitments.invocations[0].output_sha256);
  for(const table of ['axiom_ec_agent_invocations','axiom_ec_runs','axiom_ec_evidence','axiom_ec_agent_completion_guards','axiom_lc_exports','axiom_lc_tombstones'])assert.equal(JSON.stringify(f.db.connection.prepare(`SELECT * FROM ${table}`).all()).includes('Sensitive hosted original output'),false);
});

test('fresh SQLite connections preserve tombstone readback and duplicate receipts across restart',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'axiom-lifecycle-restart-')),file=path.join(directory,'state.sqlite');
  const db=d1(file),f=await fixture({db}),request=await prepared(f),receipt=await f.lifecycle.deleteWork(request);db.connection.close();
  const reopened=d1(file);t.after(()=>{reopened.connection.close();fs.rmSync(directory,{recursive:true});});
  assert.deepEqual(await owner(reopened,f).deleteWork(request),receipt);
  const read=await readD1EvidenceLifecycleErasure({db:reopened,customer:{customer_id:f.tenant},taskId:f.taskId});
  assert.equal(read.status,'ERASED');assert.equal(read.deletion_receipt.receipt_sha256,receipt.receipt_sha256);
});

test('bounded row and payload scans reject oversized Works without creating lifecycle proofs',async()=>{
  const f=await fixture();
  f.db.connection.prepare('UPDATE axiom_ec_artifacts SET content_json=? WHERE tenant_id=?').run(JSON.stringify({oversized:'x'.repeat(524288)}),f.tenant);
  await assert.rejects(()=>plan(f),/snapshot capacity/);assert.equal(counts(f).axiom_lc_delete_requests,0);
  const g=await fixture();
  const insert=g.db.connection.prepare("INSERT INTO axiom_ec_reservations(tenant_id,reservation_id,work_id,task_id,binding_id,generation,action_kind,operation,compute_calls,provider_calls,created_at) VALUES(?,?,?,NULL,'capacity-fixture',NULL,'decision',NULL,0,0,?)");
  for(let i=0;i<257;i++)insert.run(g.tenant,`capacity-${i}`,g.work,g.now().toISOString());
  await assert.rejects(()=>plan(g),/row capacity/);assertUnchanged(g);
});

test('legal holds cover Evidence and require an explicit audited release and fresh export',async()=>{
  const f=await fixture(),request=await prepared(f),evidence=f.db.connection.prepare('SELECT evidence_id FROM axiom_ec_evidence WHERE tenant_id=? LIMIT 1').get(f.tenant);
  await f.lifecycle.placeHold({work_id:f.work,hold_id:'legal-matter-1',object_kind:'EVIDENCE',object_id:evidence.evidence_id,reason:'Legal matter 1'});
  const held=await plan(f);assert.equal(held.can_delete,false);assert.equal(held.blockers[0].kind,'LEGAL_HOLD');
  await assert.rejects(()=>f.lifecycle.deleteWork(request),/plan changed/);
  await assert.rejects(()=>f.lifecycle.deleteWork({...request,plan_sha256:held.plan_sha256}),/legal hold/);
  await f.lifecycle.releaseHold({work_id:f.work,hold_id:'legal-matter-1',reason:'Matter closed'});
  await assert.rejects(async()=>f.lifecycle.deleteWork({...request,plan_sha256:(await plan(f)).plan_sha256}),/verified export/);
  const bundle=await f.lifecycle.exportWork({work_id:f.work,request_id:'export-after-release'});
  const receipt=await f.lifecycle.deleteWork({...request,plan_sha256:(await plan(f)).plan_sha256,export_receipt_sha256:bundle.receipt.receipt_sha256});
  assert.equal(receipt.status,'ERASED');
  assert.equal(f.db.connection.prepare("SELECT COUNT(*) n FROM axiom_lc_audit WHERE event_type IN('hold.place','hold.release')").get().n,2);
});

test('actual incoming Work dependencies block erasure and cross-tenant guesses stay indistinguishable',async()=>{
  const f=await fixture(),dependent=await fixture({db:f.db,work:'dependent-work'});
  const foreign=await fixture({db:f.db,tenant:'tenant-b',work:'foreign-work'});
  const request={work_id:f.work,dependency_id:'dependency-a',dependent_work_id:dependent.work,reason:'Referenced by another Work'};
  for(const dependent_work_id of [foreign.work,'missing-work'])await assert.rejects(()=>f.lifecycle.registerDependency({...request,dependent_work_id}),error=>error.name==='NotFoundError'&&error.message==='lifecycle object not found');
  await f.lifecycle.registerDependency(request);
  const impact=await plan(f);assert.equal(impact.can_delete,false);assert.equal(impact.blockers[0].kind,'DEPENDENCY');
  await assert.rejects(async()=>f.lifecycle.deleteWork(await prepared(f)),/dependency/);
  await f.lifecycle.releaseDependency({work_id:f.work,dependency_id:'dependency-a',reason:'Reference removed by owner'});
  assert.equal((await plan(f)).can_delete,true);assertUnchanged(f);
});

test('a legal hold committed by another SQLite connection between validation and deletion rolls back all erasure',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'axiom-lifecycle-hold-')),file=path.join(directory,'state.sqlite');
  const db=d1(file),f=await fixture({db}),other=d1(file),request=await prepared(f);
  t.after(()=>{db.connection.close();other.connection.close();fs.rmSync(directory,{recursive:true});});
  db.beforeBatch=()=>owner(other,f).placeHold({work_id:f.work,hold_id:'racing-hold',reason:'Legal race'});
  await assert.rejects(()=>f.lifecycle.deleteWork(request),/snapshot, legal hold, dependency or authority changed/);
  assertUnchanged(f);assert.equal((await plan(f)).blockers[0].kind,'LEGAL_HOLD');
});

test('a dependency committed by another connection at the atomic boundary prevents deletion',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'axiom-lifecycle-dependency-')),file=path.join(directory,'state.sqlite');
  const db=d1(file),f=await fixture({db}),dependent=await fixture({db,work:'dependency-source'}),other=d1(file),request=await prepared(f);
  t.after(()=>{db.connection.close();other.connection.close();fs.rmSync(directory,{recursive:true});});
  db.beforeBatch=()=>owner(other,f).registerDependency({work_id:f.work,dependency_id:'racing-dependency',dependent_work_id:dependent.work,reason:'Retained by another Work'});
  await assert.rejects(()=>f.lifecycle.deleteWork(request),/snapshot, legal hold, dependency or authority changed/);
  assertUnchanged(f);assert.equal((await plan(f)).blockers[0].kind,'DEPENDENCY');
});

test('grant revocation and persisted Evidence changes at commit time are rechecked in SQL',async()=>{
  const f=await fixture(),request=await prepared(f);
  f.db.beforeBatch=()=>f.db.connection.prepare("UPDATE axiom_lc_authorizations SET state='REVOKED' WHERE tenant_id=? AND work_id=? AND action='lifecycle.delete'").run(f.tenant,f.work);
  await assert.rejects(()=>f.lifecycle.deleteWork(request),/snapshot, legal hold, dependency or authority changed/);
  assertUnchanged(f);
  const g=await fixture(),otherRequest=await prepared(g);
  g.db.beforeBatch=()=>g.db.connection.prepare("UPDATE axiom_ec_evidence SET content_json='{}' WHERE tenant_id=?").run(g.tenant);
  await assert.rejects(()=>g.lifecycle.deleteWork(otherRequest),/snapshot, legal hold, dependency or authority changed/);
  assertUnchanged(g);
});

test('export snapshots and stored completion corruption cannot be promoted to deletion proof',async()=>{
  const f=await fixture(),bundle=await exported(f),tampered=structuredClone(bundle);
  tampered.payload.snapshot.artifacts[0].content_json='{}';
  assert.equal(await verifyEvidenceLifecycleExport(tampered),false);
  const request=await prepared(f);
  await assert.rejects(()=>f.lifecycle.deleteWork({...request,export_receipt_sha256:'0'.repeat(64)}),/verified export/);
  f.db.connection.prepare("UPDATE axiom_ec_agent_completion_guards SET snapshot_json='[{}]' WHERE tenant_id=?").run(f.tenant);
  await assert.rejects(()=>plan(f),/completion snapshot changed/);
  await assert.rejects(()=>f.lifecycle.deleteWork(request),/completion snapshot changed/);
  assertUnchanged(f);
});

test('duplicate and concurrent deletion replay returns one immutable receipt without cross-tenant request collisions',async()=>{
  const f=await fixture(),other=await fixture({db:f.db,tenant:'tenant-b'}),request=await prepared(f);
  const results=await Promise.all([f.lifecycle.deleteWork(request),f.lifecycle.deleteWork(request)]);
  assert.deepEqual(results[0],results[1]);
  assert.deepEqual(await f.lifecycle.deleteWork(request),results[0]);
  await assert.rejects(()=>f.lifecycle.deleteWork({...request,reason_code:'different-reason'}),/request_id conflicts/);
  assert.equal(f.db.connection.prepare("SELECT COUNT(*) n FROM axiom_lc_audit WHERE tenant_id=? AND event_type='work.erase'").get(f.tenant).n,1);
  const otherReceipt=await other.lifecycle.deleteWork(await prepared(other));
  assert.equal(otherReceipt.request_id,results[0].request_id);assert.notEqual(otherReceipt.receipt_sha256,results[0].receipt_sha256);
  assert.equal((await other.lifecycle.verifyWorkDeletion({work_id:other.work})).status,'VERIFIED_LOGICAL_ERASURE');
});

test('exports replay before erasure and only proof receipts remain retrievable after erasure',async()=>{
  const f=await fixture(),first=await exported(f);
  assert.deepEqual(await exported(f),first);
  await f.lifecycle.deleteWork(await prepared(f));
  assert.deepEqual(await f.lifecycle.getExportReceipt({work_id:f.work,request_id:'export-1'}),first.receipt);
  await assert.rejects(()=>exported(f),/has been erased/);
  for(const table of ['axiom_lc_exports','axiom_lc_delete_requests','axiom_lc_tombstones','axiom_lc_audit'])assert.equal(JSON.stringify(f.db.connection.prepare(`SELECT * FROM ${table}`).all()).includes('Sensitive original evidence payload'),false);
});

test('normal authenticated tenant readback reports erasure and never resurrects a completed task',async()=>{
  const f=await fixture();
  assert.equal(await readD1EvidenceLifecycleErasure({db:f.db,customer:{customer_id:f.tenant},taskId:f.taskId}),null);
  const receipt=await f.lifecycle.deleteWork(await prepared(f));
  const proof=await readD1EvidenceLifecycleErasure({db:f.db,customer:{customer_id:f.tenant},taskId:f.taskId});
  assert.equal(proof.status,'ERASED');assert.deepEqual(proof.deletion_receipt,receipt);
  assert.equal(proof.retained_commitments.work.contract_sha256,f.binding.contract.contract_sha256);
  for(const taskId of [f.taskId,'unknown-task'])assert.equal(await readD1EvidenceLifecycleErasure({db:f.db,customer:{customer_id:'tenant-b'},taskId}),null);
  assert.throws(()=>f.db.connection.prepare("UPDATE axiom_ec_artifacts SET content_json='{}' WHERE tenant_id=?").run(f.tenant),/cannot be changed or resurrected/);
  assert.throws(()=>f.db.connection.prepare('DELETE FROM axiom_ec_evidence WHERE tenant_id=?').run(f.tenant),/cannot be changed or resurrected/);
  assert.throws(()=>f.db.connection.prepare("UPDATE axiom_ec_works SET state='ACTIVE' WHERE tenant_id=?").run(f.tenant),/cannot be changed or resurrected/);
  assert.throws(()=>f.db.connection.exec("UPDATE axiom_lc_delete_requests SET receipt_json='{}'"),/proof is immutable/);
  assert.throws(()=>f.db.connection.exec('DELETE FROM axiom_lc_audit'),/proof is immutable/);
  assert.throws(()=>f.db.connection.exec('DELETE FROM axiom_lc_tombstones'),/proof is immutable/);
});

test('receipt, audit, payload and retained-metadata tampering fail verification after SQL guards are deliberately bypassed',async()=>{
  const f=await fixture();await f.lifecycle.deleteWork(await prepared(f));
  f.db.connection.exec('DROP TRIGGER axiom_ec_artifacts_lifecycle_frozen_update');
  f.db.connection.prepare("UPDATE axiom_ec_artifacts SET content_sha256=? WHERE tenant_id=?").run('f'.repeat(64),f.tenant);
  await assert.rejects(()=>f.lifecycle.verifyWorkDeletion({work_id:f.work}),/metadata changed|commitment changed/);
  await assert.rejects(()=>readD1EvidenceLifecycleErasure({db:f.db,customer:{customer_id:f.tenant},taskId:f.taskId}),/metadata changed|commitment changed/);
  const g=await fixture();await g.lifecycle.deleteWork(await prepared(g));
  g.db.connection.exec("DROP TRIGGER axiom_lc_audit_immutable_update; UPDATE axiom_lc_audit SET payload_json='{}' WHERE sequence=(SELECT MIN(sequence) FROM axiom_lc_audit)");
  await assert.rejects(()=>g.lifecycle.verifyWorkDeletion({work_id:g.work}),/audit chain changed/);
});

test('late audit write failure rolls back payload redaction, tombstones and receipt together',async()=>{
  const f=await fixture(),request=await prepared(f);
  f.db.connection.exec("CREATE TRIGGER reject_lifecycle_erase_audit BEFORE INSERT ON axiom_lc_audit WHEN NEW.event_type='work.erase' BEGIN SELECT RAISE(ABORT,'simulated late lifecycle persistence failure'); END");
  await assert.rejects(()=>f.lifecycle.deleteWork(request),/simulated late lifecycle persistence failure/);
  assertUnchanged(f);assert.equal((await f.gate.get(f.taskId)).status,'COMPLETED');
});
