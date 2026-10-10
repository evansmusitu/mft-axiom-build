import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createD1Compat} from './helpers/sqlite-d1.mjs';
import {generateDemonstrationKeys} from '../src/evidence.mjs';
import {DurableMailFabric} from '../src/durable/fabric.mjs';
import {createSimulatedProvider} from '../src/providers.mjs';
import {webhookHeaders} from './helpers/svix.mjs';
import ingress from '../src/edge/webhook-only.mjs';
function fixture(t){
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../src/durable/schema.sql',import.meta.url),'utf8'));t.after(()=>sql.close());
 const db=createD1Compat(sql),encryptionKey=randomBytes(32),privacyKey=randomBytes(32),keys=generateDemonstrationKeys();
 const provider=createSimulatedProvider();
 const fab=new DurableMailFabric({tenantId:'client1',verifiedDomains:['example.org'],allowedRegions:['us-east-1'],provider},
  {db,encryptionKey,privacyKey,keys});
 const secret='whsec_'+randomBytes(32).toString('base64');
 const env={MMF_DB:db,MMF_TENANT_ID:'client1',MMF_FROM_DOMAIN:'example.org',
   MMF_ENCRYPTION_KEY_B64:encryptionKey.toString('base64'),MMF_PRIVACY_KEY_B64:privacyKey.toString('base64'),
   MMF_SIGNING_PRIVATE_KEY_PEM:keys.privateKey.export({type:'pkcs8',format:'pem'}).toString(),
   MMF_SIGNING_PUBLIC_KEY_PEM:keys.publicKey.export({type:'spki',format:'pem'}).toString(),
   MMF_WEBHOOK_SECRET:secret,MMF_WEBHOOK_ENABLED:'true',
   MMF_API_ENABLED:'false',MMF_REAL_SEND_ENABLED:'false'};
 const request=(raw,headers)=>new Request('https://isolated.invalid/v1/webhooks/resend',{method:'POST',
   headers:{'content-type':'application/json',...headers},body:raw});
 return{sql,db,fab,provider,env,secret,request};
}
test('webhook-only ingress accepts valid signed provider feedback, suppresses and deduplicates without sending',async t=>{
 const f=fixture(t);
 const prior=await f.fab.enqueue({tenantId:'client1',from:'notices@example.org',to:'recipient@example.net',
  subject:'Test notice',text:'Synthetic test only',kind:'SECURITY',idempotencyKey:'webhook-only-123456'});
 const accepted=await f.fab.processById(prior.messageId);
 const providerId=accepted.proof.events.at(-1).detail.providerId;
 const raw=JSON.stringify({type:'email.bounced',created_at:new Date().toISOString(),
  data:{email_id:providerId,to:['recipient@example.net']}});
 const headers=webhookHeaders(f.secret,raw,'svix-ingress-12345');
 const response=await ingress.fetch(f.request(raw,headers),f.env);
 assert.equal(response.status,202);
 assert.deepEqual(await response.json(),{accepted:true,recorded:true});
 const again=await ingress.fetch(f.request(raw,headers),f.env);
 assert.equal(again.status,202);
 assert.deepEqual(await again.json(),{accepted:true,recorded:false});
 assert.equal(f.provider.attempts,1,'webhook cannot trigger a provider send');
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM mail_provider_events').get().n,1);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM mail_suppressions').get().n,1);
});
test('webhook-only ingress does not expose client, operator, diagnostic or sender-management routes',async t=>{
 const f=fixture(t);
 for(const path of ['/health','/v1/messages','/v1/ops/health','/v1/operator/suppressions',
  '/v1/operator/senders/revoke','/v1/senders/challenge']){
  const response=await ingress.fetch(new Request('https://isolated.invalid'+path,{method:'POST',body:'{}'}),f.env);
  assert.equal(response.status,404,path);
 }
 const get=await ingress.fetch(new Request('https://isolated.invalid/v1/webhooks/resend'),f.env);
 assert.equal(get.status,404);
});
test('webhook ingress rejects misconfigured public API, enabled sending or missing signature without storing events',async t=>{
 const f=fixture(t);
 const raw=JSON.stringify({type:'email.bounced',data:{email_id:'unknown',to:['recipient@example.net']}});
 for(const changes of [{MMF_API_ENABLED:'true'},{MMF_REAL_SEND_ENABLED:'true'},
  {MMF_WEBHOOK_ENABLED:'false'}]){
  const response=await ingress.fetch(f.request(raw,{}),{...f.env,...changes});
  assert.equal(response.status,503);
 }
 const forged=await ingress.fetch(f.request(raw,{}),f.env);
 assert.equal(forged.status,401);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM mail_provider_events').get().n,0);
});
test('webhook-only ingress fails closed when its dedicated database binding is absent',async t=>{
 const f=fixture(t),raw=JSON.stringify({type:'email.delivered',data:{email_id:'unmatched',to:['recipient@example.net']}});
 const h=webhookHeaders(f.secret,raw,'svix-unbound-1234');
 const response=await ingress.fetch(f.request(raw,h),{...f.env,MMF_DB:undefined});
 assert.equal(response.status,503);
});
