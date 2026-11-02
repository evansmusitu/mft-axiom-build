/** Isolated local workerd + real D1. No hosted accounts or provider calls. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createRemoteD1} from './hosted-storage-client.mjs';
import {createD1ExecutionGovernance} from '../../ops/axiom_execution_contract.mjs';
import {executeDecisionTask} from '../../axiom_interface/vnext/runtime_decision_service.mjs';
import {sha256Json} from '../../axiom_interface/vnext/execution_integrity.mjs';
import {createD1EvidenceLifecycle,verifyEvidenceLifecycleExport} from '../../ops/axiom_evidence_lifecycle.mjs';
import {SHARED_SCOPE,sharedSql} from './shared-d1-scope.mjs';
import {REUSE_DATABASE,inspectReusedD1,seedReusedNamespace} from './reused-d1-preflight.mjs';

const {Miniflare}=await import(process.env.AXIOM_MINIFLARE_MODULE||'miniflare');
const {build}=await import(process.env.AXIOM_ESBUILD_MODULE||'esbuild');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const bundle=await build({entryPoints:[join(root,'qualification/whole-system-20261029/hosted-storage-worker.mjs')],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',loader:{'.sql':'text'},logLevel:'silent'});
const script=bundle.outputFiles[0].text;
const runId='axiom-acceptance-20261101-local-test';
const operatorToken='operator-local-test-credential-'.repeat(3);
const alphaToken='tenant-alpha-local-credential-'.repeat(3);
const betaToken='tenant-beta-local-credential-'.repeat(3);
const revokedToken='tenant-revoked-local-credential-'.repeat(3);
const readOnlyToken='tenant-readonly-local-credential-'.repeat(3);
const digest=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const tenants={};
for(const [token,tenant_id,status,roles] of [
  [alphaToken,'tenant-alpha','ACTIVE',['tasks:read','tasks:write']],
  [betaToken,'tenant-beta','ACTIVE',['tasks:read','tasks:write']],
  [revokedToken,'tenant-revoked','REVOKED',['tasks:read','tasks:write']],
  [readOnlyToken,'tenant-alpha','ACTIVE',['tasks:read']],
])tenants[await digest(token)]={tenant_id,status,roles};
const problem=JSON.parse(readFileSync(join(root,'frontier_v5/fixtures/decision_analysis_v1.json'),'utf8')).cases[0].problem;
const payload={objective:'Compare the declared alternatives.',submission_id:'hosted-submission-one',execution_context:{project_id:'project-one',work_id:'work-one',controls:{privacy:'Private',budget:1}},decision:problem};

async function fixture(t,{marker=runId,persist,shared=false}={}){
  const options={modules:true,compatibilityDate:'2026-07-01',compatibilityFlags:['nodejs_compat'],cf:false,script,d1Databases:{AXIOM_DB:'00000000-0000-4000-8000-000000000156'},bindings:{ACCEPTANCE_RUN_ID:runId,ACCEPTANCE_OPERATOR_TOKEN:operatorToken,ACCEPTANCE_TENANTS_JSON:JSON.stringify(tenants),...(shared?{ACCEPTANCE_STORAGE_SCOPE:SHARED_SCOPE,ACCEPTANCE_NAMESPACE:'axiom_q06_',ACCEPTANCE_REUSE_DATABASE_ID:'a7384b8a-0751-4705-ac77-0616b0885e7c',ACCEPTANCE_LEGACY_TABLES_JSON:JSON.stringify(['legacy_customers'])}:{})},...(persist?{d1Persist:persist}:{})};
  let mf=new Miniflare(options);
  t.after(async()=>{if(mf)await mf.dispose();});
  let db=await mf.getD1Database('AXIOM_DB');
  if(shared){
    await db.exec("CREATE TABLE legacy_customers(id INTEGER PRIMARY KEY,secret_value TEXT); INSERT INTO legacy_customers VALUES(1,'original private fixture');");
    if(marker!==null){
      await db.exec('CREATE TABLE axiom_q06_axiom_acceptance_reuse_scope(singleton INTEGER PRIMARY KEY,run_id TEXT NOT NULL,database_uuid TEXT NOT NULL,scope TEXT NOT NULL,namespace TEXT NOT NULL);');
      await db.prepare('INSERT INTO axiom_q06_axiom_acceptance_reuse_scope VALUES(1,?,?,?,?)').bind(marker,'a7384b8a-0751-4705-ac77-0616b0885e7c',SHARED_SCOPE,'axiom_q06_').run();
    }
  }else if(marker!==null){
    await db.exec('CREATE TABLE IF NOT EXISTS axiom_acceptance_isolation(singleton INTEGER PRIMARY KEY CHECK(singleton=1),run_id TEXT NOT NULL UNIQUE,isolated INTEGER NOT NULL CHECK(isolated=1));');
    await db.prepare('INSERT OR IGNORE INTO axiom_acceptance_isolation VALUES(1,?1,1)').bind(marker).run();
  }
  const fetchImpl=(url,init)=>mf.dispatchFetch(url,init);
  const request=(path,{token=operatorToken,method='GET',body,headers={}}={})=>fetchImpl('https://isolated-acceptance.test'+path,{method,headers:{...(token?{authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'content-type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const remote=createRemoteD1({baseUrl:'https://isolated-acceptance.test',operatorToken,runId,fetchImpl,timeoutMs:5000});
  return {get db(){return db;},remote,request,readyUrl:()=>mf.ready,async schema(){return request('/operator/schema',{method:'POST',body:{run_id:runId}});},async restart(){await mf.dispose();mf=null;mf=new Miniflare(options);db=await mf.getD1Database('AXIOM_DB');}};
}

test('isolated worker refuses schema and RPC on absent or mismatched bootstrap marker',{timeout:30000},async t=>{
  for(const marker of [null,'different-isolated-run']){
    const f=await fixture(t,{marker});
    const health=await f.request('/health',{token:null});
    assert.equal(health.status,503);
    assert.equal((await health.json()).marker_matches,false);
    assert.equal((await f.schema()).status,503);
    await assert.rejects(()=>f.remote.prepare('SELECT 1').first(),/isolated_database_marker_required/);
    assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='axiom_ec_projects'").first()).n,0);
  }
});

test('reused staging storage migrates only the selected namespace and preserves existing records',{timeout:30000},async t=>{
  const f=await fixture(t,{shared:true});
  const before=await f.db.prepare('SELECT * FROM legacy_customers').all();
  const migration=await f.schema();assert.equal(migration.status,200,await migration.clone().text());assert.equal((await f.schema()).status,200);
  const health=await (await f.request('/health',{token:null})).json();assert.equal(health.storage_scope,SHARED_SCOPE);assert.equal(health.isolated_database,false);assert.equal(health.execution_schema_ready,true);
  const response=await f.request('/vnext/api/tasks',{token:alphaToken,method:'POST',body:payload});assert.equal(response.status,200);assert.match(await response.text(),/event: complete/);
  const saved=await (await f.request('/vnext/api/submissions/'+payload.submission_id,{token:alphaToken})).json();assert.equal(saved.execution.result.expected_utilities.launch,28);
  assert.equal((await f.request('/vnext/api/tasks/'+saved.task_id,{token:betaToken})).status,404);
  assert.equal(await f.remote.prepare('SELECT COUNT(*) AS n FROM axiom_ec_reservations').first('n'),1);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='axiom_ec_works'").first()).n,0);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='axiom_q06_axiom_ec_works'").first()).n,1);
  for(const sql of ['SELECT * FROM legacy_customers','DELETE FROM "legacy_customers"',"UPDATE [legacy_customers] SET secret_value='changed'",'DROP TABLE legacy_customers','DELETE FROM sqlite_master','PRAGMA writable_schema=ON','CREATE TABLE unrelated_table(id INTEGER)','SELECT 1; DELETE FROM legacy_customers'])await assert.rejects(()=>f.remote.prepare(sql).run());
  await assert.rejects(()=>f.remote.prepare('DELETE FROM axiom_acceptance_reuse_scope').run(),/protected_isolation_marker/);
  assert.deepEqual((await f.db.prepare('SELECT * FROM legacy_customers').all()).results,before.results);
});

test('shared namespace requires its own exact marker and refuses unowned identifiers',{timeout:30000},async t=>{
  for(const marker of [null,'wrong-shared-run']){
    const f=await fixture(t,{shared:true,marker});assert.equal((await f.schema()).status,503);
    assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='axiom_q06_axiom_ec_works'").first()).n,0);
  }
  const config={prefix:'axiom_q06_',legacyTables:['legacy_customers']};
  for(const sql of ["INSERT OR REPLACE INTO 'legacy_customers' VALUES(1)",'UPDATE/*gap*/`legacy_customers` SET id=2','CREATE TRIGGER axiom_ec_evil AFTER INSERT ON legacy_customers BEGIN SELECT 1; END','CREATE TABLE axiom_ec_evil(id INTEGER REFERENCES legacy_customers(id))','ATTACH DATABASE \'x\' AS y','PRAGMA journal_mode=OFF'])assert.throws(()=>sharedSql(sql,config));
});

