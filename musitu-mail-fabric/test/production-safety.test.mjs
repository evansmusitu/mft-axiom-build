import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {DurableMailFabric} from '../src/durable/fabric.mjs';
import {createD1Compat} from './helpers/sqlite-d1.mjs';
import {createSimulatedProvider} from '../src/providers.mjs';
import {generateDemonstrationKeys} from '../src/evidence.mjs';
import {processResendWebhook} from '../src/webhooks/resend.mjs';
import {makeWebhook,webhookHeaders} from './helpers/svix.mjs';

const base={tenantId:'client1',from:'notices@example.org',to:'recipient@example.net',subject:'Account notice',text:'Verified transaction',kind:'ACCOUNT',idempotencyKey:'txn-000001'};
function fixture(t,{dailySendLimit=100,nowValue=Date.parse('2026-10-10T12:00:00Z')}={}){
  const dir=mkdtempSync(join(tmpdir(),'mmf-safety-'));
  const d=new DatabaseSync(join(dir,'db.sqlite'));
  d.exec(readFileSync(new URL('../src/durable/schema.sql',import.meta.url),'utf8'));
  const provider=createSimulatedProvider(),keys=generateDemonstrationKeys(),encryptionKey=randomBytes(32),privacyKey=randomBytes(32);
  let clock=nowValue;
  const make=(tenant='client1',db=createD1Compat(d))=>new DurableMailFabric({tenantId:tenant,verifiedDomains:['example.org'],allowedRegions:['us-east-1'],provider,dailySendLimit},{db,encryptionKey,keys,privacyKey,now:()=>clock});
  const count=()=>d.prepare('SELECT COUNT(*) n FROM mail_messages WHERE tenant_id=?').get('client1').n;
  t.after(()=>{d.close();rmSync(dir,{recursive:true,force:true});});
  return {make,provider,d,count,keys,encryptionKey,privacyKey,clock:v=>{clock=v;}};
}
test('durable daily quota blocks another message, preserves duplicate idempotency',async t=>{
  const f=fixture(t,{dailySendLimit:1}),mail=f.make();
  const first=await mail.enqueue(base);
  assert.equal(first.state,'QUEUED');
  assert.equal((await mail.enqueue({...base})).messageId,first.messageId);
  await assert.rejects(()=>mail.enqueue({...base,idempotencyKey:'txn-000002'}),{code:'QUOTA_EXCEEDED'});
  assert.equal(f.count(),1);
  const restarted=f.make();
  await assert.rejects(()=>restarted.enqueue({...base,idempotencyKey:'txn-000003'}),{code:'QUOTA_EXCEEDED'});
  f.clock(Date.parse('2026-10-11T00:00:01Z'));
  const next=await restarted.enqueue({...base,idempotencyKey:'txn-000004'});
  assert.equal(next.state,'QUEUED');assert.equal(f.count(),2);
});
test('atomic quota cannot be evaded by competing submitters',async t=>{
  const f=fixture(t,{dailySendLimit:2}),a=f.make(),b=f.make();
  const messages=Array.from({length:10},(_,i)=>({...base,idempotencyKey:'txn-parallel-'+i}));
  const results=await Promise.allSettled(messages.map((m,i)=>(i%2?a:b).enqueue(m)));
  assert.equal(results.filter(x=>x.status==='fulfilled').length,2);
  assert.equal(results.filter(x=>x.status==='rejected'&&x.reason?.code==='QUOTA_EXCEEDED').length,8);
  assert.equal(f.count(),2);
});
test('verified bounce creates durable recipient suppression across restarts',async t=>{
  const f=fixture(t),mail=f.make(),submitted=await mail.enqueue(base),sent=await mail.processById(submitted.messageId);
  const providerId=sent.proof.events.at(-1).detail.providerId;
  const secret='whsec_'+randomBytes(32).toString('base64');
  const raw=makeWebhook({type:'email.bounced',data:{email_id:providerId}});
  const info=await processResendWebhook(mail,raw,webhookHeaders(secret,raw,'svix-feedback-001'),{secret});
  assert.equal(info.recorded,true);
  await assert.rejects(()=>f.make().enqueue({...base,idempotencyKey:'txn-000002'}),{code:'RECIPIENT_SUPPRESSED'});
  assert.equal((await f.make().enqueue({...base,to:'other@example.net',idempotencyKey:'txn-000003'})).state,'QUEUED');
});
test('verified complaint suppresses recipient but delivered event does not',async t=>{
  const f=fixture(t),mail=f.make(),m1=await mail.enqueue(base),sent1=await mail.processById(m1.messageId);
  const secret='whsec_'+randomBytes(32).toString('base64');
  const event1=makeWebhook({type:'email.delivered',data:{email_id:sent1.proof.events.at(-1).detail.providerId}});
  await processResendWebhook(mail,event1,webhookHeaders(secret,event1,'svix-safe-001'),{secret});
  const m2=await mail.enqueue({...base,idempotencyKey:'txn-000002'}),sent2=await mail.processById(m2.messageId);
  const event2=makeWebhook({type:'email.complained',data:{email_id:sent2.proof.events.at(-1).detail.providerId}});
  await processResendWebhook(mail,event2,webhookHeaders(secret,event2,'svix-abuse-001'),{secret});
  await assert.rejects(()=>f.make().enqueue({...base,idempotencyKey:'txn-000003'}),{code:'RECIPIENT_SUPPRESSED'});
});
test('duplicate webhook repairs a suppression that failed after event storage',async t=>{
  const f=fixture(t),mail=f.make(),m=await mail.enqueue(base),sent=await mail.processById(m.messageId);
  const secret='whsec_'+randomBytes(32).toString('base64');
  const event=makeWebhook({type:'email.complained',data:{email_id:sent.proof.events.at(-1).detail.providerId,to:['recipient@example.net']}});
  const h=webhookHeaders(secret,event,'svix-recovery-001');
  const actual=createD1Compat(f.d);let injected=false;
  const wrapper={prepare(sql){if(!injected&&sql.includes('INSERT OR IGNORE INTO mail_suppressions')){
    injected=true;return{bind(){return{async run(){throw Error('TRANSIENT_STORAGE_FAILURE');}}}};
  }return actual.prepare(sql);}};
  const crashMail=f.make('client1',wrapper);
  await assert.rejects(()=>processResendWebhook(crashMail,event,h,{secret}),/TRANSIENT_STORAGE_FAILURE/);
  const replay=await processResendWebhook(mail,event,h,{secret});
  assert.equal(replay.recorded,false);
  await assert.rejects(()=>f.make().enqueue({...base,idempotencyKey:'txn-000002'}),{code:'RECIPIENT_SUPPRESSED'});
});

