import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createD1Compat} from './helpers/sqlite-d1.mjs';
import {createWorker} from '../src/edge/worker.mjs';
import {SenderRegistry} from '../src/security/sender-ownership.mjs';
const operator='operator-revocation-secret-0123456789abcdef',customer='customer-mail-secret-0123456789abcdef';
function fixture(t){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(readFileSync(new URL('../src/durable/schema.sql',import.meta.url),'utf8'));t.after(()=>sqlite.close());
 const db=createD1Compat(sqlite),now=Date.now();
 const insert=sqlite.prepare(`INSERT INTO mail_sender_domains
  (tenant_id,domain,challenge_sha256,challenge_expires_ms,verified_until_ms,status,updated_ms)
  VALUES(?,?,?,?,?,'VERIFIED',?)`);
 insert.run('client1','example.org','a'.repeat(64),now+60000,now+86400000,now);
 insert.run('client2','example.org','b'.repeat(64),now+60000,now+86400000,now);
 const env={MMF_DB:db,MMF_TENANT_ID:'client1',MMF_FROM_DOMAIN:'example.org',
  MMF_SENDER_REVOKE_API_ENABLED:'true',MMF_OPERATOR_TOKEN:operator,MMF_AUTH_TOKEN:customer,
  MMF_API_ENABLED:'false',MMF_REAL_SEND_ENABLED:'false'};
 const worker=createWorker();
 const req=(token=operator,payload={domain:'example.org',confirm:'REVOKE_SENDER'})=>new Request(
  'https://restricted.invalid/v1/operator/senders/revoke',{
    method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},
    body:JSON.stringify(payload)});
 return {sqlite,db,env,worker,req};
}
test('dedicated operator can immediately revoke own verified domain even with customer sending paused',async t=>{
 const f=fixture(t),response=await f.worker.fetch(f.req(),f.env);
 assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{revoked:true});
 const row=f.sqlite.prepare('SELECT status,verified_until_ms FROM mail_sender_domains WHERE tenant_id=?').get('client1');
 assert.equal(row.status,'REVOKED');assert.equal(row.verified_until_ms,0);
 const other=f.sqlite.prepare('SELECT status FROM mail_sender_domains WHERE tenant_id=?').get('client2');
 assert.equal(other.status,'VERIFIED');
 const registry=new SenderRegistry({db:f.db,tenantId:'client1'});
 assert.equal(await registry.isVerified('example.org'),false);
});
test('customer token, unauthenticated request and reused operator token cannot revoke senders',async t=>{
 const f=fixture(t);
 assert.equal((await f.worker.fetch(f.req(customer),f.env)).status,401);
 assert.equal((await f.worker.fetch(f.req('incorrect-operator-token-12345678'),f.env)).status,401);
 assert.equal((await f.worker.fetch(f.req(),{...f.env,MMF_OPERATOR_TOKEN:customer})).status,503);
 assert.equal((await f.worker.fetch(f.req(),{...f.env,MMF_SENDER_REVOKE_API_ENABLED:'false'})).status,404);
 assert.equal(f.sqlite.prepare('SELECT status FROM mail_sender_domains WHERE tenant_id=?').get('client1').status,'VERIFIED');
});
test('domain mismatch and missing exact confirmation fail closed',async t=>{
 const f=fixture(t);
 for(const payload of [
  {domain:'other.example.org',confirm:'REVOKE_SENDER'},
  {domain:'example.org',confirm:'maybe'},
  {domain:'example.org'},
  {domain:'example.org',confirm:'REVOKE_SENDER',tenantId:'client2'}
 ]){
  const response=await f.worker.fetch(f.req(operator,payload),f.env);
  assert.equal(response.status,422);
 }
 assert.equal(f.sqlite.prepare('SELECT status FROM mail_sender_domains WHERE tenant_id=?').get('client1').status,'VERIFIED');
});
test('revoke fails closed when storage is unavailable',async t=>{
 const f=fixture(t);
 const response=await f.worker.fetch(f.req(),{...f.env,MMF_DB:{prepare(){throw Error('database down')}}});
 assert.equal(response.status,503);
 assert.deepEqual(await response.json(),{error:'SENDER_REVOCATION_UNAVAILABLE'});
 assert.equal(f.sqlite.prepare('SELECT status FROM mail_sender_domains WHERE tenant_id=?').get('client1').status,'VERIFIED');
});