test('reuse preflight hashes real legacy records and rejects collisions or changed originals without database provisioning',{timeout:30000},async t=>{
  const f=await fixture(t,{marker:null}),d=REUSE_DATABASE;
  await f.db.exec("CREATE TABLE legacy_customers(id INTEGER PRIMARY KEY,secret_value TEXT); INSERT INTO legacy_customers VALUES(1,'private preservation fixture');");
  const paths=[];let name=d.name;
  const cf=async(path,options={})=>{
    paths.push({path,method:options.method??'GET'});
    if(path.endsWith('/settings'))return {bindings:[{type:'d1',name:'AXIOM_DB',id:d.uuid}]};
    if(path.endsWith('/query'))return [await f.db.prepare(options.body.sql).bind(...options.body.params).all()];
    assert.equal(path,`/accounts/${d.account_id}/d1/database/${d.uuid}`);assert.equal(options.method,undefined);return {uuid:d.uuid,name,file_size:81920};
  };
  const before=await inspectReusedD1(cf);assert.equal(before.snapshot.tables[0].row_count,1);assert.equal(JSON.stringify(before).includes('private preservation fixture'),false);
  await seedReusedNamespace(cf,{runId:'axiom-acceptance-20261101-06',preflight:before});
  assert.equal((await inspectReusedD1(cf,{previous:before})).original_schema_records_and_worker_unchanged,true);
  await assert.rejects(()=>inspectReusedD1(cf),/namespace already exists/);
  await f.db.prepare("UPDATE legacy_customers SET secret_value='changed by another actor'").run();
  await assert.rejects(()=>inspectReusedD1(cf,{previous:before}),/original staging schema, records or Worker settings changed/);
  name='different-database';await assert.rejects(()=>inspectReusedD1(cf),/database name changed/);
  assert.equal(paths.some(x=>x.path.endsWith('/database')||x.method==='DELETE'||x.method==='PUT'),false);
});

