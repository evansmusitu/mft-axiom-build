/** Destructive builder restore against a separate real workerd authority store.
 * Synthetic local roles and callbacks do not establish independent custody. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync,mkdtempSync,rmSync,cpSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {fixture as ledgerFixture,origin} from './external-ledger-fixture.mjs';
import {createD1ExecutionGovernance} from '../../ops/axiom_execution_contract.mjs';
import {configuredExternalLedger} from '../../integrations/independent-ledger/client.mjs';
import {canonicalJson,sha256Json} from '../../integrations/independent-ledger/protocol.mjs';
import {executeRuntimeTask} from '../../axiom_interface/vnext/runtime_task_service.mjs';
import {executeDecisionTask} from '../../axiom_interface/vnext/runtime_decision_service.mjs';
import {executeAnalyticalTask} from '../../axiom_interface/vnext/runtime_analytical_service.mjs';
import {handleRuntimeTaskApi} from '../../ops/axiom_runtime_task_api.mjs';
import {createD1EvidenceLifecycle,verifyEvidenceLifecycleExport} from '../../ops/axiom_evidence_lifecycle.mjs';
import {ATOMIC_OPERATIONS} from '../../axiom_interface/vnext/capability_registry.js';
const {Miniflare}=await import(process.env.AXIOM_MINIFLARE_MODULE||'miniflare');
const schema=readFileSync(new URL('../../ops/axiom_execution_contract_schema.sql',import.meta.url),'utf8')
  .split('\n').filter(x=>!x.trimStart().startsWith('--')).join('\n').trim()
  .split(/\n(?=(?:PRAGMA|CREATE (?:TABLE|TRIGGER|INDEX))\b)/u).map(x=>x.replace(/\s+/g,' ').trim()).join('\n');
const customer={customer_id:'tenant-alpha'},objective='Prepare the declared acknowledgement.';
const context={project_id:'project-one',work_id:'work-one',controls:{privacy:'Project',budget:2}};
const runtime={inspect:async()=>({ok:true,build_id:'local-ledger-fixture',operation_count:74,tools:ATOMIC_OPERATIONS}),execute:async()=>{throw Error('no protected computation requested');}};
const problem=JSON.parse(readFileSync(new URL('../../frontier_v5/fixtures/decision_analysis_v1.json',import.meta.url),'utf8')).cases[0].problem;
async function builderFixture(t){
  const root=mkdtempSync(join(tmpdir(),'axiom-builder-restore-')),active=join(root,'active'),snapshot=join(root,'snapshot');
  const options={modules:true,compatibilityDate:'2026-07-01',cf:false,script:'export default {fetch(){return new Response("isolated-builder")}}',d1Databases:{EXECUTION_DB:'00000000-0000-4000-8000-000000000056'},d1Persist:active};
  let mf,db,mutateBeforeBatch=null;
  async function start(){mf=new Miniflare(options);db=await mf.getD1Database('EXECUTION_DB');}
  await start();await db.exec(schema);await db.exec(schema);
  t.after(async()=>{if(mf)await mf.dispose();rmSync(root,{recursive:true,force:true});});
  const facade={prepare(sql){return db.prepare(sql);},async batch(statements){if(mutateBeforeBatch){const mutate=mutateBeforeBatch;mutateBeforeBatch=null;await mutate(db);}return db.batch(statements);}};
  return {get db(){return db;},facade,
    gate:client=>createD1ExecutionGovernance({db:facade,customer,externalLedger:client,serverPolicy:{max_provider_calls:2}}),
    count:async table=>(await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n,
    race(mutate){mutateBeforeBatch=mutate;},
    async snapshot(){await mf.dispose();mf=null;cpSync(active,snapshot,{recursive:true});await start();},
    async restore(){await mf.dispose();mf=null;rmSync(active,{recursive:true,force:true});cpSync(snapshot,active,{recursive:true});await start();},
    async restart(){await mf.dispose();mf=null;await start();},
  };
}
async function fixture(t,extra={}){
  const authority=await ledgerFixture(t,{persist:true}),builder=await builderFixture(t),client=await authority.makeClient(extra);
  await authority.bootstrap();
  const admit=()=>builder.gate(client).admit({objective,context});
  const binding=await admit();
  await authority.grant({admission_sha256:binding.admission_sha256,max_actions:4,max_compute_calls:2,max_provider_calls:2});
  return {authority,builder,client,binding,admit};
}
function modelFixture(onCall=()=>{}){
  let count=0;const model=async({stage})=>{count++;await onCall(stage,count);return stage==='planning'?{title:'Declared model',needs_research:false,operation:null,operation_args:{}}:{title:'Brief',summary:'Local acknowledgement from the declared callback.',findings:[],citations:[],limitations:['Synthetic callback; no inference request.']};};
  return {model,get count(){return count;}};
}
const run=(binding,model,taskId='task_ledger_one')=>executeRuntimeTask({objective,customer,governance:binding,runtime,model,idFactory:()=>taskId});

test('actual D1 completion and restarted readback verify signed external evidence before accepting receipts',{timeout:30000},async t=>{
  const f=await fixture(t),model=modelFixture();
  const result=await run(f.binding,model.model);assert.equal(model.count,2);assert.equal(result.external_ledger_evidence.length,2);
  assert.equal(await f.builder.count('axiom_ec_external_consumptions'),2);
  await f.builder.restart();await f.authority.restart();
  const fresh=await f.authority.makeClient(),saved=await f.builder.gate(fresh).get(result.task_id);
  assert.equal(saved.receipt.receipt_sha256,result.receipt.receipt_sha256);
  assert.equal(saved.object_refs.evidence.filter(x=>x.kind==='EXTERNAL_LEDGER_CONSUMPTION').length,2);
  await assert.rejects(()=>f.builder.gate().get(result.task_id),/pinned external ledger verifier required/);
  const row=await f.builder.db.prepare('SELECT reservation_id,envelope_json FROM axiom_ec_external_consumptions LIMIT 1').first(),changed=JSON.parse(row.envelope_json);
  changed.payload.chain_sha256='f'.repeat(64);
  await f.builder.db.prepare('UPDATE axiom_ec_external_consumptions SET envelope_json=?1 WHERE reservation_id=?2').bind(canonicalJson(changed),row.reservation_id).run();
  await assert.rejects(()=>f.builder.gate(fresh).get(result.task_id),/SIGNATURE_INVALID/);
});

test('destructive builder restore, fresh clients and authority restart cannot authorize a second provider dispatch',{timeout:30000},async t=>{
  const f=await fixture(t),model=modelFixture();await f.builder.snapshot();
  const first=await f.admit(),result=await run(first,model.model);assert.equal(model.count,2);assert.equal(result.status,'COMPLETED');
  await f.authority.restart();await f.builder.restore();
  assert.equal(await f.builder.count('axiom_ec_runs'),0);assert.equal(await f.builder.count('axiom_ec_reservations'),0);
  const rebuiltClient=await f.authority.makeClient(),restored=await f.builder.gate(rebuiltClient).admit({objective,context});
  await assert.rejects(()=>run(restored,model.model),e=>['ALREADY_CONSUMED_HOLD','CONTRACT_REBIND_DENIED'].includes(e.remote_code));
  assert.equal(model.count,2,'no callback after rollback');assert.equal(await f.builder.count('axiom_ec_artifacts'),0);
  const held=await f.builder.db.prepare('SELECT status FROM axiom_ec_external_consumptions').first();assert.equal(held.status,'DENIED');
  const read=await rebuiltClient.inspect({tenant_id:customer.customer_id});assert.equal(read.payload.grant.sequence,2);assert.equal(read.payload.grant.provider_calls,2);assert.equal(read.payload.dispatch_allowed,false);
});

test('a lost acknowledgement retains both budgets and blocks resume, retries and local fallback',{timeout:30000},async t=>{
  const authority=await ledgerFixture(t),builder=await builderFixture(t);await authority.bootstrap();let sends=0;
  const client=await authority.makeClient({fetchImpl:async(url,init)=>{sends++;const response=await authority.fetchImpl(url,init);assert.equal(response.status,200);await response.body.cancel();throw Error('response lost after durable consume');}});
  const binding=await builder.gate(client).admit({objective,context});await authority.grant({admission_sha256:binding.admission_sha256});
  const model=modelFixture();await assert.rejects(()=>run(binding,model.model),/AMBIGUOUS_HOLD/);assert.equal(model.count,0);assert.equal(sends,1);
  const row=await builder.db.prepare('SELECT status FROM axiom_ec_external_consumptions').first();assert.equal(row.status,'UNCERTAIN');
  assert.equal((await builder.db.prepare('SELECT provider_calls FROM axiom_ec_works').first()).provider_calls,1);
  const fresh=await authority.makeClient(),again=await builder.gate(fresh).admit({objective,context});
  await assert.rejects(()=>run(again,model.model,'task_ledger_again'),/outcome unresolved/);assert.equal(sends,1);assert.equal(model.count,0);
  const read=await fresh.inspect({tenant_id:customer.customer_id});assert.equal(read.payload.grant.provider_calls,1);assert.equal(await builder.count('axiom_ec_artifacts'),0);
  await assert.rejects(()=>builder.gate().admit({objective,context}),/immutable Work contract/);
});

test('external revocation and local revocation during a consume response fence dispatch',{timeout:30000},async t=>{
  const f=await fixture(t),model=modelFixture();
  await f.authority.request('/v1/operator/revoke',{grant_id:'grant-one',tenant_id:customer.customer_id,expected_epoch:1,challenge:'4'.repeat(64)},{role:'revoke'});
  await assert.rejects(()=>run(f.binding,model.model),e=>e.remote_code==='GRANT_EXPIRED_OR_REVOKED');assert.equal(model.count,0);
  // The independent case below uses a new fixture and revokes the local Work only
  // after the authority has durably consumed the reservation.
  const authority=await ledgerFixture(t),builder=await builderFixture(t);await authority.bootstrap();let binding;
  const client=await authority.makeClient({fetchImpl:async(url,init)=>{const response=await authority.fetchImpl(url,init);if(url.endsWith('/v1/consume'))await binding.revoke();return response;}});
  binding=await builder.gate(client).admit({objective,context});await authority.grant({admission_sha256:binding.admission_sha256});
  await assert.rejects(()=>run(binding,model.model),/revoked/);assert.equal(model.count,0);assert.equal(await builder.count('axiom_ec_artifacts'),0);
  assert.equal((await (await authority.makeClient()).inspect({tenant_id:customer.customer_id})).payload.grant.sequence,1);
});

test('completion snapshot rejects a post-verification proof race atomically',{timeout:30000},async t=>{
  const f=await fixture(t),model=modelFixture(stage=>{if(stage==='synthesis')f.builder.race(async db=>{
    await db.prepare("UPDATE axiom_ec_external_consumptions SET envelope_json=replace(envelope_json,'ALLOW_ONCE','DENY_ONCE')").run();
  });});
  await assert.rejects(()=>run(f.binding,model.model),/external consumption set changed/);
  assert.equal(model.count,2);assert.equal(await f.builder.count('axiom_ec_artifacts'),0);assert.equal(await f.builder.count('axiom_ec_evidence'),0);
  assert.equal(await f.builder.count('axiom_ec_reservations'),2);assert.equal((await f.builder.db.prepare('SELECT status FROM axiom_ec_runs').first()).status,'FAILED');
});

test('decision proof includes an external zero-provider consumption and survives local recovery',{timeout:30000},async t=>{
  const authority=await ledgerFixture(t),builder=await builderFixture(t);await authority.bootstrap();const client=await authority.makeClient();
  const decisionObjective='Compare the declared alternatives.';
  const binding=await builder.gate(client).admit({objective:decisionObjective,context,input_commitment:{kind:'decision',sha256:await sha256Json(problem)}});
  await authority.grant({admission_sha256:binding.admission_sha256});
  const result=await executeDecisionTask({objective:decisionObjective,customer,problem,governance:binding,idFactory:()=> 'task_ledger_decision'});
  assert.equal(result.external_ledger_evidence.length,1);assert.equal(result.execution.result.expected_utilities.launch,28);
  const read=await client.inspect({tenant_id:customer.customer_id});assert.equal(read.payload.grant.provider_calls,0);assert.equal(read.payload.grant.sequence,1);
  await builder.restart();assert.equal((await builder.gate(client).get(result.task_id)).receipt.receipt_sha256,result.receipt.receipt_sha256);
});

test('server-required configuration fails closed and pins grant epochs per Work for historical readback',{timeout:30000},async t=>{
  const f=await ledgerFixture(t),builder=await builderFixture(t),client=await f.makeClient();
  assert.throws(()=>createD1ExecutionGovernance({db:builder.facade,customer,serverPolicy:{external_ledger_required:true}}),/client unavailable/);
  for(const env of [{AXIOM_EXTERNAL_LEDGER_REQUIRED:'yes'},{AXIOM_EXTERNAL_LEDGER_REQUIRED:'true'},{AXIOM_EXTERNAL_LEDGER_CONFIG_JSON:'{}'}])await assert.rejects(()=>configuredExternalLedger(env,{tenant_id:customer.customer_id,work_id:'work-one'}));
  const {execution_artifact_sha256,ledger_id,genesis_id,key_id}=f.config;
  const env={AXIOM_EXTERNAL_LEDGER_REQUIRED:'true',AXIOM_EXTERNAL_LEDGER_CONFIG_JSON:JSON.stringify({origin,ledger_id,genesis_id,key_id,execution_artifact_sha256,public_key_jwk:f.publicJwk}),AXIOM_EXTERNAL_LEDGER_CONSUMERS_JSON:JSON.stringify({'tenant-alpha':{token:'synthetic_consumer_credential_'.repeat(3),read_token:'synthetic_read_credential_'.repeat(3),grants:{'work-one':{grant_id:'grant-one',epoch:1},'work-two':{grant_id:'grant-two',epoch:2}}}})};
  const first=await configuredExternalLedger(env,{tenant_id:customer.customer_id,work_id:'work-one'}),second=await configuredExternalLedger(env,{tenant_id:customer.customer_id,work_id:'work-two'});
  assert.equal(first.client.reference.epoch,1);assert.equal(second.client.reference.epoch,2);assert.equal(first.client.reference.authority_sha256,client.reference.authority_sha256);
  await assert.rejects(()=>configuredExternalLedger(env,{tenant_id:'tenant-beta',work_id:'work-one'}),/NO_OPERATOR_APPROVED_WORK_GRANT/);
  await assert.rejects(()=>configuredExternalLedger(env,{tenant_id:customer.customer_id,work_id:'unapproved-work'}),/NO_OPERATOR_APPROVED_WORK_GRANT/);
});

test('guarded lifecycle requires independent revocation and retains the verified consumption fence after logical erasure',{timeout:30000},async t=>{
  const f=await fixture(t),model=modelFixture();await run(f.binding,model.model);
  const ddl=readFileSync(new URL('../../ops/axiom_evidence_lifecycle_schema.sql',import.meta.url),'utf8').split('\n').filter(x=>!x.trimStart().startsWith('--')).join('\n').trim()
    .split(/\n(?=(?:PRAGMA|INSERT|CREATE (?:TABLE|TRIGGER|INDEX))\b)/u).map(x=>x.replace(/\s+/g,' ').trim()).join('\n');
  await f.builder.db.exec(ddl);await f.builder.db.exec(ddl);
  for(const action of ['plan','export','delete','read'])await f.builder.db.prepare("INSERT INTO axiom_lc_authorizations(tenant_id,authorization_id,principal_id,action,work_id,state,expires_at) VALUES(?1,?2,'fixture-owner',?3,'work-one','ACTIVE',?4)")
    .bind(customer.customer_id,'grant-'+action,'lifecycle.'+action,new Date(Date.now()+600000).toISOString()).run();
  const lifecycle=createD1EvidenceLifecycle({db:f.builder.facade,customer,externalLedger:f.client,authorize:async({action})=>({principal_id:'fixture-owner',authorization_id:'grant-'+action.split('.')[1]})});
  const active=await lifecycle.planWork({work_id:'work-one'});assert.equal(active.can_delete,false);assert.equal(active.blockers[0].kind,'EXTERNAL_LEDGER_GRANT_NOT_REVOKED');
  await f.authority.request('/v1/operator/revoke',{grant_id:'grant-one',tenant_id:customer.customer_id,expected_epoch:1,challenge:'7'.repeat(64)},{role:'revoke'});
  const plan=await lifecycle.planWork({work_id:'work-one'});assert.equal(plan.can_delete,true);assert.equal(plan.retained_external_ledger.consumer_fence_retained,true);
  const bundle=await lifecycle.exportWork({work_id:'work-one',request_id:'export-guarded-ledger'});
  assert.equal(await verifyEvidenceLifecycleExport({...bundle,externalLedger:f.client}),true);assert.equal(await verifyEvidenceLifecycleExport(bundle),false);
  assert.equal((await lifecycle.exportWork({work_id:'work-one',request_id:'export-guarded-ledger'})).receipt.receipt_sha256,bundle.receipt.receipt_sha256);
  const receipt=await lifecycle.deleteWork({work_id:'work-one',request_id:'erase-guarded-ledger',reason_code:'SYNTHETIC_LOCAL_FIXTURE',plan_sha256:plan.plan_sha256,export_receipt_sha256:bundle.receipt.receipt_sha256});
  assert.equal(receipt.status,'ERASED');assert.equal(receipt.external_erasure_verified,false);
  assert.equal((await lifecycle.verifyWorkDeletion({work_id:'work-one'})).status,'VERIFIED_LOGICAL_ERASURE');
  assert.equal((await f.builder.gate(f.client).get('task_ledger_one')).status,'ERASED');
  assert.equal(await f.builder.count('axiom_ec_external_consumptions'),2);assert.equal((await f.client.inspect({tenant_id:customer.customer_id})).payload.grant.sequence,2);
  await f.builder.db.prepare("UPDATE axiom_ec_external_consumptions SET envelope_json=replace(envelope_json,'ALLOW_ONCE','DENY_ONCE')").run();
  await assert.rejects(()=>lifecycle.verifyWorkDeletion({work_id:'work-one'}),/external authority commitment changed/);
});

test('fresh Node processes use actual local HTTP transport and cannot recover a spent permit',{timeout:30000},async t=>{
  const f=await ledgerFixture(t,{persist:true});await f.bootstrap();await f.grant();
  const runChild=async()=>{
    const packet={origin,...f.config,grant_id:'grant-one',epoch:1,public_key_jwk:f.publicJwk,token:'synthetic_consume_credential_'.repeat(3),base:String(await f.readyUrl())};
    const source=`import {createExternalLedgerClient} from ${JSON.stringify(new URL('../../integrations/independent-ledger/client.mjs',import.meta.url).href)};
      let input='';for await(const chunk of process.stdin)input+=chunk;const p=JSON.parse(input),base=p.base;delete p.base;
      // Test-only routing of the pinned synthetic HTTPS origin to the fixture's
      // real loopback HTTP server. Production origin validation is unchanged.
      const client=await createExternalLedgerClient({...p,fetchImpl:(url,init)=>{if(!url.startsWith(p.origin+'/v1/'))throw Error('unpinned fixture route');return fetch(new URL(new URL(url).pathname,base),init);}});
      const request=await client.prepare({contract:{tenant_id:'tenant-alpha',work_id:'work-one',contract_sha256:'c'.repeat(64),policy:{external_ledger:client.reference}},admission_sha256:'b'.repeat(64),task_id:'task_one',slot:0,action:{kind:'model',operation:null,compute_calls:0,provider_calls:1}});
      try{const envelope=await client.consume(request);process.stdout.write(JSON.stringify({permit:true,sequence:envelope.payload.grant_sequence}));}
      catch(error){process.stdout.write(JSON.stringify({permit:false,remote_code:error.remote_code,code:error.code}));}`;
    return new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,['--input-type=module','-e',source],{env:{TZ:'UTC'},stdio:['pipe','pipe','pipe']}),timer=setTimeout(()=>child.kill(),10000);let out='',err='';
      child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);child.on('error',reject);
      child.on('close',code=>{clearTimeout(timer);if(code!==0)reject(Error('fixture child failed: '+err));else try{resolve(JSON.parse(out));}catch(error){reject(error);}});child.stdin.end(JSON.stringify(packet));
    });
  };
  assert.deepEqual(await runChild(),{permit:true,sequence:1});await f.restart();
  const replay=await runChild();assert.equal(replay.permit,false);assert.equal(replay.remote_code,'ALREADY_CONSUMED_HOLD');
  assert.equal((await (await f.makeClient()).inspect({tenant_id:customer.customer_id})).payload.grant.sequence,1);
});

test('analytical pipelines reserve every stage externally and preserve signed evidence on readback',{timeout:30000},async t=>{
  const authority=await ledgerFixture(t),builder=await builderFixture(t);await authority.bootstrap();const client=await authority.makeClient();
  const states=[{id:'A',prior:.5,likelihood:.8},{id:'B',prior:.5,likelihood:.2}],input={workflow:'analytical-pipeline',data:{stages:['first','second'].map(id=>({id,workflow:'bayesian-updating',data:{states},depends_on:[],bindings:[]})),checks:[]}};
  const binding=await builder.gate(client).admit({objective,context:{...context,controls:{privacy:'Private',budget:3}},input_commitment:{kind:'analysis',sha256:await sha256Json(input)}});
  await authority.grant({admission_sha256:binding.admission_sha256,max_actions:3,max_compute_calls:3,max_provider_calls:0});
  const result=await executeAnalyticalTask({objective,customer,input,governance:binding,idFactory:()=> 'task_ledger_pipeline'});
  assert.equal(result.external_ledger_evidence.length,3);assert.equal((await client.inspect({tenant_id:customer.customer_id})).payload.grant.compute_calls,3);
  assert.equal((await builder.gate(client).get(result.task_id)).receipt.receipt_sha256,result.receipt.receipt_sha256);
});

test('HTTP submission with a missing required authority fails before Run creation or any provider callback',{timeout:30000},async t=>{
  const builder=await builderFixture(t),appOrigin='https://isolated-qualification.example';let providerCalls=0;
  const request=new Request(appOrigin+'/vnext/api/tasks',{method:'POST',headers:{origin:appOrigin,'content-type':'application/json'},body:JSON.stringify({objective,submission_id:'missing-required-authority',execution_context:context})});
  const response=await handleRuntimeTaskApi(request,{AXIOM_DB:builder.facade,AXIOM_EXTERNAL_LEDGER_REQUIRED:'true',TASK_RATE_LIMITER:{limit:async()=>({success:true})}},{customer,origin:appOrigin,fetchImpl:async()=>{providerCalls++;throw Error('unexpected provider');}});
  assert.equal(response.status,503);assert.equal(providerCalls,0);assert.equal(await builder.count('axiom_ec_runs'),0);assert.equal(await builder.count('axiom_ec_reservations'),0);
});
