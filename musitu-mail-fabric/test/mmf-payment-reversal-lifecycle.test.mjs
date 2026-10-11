import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {
 draftMmfFmiPaynowQuote,canonicalMmfPaymentClaim,canonicalMmfReversalClaim,
 verifyMmfPaynowReversal
} from '../src/commercial/fmi-paynow-reuse.mjs';
import {
 ensureMmfPaymentTables,openMmfPreparationOrder,reconcileMmfSandboxSettlement,
 reconcileMmfSandboxReversal
} from '../src/commercial/mmf-order-ledger.mjs';
import worker from '../src/commercial/billing-stage-worker.mjs';
const now=Date.UTC(2026,9,11,7,15);
const env={MMF_STAGE_ONLY:'true',MMF_REAL_SEND_ENABLED:'false',MMF_COMMERCE_ENABLED:'false'};
const actor={tenantId:'test_tenant_a',customerReference:'customer:verified:001',contractReference:'contract:approved:001',orderReference:'MMF-TESTORDER001'};
const quote=draftMmfFmiPaynowQuote(actor);
const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const publicKeyPem=publicKey.export({type:'spki',format:'pem'});
const fingerprint=createHash('sha256').update(publicKey.export({type:'spki',format:'der'})).digest('hex');
const paid={schema:'mmf-paynow-settlement-v1',product:quote.product,sku:quote.sku,
 tenantId:quote.tenantId,orderReference:quote.orderReference,contractReference:quote.contractReference,
 provider:'paynow',paymentAuthority:'mft-phase8-external-authority',
 providerReferenceSha256:'9'.repeat(64),amountCents:9900,currency:'USD',
 status:'paid',settledAtMs:now-10000};
const verification={publicKeyPem,fingerprint,nowMs:now,expectedProviderReferenceSha256:paid.providerReferenceSha256,expectedOriginalSettledAtMs:paid.settledAtMs};
const refund={schema:'mmf-paynow-reversal-v1',product:quote.product,sku:quote.sku,
 tenantId:quote.tenantId,orderReference:quote.orderReference,contractReference:quote.contractReference,
 provider:'paynow',paymentAuthority:'mft-phase8-external-authority',
 providerReferenceSha256:'9'.repeat(64),amountCents:9900,currency:'USD',
 status:'refunded',originalSettledAtMs:paid.settledAtMs,reversedAtMs:now};
