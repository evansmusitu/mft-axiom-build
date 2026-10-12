import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {Catalog,CommercialPlatform,canonicalCommerceClaim} from '../src/commercial/mmf-commercial-platform.mjs';
const now=Date.UTC(2026,9,12,12);
const validEnv={MMF_REAL_SEND_ENABLED:'false',MMF_COMMERCE_ENABLED:'false',MMF_CUSTOMER_API_ENABLED:'false'};
function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 const {publicKey,privateKey}=generateKeyPairSync('ed25519');
 const registry=new CommercialPlatform(db,{apiPepper:Buffer.alloc(32,19),trustedPaymentKey:publicKey,now:()=>now,env:validEnv});
 return {registry,db,privateKey};
}
const hashedRef=(s)=>createHash('sha256').update(s).digest('hex');
function claim({tenant='org-alpha',order='MMF-ORDER-ABCDEF12345',plan='LAUNCH',status='paid',ref='paynow-A1',amount=9900,at=now}={}){
 return {schema:'mmf-commerce-claim-v1',product:'musitu-mail-fabric',tenantId:tenant,orderReference:order,planCode:plan,amountCents:amount,currency:'USD',provider:'paynow',providerReferenceSha256:hashedRef(ref),status,observedAtMs:at};
}
const receipt=(c,key)=>({claim:c,signature:sign(null,canonicalCommerceClaim(c),key).toString('base64url')});
const create=(r,id,sub)=>r.createTenant({tenantId:id,ownerSubject:sub});

