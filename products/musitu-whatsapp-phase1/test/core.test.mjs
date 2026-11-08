import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyMetaSignature, resolveWebhookEvents, IsolatedInbox, allowExternalAction } from '../src/core/verify.mjs';

const secret='test-only-nonproduction-secret';
const goodPayload={object:'whatsapp_business_account',entry:[{id:'WABA_A',changes:[{field:'messages',value:{metadata:{phone_number_id:'PHONE_A'},messages:[{id:'wamid.001',from:'263771000001',timestamp:'1791830000',type:'text',text:{body:'Hello'}}]}}]}]};
const serialized=Buffer.from(JSON.stringify(goodPayload));
const sig='sha256='+createHmac('sha256',secret).update(serialized).digest('hex');
const bindings=[{wabaId:'WABA_A',phoneNumberId:'PHONE_A',tenantId:'tenant-A'},{wabaId:'WABA_B',phoneNumberId:'PHONE_B',tenantId:'tenant-B'}];

test('Meta signature authenticates exact raw bytes and rejects malformed or altered signatures',()=>{
  assert.equal(verifyMetaSignature(serialized,sig,secret),true);
  assert.equal(verifyMetaSignature(Buffer.from(serialized.toString().replace('Hello','Hella')),sig,secret),false);
  assert.equal(verifyMetaSignature(serialized,'sha256=00',secret),false);
  assert.equal(verifyMetaSignature(serialized,null,secret),false);
});

test('provider WABA plus phone binding selects one tenant and never trusts customer-supplied tenant ID',()=>{
  const withInjection=structuredClone(goodPayload);
  withInjection.entry[0].changes[0].value.tenant_id='tenant-B';
  assert.deepEqual(resolveWebhookEvents(withInjection,bindings),[{tenantId:'tenant-A',wabaId:'WABA_A',phoneNumberId:'PHONE_A',providerMessageId:'wamid.001',direction:'inbound'}]);
});

test('WABA mismatch and unknown phone fail closed',()=>{
  const wrong=structuredClone(goodPayload);wrong.entry[0].id='WABA_B';
  assert.throws(()=>resolveWebhookEvents(wrong,bindings),/UNAUTHORIZED_CHANNEL/);
  const unknown=structuredClone(goodPayload);unknown.entry[0].changes[0].value.metadata.phone_number_id='UNKNOWN';
  assert.throws(()=>resolveWebhookEvents(unknown,bindings),/UNAUTHORIZED_CHANNEL/);
});

test('inbox ingress is idempotent per tenant/provider message ID',()=>{
  const inbox=new IsolatedInbox();
  const event={tenantId:'tenant-A',providerMessageId:'wamid.001',phoneNumberId:'PHONE_A'};
  assert.equal(inbox.ingest(event),'ACCEPTED');
  assert.equal(inbox.ingest(event),'DUPLICATE');
  assert.equal(inbox.count('tenant-A'),1);
});

test('human takeover disables automated replies and other tenants cannot control conversation',()=>{
  const inbox=new IsolatedInbox();
  inbox.ingest({tenantId:'tenant-A',providerMessageId:'wamid.2',phoneNumberId:'PHONE_A',conversationId:'CONV_A'});
  assert.equal(inbox.canBotReply('tenant-A','CONV_A'),true);
  inbox.handover('tenant-A','CONV_A');
  assert.equal(inbox.canBotReply('tenant-A','CONV_A'),false);
  assert.throws(()=>inbox.handover('tenant-B','CONV_A'),/TENANT_NOT_FOUND/);
});

test('all real sends, live checkout, production email and signup fail closed regardless of env variables',()=>{
  for(const kind of ['META_SEND','PAYMENT_CAPTURE','MAIL_SEND','PUBLIC_SIGNUP']){
    assert.throws(()=>allowExternalAction(kind),/ACTION_DISABLED/);
  }
});

test('rejected cross-tenant conversation collision must not change message ledger',()=>{
  const inbox=new IsolatedInbox();
  assert.equal(inbox.ingest({tenantId:'tenant-A',providerMessageId:'mA',phoneNumberId:'PHONE_A',conversationId:'CONV_A'}),'ACCEPTED');
  assert.throws(()=>inbox.ingest({tenantId:'tenant-B',providerMessageId:'mB',phoneNumberId:'PHONE_B',conversationId:'CONV_A'}),/TENANT_CONFLICT/);
  assert.equal(inbox.count('tenant-A'),1);
  assert.equal(inbox.count('tenant-B'),0);
});
