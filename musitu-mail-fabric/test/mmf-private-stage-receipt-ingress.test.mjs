import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import worker from '../src/commercial/billing-stage-worker.mjs';
import {certifyMmfPaidViaAuthoritativePoll,certifyMmfRefundViaAuthoritativePoll} from '../src/commercial/paynow-private-authority-candidate.mjs';
import {draftMmfFmiPaynowQuote} from '../src/commercial/fmi-paynow-reuse.mjs';
import {canonicalMmfPaymentClaim,canonicalMmfReversalClaim,MMF_PREPARATION_SKU,SHARED_MUSITU_PAYNOW} from '../src/commercial/fmi-paynow-reuse.mjs';
const {privateKey,publicKey}=generateKeyPairSync('ed25519');
const publicKeyPem=publicKey.export({type:'spki',format:'pem'});
const fingerprint=createHash('sha256').update(publicKey.export({type:'spki',format:'der'})).digest('hex');
const RECEIPT_TOKEN='private-receipt-intake-token-unit-test-20261011-not-live';
const OPERATOR_TOKEN='private-order-management-token-unit-test-20261011';
const quoteFields={customerReference:'customer:approved:123',contractReference:'contract:approved:456',orderReference:'MMF-PAYMENTSINTAKE001'};
const base='https://mmf-private.billing.internal';
const time=()=>Date.now();
const hash='a'.repeat(64);
function connection(){const sqlite=new DatabaseSync(':memory:');const db={prepare(sql){return {bind(...values){const stmt=sqlite.prepare(sql);return {async run(){const x=stmt.run(...values);return {success:true,meta:{changes:Number(x.changes)}}},async first(){return stmt.get(...values)??null}}},async run(){const x=sqlite.prepare(sql).run();return {success:true,meta:{changes:Number(x.changes)}}}}}};return {db,close:()=>sqlite.close()};}
function env(db,tenant='mmf_pilot_a'){return {MMF_STAGE_ONLY:'true',MMF_COMMERCE_ENABLED:'false',MMF_REAL_SEND_ENABLED:'false',MMF_MAIL_SENDING_ENABLED:'false',MMF_BILLING_API_ENABLED:'true',MMF_API_ENABLED:'false',MMF_WEBHOOK_ENABLED:'false',MMF_PAYMENT_DB:db,MMF_TENANT_ID:tenant,MMF_BILLING_OPERATOR_TOKEN:OPERATOR_TOKEN,MMF_STAGE_RECEIPTS_ENABLED:'true',MMF_STAGE_RECEIPT_TOKEN:RECEIPT_TOKEN,MMF_STAGE_AUTHORITY_PUBLIC_KEY_PEM:publicKeyPem,MMF_STAGE_AUTHORITY_FINGERPRINT_SHA256:fingerprint};}
function req(path,data,token=RECEIPT_TOKEN){return new Request(base+path,{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+token},body:JSON.stringify(data)});}
async function call(r,e){const z=await worker.fetch(r,e);return {code:z.status,result:await z.json()};}
const paidClaim=(at=time(),tenant='mmf_pilot_a')=>({schema:'mmf-paynow-settlement-v1',product:MMF_PREPARATION_SKU.product,sku:MMF_PREPARATION_SKU.sku,tenantId:tenant,orderReference:quoteFields.orderReference,contractReference:quoteFields.contractReference,provider:'paynow',paymentAuthority:SHARED_MUSITU_PAYNOW.authorityWorker,providerReferenceSha256:hash,amountCents:9900,currency:'USD',status:'paid',settledAtMs:at});
const refundClaim=(paid,at=time())=>({schema:'mmf-paynow-reversal-v1',product:MMF_PREPARATION_SKU.product,sku:MMF_PREPARATION_SKU.sku,tenantId:paid.tenantId,orderReference:paid.orderReference,contractReference:paid.contractReference,provider:'paynow',paymentAuthority:SHARED_MUSITU_PAYNOW.authorityWorker,providerReferenceSha256:paid.providerReferenceSha256,amountCents:9900,currency:'USD',status:'refunded',originalSettledAtMs:paid.settledAtMs,reversedAtMs:at});
const receipt=(claim)=>({claim,signature:sign(null,claim.schema==='mmf-paynow-settlement-v1'?canonicalMmfPaymentClaim(claim):canonicalMmfReversalClaim(claim),privateKey).toString('base64url')});
async function order(e){return call(req('/v1/billing/stage/orders',quoteFields,OPERATOR_TOKEN),e)}
const evidence=(r)=>({...quoteFields,receipt:r});
const route='/v1/billing/stage/evidence';
test('private HTTP receipt intake independently checks pinned authority evidence, records pending -> paid -> refunded, idempotent and non-resurrecting',async()=>{
 const {db,close}=connection();try{
  const e=env(db);const opened=await order(e);assert.equal(opened.code,201);
  const paid=paidClaim();const payment=receipt(paid);
  const a=await call(req(route,evidence(payment)),e);
  assert.equal(a.code,200);assert.equal(a.result.status,'SANDBOX_SETTLEMENT_RECORD_ONLY');
  assert.equal(a.result.realProviderSettlementVerified,false);assert.equal(a.result.grantsMailSending,false);
  const retry=await call(req(route,evidence(payment)),e);assert.equal(retry.code,200);assert.equal(retry.result.idempotent,true);
  const reverse=receipt(refundClaim(paid));const b=await call(req(route,evidence(reverse)),e);
  assert.equal(b.code,200);assert.equal(b.result.status,'REVERSED_SANDBOX');assert.equal(b.result.actualRefundSubmitted,false);
  assert.equal((await call(req(route,evidence(reverse)),e)).result.idempotent,true);
  const replay=await call(req(route,evidence(payment)),e);assert.notEqual(replay.code,200);
  const read=await call(new Request(base+'/v1/billing/stage/orders/'+quoteFields.orderReference,{headers:{authorization:'Bearer '+OPERATOR_TOKEN}}),e);
  assert.equal(read.code,200);assert.equal(read.result.status,'REVERSED_SANDBOX');
  assert.equal(read.result.canAcceptCustomerFunds,false);
 }finally{close()}
});
test('private receipt boundary rejects wrong token, operator-token substitution, disabled lock and misconfigured signer without write',async()=>{
 const {db,close}=connection();try{
  const e=env(db);await order(e);const data=evidence(receipt(paidClaim()));
  for(const token of [OPERATOR_TOKEN,'invalid-customer-bearer']){
   assert.equal((await call(req(route,data,token),e)).code,401);
  }
  for(const override of [{MMF_STAGE_RECEIPTS_ENABLED:'false'},{MMF_STAGE_AUTHORITY_FINGERPRINT_SHA256:'b'.repeat(64)},
   {MMF_STAGE_AUTHORITY_PUBLIC_KEY_PEM:'not-a-key'},
   {MMF_STAGE_RECEIPT_TOKEN:OPERATOR_TOKEN},{MMF_COMMERCE_ENABLED:'true'},
   {MMF_REAL_SEND_ENABLED:'true'}, {MMF_STAGE_ONLY:'false'}]){
   const trial=await call(req(route,data),{...e,...override});assert.notEqual(trial.code,200,JSON.stringify(override));
  }
  const row=await db.prepare('SELECT state FROM mmf_prep_orders WHERE order_reference=?').bind(quoteFields.orderReference).first();
  assert.equal(row.state,'PENDING');
 }finally{close()}
});
test('private receipt intake rejects forged evidence, wrong tenant and immutable-quote mismatch without changing recorded order',async()=>{
 const {db,close}=connection();try{
  const e=env(db);await order(e);
  const paid=paidClaim();
  for(const requestBody of [
   {...evidence(receipt(paid)),receipt:{...receipt(paid),signature:'forged'}},
   evidence(receipt(paidClaim(time(),'mmf_other_tenant'))),
   {...evidence(receipt(paid)),contractReference:'contract:DIFFERENT:999'},
   {...evidence(receipt(paid)),status:'paid'},
   {...evidence(receipt(paid)),price:1},
   evidence({claim:paid,signature:'bad'})
  ]){
   const response=await call(req(route,requestBody),e);assert.notEqual(response.code,200,JSON.stringify(requestBody));
  }
  const state=await db.prepare('SELECT state FROM mmf_prep_orders WHERE order_reference=?').bind(quoteFields.orderReference).first();
  assert.equal(state.state,'PENDING');
 }finally{close()}
});

