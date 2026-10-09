import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {MailFabric} from '../src/fabric.mjs';
import {verifyProof} from '../src/evidence.mjs';
import {createSimulatedProvider,createResendProvider} from '../src/providers.mjs';
import {createHandler} from '../src/api.mjs';
const msg={tenantId:'client1',from:'alerts@example.org',to:'member@example.net',subject:'Receipt available',text:'Your receipt is ready.',kind:'RECEIPT',idempotencyKey:'charge-000001'};
const setup=(provider=createSimulatedProvider(),rest={})=>({provider,fabric:new MailFabric({tenantId:'client1',verifiedDomains:['example.org'],allowedRegions:['us-east-1'],provider,...rest},{privacyKey:randomBytes(32)})});
test('verified signed policy and provider acceptance, never inbox proof',async()=>{
  const {fabric}=setup(),r=await fabric.submit(msg);
  assert.equal(r.state,'ACCEPTED_BY_PROVIDER');
  assert.deepEqual(r.proof.events.map(x=>x.event),['POLICY_APPROVED','PROVIDER_ACCEPTED']);
  assert.equal(verifyProof(r.proof,{trustedPublicKey:r.proof.publicKey}),true);
  for(const s of [msg.to,msg.text,msg.subject])assert.equal(JSON.stringify(r.proof).includes(s),false);
  assert.equal(fabric.get(r.messageId,'another-tenant'),null);
});
test('idempotency prevents duplicate network attempts',async()=>{
  const {fabric,provider}=setup(),[a,b]=await Promise.all([fabric.submit(msg),fabric.submit({...msg})]);
  assert.equal(a.messageId,b.messageId);assert.equal(provider.attempts,1);
  assert.equal((await fabric.submit(msg)).messageId,a.messageId);assert.equal(provider.attempts,1);
});
test('changed content with same idempotency key is rejected',async()=>{
  const {fabric,provider}=setup();await fabric.submit(msg);
  await assert.rejects(()=>fabric.submit({...msg,text:'altered'}),{code:'IDEMPOTENCY_CONFLICT'});
  assert.equal(provider.attempts,1);
});
test('sender, header, marketing, tenant and address policies fail closed',async()=>{
  const {fabric,provider}=setup();
  for(const [change,code] of [
    [{from:'x@other.example'},'DOMAIN_NOT_VERIFIED'],[{subject:'A\nBcc: victim@example.net'},'INVALID_SUBJECT'],
    [{kind:'MARKETING'},'PURPOSE_NOT_ALLOWED'],[{idempotencyKey:'1'},'INVALID_IDEMPOTENCY_KEY'],
    [{to:'not-email'},'INVALID_ADDRESS'],[{tenantId:'other'},'TENANT_NOT_AUTHORIZED']
  ])await assert.rejects(()=>fabric.submit({...msg,...change}),{code});
  assert.equal(provider.attempts,0);
});
test('suppression blocks delivery',async()=>{
  const {fabric,provider}=setup();fabric.suppress(msg.to);
  await assert.rejects(()=>fabric.submit(msg),{code:'RECIPIENT_SUPPRESSED'});assert.equal(provider.attempts,0);
});
test('declared residency and allowlist restrictions block delivery',async()=>{
  const a=setup({...createSimulatedProvider(),region:'eu-west-1'});
  await assert.rejects(()=>a.fabric.submit(msg),{code:'RESIDENCY_POLICY_REJECTED'});
  const b=setup(createSimulatedProvider(),{denyExternalRecipients:true,allowedRecipientDomains:['example.org']});
  await assert.rejects(()=>b.fabric.submit(msg),{code:'RECIPIENT_POLICY_REJECTED'});
});
test('unknown network outcome stops automatic retries',async()=>{
  let count=0;const {fabric}=setup({name:'ambiguous',region:'us-east-1',async send(){count++;throw Error('timeout')}});
  const a=await fabric.submit(msg),b=await fabric.submit(msg);
  assert.equal(count,1);assert.equal(a.state,'OUTCOME_UNKNOWN');assert.equal(b.messageId,a.messageId);
});
test('provider rejection is never delivery success',async()=>{
  const {fabric}=setup(createSimulatedProvider({outcome:'rejected'})),r=await fabric.submit(msg);
  assert.equal(r.state,'REJECTED_BY_PROVIDER');
});
test('tampering and false trust anchors invalidate proof',async()=>{
  const {fabric}=setup(),r=await fabric.submit(msg),copy=structuredClone(r.proof);
  copy.events[0].detail.kind='SECURITY';assert.equal(verifyProof(copy),false);
  assert.equal(verifyProof(r.proof,{trustedPublicKey:'untrusted'}),false);
});
test('network sending needs explicit opt-in and a key',()=>{
  assert.throws(()=>createResendProvider({apiKey:'re_examplecredential1234567'}),/explicit opt-in/);
  assert.throws(()=>createResendProvider({apiKey:'invalid',allowNetwork:true}),/credential/);
});
test('Resend adapter signs single stable attempt and accepts mock response',async()=>{
  const calls=[];const p=createResendProvider({apiKey:'re_examplecredential1234567',allowNetwork:true,fetchImpl:async(url,opts)=>{
    calls.push({url,opts});return {status:201,json:async()=>({id:'a1a1a1a1-b2b2-c3c3-d4d4-e5e5e5e5e5e5'})};
  }});
  const {fabric}=setup(p),r=await fabric.submit(msg);
  assert.equal(r.state,'ACCEPTED_BY_PROVIDER');assert.equal(calls.length,1);
  assert.match(calls[0].opts.headers['Idempotency-Key'],/^musitu-[a-f0-9]{64}$/);
});
test('Resend 503 remains unknown and no retry occurs',async()=>{
  let n=0;const p=createResendProvider({apiKey:'re_examplecredential1234567',allowNetwork:true,fetchImpl:async()=>{n++;return {status:503}}});
  const {fabric}=setup(p),r=await fabric.submit(msg);await fabric.submit(msg);
  assert.equal(r.state,'OUTCOME_UNKNOWN');assert.equal(n,1);
});
test('bearer-protected API supports submit, lookup, invalid body and size limits',async()=>{
  const {fabric}=setup(),handle=createHandler({fabric,apiToken:'long-test-token-12345678901234567890',tenantId:'client1'});
  const noauth=await handle(new Request('https://example.invalid/v1/messages',{method:'POST',body:'{}'}));assert.equal(noauth.status,401);
  const h={authorization:'Bearer long-test-token-12345678901234567890'};
  const resp=await handle(new Request('https://example.invalid/v1/messages',{method:'POST',headers:h,body:JSON.stringify(msg)}));
  assert.equal(resp.status,202);const result=await resp.json();
  const lookup=await handle(new Request('https://example.invalid/v1/messages/'+result.messageId,{headers:h}));
  assert.deepEqual(await lookup.json(),result);
  const bad=await handle(new Request('https://example.invalid/v1/messages',{method:'POST',headers:h,body:'{bad'}));assert.equal(bad.status,400);
  const big=await handle(new Request('https://example.invalid/v1/messages',{method:'POST',headers:h,body:'x'.repeat(30001)}));assert.equal(big.status,413);
});