test('remote client preserves real D1 results, first-column reads and atomic batch rollback',{timeout:30000},async t=>{
  const f=await fixture(t);
  assert.equal((await f.schema()).status,200);
  assert.equal((await f.schema()).status,200,'canonical schema is idempotent');
  const health=await f.request('/health',{token:null});
  const status=await health.json();
  assert.equal(status.marker_matches,true);assert.equal(status.execution_schema_ready,true);
  assert.equal(status.production_authority,false);
  await f.remote.exec('CREATE TABLE acceptance_atomic(id INTEGER PRIMARY KEY, value TEXT, data BLOB);');
  const inserted=await f.remote.prepare('INSERT INTO acceptance_atomic VALUES(?1,?2,?3)').bind(1,'durable',new Uint8Array([3,7,9])).run();
  assert.equal(inserted.success,true);assert.equal(inserted.meta.changes,1);
  assert.equal(await f.remote.prepare('SELECT value FROM acceptance_atomic WHERE id=?').bind(1).first('value'),'durable');
  assert.deepEqual((await f.remote.prepare('SELECT data FROM acceptance_atomic').all()).results[0].data,[3,7,9]);
  const batch=await f.remote.batch([f.remote.prepare('SELECT COUNT(*) AS n FROM acceptance_atomic'),f.remote.prepare('UPDATE acceptance_atomic SET value=? WHERE id=?').bind('changed',1)]);
  assert.equal(batch[0].results[0].n,1);assert.equal(batch[1].meta.changes,1);
  await assert.rejects(()=>f.remote.batch([f.remote.prepare('INSERT INTO acceptance_atomic(id,value) VALUES(2,?)').bind('must roll back'),f.remote.prepare('INSERT INTO acceptance_atomic(id) VALUES(1)')]),/UNIQUE constraint failed/);
  assert.equal(await f.remote.prepare('SELECT COUNT(*) AS n FROM acceptance_atomic').first('n'),1);
  await assert.rejects(()=>f.remote.prepare('DELETE FROM axiom_acceptance_isolation').run(),/protected_isolation_marker/);
  await assert.rejects(()=>f.remote.exec("ATTACH DATABASE ':memory:' AS other"),/database_attachment_forbidden/);
  assert.equal((await f.request('/operator/schema',{method:'POST',body:{run_id:runId,sql:'DROP TABLE axiom_ec_projects'}})).status,400);
  assert.equal((await f.request('/rpc-d1',{method:'POST',body:{run_id:'wrong-run',action:'first',sql:'SELECT 1',params:[]}})).status,409);
});

