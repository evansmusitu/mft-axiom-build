/** REAL local D1/workerd and typed client; synthetic fixture identities, not hosted acceptance. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {SCHEMA,validateScope} from './protocol.mjs';
import {isolatedStagingStore} from './client.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const ORIGIN='https://axiom-frontier-stage-test.fixture-account.workers.dev';
const PIN={schema:SCHEMA,account_id:'67469478aa9349fa0a57fe3a72da200a',
 database_id:'11111111-1111-4111-8111-111111111111',scope_nonce:'f'.repeat(64)};
const TOKENS={alice_write:'w'.repeat(40),alice_read:'r'.repeat(40),alice_admin:'a'.repeat(40),
 bob_write:'u'.repeat(40),bob_read:'t'.repeat(40),bob_admin:'b'.repeat(40)};
const principals=Object.entries(TOKENS).map(([name,token])=>{
 const [namePart,role]=name.split('_');return {token_sha256:sha(token),tenant_id:'fixture_'+namePart,role};});
let compiled;
async function fixture(t,{migrate=true,marker=true,pin=PIN,race=null}={}){
 const directory=await mkdtemp(join(tmpdir(),'axiom-frontier-staging-'));
 compiled??=build({entryPoints:[fileURLToPath(new URL('./worker.mjs',import.meta.url))],
  bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
 let script=(await compiled).outputFiles[0].text;
 if(race){
  // Test-only interception changes REAL D1 state AFTER the authenticated
  // preflight read, before the actual guarded SQL mutation is submitted.
  const entry=`
  import original from './worker.mjs';
  export default {fetch(request,env){
   const real=env.FRONTIER_STAGE_DB;
   const db={prepare(sql){return {bind(...values){const statement=real.prepare(sql).bind(...values);
    return {run:()=>statement.run(),first:async()=>{
     const value=await statement.first();
     if(sql.startsWith('SELECT token_sha256 FROM frontier_stage_revocations')){
      if(env.TEST_RACE==='revoke')await real.prepare('INSERT OR IGNORE INTO frontier_stage_revocations VALUES(?,?,?)').bind(...values).run();
      if(env.TEST_RACE==='marker')await real.prepare('UPDATE frontier_stage_identity SET scope_nonce=?').bind('e'.repeat(64)).run();
     }
     return value;}};}};}};
   return original.fetch(request,{...env,FRONTIER_STAGE_DB:db});
  }};`;
  script=(await build({stdin:{contents:entry,resolveDir:fileURLToPath(new URL('./',import.meta.url))},
   bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'})).outputFiles[0].text;
 }
 const settings={name:'frontier-stage-fixture',script,modules:true,compatibilityDate:'2026-07-01',cf:false,
  d1Databases:{FRONTIER_STAGE_DB:PIN.database_id},d1Persist:directory,
  bindings:{FRONTIER_STAGE_SCOPE_JSON:JSON.stringify(pin),FRONTIER_STAGE_PRINCIPALS_JSON:JSON.stringify(principals),
   ...(race?{TEST_RACE:race}:{})},
  outboundService(){throw Error('EXTERNAL_NETWORK_FORBIDDEN_IN_STAGING_FIXTURE');}};
 let mf=new Miniflare(settings);
 t.after(async()=>{await mf.dispose();await rm(directory,{recursive:true,force:true});});
 const database=()=>mf.getD1Database('FRONTIER_STAGE_DB');
 if(migrate){
  const sql=await readFile(new URL('./schema.sql',import.meta.url),'utf8');
  for(const part of sql.split(';').map(x=>x.trim()).filter(Boolean))await (await database()).prepare(part).run();
 }
 if(migrate&&marker)await (await database()).prepare('INSERT INTO frontier_stage_identity VALUES(1,?,?,?)')
  .bind(PIN.account_id,PIN.database_id,PIN.scope_nonce).run();
 const fetchImpl=(url,init)=>mf.dispatchFetch(url,init);
 return {database,settings,fetchImpl,
  store:key=>isolatedStagingStore({pin,origin:ORIGIN,token:TOKENS[key],fetchImpl}),
  raw:(path,token= TOKENS.alice_write,body={tenant_id:'fixture_alice'},headers={})=>fetchImpl(ORIGIN+path,
   {method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json',...headers},
    body:JSON.stringify({schema:SCHEMA,scope_nonce:pin.scope_nonce,...body})}),
  restart:async()=>{await mf.dispose();mf=new Miniflare(settings);}};
}
const record={tenant_id:'fixture_alice',record_id:'fixture_record'};
test('actual D1 typed create/read/update preserves independently hashed data across worker restart',{timeout:60000},async t=>{
 const f=await fixture(t),writer=f.store('alice_write'),reader=f.store('alice_read');
 const first=await writer.put({...record,expected_version:0,payload:{answer:42}});
 assert.equal(first.version,1);assert.equal(first.payload_sha256,sha('{"answer":42}'));
 assert.deepEqual((await reader.read(record)).payload,{answer:42});
 const second=await writer.put({...record,expected_version:1,payload:{answer:43}});assert.equal(second.version,2);
 await f.restart();assert.equal((await reader.read(record)).version,2);
 assert.deepEqual((await reader.read(record)).payload,{answer:43});
});
test('actual D1 fixture bridge rejects arbitrary SQL routes, browser origins and wrong role before writes',{timeout:60000},async t=>{
 const f=await fixture(t);
 assert.equal((await f.raw('/query',TOKENS.alice_write,{sql:'DROP TABLE customers'})).status,404);
 assert.equal((await f.raw('/v1/staging/put',TOKENS.alice_read,{...record,expected_version:0,payload:{}})).status,403);
 assert.equal((await f.raw('/v1/staging/put',TOKENS.alice_write,{...record,expected_version:0,payload:{}},
  {origin:'https://untrusted.invalid'})).status,403);
 assert.equal((await (await f.database()).prepare('SELECT count(*) AS n FROM frontier_stage_records').first()).n,0);
});
test('actual D1 bridge enforces tenant separation for reads, writes and revocations',{timeout:60000},async t=>{
 const f=await fixture(t),alice=f.store('alice_write'),bob=f.store('bob_write');
 await alice.put({...record,expected_version:0,payload:{owner:'alice'}});
 await bob.put({...record,tenant_id:'fixture_bob',expected_version:0,payload:{owner:'bob-secret'}});
 await assert.rejects(f.store('alice_read').read({...record,tenant_id:'fixture_bob'}));
 await assert.rejects(alice.put({...record,tenant_id:'fixture_bob',expected_version:1,payload:{swapped:true}}));
 await assert.rejects(f.store('alice_admin').revoke({tenant_id:'fixture_alice',token_sha256:sha(TOKENS.bob_read)}));
 assert.deepEqual((await f.store('bob_read').read({...record,tenant_id:'fixture_bob'})).payload,{owner:'bob-secret'});
 const denied=await f.raw('/v1/staging/read',TOKENS.alice_read,{...record,tenant_id:'fixture_bob'});
 assert.ok(!(await denied.text()).includes('bob-secret'));
});
test('actual D1 compare-and-set linearizes twelve concurrent creates into one version',{timeout:60000},async t=>{
 const f=await fixture(t),writer=f.store('alice_write');
 const outcomes=await Promise.allSettled(Array.from({length:12},(_,i)=>writer.put(
  {...record,expected_version:0,payload:{candidate:i}})));
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
 const row=await f.store('alice_read').read(record);assert.equal(row.version,1);
 assert.equal((await (await f.database()).prepare('SELECT count(*) AS n FROM frontier_stage_records').first()).n,1);
 await assert.rejects(writer.put({...record,expected_version:0,payload:{replay:true}}));
});
test('actual D1 revocation persists across restart and blocks an otherwise valid stored credential',{timeout:60000},async t=>{
 const f=await fixture(t),writer=f.store('alice_write'),reader=f.store('alice_read'),admin=f.store('alice_admin');
 await writer.put({...record,expected_version:0,payload:{answer:42}});
 await admin.revoke({tenant_id:'fixture_alice',token_sha256:sha(TOKENS.alice_write)});
 await f.restart();await assert.rejects(writer.put({...record,expected_version:1,payload:{answer:99}}));
 assert.deepEqual((await reader.read(record)).payload,{answer:42});
 await admin.revoke({tenant_id:'fixture_alice',token_sha256:sha(TOKENS.alice_read)});
 await assert.rejects(reader.read(record));
});
test('actual D1 identity marker is required before writes; requests cannot create a missing schema',{timeout:60000},async t=>{
 const f=await fixture(t,{migrate:false,marker:false});
 await assert.rejects(f.store('alice_write').put({...record,expected_version:0,payload:{}}));
 const tables=await (await f.database()).prepare("SELECT name FROM sqlite_master WHERE name LIKE 'frontier_stage_%'").all();
 assert.equal(tables.results.length,0);
});
test('actual D1 marker mismatch rejects before a schema or data mutation',{timeout:60000},async t=>{
 const f=await fixture(t,{marker:false});
 await assert.rejects(f.store('alice_write').put({...record,expected_version:0,payload:{}}));
 await (await f.database()).prepare('INSERT INTO frontier_stage_identity VALUES(1,?,?,?)')
  .bind(PIN.account_id,PIN.database_id,'e'.repeat(64)).run();
 await assert.rejects(f.store('alice_write').put({...record,expected_version:0,payload:{}}));
 assert.equal((await (await f.database()).prepare('SELECT count(*) AS n FROM frontier_stage_records').first()).n,0);
});
test('source and accepted recovery-copy UUIDs can never become a staging target',()=>{
 for(const database_id of ['ccc473f1-fbb5-4b8d-8a24-45f3696ac10f','504029cc-f9a5-495e-818f-63c6144b4ea4',
  'be760b23-2ed1-47aa-92aa-9042ce917bb9','5c092b73-d093-483d-adf9-9883a8c2f063','c023a0a0-472a-4178-ad07-02f1d6b2e122'])
  assert.throws(()=>validateScope({...PIN,database_id}));
 assert.throws(()=>validateScope({...PIN,account_id:'93f395f5121954671f92fffa453d6b61'}));
});
test('actual D1 bridge rejects SQL-shaped IDs, extra fields and mismatched request scope',{timeout:60000},async t=>{
 const f=await fixture(t);
 for(const body of [{...record,record_id:"fixture_x'; DROP TABLE customers;--",expected_version:0,payload:{}},
  {...record,expected_version:0,payload:{},sql:'DELETE FROM customers'},
  {...record,scope_nonce:'e'.repeat(64),expected_version:0,payload:{}}]){
   const r=await f.raw('/v1/staging/put',TOKENS.alice_write,body);assert.ok(r.status>=400);
 }
 assert.equal((await (await f.database()).prepare('SELECT count(*) AS n FROM frontier_stage_records').first()).n,0);
});
test('actual D1 integrity corruption never returns an unchecked record',{timeout:60000},async t=>{
 const f=await fixture(t);await f.store('alice_write').put({...record,expected_version:0,payload:{answer:42}});
 await (await f.database()).prepare('UPDATE frontier_stage_records SET payload_json=?').bind('{"answer":99}').run();
 await assert.rejects(f.store('alice_read').read(record));
});
test('actual bridge refuses unauthenticated callers and oversized stored payloads before mutation',{timeout:60000},async t=>{
 const f=await fixture(t);
 assert.equal((await f.raw('/v1/staging/put','',{...record,expected_version:0,payload:{}})).status,401);
 assert.equal((await f.raw('/v1/staging/put',TOKENS.alice_write,{...record,expected_version:0,payload:'x'.repeat(5000)})).status,413);
 assert.equal((await (await f.database()).prepare('SELECT count(*) AS n FROM frontier_stage_records').first()).n,0);
});
test('actual bridge refuses a production database pin even when a caller bypasses the typed client',{timeout:60000},async t=>{
 const f=await fixture(t,{pin:{...PIN,database_id:'504029cc-f9a5-495e-818f-63c6144b4ea4'}});
 const r=await f.raw('/v1/staging/put',TOKENS.alice_write,{...record,expected_version:0,payload:{}});
 assert.equal(r.status,503);
 assert.equal((await (await f.database()).prepare('SELECT count(*) AS n FROM frontier_stage_records').first()).n,0);
});
test('actual D1 wrong role cannot self-upgrade or revoke tenant administration',{timeout:60000},async t=>{
 const f=await fixture(t);
 await assert.rejects(f.store('alice_write').revoke({tenant_id:'fixture_alice',token_sha256:sha(TOKENS.alice_read)}));
 await assert.rejects(f.store('alice_admin').revoke({tenant_id:'fixture_alice',token_sha256:sha(TOKENS.alice_admin)}));
 assert.equal((await (await f.database()).prepare('SELECT count(*) AS n FROM frontier_stage_revocations').first()).n,0);
});
test('typed client denies production/general origins and rejects a forged response without retrying',async()=>{
 for(const origin of ['https://api.cloudflare.com','https://mcp.mftintelligence.com','http://127.0.0.1:8000',
  'https://axiom-frontier-stage-test.fixture-account.workers.dev@evil.invalid'])
  assert.throws(()=>isolatedStagingStore({pin:PIN,origin,token:TOKENS.alice_write}));
 let calls=0;const forged=isolatedStagingStore({pin:PIN,origin:ORIGIN,token:TOKENS.alice_write,
  fetchImpl:async()=>{calls++;return Response.json({schema:SCHEMA,scope_nonce:PIN.scope_nonce,
   tenant_id:'fixture_bob',operation:'put',record_id:'fixture_record',version:1,payload_sha256:'a'.repeat(64)});}});
 await assert.rejects(forged.put({...record,expected_version:0,payload:{answer:42}}));assert.equal(calls,1);
 assert.equal(Object.hasOwn(forged,'query'),false);
});
test('typed client holds a lost acknowledgement instead of automatically repeating a mutation',async()=>{
 let calls=0;const client=isolatedStagingStore({pin:PIN,origin:ORIGIN,token:TOKENS.alice_write,
  fetchImpl:async()=>{calls++;throw Error('synthetic lost response after external mutation');}});
 await assert.rejects(client.put({...record,expected_version:0,payload:{answer:42}}));assert.equal(calls,1);
});
test('typed client bounds uncooperative provider responses',{timeout:3000},async()=>{
 const client=isolatedStagingStore({pin:PIN,origin:ORIGIN,token:TOKENS.alice_read,timeoutMs:200,
  fetchImpl:async()=>new Response(new ReadableStream({start(){}}))});
 await assert.rejects(client.read(record));
});
test('actual D1 mutation rechecks revocation after the preflight authorization read',{timeout:60000},async t=>{
 const f=await fixture(t,{race:'revoke'});
 await assert.rejects(f.store('alice_write').put({...record,expected_version:0,payload:{should_not_exist:true}}));
 assert.equal((await (await f.database()).prepare('SELECT count(*) AS n FROM frontier_stage_records').first()).n,0);
 assert.equal((await (await f.database()).prepare('SELECT count(*) AS n FROM frontier_stage_revocations').first()).n,1);
});
test('actual D1 mutation rechecks database identity after the initial marker read',{timeout:60000},async t=>{
 const f=await fixture(t,{race:'marker'});
 await assert.rejects(f.store('alice_write').put({...record,expected_version:0,payload:{should_not_exist:true}}));
 assert.equal((await (await f.database()).prepare('SELECT count(*) AS n FROM frontier_stage_records').first()).n,0);
});
test('actual D1 commit with lost client ACK is never automatically resubmitted',{timeout:60000},async t=>{
 const f=await fixture(t);let calls=0;
 const client=isolatedStagingStore({pin:PIN,origin:ORIGIN,token:TOKENS.alice_write,
  fetchImpl:async(...args)=>{calls++;const r=await f.fetchImpl(...args);assert.equal(r.status,200);
   await r.arrayBuffer();throw Error('synthetic lost ACK after actual local D1 commit');}});
 await assert.rejects(client.put({...record,expected_version:0,payload:{answer:42}}));assert.equal(calls,1);
 const retained=await f.store('alice_read').read(record);assert.equal(retained.version,1);
 assert.deepEqual(retained.payload,{answer:42});
 await assert.rejects(f.store('alice_write').put({...record,expected_version:0,payload:{answer:99}}));
 assert.equal((await f.store('alice_read').read(record)).version,1);
});
test('fixture schema and bridge source never contain a default identity or migration/provisioning route',async()=>{
 const sql=await readFile(new URL('./schema.sql',import.meta.url),'utf8');
 assert.doesNotMatch(sql,/^\s*INSERT\b/m);
 const source=await readFile(new URL('./worker.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(source,/CREATE TABLE|ALTER TABLE|DROP TABLE|api\.cloudflare\.com|CLOUDFLARE_API_TOKEN/);
});
