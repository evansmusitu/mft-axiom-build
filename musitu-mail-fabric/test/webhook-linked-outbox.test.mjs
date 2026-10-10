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

function fixture(t){
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());
 sqlite.exec(readFileSync(new URL('../src/durable/schema.sql',import.meta.url),'utf8'));
 const storage={sql:{exec(stmt,...args){
  const statement=sqlite.prepare(stmt);
  const rows=/^(SELECT|WITH|PRAGMA)/i.test(stmt.trim())?statement.all(...args):(statement.run(...args),[]);
  return{toArray(){return rows}};
 }}};
 const token='isolated-outbox-ledger-secret-1234567890abcde';
 const owner=new MmfStagingSqliteDO({storage},{MMF_STORAGE_RPC_SECRET:token});
 const outbox={idFromName:n=>n,get:()=>({fetch:req=>owner.fetch(req)})};
 const receipts={idFromName:n=>n,get:()=>({fetch(){throw Error('RECEIPTS_MUST_NOT_BE_USED_FOR_CORRELATION')}})};
 const keys=generateDemonstrationKeys(),encryptionKey=randomBytes(32),privacyKey=randomBytes(32);
 const db=createD1Compat(sqlite),provider=createSimulatedProvider();
 const fabric=new DurableMailFabric({tenantId:'client1',verifiedDomains:['example.org'],allowedRegions:['us-east-1'],provider},
  {db,encryptionKey,privacyKey,keys});
 const webhookSecret='whsec_'+randomBytes(32).toString('base64');
 const env={MMF_WEBHOOK_ENABLED:'true',MMF_REAL_SEND_ENABLED:'false',MMF_API_ENABLED:'false',
  MMF_OUTBOX_LINK_ENABLED:'true',MMF_OUTBOX:outbox,MMF_RECEIPTS:receipts,MMF_OUTBOX_RPC_SECRET:token,
  MMF_TENANT_ID:'client1',MMF_FROM_DOMAIN:'example.org',
  MMF_WEBHOOK_SECRET:webhookSecret,
  MMF_ENCRYPTION_KEY_B64:encryptionKey.toString('base64'),MMF_PRIVACY_KEY_B64:privacyKey.toString('base64'),
  MMF_SIGNING_PRIVATE_KEY_PEM:keys.privateKey.export({type:'pkcs8',format:'pem'}).toString(),
  MMF_SIGNING_PUBLIC_KEY_PEM:keys.publicKey.export({type:'spki',format:'pem'}).toString()};
 return {sqlite,fabric,env,provider,webhookSecret,receipts,outbox};
}
test('linked webhook-only Worker reconciles signed bounce into originating outbox, never private receipts DB',async t=>{
 const f=fixture(t);
 const pending=await f.fabric.enqueue({tenantId:'client1',from:'alerts@example.org',to:'recipient@example.net',
  subject:'Notice',text:'Synthetic payload',kind:'ACCOUNT',idempotencyKey:'linked-outbox-1234'});
 const accepted=await f.fabric.processById(pending.messageId);
 const providerId=accepted.proof.events.at(-1).detail.providerId;
 const raw=JSON.stringify({type:'email.bounced',created_at:new Date().toISOString(),
  data:{email_id:providerId,to:['recipient@example.net']}});
 const headers={'content-type':'application/json',...webhookHeaders(f.webhookSecret,raw,'svix-linked-outbox-01')};
 const req=()=>new Request('https://private.invalid/v1/webhooks/resend',{method:'POST',headers,body:raw});
 const res=await ingress.fetch(req(),f.env);
 assert.equal(res.status,202);assert.deepEqual(await res.json(),{accepted:true,recorded:true});
 assert.equal((await ingress.fetch(req(),f.env)).status,202);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM mail_provider_events').get().n,1);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM mail_suppressions').get().n,1);
 const ev=await f.fabric.getProviderEvidence(pending.messageId,'client1');
 assert.equal(ev.providerStatus,'BOUNCED_REPORTED');
 assert.equal(f.provider.attempts,1);
});
test('linked Worker fails closed on absent or wrong outbox credential and separate-unlinked receipt DB',async t=>{
 const f=fixture(t);
 const raw=JSON.stringify({type:'email.bounced',data:{email_id:'unknown',to:['recipient@example.net']}});
 const hdr={'content-type':'application/json',...webhookHeaders(f.webhookSecret,raw,'svix-boundary-01')};
 const req=()=>new Request('https://private.invalid/v1/webhooks/resend',{method:'POST',headers:hdr,body:raw});
 for(const changed of [{MMF_OUTBOX_LINK_ENABLED:'false'},{MMF_OUTBOX:undefined},
  {MMF_OUTBOX_RPC_SECRET:'wrong-outbox-secret-0123456789abcdef'},
  {MMF_OUTBOX:f.receipts}]){
  const resp=await ingress.fetch(req(),{...f.env,...changed});
  assert.equal(resp.status,503);
 }
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM mail_provider_events').get().n,0);
});