test('tenant decision API derives identity from bearer, persists the actual pipeline and scopes replay/readback',{timeout:30000},async t=>{
  const f=await fixture(t);assert.equal((await f.schema()).status,200);
  const submit=token=>f.request('/vnext/api/tasks',{token,method:'POST',body:payload});
  const first=await submit(alphaToken);assert.equal(first.status,200);
  const events=await first.text();assert.match(events,/event: complete/);
  const read=await f.request('/vnext/api/submissions/'+payload.submission_id,{token:alphaToken});assert.equal(read.status,200);
  const saved=await read.json();
  assert.equal(saved.customer_id,'tenant-alpha');assert.equal(saved.status,'COMPLETED');
  assert.equal(saved.execution.result.expected_utilities.launch,28);
  assert.equal(saved.execution.result.recommendation_only,true);assert.equal(saved.execution.result.authority_granted,false);
  assert.equal(saved.object_refs.artifacts.length,1);assert.equal(saved.object_refs.evidence.length,3);
  const replay=await submit(alphaToken);assert.equal(replay.status,200);assert.ok((await replay.text()).includes(saved.receipt.receipt_sha256));
  assert.equal(await f.remote.prepare('SELECT COUNT(*) AS n FROM axiom_ec_reservations').first('n'),1);
  assert.equal((await f.request('/vnext/api/submissions/'+payload.submission_id,{token:betaToken})).status,404);
  assert.equal((await f.request('/vnext/api/tasks/'+saved.task_id,{token:betaToken})).status,404);
  const beta=await submit(betaToken);assert.equal(beta.status,200);assert.match(await beta.text(),/event: complete/);
  const second=await (await f.request('/vnext/api/submissions/'+payload.submission_id,{token:betaToken})).json();
  assert.equal(second.customer_id,'tenant-beta');assert.notEqual(second.task_id,saved.task_id);
  assert.equal(await f.remote.prepare('SELECT COUNT(*) AS n FROM axiom_ec_runs').first('n'),2);
  for(const token of ['unknown-token-local-value'.repeat(3),revokedToken,operatorToken])assert.equal((await submit(token)).status,401);
  assert.equal((await submit(readOnlyToken)).status,403);
  assert.equal((await f.request('/vnext/api/submissions/'+payload.submission_id,{token:readOnlyToken})).status,200);
  assert.equal((await f.request('/operator/schema',{token:alphaToken,method:'POST',body:{run_id:runId}})).status,401);
  assert.equal((await f.request('/rpc-d1',{token:alphaToken,method:'POST',body:{run_id:runId,action:'first',sql:'SELECT 1'}})).status,401);
  for(const headers of [{origin:'https://isolated-acceptance.test'},{origin:'null'},{'sec-fetch-site':'same-origin'},{cookie:'session=browser'}]){
    assert.equal((await f.request('/vnext/api/tasks',{token:alphaToken,method:'POST',body:payload,headers})).status,403);
    assert.equal((await f.request('/rpc-d1',{method:'POST',body:{run_id:runId,action:'first',sql:'SELECT 1'},headers})).status,403);
  }
  assert.equal((await f.request('/vnext/api/tasks',{token:alphaToken,method:'POST',body:{...payload,customer_id:'tenant-beta'}})).status,400);
  const {decision,...withoutDecision}=payload;
  assert.equal((await f.request('/vnext/api/tasks',{token:alphaToken,method:'POST',body:withoutDecision})).status,400);
  assert.equal((await f.request('/vnext/api/tasks',{token:alphaToken,method:'POST',body:payload})).headers.get('access-control-allow-origin'),null);
});

