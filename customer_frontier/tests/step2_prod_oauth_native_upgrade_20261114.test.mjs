import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import worker,{lateFailure,applyReviewed,concurrentReviewed,readUpgraded,tenantAndRevocation,TENANT_CASES} from '../recovery/step2_prod_oauth_native_worker_20261114.mjs';
import { PLAN,PLAN_SHA256 } from '../recovery/step2_reviewed_oauth_plan_20261114.mjs';
import { rehearse,expectedStateMatches,checkedReply } from '../recovery/step2_prod_oauth_native_upgrade_20261114.mjs';
import { allowed,PRODUCTION_BASE,PRODUCTION_DATABASE,PREVIEW_A,PREVIEW_B } from '../recovery/step2_prod_oauth_preview_transport_20261114.mjs';
import { ACCOUNT,NAME } from '../recovery/step2_create_oauth_restore_target_20261114.mjs';
import { TARGET,TARGET_BASE,ACCOUNT_BASE } from '../recovery/step2_prod_oauth_hosted_restore_20261114.mjs';
const baseline=JSON.parse(readFileSync(new URL('../evidence/hosted_recovery_20261114/prod_oauth_hosted_restore_parity_rollback_passed_20261114.json',import.meta.url)));
const preflight=JSON.parse(readFileSync(new URL('../evidence/hosted_recovery_20261114/prod_oauth_real_data_local_upgrade_preflight_passed_20261114.json',import.meta.url)));
const workerSource=readFileSync(new URL('../recovery/step2_prod_oauth_native_worker_20261114.mjs',import.meta.url),'utf8');
const planSource=readFileSync(new URL('../recovery/step2_reviewed_oauth_plan_20261114.mjs',import.meta.url),'utf8');
const SQL=`CREATE TABLE customers(id TEXT PRIMARY KEY,status TEXT NOT NULL,email TEXT);
CREATE TABLE api_keys(id TEXT PRIMARY KEY,customer_id TEXT NOT NULL REFERENCES customers(id),key_hash TEXT NOT NULL,status TEXT NOT NULL,revoked_at TEXT);
CREATE TABLE oauth_authorization_codes(code_hash TEXT PRIMARY KEY,customer_id TEXT REFERENCES customers(id));
CREATE TABLE oauth_access_tokens(token_hash TEXT PRIMARY KEY,api_key_id TEXT REFERENCES api_keys(id),customer_id TEXT REFERENCES customers(id),revoked_at TEXT);
CREATE TABLE oauth_refresh_tokens(token_hash TEXT PRIMARY KEY,api_key_id TEXT REFERENCES api_keys(id),customer_id TEXT REFERENCES customers(id),revoked_at TEXT);
CREATE TABLE oauth_clients(id TEXT PRIMARY KEY);CREATE TABLE oauth_authorization_flows(id TEXT PRIMARY KEY);
INSERT INTO customers VALUES('synthetic-customer-a','active','private-a@example.invalid'),('synthetic-customer-b','active','private-b@example.invalid');
INSERT INTO api_keys VALUES('synthetic-key-a','synthetic-customer-a','SYNTHETIC_PRIVATE_HASH','active',NULL),('synthetic-key-b','synthetic-customer-b','SYNTHETIC_PRIVATE_HASH','active',NULL);
INSERT INTO oauth_authorization_codes VALUES('synthetic-code-a','synthetic-customer-a'),('synthetic-code-b','synthetic-customer-b');
INSERT INTO oauth_access_tokens VALUES('synthetic-access-a','synthetic-key-a','synthetic-customer-a',NULL),('synthetic-access-b','synthetic-key-b','synthetic-customer-b',NULL);
INSERT INTO oauth_refresh_tokens VALUES('synthetic-refresh-a','synthetic-key-a','synthetic-customer-a',NULL),('synthetic-refresh-b','synthetic-key-b','synthetic-customer-b',NULL);`;
function d1({atomic=true}={}){
  const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON;');db.exec(SQL);const batches=[];
  const prepare=sql=>{let params=[];const p={sql,args:()=>params,bind(...values){params=values;return p;},
    async first(){return db.prepare(sql).get(...params)??null;},async run(){return db.prepare(sql).run(...params);}};return p;};
  return{db,prepare,batches,async batch(items){batches.push(items.length);if(atomic)db.exec('BEGIN IMMEDIATE');
    try{const rows=items.map(p=>({results:db.prepare(p.sql).all(...p.args())}));if(atomic)db.exec('COMMIT');return rows;}
    catch(error){if(atomic)db.exec('ROLLBACK');throw error;}},close:()=>db.close()};
}
function state(db){const schema=db.prepare("SELECT type,name,sql FROM sqlite_schema ORDER BY type,name").all();
  const tables=schema.filter(r=>r.type==='table').map(r=>[r.name,db.prepare('SELECT * FROM "'+r.name.replaceAll('"','""')+'"').all()]);
  return JSON.stringify([schema,tables]);}
