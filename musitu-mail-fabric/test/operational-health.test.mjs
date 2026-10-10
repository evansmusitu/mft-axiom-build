import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createD1Compat} from './helpers/sqlite-d1.mjs';
import {assessTenantHealth} from '../src/ops/health.mjs';
import {createWorker} from '../src/edge/worker.mjs';
const now=Date.parse('2026-10-10T06:50:00Z');
function fixture(t){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(readFileSync(new URL('../src/durable/schema.sql',import.meta.url),'utf8'));
 t.after(()=>sqlite.close());
 const insert=sqlite.prepare('INSERT INTO mail_messages(message_id,tenant_id,idempotency_key,request_hash,recipient_hmac,state,sealed_envelope,events_json,lease_deadline,created_ms,updated_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
 function add(id,tenant='client1',state='QUEUED',age=1000,lease=null){
  insert.run(id,tenant,'key-'+id,'hash-'+id,'opaque-'+id,state,state==='QUEUED'?'v1.mock.encrypted':null,'[]',lease,now-age,now-age);
 }
 return {sqlite,db:createD1Compat(sqlite),add};
}
test('reads only authorized tenant aggregate counters, no message content or addresses',async t=>{
 const f=fixture(t);f.add('msg1');f.add('msg2','client2');f.add('msg3','client1','ACCEPTED_BY_PROVIDER');
 const report=await assessTenantHealth(f.db,{tenantId:'client1',now:()=>now});
 assert.equal(report.status,'OK');assert.equal(report.metrics.messageStates.QUEUED,1);
 assert.equal(report.metrics.messageStates.ACCEPTED_BY_PROVIDER,1);
 assert.equal(report.metrics.staleClaims,0);assert.equal(report.metrics.oldestQueuedAgeMs,1000);
 assert.ok(!JSON.stringify(report).includes('client1'));
 assert.ok(!JSON.stringify(report).includes('opaque-msg1'));
 assert.ok(!JSON.stringify(report).includes('client2'));
});
test('stale claims, ambiguous outcomes and queue backlog produce explicit operational signals',async t=>{
 const f=fixture(t);
 f.add('q1','client1','QUEUED',20*60000);
 f.add('s1','client1','SENDING',5*60000,now-1000);
 f.add('a1','client1','OUTCOME_UNKNOWN',5*60000);
 const report=await assessTenantHealth(f.db,{tenantId:'client1',now:()=>now,maxQueuedAgeMs:10*60000});
 assert.equal(report.status,'ATTENTION_REQUIRED');assert.equal(report.metrics.staleClaims,1);
 assert.deepEqual(report.reasons,['STALE_DELIVERY_CLAIMS','AMBIGUOUS_PROVIDER_OUTCOMES','QUEUE_BACKLOG_EXCEEDED']);
});
test('complaint metrics report provider-reported events without claiming inbox delivery',async t=>{
 const f=fixture(t);
 f.add('sent1','client1','ACCEPTED_BY_PROVIDER');
 f.sqlite.prepare('INSERT INTO mail_provider_events(tenant_id,svix_id,message_id,provider_id,kind,raw_sha256,created_ms) VALUES(?,?,?,?,?,?,?)')
   .run('client1','svix-001','sent1','provider-msg','email.complained','a'.repeat(64),now-3000);
 const report=await assessTenantHealth(f.db,{tenantId:'client1',now:()=>now});
 assert.equal(report.metrics.complaints24h,1);assert.equal(report.status,'ATTENTION_REQUIRED');
 assert.ok(report.reasons.includes('RECIPIENT_COMPLAINTS_RECORDED'));
 assert.ok(!JSON.stringify(report).includes('provider-msg'));
});
test('invalid tenant, invalid age limits and storage unavailability fail closed',async t=>{
 const f=fixture(t);
 await assert.rejects(()=>assessTenantHealth(f.db,{tenantId:'../other',now:()=>now}),/INVALID_OPERATIONAL_SCOPE/);
 await assert.rejects(()=>assessTenantHealth(f.db,{tenantId:'client1',maxQueuedAgeMs:0}),/INVALID_OPERATIONAL_SCOPE/);
 await assert.rejects(()=>assessTenantHealth({prepare(){throw Error('db offline')}},{tenantId:'client1',now:()=>now}),/OPERATIONAL_STORE_UNAVAILABLE/);
});
test('operator health works while outbound sending is disabled, never uses customer authorization',async t=>{
 const f=fixture(t);f.add('existing');
 const worker=createWorker(),token='dedicated-operator-token-01234567890123';
 const base={MMF_DB:f.db,MMF_TENANT_ID:'client1',MMF_DIAGNOSTICS_ENABLED:'true',MMF_OPERATOR_TOKEN:token,
  MMF_API_ENABLED:'false',MMF_REAL_SEND_ENABLED:'false'};
 const req=(header)=>new Request('https://internal.invalid/v1/ops/health',{headers:header?{authorization:header}:{}});
 const denied=await worker.fetch(req(),base);assert.equal(denied.status,401);
 const customerAuth=await worker.fetch(req('Bearer customer-token-has-no-role-0123456789'),base);assert.equal(customerAuth.status,401);
 const allowed=await worker.fetch(req('Bearer '+token),base);assert.equal(allowed.status,200);
 assert.equal((await allowed.json()).metrics.messageStates.QUEUED,1);
 const disabled=await worker.fetch(req('Bearer '+token),{...base,MMF_DIAGNOSTICS_ENABLED:'false'});
 assert.equal(disabled.status,404);
});
test('health returns service unavailable when storage fails, never partially disclosed',async()=>{
 const token='dedicated-operator-token-01234567890123';
 const worker=createWorker();
 const res=await worker.fetch(new Request('https://internal.invalid/v1/ops/health',{headers:{authorization:'Bearer '+token}}),
 {MMF_DB:{prepare(){throw Error('temporary storage outage')}},MMF_TENANT_ID:'client1',MMF_DIAGNOSTICS_ENABLED:'true',MMF_OPERATOR_TOKEN:token});
 assert.equal(res.status,503);assert.deepEqual(await res.json(),{error:'OPERATIONAL_STORE_UNAVAILABLE'});
});
