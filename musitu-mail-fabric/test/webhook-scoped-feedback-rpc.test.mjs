import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handleFeedbackRpc,createFeedbackSqlAdapter} from '../src/edge/feedback-rpc.mjs';
const secret='feedback-scoped-capability-secret-0123456789abcdef';
const owner={MMF_TENANT_ID:'client1',MMF_FEEDBACK_RPC_ENABLED:'true',
 MMF_FEEDBACK_RPC_SECRET:secret,MMF_STORAGE_RPC_SECRET:'different-storage-capability-secret-0123456789'};
function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec(readFileSync(new URL('../src/durable/schema.sql',import.meta.url),'utf8'));
 db.prepare("INSERT INTO mail_messages(message_id,tenant_id,idempotency_key,request_hash,recipient_hmac,state,events_json,provider_id,created_ms,updated_ms) VALUES(?,?,?,?,?,?,?,?,?,?)")
 .run('msg-one','client1','idem-one','hash-one','a'.repeat(64),'ACCEPTED_BY_PROVIDER','[]','provider-one',123,123);
 const sql={exec(q,...a){
  const statement=db.prepare(q);
  const rows=/^(SELECT|WITH|PRAGMA)/i.test(q.trim())?statement.all(...a):(statement.run(...a),[]);
  return {toArray(){return rows}};
 }};
 const req=(q,a,key=secret)=>new Request('https://mmf-internal.invalid/feedback-rpc',{
  method:'POST',headers:{'x-mmf-feedback':key},body:JSON.stringify({sql:q,params:a})});
 const execute=(q,a,key=secret)=>handleFeedbackRpc(req(q,a,key),sql,owner);
 return {db,sql,execute};
}
test('feedback capability rejects unexpected queries and cross-tenant reads',async t=>{
 const f=fixture(t);
 assert.equal((await f.execute('SELECT * FROM mail_messages WHERE tenant_id=?',['client1'])).status,403);
 assert.equal((await f.execute("SELECT message_id FROM mail_messages WHERE tenant_id=? AND provider_id=? AND state='ACCEPTED_BY_PROVIDER'",
  ['other-tenant','provider-one'])).status,403);
 assert.equal((await f.execute('SELECT * FROM mail_messages WHERE tenant_id=?',['client1'],'bad-secret')).status,401);
});
test('provider event may be added only for a matching accepted message',async t=>{
 const f=fixture(t),q='INSERT OR IGNORE INTO mail_provider_events(tenant_id,svix_id,message_id,provider_id,kind,raw_sha256,created_ms) VALUES(?,?,?,?,?,?,?)';
 const good=['client1','svix-evt-001','msg-one','provider-one','email.bounced','a'.repeat(64),Date.now()];
 assert.equal((await f.execute(q,[...good.slice(0,3),'wrong-provider',...good.slice(4)])).status,422);
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM mail_provider_events').get().n,0);
 assert.equal((await f.execute(q,good)).status,200);
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM mail_provider_events').get().n,1);
});
test('manual suppression through feedback capability requires a recorded bounce or complaint',async t=>{
 const f=fixture(t),q='INSERT OR IGNORE INTO mail_suppressions(tenant_id,recipient_hmac,created_ms) VALUES(?,?,?)';
 assert.equal((await f.execute(q,['client1','a'.repeat(64),Date.now()])).status,422);
 const e='INSERT OR IGNORE INTO mail_provider_events(tenant_id,svix_id,message_id,provider_id,kind,raw_sha256,created_ms) VALUES(?,?,?,?,?,?,?)';
 await f.execute(e,['client1','svix-evt-002','msg-one','provider-one','email.complained','b'.repeat(64),Date.now()]);
 assert.equal((await f.execute(q,['client1','a'.repeat(64),Date.now()])).status,200);
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM mail_suppressions').get().n,1);
});
test('least-privilege adapter can access approved feedback lookup but no general messages',async t=>{
 const f=fixture(t),ns={idFromName:x=>x,get:()=>({fetch:request=>handleFeedbackRpc(request,f.sql,owner)})};
 const db=createFeedbackSqlAdapter(ns,secret);
 assert.throws(()=>db.prepare('SELECT * FROM mail_messages WHERE tenant_id=?'),/FORBIDDEN_FEEDBACK_SQL/);
 const q="SELECT message_id FROM mail_messages WHERE tenant_id=? AND provider_id=? AND state='ACCEPTED_BY_PROVIDER'";
 assert.equal((await db.prepare(q).bind('client1','provider-one').first()).message_id,'msg-one');
});