test('Node governance runs through authenticated RPC with real D1 and survives worker restart',{timeout:30000},async t=>{
  for(const shared of [false,true]){
  const persist=mkdtempSync(join(tmpdir(),'axiom-hosted-storage-'));
  t.after(()=>rmSync(persist,{recursive:true,force:true}));
  const f=await fixture(t,{persist,shared});assert.equal((await f.schema()).status,200);
  const customer={customer_id:'tenant-node-client'};
  const gate=createD1ExecutionGovernance({db:f.remote,customer});
  const governance=await gate.admit({objective:payload.objective,context:{...payload.execution_context,work_id:'work-node-client'},input_commitment:{kind:'decision',sha256:await sha256Json(problem)}});
  const result=await executeDecisionTask({objective:payload.objective,customer,problem,governance,idFactory:()=> 'task_node_client'});
  assert.equal(result.execution.result.expected_utilities.launch,28);
  await f.restart();
  const restored=await createD1ExecutionGovernance({db:f.remote,customer}).get(result.task_id);
  assert.equal(restored.receipt.receipt_sha256,result.receipt.receipt_sha256);
  assert.equal(restored.object_refs.evidence.length,3);
  if(shared){
    const fresh=await new Promise((resolveRead,rejectRead)=>{
      const child=spawn(process.execPath,[join(root,'qualification/whole-system-20261029/fresh-d1-readback.mjs')],{env:{TZ:'UTC'},stdio:['pipe','pipe','pipe']});
      let out='',err='';const timer=setTimeout(()=>child.kill(),15000);child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);child.on('error',rejectRead);
      child.on('close',code=>{clearTimeout(timer);if(code!==0)rejectRead(Error(err));else try{resolveRead(JSON.parse(out));}catch(error){rejectRead(error);}});
      Promise.resolve(f.readyUrl()).then(url=>child.stdin.end(JSON.stringify({base_url:String(url),operator_token:operatorToken,run_id:runId,tenant_id:customer.customer_id,task_id:result.task_id})),rejectRead);
    });
    assert.equal(fresh.receipt_sha256,result.receipt.receipt_sha256);assert.equal(fresh.receipt_verified,true);
  }
  }
});

test('tenant rate limiting consumes an atomic, tenant-scoped D1 counter',{timeout:30000},async t=>{
  const f=await fixture(t);assert.equal((await f.schema()).status,200);
  for(let i=0;i<30;i++)assert.equal((await f.request('/vnext/api/tasks',{token:alphaToken,method:'POST',body:{decision:problem}})).status,400);
  assert.equal(await f.remote.prepare('SELECT SUM(hits) AS n FROM axiom_acceptance_rate_limits WHERE tenant_id=?').bind('tenant-alpha').first('n'),30);
  // Keep the denial check deterministic if the thirty calls crossed a minute.
  const window=Math.floor(Date.now()/60000);
  await f.remote.batch([window,window+1].map(value=>f.remote.prepare('INSERT INTO axiom_acceptance_rate_limits VALUES(?1,?2,?3,30) ON CONFLICT(run_id,tenant_id,window_start) DO UPDATE SET hits=30').bind(runId,'tenant-alpha',value)));
  assert.equal((await f.request('/vnext/api/tasks',{token:alphaToken,method:'POST',body:payload})).status,429);
  assert.equal((await f.request('/vnext/api/tasks',{token:betaToken,method:'POST',body:payload})).status,200);
});