// Full isolated HTTP integration: synthetic Paynow wire form -> authenticated
// independent status poll -> signer -> MMF private Worker -> SQLite. Not Paynow.
test('callback + independent emulated provider poll + signed authority evidence + HTTP stage D1 receipt integration',async()=>{
 const {db,close}=connection();try{
  const e=env(db),opened=await order(e);assert.equal(opened.code,201);
  const secret='MMF_FAKE_TEST_PAYNOW_INTEGRATION_KEY_NO_PROVIDER',
   quote=draftMmfFmiPaynowQuote({tenantId:e.MMF_TENANT_ID,...quoteFields}),
   poll='https://www.paynow.co.zw/Interface/CheckPayment/?guid=9f24be04-f4a6-4dff-8ab5-455263ba7b6b';
  function signed(status){
   const fields={reference:quoteFields.orderReference,paynowreference:'TEST-MMF-PROVIDER-01',
    amount:'99.00',status,pollurl:poll};const list=Object.entries(fields);
   const value=createHash('sha512').update(list.map(([,v])=>v).join('')+secret).digest('hex').toUpperCase();
   return new URLSearchParams([...list,['hash',value]]).toString();
  }
  let calls=0;
  function params(status){return {signedCallbackBody:signed(status),quote,integrationKey:secret,
   authoritySignerPrivateKey:privateKey,nowMs:time(),
   fetchPoll:async(url,options)=>{calls++;assert.equal(url,poll);assert.equal(options.method,'POST');
    return new Response(signed(status),{status:200,headers:{'content-type':'application/x-www-form-urlencoded'}});}};}
  const paid=await certifyMmfPaidViaAuthoritativePoll(params('Paid'));
  assert.equal(calls,1);assert.equal(paid.providerPollVerified,true);
  const a=await call(req(route,evidence(paid.receipt)),e);
  assert.equal(a.code,200);assert.equal(a.result.status,'SANDBOX_SETTLEMENT_RECORD_ONLY');
  const prior={providerReferenceSha256:paid.receipt.claim.providerReferenceSha256,
   originalSettledAtMs:paid.receipt.claim.settledAtMs};
  const refunded=await certifyMmfRefundViaAuthoritativePoll({...params('Refunded'),prior});
  assert.equal(calls,2);assert.equal(refunded.actualRefundRequested,false);
  const b=await call(req(route,evidence(refunded.receipt)),e);
  assert.equal(b.code,200);assert.equal(b.result.status,'REVERSED_SANDBOX');
  assert.equal(b.result.grantsMailSending,false);assert.equal(b.result.canAcceptCustomerFunds,false);
  const row=await db.prepare('SELECT state, reversal_kind, provider_ref_sha256 FROM mmf_prep_orders WHERE order_reference=?')
   .bind(quoteFields.orderReference).first();
  assert.equal(row.state,'REVERSED_SANDBOX');
  assert.equal(row.reversal_kind,'refunded');
  assert.equal(row.provider_ref_sha256,paid.receipt.claim.providerReferenceSha256);
 }finally{close()}
});
