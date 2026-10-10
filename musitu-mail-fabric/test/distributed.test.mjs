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
import {generateDemonstrationKeys,verifyProof} from '../src/evidence.mjs';
import {verifyResendWebhook,processResendWebhook} from '../src/webhooks/resend.mjs';
import {makeWebhook,webhookHeaders} from './helpers/svix.mjs';
import {createWorker} from '../src/edge/worker.mjs';
import {provisionTestRelease} from './helpers/release-grant.mjs';
const message={tenantId:'client1',from:'alerts@example.org',to:'customer@example.net',subject:'Account alert',text:'Test private message',kind:'SECURITY',idempotencyKey:'event-000001'};
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'mmf-v03-')),file=join(dir,'db.sqlite');
 const d=new DatabaseSync(file); d.exec(readFileSync(new URL('../src/durable/schema.sql',import.meta.url),'utf8'));
 const keys=generateDemonstrationKeys(), encryptionKey=randomBytes(32),privacyKey=randomBytes(32);
 const provider=createSimulatedProvider();
 const config={tenantId:'client1',verifiedDomains:['example.org'],allowedRegions:['us-east-1'],provider};
 const make=()=>new DurableMailFabric(config,{db:createD1Compat(d),keys,encryptionKey,privacyKey});
 t.after(()=>{d.close();rmSync(dir,{force:true,recursive:true});});
 return {d,make,provider,keys,encryptionKey,privacyKey};
}
test('message-id dispatch cannot process another tenant or duplicate queue item',async t=>{
 const f=fixture(t),q=f.make(),m=await q.enqueue(message);
 const wrong=await q.processById('00000000-0000-4000-8000-000000000001');
 assert.equal(wrong,null);assert.equal(f.provider.attempts,0);
 const [a,b]=await Promise.all([q.processById(m.messageId),q.processById(m.messageId)]);
 assert.equal(f.provider.attempts,1);assert.equal([a,b].filter(x=>x?.state==='ACCEPTED_BY_PROVIDER').length,1);
});
test('webhook rejects unsigned, replayed and out-of-window events',async t=>{
 const f=fixture(t),q=f.make(),enq=await q.enqueue(message),done=await q.processById(enq.messageId);
 const secret='whsec_'+randomBytes(32).toString('base64');
 const event=makeWebhook({type:'email.delivered',data:{email_id:done.proof.events.at(-1).detail.providerId}}),headers=webhookHeaders(secret,event,'svix-00000001');
 await assert.rejects(()=>processResendWebhook(q,event,{...headers,'svix-signature':'v1,broken'},{secret}),/WEBHOOK_AUTH_FAILED/);
 const a=await processResendWebhook(q,event,headers,{secret}); assert.equal(a.recorded,true);
 const b=await processResendWebhook(q,event,headers,{secret}); assert.equal(b.recorded,false);
 const evidence=await q.getProviderEvidence(done.messageId,'client1'); assert.equal(evidence.events.length,1);assert.equal(evidence.events[0].type,'email.delivered');
 assert.equal(verifyProof(evidence.proof,{trustedPublicKey:evidence.proof.publicKey}),true);
 const changed={...headers,'svix-timestamp':String(Math.floor(Date.now()/1000)-1000)};
 assert.throws(()=>verifyResendWebhook(event,changed,secret),/WEBHOOK_AUTH_FAILED/);
});
test('out-of-order bounce and delivery remain distinct provider claims, not inbox truth',async t=>{
 const f=fixture(t),q=f.make(),m=await q.enqueue(message),done=await q.processById(m.messageId),id=done.proof.events.at(-1).detail.providerId;
 const secret='whsec_'+randomBytes(32).toString('base64');
 for(const [type,svix] of [['email.bounced','svix-event-aaa'],['email.delivered','svix-event-bbb']]){
  const raw=makeWebhook({type,data:{email_id:id}}); await processResendWebhook(q,raw,webhookHeaders(secret,raw,svix),{secret});
 }
 const report=await q.getProviderEvidence(m.messageId,'client1');
 assert.deepEqual(report.events.map(x=>x.type),['email.bounced','email.delivered']);
 assert.ok(report.events.every(x=>x.claim==='PROVIDER_REPORTED'&&x.type!=='HUMAN_READ'));
});
test('Cloudflare-compatible adapter restricts API, queues and cron to configured tenant',async t=>{
 const f=fixture(t),token='minimum-strong-private-api-token-000000000000',queue=[];
 const env={MMF_DB:createD1Compat(f.d),MMF_TENANT_ID:'client1',MMF_FROM_DOMAIN:'example.org',MMF_AUTH_TOKEN:token,MMF_ENCRYPTION_KEY_B64:f.encryptionKey.toString('base64'),MMF_PRIVACY_KEY_B64:f.privacyKey.toString('base64'),MMF_SIGNING_PRIVATE_KEY_PEM:f.keys.privateKey.export({format:'pem',type:'pkcs8'}).toString(),MMF_SIGNING_PUBLIC_KEY_PEM:f.keys.publicKey.export({format:'pem',type:'spki'}).toString(),MMF_API_ENABLED:'true',MMF_REAL_SEND_ENABLED:'false',MMF_QUEUE:{send:async body=>queue.push(body)}};
 const worker=createWorker({providerFactory:()=>f.provider});
 const noAuth=await worker.fetch(new Request('https://mmf.invalid/v1/messages',{method:'POST',body:JSON.stringify(message)}),env);assert.equal(noAuth.status,401);
 const headers={authorization:'Bearer '+token,'content-type':'application/json'};
 const response=await worker.fetch(new Request('https://mmf.invalid/v1/messages',{method:'POST',headers,body:JSON.stringify(message)}),env);
 assert.equal(response.status,202);const json=await response.json();assert.equal(json.state,'QUEUED');assert.equal(queue.length,1);
 let ack=0;await worker.queue({messages:[{body:queue[0],ack(){ack++},retry(){throw Error('unexpected retry')}}]},env);
 assert.equal(ack,1);assert.equal(f.provider.attempts,1);
 await worker.queue({messages:[{body:queue[0],ack(){ack++},retry(){throw Error('unexpected retry')}}]},env);assert.equal(f.provider.attempts,1);
 await worker.scheduled({},env);assert.equal(f.provider.attempts,1);
 const lookup=await worker.fetch(new Request('https://mmf.invalid/v1/messages/'+json.messageId,{headers}),env);
 assert.equal(lookup.status,200);assert.equal((await lookup.json()).state,'ACCEPTED_BY_PROVIDER');
});
test('provider event for unrelated message cannot be attached',async t=>{
 const f=fixture(t),q=f.make(),m=await q.enqueue(message);await q.processById(m.messageId);
 const secret='whsec_'+randomBytes(32).toString('base64'); const raw=makeWebhook({type:'email.delivered',data:{email_id:'different-provider-id'}});
 const result=await processResendWebhook(q,raw,webhookHeaders(secret,raw,'svix-unrelated01'),{secret});
 assert.equal(result.recorded,false);assert.equal((await q.getProviderEvidence(m.messageId,'client1')).events.length,0);
});
test('durably queued mail survives queue notification failure for scheduler repair',async t=>{
 const f=fixture(t),token='minimum-strong-private-api-token-000000000000';
 const env={MMF_DB:createD1Compat(f.d),MMF_TENANT_ID:'client1',MMF_FROM_DOMAIN:'example.org',MMF_AUTH_TOKEN:token,
 MMF_ENCRYPTION_KEY_B64:f.encryptionKey.toString('base64'),MMF_PRIVACY_KEY_B64:f.privacyKey.toString('base64'),
 MMF_SIGNING_PRIVATE_KEY_PEM:f.keys.privateKey.export({format:'pem',type:'pkcs8'}).toString(),
 MMF_SIGNING_PUBLIC_KEY_PEM:f.keys.publicKey.export({format:'pem',type:'spki'}).toString(),MMF_API_ENABLED:'true',MMF_REAL_SEND_ENABLED:'false',
 MMF_QUEUE:{send:async()=>{throw Error('queue temporarily down')}}};
 const worker=createWorker({providerFactory:()=>f.provider});
 const request=new Request('https://mmf.invalid/v1/messages',{method:'POST',headers:{authorization:'Bearer '+token},body:JSON.stringify(message)});
 const response=await worker.fetch(request,env);assert.equal(response.status,202);const result=await response.json();
 assert.equal(result.queueNotificationAccepted,false);assert.equal(result.state,'QUEUED');assert.equal(f.provider.attempts,0);
 await worker.scheduled({},env);assert.equal(f.provider.attempts,1);
 const evidence=await worker.fetch(new Request(`https://mmf.invalid/v1/messages/${result.messageId}/evidence`,{headers:{authorization:'Bearer '+token}}),env);
 assert.equal(evidence.status,200);const proof=await evidence.json();assert.equal(verifyProof(proof.proof,{trustedPublicKey:proof.proof.publicKey}),true);
});
test('different signed webhook content reusing an event ID fails closed',async t=>{
 const f=fixture(t),q=f.make(),m=await q.enqueue(message),sent=await q.processById(m.messageId),id=sent.proof.events.at(-1).detail.providerId;
 const secret='whsec_'+randomBytes(32).toString('base64'); const a=makeWebhook({type:'email.delivered',data:{email_id:id}});
 assert.equal((await processResendWebhook(q,a,webhookHeaders(secret,a,'svix-clash-01'),{secret})).recorded,true);
 const b=makeWebhook({type:'email.bounced',data:{email_id:id}});
 await assert.rejects(()=>processResendWebhook(q,b,webhookHeaders(secret,b,'svix-clash-01'),{secret}),/WEBHOOK_ID_CONFLICT/);
 assert.equal((await q.getProviderEvidence(m.messageId,'client1')).events.length,1);
});
test('tenant isolation protects metadata and proof endpoints',async t=>{
 const f=fixture(t),q=f.make(),m=await q.enqueue(message);
 assert.equal(await q.getProviderEvidence(m.messageId,'client2'),null);
 assert.equal(await q.get(m.messageId,'client2'),null);
});
test('mismatched private/public key configuration fails closed before enqueue',async t=>{
 const f=fixture(t),token='minimum-strong-private-api-token-000000000000',other=generateDemonstrationKeys();
 const worker=createWorker({providerFactory:()=>f.provider});
 const env={MMF_DB:createD1Compat(f.d),MMF_TENANT_ID:'client1',MMF_FROM_DOMAIN:'example.org',MMF_AUTH_TOKEN:token,
 MMF_ENCRYPTION_KEY_B64:f.encryptionKey.toString('base64'),MMF_PRIVACY_KEY_B64:f.privacyKey.toString('base64'),
 MMF_SIGNING_PRIVATE_KEY_PEM:f.keys.privateKey.export({format:'pem',type:'pkcs8'}).toString(),
 MMF_SIGNING_PUBLIC_KEY_PEM:other.publicKey.export({format:'pem',type:'spki'}).toString(),MMF_API_ENABLED:'true'};
 const response=await worker.fetch(new Request('https://mmf.invalid/v1/messages',{method:'POST',headers:{authorization:'Bearer '+token},body:JSON.stringify(message)}),env);
 assert.equal(response.status,503);assert.equal(f.provider.attempts,0);
});
test('real-delivery flag without configured provider credentials fails closed',async t=>{
 const f=fixture(t),token='minimum-strong-private-api-token-000000000000';
 const env={MMF_DB:createD1Compat(f.d),MMF_TENANT_ID:'client1',MMF_FROM_DOMAIN:'example.org',MMF_AUTH_TOKEN:token,
 MMF_ENCRYPTION_KEY_B64:f.encryptionKey.toString('base64'),MMF_PRIVACY_KEY_B64:f.privacyKey.toString('base64'),
 MMF_SIGNING_PRIVATE_KEY_PEM:f.keys.privateKey.export({format:'pem',type:'pkcs8'}).toString(),
 MMF_SIGNING_PUBLIC_KEY_PEM:f.keys.publicKey.export({format:'pem',type:'spki'}).toString(),MMF_API_ENABLED:'true',MMF_REAL_SEND_ENABLED:'true',MMF_PROVIDER:'postal'};
 const resp=await createWorker().fetch(new Request('https://mmf.invalid/v1/messages',{method:'POST',headers:{authorization:'Bearer '+token},body:JSON.stringify(message)}),env);
 assert.equal(resp.status,503);
});
test('independent Postal transport can be explicitly selected without Resend',async t=>{
 const f=fixture(t),token='minimum-strong-private-api-token-000000000000',oldFetch=globalThis.fetch;let count=0;
 globalThis.fetch=async(url,opts)=>{assert.equal(url,'https://mail.example.org/api/v1/send/message');count++;return{status:200,json:async()=>({status:'success',data:{message_id:'postal-message-id@rp.example.org'}})};};
 t.after(()=>{globalThis.fetch=oldFetch});
 const env={MMF_DB:createD1Compat(f.d),MMF_TENANT_ID:'client1',MMF_FROM_DOMAIN:'example.org',MMF_AUTH_TOKEN:token,
 MMF_ENCRYPTION_KEY_B64:f.encryptionKey.toString('base64'),MMF_PRIVACY_KEY_B64:f.privacyKey.toString('base64'),
 MMF_SIGNING_PRIVATE_KEY_PEM:f.keys.privateKey.export({format:'pem',type:'pkcs8'}).toString(),MMF_SIGNING_PUBLIC_KEY_PEM:f.keys.publicKey.export({format:'pem',type:'spki'}).toString(),
 MMF_API_ENABLED:'true',MMF_REAL_SEND_ENABLED:'true',MMF_PROVIDER:'postal',MMF_POSTAL_BASE_URL:'https://mail.example.org',MMF_POSTAL_API_KEY:'test-postal-server-key'};
 const instant=Date.now();
 f.d.prepare(`INSERT INTO mail_sender_domains(tenant_id,domain,challenge_sha256,challenge_expires_ms,verified_until_ms,status,updated_ms)
    VALUES(?,?,?,?,?,'VERIFIED',?)`).run('client1','example.org','f'.repeat(64),instant+86400000,instant+86400000,instant);
 provisionTestRelease(env);
 const w=createWorker(),h={authorization:'Bearer '+token};
 const resp=await w.fetch(new Request('https://mmf.invalid/v1/messages',{method:'POST',headers:h,body:JSON.stringify(message)}),env);
 assert.equal(resp.status,202);const row=await resp.json();
 await w.scheduled({},env);assert.equal(count,1);
 const result=await w.fetch(new Request('https://mmf.invalid/v1/messages/'+row.messageId,{headers:h}),env);
 assert.equal((await result.json()).state,'ACCEPTED_BY_PROVIDER');
});
