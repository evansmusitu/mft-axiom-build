import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {randomBytes,createHmac} from 'node:crypto';
import {createD1Compat} from './helpers/sqlite-d1.mjs';
import {DurableMailFabric} from '../src/durable/fabric.mjs';
import {generateDemonstrationKeys} from '../src/evidence.mjs';
import {processResendWebhook} from '../src/webhooks/resend.mjs';
import {createFeedbackRecorder} from '../src/webhooks/feedback-recorder.mjs';
import {webhookHeaders} from './helpers/svix.mjs';
import {createWorker} from '../src/edge/worker.mjs';

function fixture(t){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(readFileSync(new URL('../src/durable/schema.sql',import.meta.url),'utf8'));
 t.after(()=>sqlite.close());
 const db=createD1Compat(sqlite),keys=generateDemonstrationKeys(),enc=randomBytes(32),privacy=randomBytes(32);
 const provider={name:'simulation',region:'us-east-1',async send(){return {outcome:'accepted',providerId:'synthetic_opaque_feedback_101'}}};
 const owner=new DurableMailFabric({tenantId:'client1',verifiedDomains:['example.org'],allowedRegions:['us-east-1'],provider},
  {db,keys,encryptionKey:enc,privacyKey:privacy});
 const receiverDb={
  prepare:db.prepare.bind(db),
  async matchRecipient(tenantId,providerId,recipient){
   if(tenantId!=='client1')throw Error('TENANT_DENIED');
   const row=await db.prepare("SELECT recipient_hmac FROM mail_messages WHERE tenant_id=? AND provider_id=? AND state='ACCEPTED_BY_PROVIDER'")
     .bind(tenantId,providerId).first();
   if(!row)return null;
   const hmac=createHmac('sha256',privacy).update(recipient.toLowerCase()).digest('hex');
   return row.recipient_hmac===hmac;
  }
 };
 const secret='whsec_'+randomBytes(32).toString('base64');
 const env={MMF_DB:receiverDb,MMF_TENANT_ID:'client1',MMF_FROM_DOMAIN:'example.org',MMF_API_ENABLED:'false',
  MMF_REAL_SEND_ENABLED:'false',MMF_WEBHOOK_ENABLED:'true',MMF_WEBHOOK_RECORDER_ONLY:'true',MMF_WEBHOOK_SECRET:secret};
 return{sqlite,db,receiverDb,owner,secret,env};
}
async function accepted(owner){
 const q=await owner.enqueue({tenantId:'client1',from:'alerts@example.org',to:'recipient@example.net',
  subject:'Test',text:'Never public',kind:'ACCOUNT',idempotencyKey:'scoped-recorder-12345'});
 const sent=await owner.processById(q.messageId);
 assert.equal(sent.state,'ACCEPTED_BY_PROVIDER');
 return q.messageId;
}
const event=(provider,recipient='recipient@example.net',kind='email.bounced')=>
 JSON.stringify({type:kind,created_at:new Date().toISOString(),data:{email_id:provider,to:[recipient]}});
test('recipient-bound signed feedback needs no sender encryption or signing keys on receiving worker',async t=>{
 const x=fixture(t),id=await accepted(x.owner),raw=event('synthetic_opaque_feedback_101');
 assert.equal(x.env.MMF_PRIVACY_KEY_B64,undefined);
 assert.equal(x.env.MMF_ENCRYPTION_KEY_B64,undefined);
 assert.equal(x.env.MMF_SIGNING_PRIVATE_KEY_PEM,undefined);
 const req=new Request('https://private.invalid/v1/webhooks/resend',{method:'POST',
  headers:{'content-type':'application/json',...webhookHeaders(x.secret,raw,'svix-recorder-00001')},body:raw});
 const response=await createWorker().fetch(req,x.env);
 assert.equal(response.status,202,JSON.stringify(await response.clone().json()));
 assert.equal((await x.owner.getProviderEvidence(id,'client1')).providerStatus,'BOUNCED_REPORTED');
 assert.equal(x.sqlite.prepare('SELECT COUNT(*) AS n FROM mail_suppressions').get().n,1);
});
test('receive-only recorder rejects cross-recipient report without mutating persistent ledger',async t=>{
 const x=fixture(t);await accepted(x.owner);
 const recorder=createFeedbackRecorder({db:x.receiverDb,tenantId:'client1'});
 const raw=event('synthetic_opaque_feedback_101','intruder@example.net');
 await assert.rejects(()=>processResendWebhook(recorder,raw,webhookHeaders(x.secret,raw,'svix-recorder-00002'),
   {secret:x.secret,strictRecipient:true}),/PROVIDER_RECIPIENT_MISMATCH/);
 assert.equal(x.sqlite.prepare('SELECT COUNT(*) AS n FROM mail_provider_events').get().n,0);
 assert.equal(x.sqlite.prepare('SELECT COUNT(*) AS n FROM mail_suppressions').get().n,0);
});
test('provider event before accepted provider ID is stored must stay retryable',async t=>{
 const x=fixture(t);
 const recorder=createFeedbackRecorder({db:x.receiverDb,tenantId:'client1'});
 const raw=event('synthetic_opaque_feedback_101','recipient@example.net','email.delivered');
 await assert.rejects(()=>processResendWebhook(recorder,raw,webhookHeaders(x.secret,raw,'svix-recorder-00003'),
  {secret:x.secret,strictRecipient:true}),/PROVIDER_CORRELATION_PENDING/);
 assert.equal(x.sqlite.prepare('SELECT COUNT(*) AS n FROM mail_provider_events').get().n,0);
});
test('the receive-only recorder refuses inappropriate tenant or unscoped database binding',()=>{
 assert.throws(()=>createFeedbackRecorder({db:{},tenantId:'client1'}));
 assert.throws(()=>createFeedbackRecorder({db:{prepare(){return null}},tenantId:'../other'}));
});