test('real D1 lifecycle migrations preserve export commitments and normal authenticated HTTP reads return 410 after erasure',{timeout:30000},async t=>{
  for(const shared of [false,true]){
  const f=await fixture(t,{shared});assert.equal((await f.schema()).status,200);
  const submitted=await f.request('/vnext/api/tasks',{token:alphaToken,method:'POST',body:payload});assert.equal(submitted.status,200);assert.match(await submitted.text(),/event: complete/);
  const before=await (await f.request('/vnext/api/submissions/'+payload.submission_id,{token:alphaToken})).json();
  const workId=payload.execution_context.work_id,tenant='tenant-alpha';
  const actions=['plan','export','hold','dependency','delete','read'].map(action=>'lifecycle.'+action);
  await f.remote.batch(actions.map(action=>f.remote.prepare('INSERT INTO axiom_lc_authorizations VALUES(?,?,?,?,?,?,?)').bind(tenant,'grant-'+action,'acceptance-owner',action,workId,'ACTIVE',new Date(Date.now()+3600000).toISOString())));
  const lifecycle=createD1EvidenceLifecycle({db:f.remote,customer:{customer_id:tenant},authorize:async({action})=>({principal_id:'acceptance-owner',authorization_id:'grant-'+action})});
  await lifecycle.placeHold({work_id:workId,hold_id:'hold-before-erasure',object_kind:'WORK',object_id:workId,reason:'Generated acceptance legal hold'});
  const blocked=await lifecycle.planWork({work_id:workId});assert.equal(blocked.can_delete,false);
  await lifecycle.releaseHold({work_id:workId,hold_id:'hold-before-erasure',reason:'Generated hold released by owner'});
  const plan=await lifecycle.planWork({work_id:workId});assert.equal(plan.can_delete,true);
  const exported=await lifecycle.exportWork({work_id:workId,request_id:'export-before-erasure'});assert.equal(await verifyEvidenceLifecycleExport(exported),true);
  const receipt=await lifecycle.deleteWork({work_id:workId,request_id:'erase-generated-work',reason_code:'ACCEPTANCE_FIXTURE',plan_sha256:plan.plan_sha256,export_receipt_sha256:exported.receipt.receipt_sha256});
  assert.equal((await lifecycle.verifyWorkDeletion({work_id:workId})).status,'VERIFIED_LOGICAL_ERASURE');
  const read=await f.request('/vnext/api/submissions/'+payload.submission_id,{token:alphaToken});assert.equal(read.status,410);
  const erased=await read.json();assert.equal(erased.status,'ERASED');assert.equal(erased.deletion_receipt.receipt_sha256,receipt.receipt_sha256);
  assert.equal(erased.retained_commitments.artifacts[0].content_sha256,before.receipt.artifact_sha256);
  assert.equal((await f.request('/vnext/api/tasks/'+before.task_id,{token:alphaToken})).status,410);
  assert.equal((await f.request('/vnext/api/tasks/'+before.task_id,{token:betaToken})).status,404);
  assert.equal(await f.remote.prepare('SELECT COUNT(*) AS n FROM axiom_lc_guards').first('n'),0,'comparison plaintext is not retained');
  const raw=await f.remote.prepare('SELECT content_json,content_sha256 FROM axiom_ec_artifacts WHERE tenant_id=? AND task_id=?').bind(tenant,before.task_id).first();
  assert.equal(JSON.parse(raw.content_json).schema,'musitu.axiom.evidence-erased.v1');assert.equal(raw.content_sha256,before.receipt.artifact_sha256);
  assert.equal(await f.remote.prepare('SELECT COUNT(*) AS n FROM axiom_ec_projects WHERE tenant_id=?').bind(tenant).first('n'),1,'shared Project is retained');
  }
});