test('edge worker enforces operator-configured quota instead of request-supplied quota',async t=>{
  const f=fixture(t),{createWorker}=await import('../src/edge/worker.mjs');
  const {privateKey,publicKey}=generateDemonstrationKeys();
  const auth='test-only-strong-auth-token-1234567890';
  const env={MMF_DB:createD1Compat(f.d),MMF_TENANT_ID:'client1',MMF_FROM_DOMAIN:'example.org',MMF_AUTH_TOKEN:auth,
    MMF_ENCRYPTION_KEY_B64:f.encryptionKey.toString('base64'),MMF_PRIVACY_KEY_B64:f.privacyKey.toString('base64'),
    MMF_SIGNING_PRIVATE_KEY_PEM:privateKey.export({format:'pem',type:'pkcs8'}).toString(),
    MMF_SIGNING_PUBLIC_KEY_PEM:publicKey.export({format:'pem',type:'spki'}).toString(),
    MMF_API_ENABLED:'true',MMF_DAILY_SEND_LIMIT:'1',MMF_QUEUE:{send:async()=>{}},MMF_REAL_SEND_ENABLED:'false'};
  const worker=createWorker({providerFactory:()=>f.provider});
  const send=async key=>worker.fetch(new Request('https://test.invalid/v1/messages',{method:'POST',headers:{authorization:'Bearer '+auth},
    body:JSON.stringify({...base,idempotencyKey:key,dailySendLimit:100000})}),env);
  assert.equal((await send('edge-first')).status,202);
  const blocked=await send('edge-second');
  assert.equal(blocked.status,429);assert.deepEqual(await blocked.json(),{error:'QUOTA_EXCEEDED'});
  assert.equal(f.count(),1);
});

