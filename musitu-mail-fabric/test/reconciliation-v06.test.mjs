import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {DatabaseSync} from 'node:sqlite';import {randomBytes} from 'node:crypto';
import {createD1Compat} from './helpers/sqlite-d1.mjs';import {DurableMailFabric} from '../src/durable/fabric.mjs';import {generateDemonstrationKeys} from '../src/evidence.mjs';import {createSimulatedProvider} from '../src/providers.mjs';
const base={tenantId:'tenant1',from:'notice@example.org',to:'recipient@example.net',subject:'Service update',text:'Payment confirmation',kind:'RECEIPT',idempotencyKey:'payment-recon-123'};
function setup(t){const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../src/durable/schema.sql',import.meta.url),'utf8'));t.after(()=>db.close());const provider=createSimulatedProvider();const mail=new DurableMailFabric({tenantId:'tenant1',verifiedDomains:['example.org'],allowedRegions:['us-east-1'],provider},{db:createD1Compat(db),keys:generateDemonstrationKeys(),encryptionKey:randomBytes(32),privacyKey:randomBytes(32)});return {mail,db};}
test('delivery then bounce projection remains report-only and bounce wins',async t=>{
 const {mail}=setup(t),submitted=await mail.enqueue(base),accepted=await mail.processById(submitted.messageId);const id=accepted.proof.events.at(-1).detail.providerId;
 await mail.recordProviderEvent({svixId:'svix-deliv-1234',rawSha256:'a'.repeat(64),type:'email.delivered',providerId:id});
 let out=await mail.getProviderEvidence(submitted.messageId,'tenant1');assert.equal(out.providerStatus,'DELIVERED_REPORTED');
 await mail.recordProviderEvent({svixId:'svix-bounce-1234',rawSha256:'b'.repeat(64),type:'email.bounced',providerId:id});
 out=await mail.getProviderEvidence(submitted.messageId,'tenant1');assert.equal(out.providerStatus,'BOUNCED_REPORTED');
 assert.equal(out.events.length,2);assert.ok(!('humanRead' in out));
});
test('out-of-order delayed and complaint reports project conservatively',async t=>{
 const {mail}=setup(t),created=await mail.enqueue(base),sent=await mail.processById(created.messageId);const id=sent.proof.events.at(-1).detail.providerId;
 await mail.recordProviderEvent({svixId:'svix-complaint-123',rawSha256:'c'.repeat(64),type:'email.complained',providerId:id});
 await mail.recordProviderEvent({svixId:'svix-delay-12345',rawSha256:'d'.repeat(64),type:'email.delivery_delayed',providerId:id});
 await mail.recordProviderEvent({svixId:'svix-deliv-12345',rawSha256:'e'.repeat(64),type:'email.delivered',providerId:id});
 const out=await mail.getProviderEvidence(created.messageId,'tenant1');assert.equal(out.providerStatus,'COMPLAINT_REPORTED');
});

test('accepted transport without an attributable provider ID remains unknown, never provably delivered',async t=>{
  const db=new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../src/durable/schema.sql',import.meta.url),'utf8'));
  t.after(()=>db.close());
  const provider={name:'unattributable',region:'us-east-1',async send(){return {outcome:'accepted',providerId:'not valid : id'}}};
  const mail=new DurableMailFabric({tenantId:'tenant1',verifiedDomains:['example.org'],allowedRegions:['us-east-1'],provider},
    {db:createD1Compat(db),keys:generateDemonstrationKeys(),encryptionKey:randomBytes(32),privacyKey:randomBytes(32)});
  const created=await mail.enqueue(base);
  const result=await mail.processById(created.messageId);
  assert.equal(result.state,'OUTCOME_UNKNOWN');
  assert.equal(result.proof.events.at(-1).event,'SEND_OUTCOME_UNKNOWN');
  assert.equal((await mail.getProviderEvidence(created.messageId,'tenant1')).providerStatus,'NO_PROVIDER_EVENT');
});