test('analytical workflows use the authenticated task API, real D1 budget reservations and committed readback',{timeout:30000},async t=>{
  for(const shared of [false,true]){
  const persist=mkdtempSync(join(tmpdir(),'axiom-analytical-storage-'));t.after(()=>rmSync(persist,{recursive:true,force:true}));
  const f=await fixture(t,{persist,shared});assert.equal((await f.schema()).status,200);
  const input={workflow:'bayesian-updating',data:{states:[{id:'A',prior:.5,likelihood:.8},{id:'B',prior:.5,likelihood:.2}]}};
  const body={objective:'Compare declared analytical inputs.',submission_id:'analysis-submission',execution_context:{project_id:'project-analysis',work_id:'analysis-work',controls:{privacy:'Private',budget:1}},analysis:input};
  const submit=await f.request('/vnext/api/tasks',{token:alphaToken,method:'POST',body});assert.equal(submit.status,200);assert.match(await submit.text(),/event: complete/);
  const saved=await (await f.request('/vnext/api/submissions/analysis-submission',{token:alphaToken})).json();
  assert.equal(saved.execution.result.result.posterior.A,.8);assert.equal(saved.execution.operation,'analysis.evaluate');assert.equal(saved.provider_evidence,undefined);
  assert.equal(await f.remote.prepare('SELECT compute_calls FROM axiom_ec_works WHERE tenant_id=? AND work_id=?').bind('tenant-alpha','analysis-work').first('compute_calls'),1);
  assert.equal((await f.request('/vnext/api/tasks/'+saved.task_id,{token:betaToken})).status,404);
  const replay=await f.request('/vnext/api/tasks',{token:alphaToken,method:'POST',body});assert.ok((await replay.text()).includes(saved.receipt.receipt_sha256));
  const ambiguous=await f.request('/vnext/api/tasks',{token:alphaToken,method:'POST',body:{...body,decision:problem}});assert.equal(ambiguous.status,400);
  const changed=structuredClone(body);changed.analysis.data.states[0].likelihood=.7;
  assert.equal((await f.request('/vnext/api/tasks',{token:alphaToken,method:'POST',body:changed})).status,403);
  await f.restart();const after=await (await f.request('/vnext/api/tasks/'+saved.task_id,{token:alphaToken})).json();assert.equal(after.receipt.receipt_sha256,saved.receipt.receipt_sha256);
  }
});

test('RPC deadline bounds headers and body without retrying uncertain mutations',{timeout:5000},async()=>{
  for(const fetchImpl of [async()=>new Promise(()=>{}),async()=>new Response(new ReadableStream({pull(){return new Promise(()=>{});}}),{headers:{'content-type':'application/json'}})]){
    let calls=0;
    const db=createRemoteD1({baseUrl:'https://isolated-acceptance.test',operatorToken,runId,timeoutMs:25,fetchImpl:async(...args)=>{calls++;return fetchImpl(...args);}});
    const start=Date.now();
    await assert.rejects(()=>db.prepare('INSERT INTO a VALUES(1)').run(),error=>error.code==='D1_RPC_DEADLINE'&&error.mayHaveExecuted===true);
    assert.equal(calls,1);assert.ok(Date.now()-start<1000);
  }
  let calls=0;
  const db=createRemoteD1({baseUrl:'https://isolated-acceptance.test',operatorToken,runId,fetchImpl:async(url,init)=>{calls++;assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');return new Response('',{status:302,headers:{location:'https://other.example'}});}});
  await assert.rejects(()=>db.prepare('SELECT 1').first(),error=>error.code==='D1_RPC_TRANSPORT_POLICY');
  assert.equal(calls,1);
});

test('RPC rejects oversized bodies, wrong-run responses and foreign batch statements before reuse',{timeout:5000},async()=>{
  for(const [body,maxBodyBytes,code]of[
    [JSON.stringify({ok:true,run_id:runId,result:'x'.repeat(1000)}),100,'D1_RPC_BODY_LIMIT'],
    [JSON.stringify({ok:true,run_id:'another-run-id',result:{success:true}}),1000,'D1_RPC_PROTOCOL'],
    ['not-json',1000,'D1_RPC_PROTOCOL'],
  ]){
    let calls=0;
    const db=createRemoteD1({baseUrl:'https://isolated-acceptance.test',operatorToken,runId,maxBodyBytes,fetchImpl:async()=>{calls++;return new Response(body,{headers:{'content-type':'application/json'}});}});
    await assert.rejects(()=>db.prepare('UPDATE a SET b=1').run(),error=>error.code===code&&error.mayHaveExecuted===true);
    assert.equal(calls,1);
  }
  let calls=0;
  const config={baseUrl:'https://isolated-acceptance.test',operatorToken,runId,fetchImpl:async()=>{calls++;throw new Error('should not dispatch');}};
  const a=createRemoteD1(config),b=createRemoteD1(config);
  assert.throws(()=>a.batch([b.prepare('SELECT 1')]),/another D1 binding/);
  assert.throws(()=>a.prepare('SELECT ?').bind({arbitrary:'object'}),/D1 bindings/);
  assert.equal(calls,0);
});