const signedPaid=(x=paid)=>({claim:x,signature:sign(null,canonicalMmfPaymentClaim(x),privateKey).toString('base64url')});
const signedReversed=(x=refund)=>({claim:x,signature:sign(null,canonicalMmfReversalClaim(x),privateKey).toString('base64url')});
function memory(){const sq=new DatabaseSync(':memory:');return {db:{prepare(sql){return {bind(...values){const statement=sq.prepare(sql);return {async run(){const x=statement.run(...values);return {success:true,meta:{changes:Number(x.changes)}}},async first(){return statement.get(...values)||null}}},async run(){const x=sq.prepare(sql).run();return {success:true,meta:{changes:Number(x.changes)}}}}}},close(){sq.close()}}}
async function paidOrder(db){await ensureMmfPaymentTables(db);await openMmfPreparationOrder({db,quote,env,nowMs:now-20000});return reconcileMmfSandboxSettlement({db,quote,receipt:signedPaid(),verification,env});}
test('offline pinned-key reversal matches exact MMF quote and independently signed settlement; never creates mail or funds',()=>{
 const result=verifyMmfPaynowReversal(signedReversed(),quote,verification);
 assert.equal(result.verified,true);assert.equal(result.status,'REVERSAL_EVIDENCE_ONLY_CONTRACT_REVIEW_REQUIRED');
 assert.equal(result.canEnableMailSending,false);assert.equal(result.product,'musitu-mail-fabric');
});
test('paid -> refunded in isolated D1, replay idempotent, never resurrect with duplicate paid event',async()=>{
 const {db,close}=memory();try{
  await paidOrder(db);
  const first=await reconcileMmfSandboxReversal({db,quote,receipt:signedReversed(),verification,env});
  assert.equal(first.status,'REVERSED_SANDBOX');assert.equal(first.idempotent,false);
  assert.equal(first.canAcceptCustomerFunds,false);assert.equal(first.grantsMailSending,false);
  const again=await reconcileMmfSandboxReversal({db,quote,receipt:signedReversed(),verification,env});
  assert.equal(again.idempotent,true);
  await assert.rejects(()=>reconcileMmfSandboxSettlement({db,quote,receipt:signedPaid(),verification,env}),/DENIED/);
  const row=await db.prepare('SELECT state,provider_ref_sha256,reversal_kind FROM mmf_prep_orders WHERE order_reference=?').bind(quote.orderReference).first();
  assert.equal(row.state,'REVERSED_SANDBOX');assert.equal(row.provider_ref_sha256,refund.providerReferenceSha256);assert.equal(row.reversal_kind,'refunded');
  const retry=await openMmfPreparationOrder({db,quote,env,nowMs:now});assert.equal(retry.status,'REVERSED_SANDBOX');
  assert.equal(retry.idempotent,true);
 }finally{close()}
});
test('signed reversal cannot mark PENDING paid or refunded, cannot switch cancellation reason',async()=>{
 const {db,close}=memory();try{
  await ensureMmfPaymentTables(db);await openMmfPreparationOrder({db,quote,env,nowMs:now-10000});
  await assert.rejects(()=>reconcileMmfSandboxReversal({db,quote,receipt:signedReversed(),verification,env}),/DENIED/);
  await reconcileMmfSandboxSettlement({db,quote,receipt:signedPaid(),verification,env});
  await reconcileMmfSandboxReversal({db,quote,receipt:signedReversed(),verification,env});
  await assert.rejects(()=>reconcileMmfSandboxReversal({db,quote,receipt:signedReversed({...refund,status:'chargeback'}),verification,env}),/DENIED/);
 }finally{close()}
});
test('forged, cross-tenant, FMI, mismatched paid reference, future and stale reversal are rejected',()=>{
 for(const wrong of [
  {...refund,product:'musitu-fmi'},{...refund,sku:'PRO'},{...refund,tenantId:'test_tenant_b'},
  {...refund,providerReferenceSha256:'7'.repeat(64)}, {...refund,amountCents:14900},
  {...refund,status:'pending'}, {...refund,reversedAtMs:paid.settledAtMs-1},
  {...refund,reversedAtMs:now+3600000}, {...refund,originalSettledAtMs:0}
 ]){
  let receipt;
  try{receipt=signedReversed(wrong)}catch{receipt={claim:wrong,signature:'x'.repeat(86)}}
  assert.throws(()=>verifyMmfPaynowReversal(receipt,quote,verification),/DENIED/);
 }
 assert.throws(()=>verifyMmfPaynowReversal({...signedReversed(),signature:'x'.repeat(86)},quote,verification),/DENIED/);
 assert.throws(()=>verifyMmfPaynowReversal(signedReversed(),quote,{...verification,fingerprint:'a'.repeat(64)}),/DENIED/);
});
test('stage-only and disabled production flags prevent operator replay from changing financial state',async()=>{
 const {db,close}=memory();try{
  await paidOrder(db);
  for(const wrong of [{},{...env,MMF_COMMERCE_ENABLED:'true'}, {...env,MMF_STAGE_ONLY:'false'}, {...env,MMF_REAL_SEND_ENABLED:'true'}])
   await assert.rejects(()=>reconcileMmfSandboxReversal({db,quote,receipt:signedReversed(),verification,env:wrong}),/DENIED/);
  const row=await db.prepare('SELECT state FROM mmf_prep_orders WHERE order_reference=?').bind(quote.orderReference).first();
  assert.equal(row.state,'PAID_SANDBOX');
 }finally{close()}
});
test('dark stage HTTP only reads refund state; never accepts customer-supplied refund, replay or checkout',async()=>{
 const {db,close}=memory();try{
  await paidOrder(db);
  await reconcileMmfSandboxReversal({db,quote,receipt:signedReversed(),verification,env});
  const config={...env,MMF_PAYMENT_DB:db,MMF_MAIL_SENDING_ENABLED:'false',MMF_BILLING_API_ENABLED:'true',MMF_TENANT_ID:quote.tenantId,MMF_BILLING_OPERATOR_TOKEN:'isolated-stage-access-token-7777777777777777'};
  const h={authorization:'Bearer '+config.MMF_BILLING_OPERATOR_TOKEN};
  const get=await worker.fetch(new Request('https://internal/v1/billing/stage/orders/'+quote.orderReference,{headers:h}),config);
  assert.equal(get.status,200);const response=await get.json();assert.equal(response.status,'REVERSED_SANDBOX');
  assert.equal(response.grantsMailSending,false);assert.equal(response.realProviderSettlementVerified,false);
  const post=await worker.fetch(new Request('https://internal/v1/billing/stage/refunds',{method:'POST',headers:{...h,'content-type':'application/json'},body:JSON.stringify({orderReference:quote.orderReference,status:'paid'})}),config);
  assert.equal(post.status,404);
 }finally{close()}
});
