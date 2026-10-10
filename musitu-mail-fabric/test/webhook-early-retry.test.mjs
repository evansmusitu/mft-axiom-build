import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {createD1Compat} from './helpers/sqlite-d1.mjs';
import {generateDemonstrationKeys} from '../src/evidence.mjs';
import {DurableMailFabric} from '../src/durable/fabric.mjs';
import {processResendWebhook} from '../src/webhooks/resend.mjs';
import {createWorker} from '../src/edge/worker.mjs';
import {webhookHeaders} from './helpers/svix.mjs';
const message={tenantId:'client1',from:'notices@example.org',to:'recipient@example.net',subject:'Synthetic alert',text:'Test only',kind:'ACCOUNT',idempotencyKey:'early-feedback-case-1234'};
function fixture(t){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(readFileSync(new URL('../src/durable/schema.sql',import.meta.url),'utf8'));t.after(()=>sqlite.close());
 const encryptionKey=randomBytes(32),privacyKey=randomBytes(32),keys=generateDemonstrationKeys();
 const provider={name:'synthetic-controlled',region:'us-east-1',attempts:0,
   async send(){this.attempts++;return {outcome:'accepted',providerId:'provider_early_feedback_1234'}}};
 const db=createD1Compat(sqlite);
 const fab=new DurableMailFabric({tenantId:'client1',verifiedDomains:['example.org'],allowedRegions:['us-east-1'],provider},
  {db,encryptionKey,privacyKey,keys});
 const secret='whsec_'+randomBytes(32).toString('base64');
 const event=JSON.stringify({type:'email.delivered',data:{email_id:'provider_early_feedback_1234',to:['recipient@example.net']}});
 const headers=webhookHeaders(secret,event,'svix-early-1234567');
 const env={MMF_DB:db,MMF_TENANT_ID:'client1',MMF_FROM_DOMAIN:'example.org',
  MMF_ENCRYPTION_KEY_B64:encryptionKey.toString('base64'),MMF_PRIVACY_KEY_B64:privacyKey.toString('base64'),
  MMF_SIGNING_PRIVATE_KEY_PEM:keys.privateKey.export({type:'pkcs8',format:'pem'}).toString(),
  MMF_SIGNING_PUBLIC_KEY_PEM:keys.publicKey.export({type:'spki',format:'pem'}).toString(),
  MMF_WEBHOOK_SECRET:secret,MMF_WEBHOOK_ENABLED:'true',MMF_REAL_SEND_ENABLED:'false',MMF_API_ENABLED:'false'};
 return{sqlite,db,fab,provider,secret,event,headers,env};
}
test('strict signed early feedback remains retryable until provider ID is durably recorded',async t=>{
 const f=fixture(t),queued=await f.fab.enqueue(message);
 await assert.rejects(()=>processResendWebhook(f.fab,f.event,f.headers,{secret:f.secret,strictRecipient:true}),/PROVIDER_CORRELATION_PENDING/);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM mail_provider_events').get().n,0);
 assert.equal((await f.fab.processById(queued.messageId)).state,'ACCEPTED_BY_PROVIDER');
 const recorded=await processResendWebhook(f.fab,f.event,f.headers,{secret:f.secret,strictRecipient:true});
 assert.equal(recorded.recorded,true);
 const retry=await processResendWebhook(f.fab,f.event,f.headers,{secret:f.secret,strictRecipient:true});
 assert.equal(retry.reason,'DUPLICATE_EVENT');
 const evidence=await f.fab.getProviderEvidence(queued.messageId,'client1');
 assert.equal(evidence.providerStatus,'DELIVERED_REPORTED');assert.equal(evidence.events.length,1);
 assert.equal(f.provider.attempts,1);
});
test('paused Worker returns HTTP 503 instead of falsely accepting unmatched signed feedback',async t=>{
 const f=fixture(t),queued=await f.fab.enqueue(message),worker=createWorker();
 const request=()=>new Request('https://private.invalid/v1/webhooks/resend',{method:'POST',headers:f.headers,body:f.event});
 const early=await worker.fetch(request(),f.env);
 assert.equal(early.status,503);assert.deepEqual(await early.json(),{error:'PROVIDER_CORRELATION_PENDING'});
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM mail_provider_events').get().n,0);
 await f.fab.processById(queued.messageId);
 const delivered=await worker.fetch(request(),f.env);
 assert.equal(delivered.status,202);assert.equal((await delivered.json()).recorded,true);
 const repeated=await worker.fetch(request(),f.env);
 assert.equal(repeated.status,202);assert.equal((await repeated.json()).recorded,false);
 assert.equal(f.provider.attempts,1);
});