test('signed webhook feedback remains ingestible while outbound sending is paused',async t=>{
  const f=fixture(t),mail=f.make(),m=await mail.enqueue(base),sent=await mail.processById(m.messageId);
  const {createWorker}=await import('../src/edge/worker.mjs');
  const keys=generateDemonstrationKeys(),secret='whsec_'+randomBytes(32).toString('base64');
  const env={MMF_DB:createD1Compat(f.d),MMF_TENANT_ID:'client1',MMF_FROM_DOMAIN:'example.org',
    MMF_ENCRYPTION_KEY_B64:f.encryptionKey.toString('base64'),MMF_PRIVACY_KEY_B64:f.privacyKey.toString('base64'),
    MMF_SIGNING_PRIVATE_KEY_PEM:keys.privateKey.export({format:'pem',type:'pkcs8'}).toString(),
    MMF_SIGNING_PUBLIC_KEY_PEM:keys.publicKey.export({format:'pem',type:'spki'}).toString(),
    MMF_REAL_SEND_ENABLED:'false',MMF_WEBHOOK_ENABLED:'true',MMF_WEBHOOK_SECRET:secret,MMF_API_ENABLED:'false'};
  const raw=makeWebhook({type:'email.bounced',data:{email_id:sent.proof.events.at(-1).detail.providerId,to:['recipient@example.net']}});
  const headers=webhookHeaders(secret,raw,'svix-paused-001');
  const worker=createWorker();
  const response=await worker.fetch(new Request('https://mmf.invalid/v1/webhooks/resend',{method:'POST',headers:{'content-type':'application/json',...headers},body:raw}),env);
  assert.equal(response.status,202);
  const result=await response.json();assert.deepEqual(result,{accepted:true,recorded:true});
  assert.equal((await mail.getProviderEvidence(m.messageId,'client1')).events.length,1);
  await assert.rejects(()=>mail.enqueue({...base,idempotencyKey:'txn-second'}),{code:'RECIPIENT_SUPPRESSED'});
  assert.equal(f.provider.attempts,1);
  const attempted=await worker.queue({messages:[{body:{tenantId:'client1',messageId:m.messageId},retry(){},ack(){throw Error('unexpected acknowledgment')}}]},env);
  assert.equal(attempted,undefined);
});

test('transient webhook database failures return retryable HTTP 503, never false acceptance',async t=>{
  const f=fixture(t),mail=f.make(),m=await mail.enqueue(base),sent=await mail.processById(m.messageId);
  const {createWorker}=await import('../src/edge/worker.mjs');
  const keys=generateDemonstrationKeys(),secret='whsec_'+randomBytes(32).toString('base64');
  const actual=createD1Compat(f.d);
  const env={MMF_DB:{prepare(sql){if(sql.includes('INSERT OR IGNORE INTO mail_provider_events')){
    return {bind(){return {async run(){throw Error('TEMPORARY_D1_FAILURE')}}}};
  }return actual.prepare(sql)}},
    MMF_TENANT_ID:'client1',MMF_FROM_DOMAIN:'example.org',
    MMF_ENCRYPTION_KEY_B64:f.encryptionKey.toString('base64'),MMF_PRIVACY_KEY_B64:f.privacyKey.toString('base64'),
    MMF_SIGNING_PRIVATE_KEY_PEM:keys.privateKey.export({format:'pem',type:'pkcs8'}).toString(),
    MMF_SIGNING_PUBLIC_KEY_PEM:keys.publicKey.export({format:'pem',type:'spki'}).toString(),
    MMF_REAL_SEND_ENABLED:'false',MMF_WEBHOOK_ENABLED:'true',MMF_WEBHOOK_SECRET:secret,MMF_API_ENABLED:'false'};
  const raw=makeWebhook({type:'email.complained',data:{email_id:sent.proof.events.at(-1).detail.providerId,to:['recipient@example.net']}});
  const response=await createWorker().fetch(new Request('https://mmf.invalid/v1/webhooks/resend',{method:'POST',headers:{'content-type':'application/json',...webhookHeaders(secret,raw,'svix-db-down-01')},body:raw}),env);
  assert.equal(response.status,503);
  assert.deepEqual(await response.json(),{error:'WEBHOOK_PROCESSING_UNAVAILABLE'});
});

test('historical idempotent lookup remains available after a verified suppression',async t=>{
  const f=fixture(t),mail=f.make(),old=await mail.enqueue(base);
  await mail.suppress(base.to);
  const replay=await f.make().enqueue({...base});
  assert.equal(replay.messageId,old.messageId);
  assert.equal(f.count(),1);
  await assert.rejects(()=>f.make().enqueue({...base,idempotencyKey:'txn-new-0001'}),{code:'RECIPIENT_SUPPRESSED'});
});