test('catalog is versioned fixed USD proposal, never a published billable offering',()=>{
 assert.equal(Catalog.LAUNCH.amountCents,9900);assert.equal(Catalog.GROWTH.monthlyEvents,30000);
 assert.equal(Catalog.BUSINESS.amountCents,89900);assert.equal(Catalog.ENTERPRISE,'CONTACT_SALES');
 assert.equal(Catalog.LAUNCH.commerciallyReleased,false);
});
test('tenant isolation, external identity subject and scoped opaque API tokens',t=>{
 const {registry:r,db}=fixture(t);create(r,'org-alpha','oidc:subject-alpha');create(r,'org-beta','oidc:subject-beta');
 const issued=r.issueApiKey({tenantId:'org-alpha',actorSubject:'oidc:subject-alpha',scope:'events:write'});
 assert.match(issued.token,/^mmf_stage_[0-9A-Za-z_-]{43}$/);
 assert.equal(r.authenticateApiKey(issued.token,'events:write').tenantId,'org-alpha');
 assert.throws(()=>r.authenticateApiKey(issued.token,'billing:read'),/MMF_PLATFORM_DENIED/);
 assert.throws(()=>r.issueApiKey({tenantId:'org-beta',actorSubject:'oidc:subject-alpha',scope:'events:write'}),/MMF_PLATFORM_DENIED/);
 assert.throws(()=>r.createTenant({tenantId:'org-alpha',ownerSubject:'oidc:other'}),/MMF_PLATFORM_DENIED/);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mmf_api_keys WHERE secret_hash=?').get(issued.token).n,0);
 r.revokeApiKey({tenantId:'org-alpha',actorSubject:'oidc:subject-alpha',keyId:issued.keyId});
 assert.throws(()=>r.authenticateApiKey(issued.token,'events:write'),/MMF_PLATFORM_DENIED/);
});
test('domain onboarding requires a server-side TXT DNS challenge and never trusts client-supplied verified flag',async t=>{
 const {registry:r}=fixture(t);create(r,'org-alpha','oidc:subject-alpha');create(r,'org-beta','oidc:subject-beta');
 const challenge=r.requestDomain({tenantId:'org-alpha',actorSubject:'oidc:subject-alpha',domain:'mailer.example.com'});
 assert.equal(challenge.status,'PENDING_DNS');
 assert.throws(()=>r.requestDomain({tenantId:'org-alpha',actorSubject:'oidc:subject-alpha',domain:'another.example.com'}),/MMF_PLATFORM_DENIED/);
 assert.throws(()=>r.requestDomain({tenantId:'org-beta',actorSubject:'oidc:subject-beta',domain:'mailer.example.com'}),/MMF_PLATFORM_DENIED/);
 await assert.rejects(r.verifyDomainDns({tenantId:'org-alpha',actorSubject:'oidc:subject-alpha',domain:'mailer.example.com',resolveTxt:async()=>[['garbage']]}),/MMF_PLATFORM_DENIED/);
 const proof=await r.verifyDomainDns({tenantId:'org-alpha',actorSubject:'oidc:subject-alpha',domain:'mailer.example.com',resolveTxt:async n=>{assert.equal(n,'_mmf-verify.mailer.example.com');return [[challenge.txtValue]];}});
 assert.equal(proof.status,'DNS_VERIFIED_STAGE');assert.equal(proof.canSendMail,false);
});
test('subscriptions and signed source-pinned Paynow events: only matching tenant, order, price; duplicates idempotent',t=>{
 const {registry:r,privateKey}=fixture(t);create(r,'org-alpha','oidc:subject-alpha');create(r,'org-beta','oidc:subject-beta');
 const order='MMF-ORDER-ABCDEF12345';const initial=r.openSubscription({tenantId:'org-alpha',actorSubject:'oidc:subject-alpha',planCode:'LAUNCH',orderReference:order});
 assert.equal(initial.status,'PENDING');assert.equal(initial.amountCents,9900);
 assert.throws(()=>receipt(claim({amount:100}),privateKey),/MMF_PLATFORM_DENIED/);
 const badTenant=receipt(claim({tenant:'org-beta'}),privateKey);assert.throws(()=>r.ingestSignedPayment(badTenant),/MMF_PLATFORM_DENIED/);
 const accepted=receipt(claim(),privateKey);
 assert.equal(r.ingestSignedPayment(accepted).status,'PAID_ATTESTED_STAGE');
 assert.equal(r.ingestSignedPayment(accepted).idempotent,true);
 assert.equal(r.getSubscription({tenantId:'org-beta',actorSubject:'oidc:subject-beta',orderReference:order}),null);
 assert.equal(r.getSubscription({tenantId:'org-alpha',actorSubject:'oidc:subject-alpha',orderReference:order}).liveEntitlement,false);
 assert.equal(r.effectiveEntitlement({tenantId:'org-alpha',actorSubject:'oidc:subject-alpha'}).canSend,false);
});
test('payment state handles pending, failure, reversed and disputed without cross-product or contradictory entitlement',t=>{
 const {registry:r,privateKey}=fixture(t);create(r,'org-alpha','oidc:subject-alpha');
 r.openSubscription({tenantId:'org-alpha',actorSubject:'oidc:subject-alpha',planCode:'LAUNCH',orderReference:'MMF-ORDER-ABCDEF12345'});
 const p=receipt(claim({status:'pending'}),privateKey);assert.equal(r.ingestSignedPayment(p).status,'PENDING');
 const paid=receipt(claim(),privateKey);r.ingestSignedPayment(paid);
 const disputed=receipt(claim({status:'disputed'}),privateKey);assert.equal(r.ingestSignedPayment(disputed).status,'DISPUTED');
 assert.throws(()=>r.ingestSignedPayment(paid),/MMF_PLATFORM_DENIED/);
 assert.equal(r.effectiveEntitlement({tenantId:'org-alpha',actorSubject:'oidc:subject-alpha'}).canSend,false);
 const refOrder='MMF-ORDER-SECOND123456';r.openSubscription({tenantId:'org-alpha',actorSubject:'oidc:subject-alpha',planCode:'GROWTH',orderReference:refOrder});
 assert.equal(r.ingestSignedPayment(receipt(claim({order:refOrder,plan:'GROWTH',amount:29900,status:'failed',ref:'p-2'}),privateKey)).status,'FAILED');
 assert.throws(()=>r.ingestSignedPayment(receipt(claim({order:refOrder,plan:'GROWTH',amount:29900,status:'paid',ref:'p-2'}),privateKey)),/MMF_PLATFORM_DENIED/);
 const cancelOrder='MMF-ORDER-CANCEL123456';r.openSubscription({tenantId:'org-alpha',actorSubject:'oidc:subject-alpha',planCode:'LAUNCH',orderReference:cancelOrder});
 assert.equal(r.ingestSignedPayment(receipt(claim({order:cancelOrder,ref:'p-4',status:'cancelled'}),privateKey)).status,'CANCELLED');
 assert.throws(()=>r.ingestSignedPayment(receipt(claim({order:cancelOrder,ref:'p-4',status:'paid'}),privateKey)),/MMF_PLATFORM_DENIED/);
 const rOrder='MMF-ORDER-THIRD123456';r.openSubscription({tenantId:'org-alpha',actorSubject:'oidc:subject-alpha',planCode:'LAUNCH',orderReference:rOrder});
 r.ingestSignedPayment(receipt(claim({order:rOrder,ref:'p-3'}),privateKey));
 assert.equal(r.ingestSignedPayment(receipt(claim({order:rOrder,status:'reversed',ref:'p-3'}),privateKey)).status,'REVERSED');
 assert.throws(()=>r.ingestSignedPayment({claim:{...claim({order:rOrder,ref:'p-3'}),product:'mft-fmi-billing'},signature:'a'.repeat(86)}),/MMF_PLATFORM_DENIED/);
});
test('usage metering is tenant-scoped, idempotent and capped; never unlocks a production email send',t=>{
 const {registry:r}=fixture(t);create(r,'org-alpha','oidc:subject-alpha');create(r,'org-beta','oidc:subject-beta');
 const a=r.meterStageEvent({tenantId:'org-alpha',actorSubject:'oidc:subject-alpha',idempotencyKey:'EVENT-123456789',kind:'governed'});
 assert.equal(a.count,1);assert.equal(a.duplicate,false);assert.equal(a.productionDeliveryEnabled,false);
 assert.equal(r.meterStageEvent({tenantId:'org-alpha',actorSubject:'oidc:subject-alpha',idempotencyKey:'EVENT-123456789',kind:'governed'}).duplicate,true);
 assert.throws(()=>r.meterStageEvent({tenantId:'org-alpha',actorSubject:'oidc:subject-alpha',idempotencyKey:'EVENT-123456789',kind:'extra'}),/MMF_PLATFORM_DENIED/);
 assert.equal(r.getUsage({tenantId:'org-beta',actorSubject:'oidc:subject-beta'}).count,0);
 assert.equal(r.getUsage({tenantId:'org-alpha',actorSubject:'oidc:subject-alpha'}).count,1);
});
test('production flags or unsigned/browser-provided paid assertion always fail closed',t=>{
 assert.throws(()=>new CommercialPlatform(new DatabaseSync(':memory:'),{apiPepper:Buffer.alloc(32),trustedPaymentKey:generateKeyPairSync('ed25519').publicKey,env:{MMF_COMMERCE_ENABLED:'true',MMF_REAL_SEND_ENABLED:'false',MMF_CUSTOMER_API_ENABLED:'false'}}),/MMF_PLATFORM_DENIED/);
 const {registry:r}=fixture(t);create(r,'org-alpha','oidc:subject-alpha');
 r.openSubscription({tenantId:'org-alpha',actorSubject:'oidc:subject-alpha',planCode:'LAUNCH',orderReference:'MMF-ORDER-ABCDEF12345'});
 assert.throws(()=>r.ingestSignedPayment({claim:claim(),signature:'fake'}),/MMF_PLATFORM_DENIED/);
 assert.throws(()=>r.ingestSignedPayment(receipt({...claim(),currency:'ZWL'},generateKeyPairSync('ed25519').privateKey)),/MMF_PLATFORM_DENIED/);
});