test('the native worker runs the exact reviewed plan atomically, idempotently and with both-token revocation',async()=>{
  const db=d1();try{const original=state(db.db);
    assert.equal((await lateFailure(db)).status,'REVIEWED_PLAN_LATE_FAILURE_ROLLED_BACK');assert.equal(state(db.db),original);
    assert.equal(db.batches[0],91);assert.equal((await applyReviewed(db)).status,'REVIEWED_PLAN_APPLIED_IN_ONE_NATIVE_BATCH');
    const upgraded=state(db.db);await applyReviewed(db);assert.equal(state(db.db),upgraded);
    await concurrentReviewed(db);assert.equal(state(db.db),upgraded);assert.equal((await readUpgraded(db)).foreign_keys,1);
    const r=await tenantAndRevocation(db);assert.equal(r.tests.length,15);assert.equal(r.recovered_customer_rows_used,2);
    assert.equal(r.real_customer_login_qualified,false);assert.equal(r.tests.every(t=>t.result==='PASS'),true);
    for(const secret of ['synthetic-customer-a','synthetic-key-a','SYNTHETIC_PRIVATE_HASH','private-a@example.invalid'])
      assert.equal(JSON.stringify(r).includes(secret),false);
    assert.deepEqual(db.batches.slice(0,5),[91,89,89,89,89]);
  }finally{db.close();}
});
test('late failure witness rejects a nontransactional adapter and a plan that rejects dirty data early',async()=>{
  const unsafe=d1({atomic:false});try{await assert.rejects(lateFailure(unsafe),/LATE_FAILURE_DDL_NOT_ROLLED_BACK/);}finally{unsafe.close();}
  const dirty=d1();try{dirty.db.exec("UPDATE customers SET status='disabled' WHERE id='synthetic-customer-a'");const before=state(dirty.db);
    await assert.rejects(lateFailure(dirty),/REVIEWED_PLAN_REJECTED_BEFORE_DELIBERATE_LATE_FAILURE/);assert.equal(state(dirty.db),before);
  }finally{dirty.close();}
});
test('the private native route cannot receive caller SQL or run without the per-job challenge',async()=>{
  const env={GATE2_PROBE_KEY:'a'.repeat(64),RECOVERY_DB:{prepare(){assert.fail('Unauthorized binding access');}}};
  assert.equal((await worker.fetch(new Request('https://unit.invalid/gate2/prod-oauth',{method:'POST'}),env)).status,404);
  assert.equal((await worker.fetch(new Request('https://unit.invalid/gate2/prod-oauth',{method:'POST',headers:{authorization:'Bearer '+env.GATE2_PROBE_KEY},
    body:JSON.stringify({operation:'apply-reviewed-plan',sql:'DELETE FROM customers'})}),env)).status,400);
});
test('the bundled public SQL matches every statement from the unchanged Python builder',()=>{
  const root=fileURLToPath(new URL('../../',import.meta.url));
  const r=spawnSync('python3',['auth/oauth_identity_upgrade_v2.py'],{cwd:root,encoding:'utf8',maxBuffer:300000});
  assert.equal(r.status,0);const plan=JSON.parse(r.stdout);assert.deepEqual(PLAN,plan.statements);
  assert.equal(createHash('sha256').update(JSON.stringify(PLAN.slice(0,-3))).digest('hex'),PLAN_SHA256);
});
test('expected state comparison permits only version-record timestamp variance',()=>{
  const expected=preflight.memory_preflight.expected_after_upgrade;
  const varied=structuredClone(expected),versionHash=createHash('sha256').update('oauth_identity_schema_versions').digest('hex');
  varied.tables.find(t=>t.table_name_sha256===versionHash).data_sha256='f'.repeat(64);
  assert.equal(expectedStateMatches(varied,expected),true);
  varied.tables.find(t=>t.table_name_sha256!==versionHash).data_sha256='e'.repeat(64);
  assert.equal(expectedStateMatches(varied,expected),false);
});
const ok=result=>({success:true,result});
function simulation(change={}){
  const calls=[],forms=new Map();let stage='baseline',rolled=false;
  const mark='00000001-00000002-00000003-0123456789abcdef0123456789abcdef';
  const api=async(role,method,path,body,sessionToken)=>{
    assert.equal(allowed(role,method,path,body),true);calls.push({role,method,path});
    if(path===PRODUCTION_BASE)return ok({uuid:PRODUCTION_DATABASE,file_size:3092480});
    if(path===ACCOUNT_BASE)return ok({id:ACCOUNT});
    if(path.endsWith('/subscriptions'))return ok([]);
    if(path.endsWith('/d1/database?page=1&per_page=100'))return{...ok([{uuid:TARGET,name:NAME},
      {uuid:'be760b23-2ed1-47aa-92aa-9042ce917bb9',name:'axiom-idp-step1-disposable-restore-20261114-704a7351'}]),result_info:{total_count:2}};
    if(path.endsWith('/workers/scripts'))return ok([]);
    if(path.includes('/pages/projects'))return{...ok([]),result_info:{total_count:0}};
    if(path===TARGET_BASE)return ok({uuid:TARGET,name:NAME});
    if(path.endsWith('/workers/subdomain'))return ok({subdomain:'synthetic'});
    if(path.endsWith('/time_travel/bookmark'))return ok({bookmark:mark});
    if(path.includes('/time_travel/restore?')){rolled=true;stage='baseline';return ok({bookmark:mark});}
    if(path.endsWith('/query'))return ok([{success:true,results:body.sql==='PRAGMA foreign_keys'?[{foreign_keys:change.disabledCleanupFk?0:1}]:[]}]);
    if(path.endsWith('/export'))return ok({status:'complete',at_bookmark:mark,
      result:{signed_url:'https://synthetic.r2.cloudflarestorage.com/'+role+'-'+stage}});
    if(path.endsWith('/subdomain/edge-preview'))return ok({token:'SYNTHETIC_SESSION_TOKEN',exchange_url:'https://exchange.synthetic.workers.dev/auth'});
    if(path.endsWith('/edge-preview')&&method==='POST'){
      assert.equal(sessionToken,'SYNTHETIC_EXPANDED_TOKEN');const meta=JSON.parse(await body.get('metadata').text());
      assert.equal(meta.bindings.find(b=>b.type==='d1').id,TARGET);assert.equal(await body.get('step2_reviewed_oauth_plan_20261114.mjs').text(),planSource);
      forms.set(path.includes(PREVIEW_B)?PREVIEW_B:PREVIEW_A,meta);return ok({preview_token:'SYNTHETIC_PREVIEW_TOKEN'});
    }
    assert.fail('Unexpected API call');
  };
  const edge=async(url,init)=>{
    if(!init)return{token:'SYNTHETIC_EXPANDED_TOKEN'};
    const name=new URL(url).hostname.startsWith(PREVIEW_B)?PREVIEW_B:PREVIEW_A,meta=forms.get(name);
    const binding=k=>meta.bindings.find(b=>b.name===k).text;
    assert.equal(init.headers.Authorization,'Bearer '+binding('GATE2_PROBE_KEY'));
    const operation=JSON.parse(init.body).operation;
    const out={schema:'musitu.axiom.production-oauth-native-worker-result.v1',preview_instance_tag:binding('GATE2_INSTANCE_TAG'),
      release_status:'NOT_RELEASE',plan_sha256:PLAN_SHA256,statement_count:89};
    if(operation==='late-failure')out.status='REVIEWED_PLAN_LATE_FAILURE_ROLLED_BACK';
    if(operation==='apply-reviewed-plan'){stage='upgraded';out.status='REVIEWED_PLAN_APPLIED_IN_ONE_NATIVE_BATCH';}
    if(operation==='concurrent-reviewed-plan'){out.status='REVIEWED_PLAN_CONCURRENT_BATCHES_VERIFIED';out.concurrent_batches=2;}
    if(operation==='read-after-upgrade')out.status='UPGRADED_COPY_STATE_VERIFIED';
    if(operation==='tenant-revocation-tests'){stage='fixtures';out.status='RECOVERED_OAUTH_TENANT_AND_REVOCATION_CHECKS_VERIFIED';
      out.tests=TENANT_CASES.map(name=>({name,result:'PASS'}));out.recovered_customer_rows_used=2;out.fixture_principals_only=true;out.real_customer_login_qualified=false;}
    return out;
  };
  const transfer=async(method,url)=>Buffer.from(url.includes('production')?'source':stage);
  const inspect=bytes=>{
    const value=bytes.toString();
    if(value==='upgraded')return preflight.memory_preflight.expected_after_upgrade;
    if(change.corruptCleanup&&rolled&&value!=='source')return{...baseline.baseline,user_data_sha256:'f'.repeat(64)};
    if(change.sourceDrift&&value==='source')return{...baseline.baseline,user_data_sha256:'e'.repeat(64)};
    return baseline.baseline;
  };
  return{calls,run:()=>rehearse({baselineReceipt:baseline,preflightReceipt:preflight,workerSource,planSource,
    api,edge,transfer,inspect,pause:async()=>{},save:()=>{}})};
}
test('controller qualifies every native phase, restores the baseline and compares unchanged production data',async()=>{
  const s=simulation(),r=await s.run();assert.equal(r.status,'PRODUCTION_OAUTH_COPY_MIGRATION_TENANT_REVOCATION_AND_ROLLBACK_QUALIFIED');
  assert.equal(r.original_customer_data_preserved,true);assert.equal(r.idempotency_verified,true);assert.equal(r.concurrent_batches_verified,true);
  assert.equal(r.cleanup_parity_verified,true);assert.equal(r.cleanup_fk_enforcement_verified,true);assert.equal(r.source_data_unchanged,true);
  assert.equal(r.production_oauth_migrated,false);assert.equal(r.owner_production_backup_decryption_pending,true);
  assert.ok(s.calls.filter(c=>c.role==='production').every(c=>c.method==='GET'||c.path===PRODUCTION_BASE+'/export'));
});
test('cleanup, enforcement and final source mismatch each prevent native qualification',async()=>{
  for(const change of[{corruptCleanup:true},{disabledCleanupFk:true},{sourceDrift:true}]){
    const r=await simulation(change).run();assert.notEqual(r.status,'PRODUCTION_OAUTH_COPY_MIGRATION_TENANT_REVOCATION_AND_ROLLBACK_QUALIFIED');
  }
});
test('unexpected result fields and source/IdP mutation routes are refused',()=>{
  assert.throws(()=>checkedReply({schema:'musitu.axiom.production-oauth-native-worker-result.v1',status:'UPGRADED_COPY_STATE_VERIFIED',
    preview_instance_tag:'tag',release_status:'NOT_RELEASE',plaintext_sql:'SYNTHETIC_PRIVATE_SQL'},'tag'));
  for(const suffix of['/query','/import','/time_travel/restore?bookmark=00000000-1111111111111111'])
    assert.equal(allowed('production','POST',PRODUCTION_BASE+suffix,{sql:'DELETE FROM customers'}),false);
  assert.equal(allowed('recovery','POST',ACCOUNT_BASE+'/d1/database/be760b23-2ed1-47aa-92aa-9042ce917bb9/query',{sql:'PRAGMA foreign_keys'}),false);
});
