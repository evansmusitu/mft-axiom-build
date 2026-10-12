/** End-to-end signed-provider event qualification against durable outbox (offline). */
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {createD1Compat} from './helpers/sqlite-d1.mjs';
import {MmfStagingSqliteDO} from '../src/edge/sqlite-do.mjs';
import {DurableMailFabric} from '../src/durable/fabric.mjs';
import {createSimulatedProvider} from '../src/providers.mjs';
import {generateDemonstrationKeys} from '../src/evidence.mjs';
import {webhookHeaders} from './helpers/svix.mjs';
import ingress from '../src/edge/webhook-only.mjs';
function context(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec(readFileSync(new URL('../src/durable/schema.sql',import.meta.url),'utf8'));
 const storage={sql:{exec(sql,...args){const statement=db.prepare(sql),rows=/^(SELECT|WITH|PRAGMA)/i.test(sql.trim())?statement.all(...args):(statement.run(...args),[]);return{toArray:()=>rows};}}};
 const secret='mmf-stage-bridge-secret-really-long-1234567890', feedback='mmf-stage-feedback-secret-really-long-123456';
 const privacyKey=randomBytes(32),encrypt=randomBytes(32),keys=generateDemonstrationKeys();
 const durable=new MmfStagingSqliteDO({storage},{MMF_STORAGE_RPC_SECRET:secret,MMF_TENANT_ID:'test-tenant',MMF_FEEDBACK_RPC_ENABLED:'true',MMF_FEEDBACK_RPC_SECRET:feedback,MMF_PRIVACY_KEY_B64:privacyKey.toString('base64')});
 const outbox={idFromName:()=>({}),get:()=>({fetch:req=>durable.fetch(req)})};
 const provider=createSimulatedProvider();
 const fabric=new DurableMailFabric({tenantId:'test-tenant',verifiedDomains:['example.org'],allowedRegions:['us-east-1'],provider},{db:createD1Compat(db),encryptionKey:encrypt,privacyKey,keys});
 const webhookSecret='whsec_'+randomBytes(32).toString('base64');
 const env={MMF_API_ENABLED:'false',MMF_REAL_SEND_ENABLED:'false',MMF_WEBHOOK_ENABLED:'true',MMF_OUTBOX_LINK_ENABLED:'true',MMF_OUTBOX:outbox,MMF_RECEIPTS:{},MMF_OUTBOX_FEEDBACK_SECRET:feedback,MMF_TENANT_ID:'test-tenant',MMF_FROM_DOMAIN:'example.org',MMF_WEBHOOK_SECRET:webhookSecret,MMF_ENCRYPTION_KEY_B64:encrypt.toString('base64'),MMF_PRIVACY_KEY_B64:randomBytes(32).toString('base64'),MMF_SIGNING_PRIVATE_KEY_PEM:keys.privateKey.export({type:'pkcs8',format:'pem'}).toString(),MMF_SIGNING_PUBLIC_KEY_PEM:keys.publicKey.export({type:'spki',format:'pem'}).toString()};
 return{db,provider,fabric,env,webhookSecret};
}
async function makeAccepted(f){const queued=await f.fabric.enqueue({tenantId:'test-tenant',from:'notices@example.org',to:'buyer@example.com',subject:'Transaction notice',text:'Test-only notice',kind:'ACCOUNT',idempotencyKey:'secure-test-'+randomBytes(8).toString('hex')});const accepted=await f.fabric.processById(queued.messageId);return{messageId:queued.messageId,providerId:accepted.proof.events.at(-1).detail.providerId};}
const req=(f,providerId,kind,id,to=['buyer@example.com'])=>{
 const raw=JSON.stringify({type:kind,created_at:'2026-10-12T12:00:00.000Z',data:{email_id:providerId,to}});
 return new Request('https://mmf-test.invalid/v1/webhooks/resend',{method:'POST',headers:{'content-type':'application/json',...webhookHeaders(f.webhookSecret,raw,id)},body:raw});
};
test('authentic signed delivered/bounced sequence preserves terminal bounce and suppresses recipient; repeats idempotent',async t=>{
 const f=context(t),m=await makeAccepted(f);
 const delivery=()=>req(f,m.providerId,'email.delivered','svix-delivery-12345');
 assert.equal((await ingress.fetch(delivery(),f.env)).status,202);
 assert.equal((await ingress.fetch(delivery(),f.env)).status,202);
 const bounce=()=>req(f,m.providerId,'email.bounced','svix-bounce-12345');
 assert.equal((await ingress.fetch(bounce(),f.env)).status,202);
 const result=await f.fabric.getProviderEvidence(m.messageId,'test-tenant');
 assert.equal(result.providerStatus,'BOUNCED_REPORTED');
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM mail_provider_events').get().n,2);
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM mail_suppressions').get().n,1);
 assert.equal(f.provider.attempts,1);
});
test('valid signed complaint and unrelated provider id are not silently credited',async t=>{
 const f=context(t),m=await makeAccepted(f);
 assert.equal((await ingress.fetch(req(f,m.providerId,'email.complained','svix-complaint-abcde'),f.env)).status,202);
 assert.equal((await f.fabric.getProviderEvidence(m.messageId,'test-tenant')).providerStatus,'COMPLAINT_REPORTED');
 const bad=await ingress.fetch(req(f,'other-provider-id','email.delivered','svix-unrelated-abcde'),f.env);
 assert.notEqual(bad.status,202);
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM mail_provider_events').get().n,1);
});
test('unsigned, wrong-recipient and disabled webhooks fail closed without evidence writes',async t=>{
 const f=context(t),m=await makeAccepted(f);
 const signed=req(f,m.providerId,'email.bounced','svix-wrong-recipient',['unrelated@example.com']);
 assert.notEqual((await ingress.fetch(signed,f.env)).status,202);
 const invalid=req(f,m.providerId,'email.bounced','svix-invalid-12345');invalid.headers.set('svix-signature','v1,invalid');
 assert.notEqual((await ingress.fetch(invalid,f.env)).status,202);
 assert.equal((await ingress.fetch(req(f,m.providerId,'email.delivered','svix-off-12345'),{...f.env,MMF_WEBHOOK_ENABLED:'false'})).status,503);
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM mail_provider_events').get().n,0);
});