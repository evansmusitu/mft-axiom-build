import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {createD1Compat} from './helpers/sqlite-d1.mjs';
import {DurableMailFabric} from '../src/durable/fabric.mjs';
import {generateDemonstrationKeys} from '../src/evidence.mjs';
import {createSimulatedProvider} from '../src/providers.mjs';
import {createWorker} from '../src/edge/worker.mjs';

const msg=n=>({tenantId:'tenantx',from:'notice@example.org',to:'recipient@example.net',subject:'Transactional notice',text:'Synthetic security notification.',kind:'SECURITY',idempotencyKey:'safety-'+String(n).padStart(10,'0')});
function fixture(t,options={}){
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../src/durable/schema.sql',import.meta.url),'utf8'));t.after(()=>sql.close());
 const db=createD1Compat(sql),provider=createSimulatedProvider(),keys=generateDemonstrationKeys();
 const encryptionKey=randomBytes(32),privacyKey=randomBytes(32);
 let clock=Date.parse('2026-10-10T09:00:10Z');
 const make=()=>new DurableMailFabric({tenantId:'tenantx',verifiedDomains:['example.org'],allowedRegions:['us-east-1'],provider,dailySendLimit:100,dailyRecipientLimit:100,minuteSendLimit:2,maxQueuedAgeMs:60_000,...options},{db,keys,encryptionKey,privacyKey,now:()=>clock});
 return {sql,db,provider,make,keys,encryptionKey,privacyKey,setNow:x=>clock=x,now:()=>clock};
}

test('durable per-minute throttle cannot be bypassed concurrently or after process restart',async t=>{
 const f=fixture(t);const results=await Promise.allSettled(Array.from({length:12},(_,i)=>f.make().enqueue(msg(i))));
 assert.equal(results.filter(x=>x.status==='fulfilled').length,2);
 assert.equal(results.filter(x=>x.status==='rejected'&&x.reason.code==='RATE_LIMIT_EXCEEDED').length,10);
 assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM mail_messages').get().n,2);
 const replay=await f.make().enqueue(msg(0));assert.equal(replay.state,'QUEUED');
 f.setNow(Date.parse('2026-10-10T09:01:01Z'));
 assert.equal((await f.make().enqueue(msg(20))).state,'QUEUED');
 assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM mail_messages').get().n,3);
});

test('expired queued message is permanently blocked, never delivered or retried',async t=>{
 const f=fixture(t);const m=await f.make().enqueue(msg(0));
 f.setNow(f.now()+60_001);
 const result=await f.make().processById(m.messageId);
 assert.equal(result.state,'BLOCKED_BY_POLICY');
 assert.equal(f.provider.attempts,0);
 assert.equal(f.sql.prepare('SELECT sealed_envelope FROM mail_messages WHERE message_id=?').get(m.messageId).sealed_envelope,null);
 assert.equal((await f.make().processById(m.messageId)),null);
 assert.ok(result.proof.events.some(x=>x.event==='POLICY_BLOCKED'));
});

test('new queued message before deadline still dispatches',async t=>{
 const f=fixture(t);const m=await f.make().enqueue(msg(1));
 f.setNow(f.now()+59_999);
 const result=await f.make().processById(m.messageId);
 assert.equal(result.state,'ACCEPTED_BY_PROVIDER');assert.equal(f.provider.attempts,1);
});

test('invalid rate and TTL configuration is rejected before any provider attempt',t=>{
 const f=fixture(t);
 for(const overrides of [{minuteSendLimit:0},{minuteSendLimit:1001},{maxQueuedAgeMs:1000},{maxQueuedAgeMs:8*86400000}]){
   assert.throws(()=>new DurableMailFabric({tenantId:'tenantx',verifiedDomains:['example.org'],allowedRegions:['us-east-1'],provider:f.provider,...overrides},{db:f.db,keys:f.keys,encryptionKey:f.encryptionKey,privacyKey:f.privacyKey}),/INVALID_(MINUTE_RATE_LIMIT|QUEUE_TTL)/);
 }
});

test('Worker maps operational burst throttle to HTTP 429 without sending',async t=>{
 const f=fixture(t);const auth='synthetic-api-token-0123456789abcdefghijklmnop';
 const env={MMF_DB:f.db,MMF_TENANT_ID:'tenantx',MMF_FROM_DOMAIN:'example.org',MMF_API_ENABLED:'true',MMF_REAL_SEND_ENABLED:'false',MMF_AUTH_TOKEN:auth,
   MMF_ENCRYPTION_KEY_B64:f.encryptionKey.toString('base64'),MMF_PRIVACY_KEY_B64:f.privacyKey.toString('base64'),
   MMF_SIGNING_PRIVATE_KEY_PEM:f.keys.privateKey.export({format:'pem',type:'pkcs8'}).toString(),
   MMF_SIGNING_PUBLIC_KEY_PEM:f.keys.publicKey.export({format:'pem',type:'spki'}).toString(),
   MMF_MINUTE_SEND_LIMIT:'1',MMF_MAX_QUEUED_AGE_SECONDS:'60'};
 const w=createWorker({providerFactory:()=>f.provider});
 const send=async i=>w.fetch(new Request('https://example.invalid/v1/messages',{method:'POST',headers:{authorization:'Bearer '+auth},body:JSON.stringify({...msg(i),minuteSendLimit:100000})}),env);
 assert.equal((await send(1)).status,202);
 const second=await send(2);assert.equal(second.status,429);
 assert.deepEqual(await second.json(),{error:'RATE_LIMIT_EXCEEDED'});
 assert.equal(f.provider.attempts,0);
});
