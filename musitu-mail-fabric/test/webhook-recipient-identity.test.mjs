import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes} from 'node:crypto';
import {createD1Compat} from './helpers/sqlite-d1.mjs';
import {generateDemonstrationKeys} from '../src/evidence.mjs';
import {DurableMailFabric} from '../src/durable/fabric.mjs';
import {createSimulatedProvider} from '../src/providers.mjs';
import {processResendWebhook} from '../src/webhooks/resend.mjs';
import {webhookHeaders} from './helpers/svix.mjs';
const sample={tenantId:'client1',from:'alerts@example.org',to:'recipient@example.net',subject:'Private alert',text:'Synthetic test only',kind:'ACCOUNT',idempotencyKey:'identity-bound-12345'};
function fixture(t){
 const rawdb=new DatabaseSync(':memory:');
 rawdb.exec(readFileSync(new URL('../src/durable/schema.sql',import.meta.url),'utf8'));
 t.after(()=>rawdb.close());
 const provider=createSimulatedProvider();
 const options={db:createD1Compat(rawdb),keys:generateDemonstrationKeys(),encryptionKey:randomBytes(32),privacyKey:randomBytes(32)};
 const f=new DurableMailFabric({tenantId:'client1',verifiedDomains:['example.org'],allowedRegions:['us-east-1'],provider},options);
 const secret='whsec_'+randomBytes(32).toString('base64');
 return{f,rawdb,secret,provider};
}
async function accepted(f){
 const queued=await f.enqueue(sample);
 const done=await f.processById(queued.messageId);
 return {id:queued.messageId,providerId:done.proof.events.at(-1).detail.providerId};
}
function raw(type,providerId,to){
 return JSON.stringify({type,created_at:'2026-10-10T07:00:00.000Z',data:{email_id:providerId,...(to===undefined?{}:{to})}});
}
async function signed(f,secret,text,id){
 return processResendWebhook(f,text,webhookHeaders(secret,text,id),{secret,strictRecipient:true});
}
test('signed Resend bounced event with a mismatched recipient cannot suppress unrelated address or create evidence',async t=>{
 const x=fixture(t),sent=await accepted(x.f),msg=raw('email.bounced',sent.providerId,['attacker@example.net']);
 await assert.rejects(()=>signed(x.f,x.secret,msg,'svix-mismatch-0001'),/PROVIDER_RECIPIENT_MISMATCH/);
 assert.equal(x.rawdb.prepare('SELECT COUNT(*) AS n FROM mail_provider_events').get().n,0);
 assert.equal(x.rawdb.prepare('SELECT COUNT(*) AS n FROM mail_suppressions').get().n,0);
 assert.equal((await x.f.getProviderEvidence(sent.id,'client1')).providerStatus,'NO_PROVIDER_EVENT');
});
test('recipient-bound strict mode rejects missing, malformed or multi-recipient signed events',async t=>{
 const x=fixture(t),sent=await accepted(x.f);
 const values=[undefined,[],['recipient@example.net','other@example.net'],['not-an-email'],['recipient@example.net',42],'recipient@example.net'];
 for(let i=0;i<values.length;i++){
  const message=raw('email.complained',sent.providerId,values[i]);
  await assert.rejects(()=>signed(x.f,x.secret,message,'svix-bad-shape-'+i),/INVALID_WEBHOOK_RECIPIENT/);
 }
 assert.equal(x.rawdb.prepare('SELECT COUNT(*) AS n FROM mail_provider_events').get().n,0);
});
test('case-normalized recipient-bound signed complaint persists and suppresses exactly the original recipient',async t=>{
 const x=fixture(t),sent=await accepted(x.f),msg=raw('email.complained',sent.providerId,['RECIPIENT@EXAMPLE.NET']);
 const recorded=await signed(x.f,x.secret,msg,'svix-match-0001');
 assert.equal(recorded.recorded,true);
 const projection=await x.f.getProviderEvidence(sent.id,'client1');
 assert.equal(projection.providerStatus,'COMPLAINT_REPORTED');
 assert.equal(projection.events.length,1);
 await assert.rejects(()=>x.f.enqueue({...sample,idempotencyKey:'other-transaction-12345'}),{code:'RECIPIENT_SUPPRESSED'});
 const duplicate=await signed(x.f,x.secret,msg,'svix-match-0001');
 assert.equal(duplicate.reason,'DUPLICATE_EVENT');
 assert.equal(x.rawdb.prepare('SELECT COUNT(*) AS n FROM mail_provider_events').get().n,1);
});
test('forged invalid signature fails before recipient matching and no event is saved',async t=>{
 const x=fixture(t),sent=await accepted(x.f),msg=raw('email.bounced',sent.providerId,['recipient@example.net']);
 const headers=webhookHeaders(x.secret,msg,'svix-signature-01');headers['svix-signature']='v1,'+randomBytes(32).toString('base64');
 await assert.rejects(()=>processResendWebhook(x.f,msg,headers,{secret:x.secret,strictRecipient:true}),/WEBHOOK_AUTH_FAILED/);
 assert.equal(x.rawdb.prepare('SELECT COUNT(*) AS n FROM mail_provider_events').get().n,0);
});
