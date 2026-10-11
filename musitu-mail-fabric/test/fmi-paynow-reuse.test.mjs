import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash,sign} from 'node:crypto';
import {SHARED_MUSITU_PAYNOW,MMF_PREPARATION_SKU,draftMmfFmiPaynowQuote,
 validatePaynowCheckoutUrl,canonicalMmfPaymentClaim,verifyMmfPaynowSettlement,
 requireMmfSpecificPaymentBinding} from '../src/commercial/fmi-paynow-reuse.mjs';
const data={tenantId:'mail_tenant',customerReference:'customer:verified:001',
 contractReference:'contract:approved:123',orderReference:'MMF-AAAAAAAAAAAA'};
const quote=draftMmfFmiPaynowQuote(data);
const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const pem=publicKey.export({type:'spki',format:'pem'});
const fingerprint=createHash('sha256').update(publicKey.export({type:'spki',format:'der'})).digest('hex');
const nowMs=Date.UTC(2026,9,11,6);
const baseClaim={schema:'mmf-paynow-settlement-v1',product:MMF_PREPARATION_SKU.product,
 sku:MMF_PREPARATION_SKU.sku,tenantId:data.tenantId,orderReference:data.orderReference,
 contractReference:data.contractReference,provider:'paynow',
 paymentAuthority:SHARED_MUSITU_PAYNOW.authorityWorker,
 providerReferenceSha256:'a'.repeat(64),amountCents:9900,currency:'USD',
 status:'paid',settledAtMs:nowMs};
const envelope=claim=>({claim,signature:sign(null,canonicalMmfPaymentClaim(claim),privateKey).toString('base64url')});
const opts={publicKeyPem:pem,fingerprint,nowMs};
test('inherits only historical payment authority and transport, never FMI entitlements',()=>{
 assert.equal(SHARED_MUSITU_PAYNOW.authorityWorker,'mft-phase8-external-authority');
 assert.equal(SHARED_MUSITU_PAYNOW.transportWorker,'mft-paynow-transport-gateway');
 assert.equal(SHARED_MUSITU_PAYNOW.fmiBillingWorker,'mft-fmi-billing');
 assert.equal(SHARED_MUSITU_PAYNOW.newMerchantRegistrationRequired,false);
 assert.equal(SHARED_MUSITU_PAYNOW.existingFmiPlanReuseAllowed,false);
 assert.equal(MMF_PREPARATION_SKU.amountCents,9900);
 assert.equal(quote.grantsMailSending,false);
});
test('MMF quote is own SKU, exact USD amount, one time and no authority to charge',()=>{
 assert.equal(quote.schema,'mmf-shared-paynow-quote-v1');
 assert.equal(quote.sku,'mmf-verified-communications-readiness-v1');
 assert.equal(quote.currency,'USD');
 assert.equal(quote.billingMode,'one_time');
 assert.equal(quote.pricingStatus,'PROPOSAL_NOT_APPROVED');
 assert.equal(quote.contractReference,data.contractReference);
});
test('malformed client requests and FMI-only parameters denied',()=>{
 for(const value of [undefined,{}, {...data,sku:'FOUNDING'}, {...data,amountCents:4900},
  {...data,tenantId:'__proto__'}, {...data,orderReference:'FMI-ABCDEFG'},
  {...data,contractReference:'a'}, JSON.parse('{"__proto__":{},"tenantId":"xxx"}')])
  assert.throws(()=>draftMmfFmiPaynowQuote(value),/DENIED/);
});
test('provider checkout links must be canonical official payment-confirmation paths',()=>{
 assert.equal(validatePaynowCheckoutUrl('https://www.paynow.co.zw/Payment/ConfirmPayment/61311942'),
  'https://www.paynow.co.zw/Payment/ConfirmPayment/61311942');
 for(const url of ['http://paynow.co.zw/Payment/ConfirmPayment/61311942',
  'https://paynow.co.zw.evil.net/Payment/ConfirmPayment/61311942',
  'https://paynow.co.zw@evil.net/Payment/ConfirmPayment/61311942',
  'https://paynow.co.zw/Payment/ConfirmPayment/61311942?next=evil',
  'https://www.paynow.co.zw/Payment/Other/61311942',
  'https://paynow.co.zw:444/Payment/ConfirmPayment/61311942'])
  assert.throws(()=>validatePaynowCheckoutUrl(url),/DENIED/);
});
test('only distinct MMF product authority signed PAID claim is accepted as payment evidence',()=>{
 const v=verifyMmfPaynowSettlement(envelope(baseClaim),quote,opts);
 assert.equal(v.verified,true);
 assert.equal(v.canEnableMailSending,false);
 assert.equal(v.canProvisionFmiPlan,false);
 assert.equal(v.status,'PAYMENT_EVIDENCE_ONLY_CONTRACT_REVIEW_REQUIRED');
});
test('FMI paid intents, pending/cancelled, wrong product/price, wrong order and tampered signatures fail shut',()=>{
 for(const claim of [
  {...baseClaim,product:'musitu-fmi'}, {...baseClaim,sku:'FOUNDING'},
  {...baseClaim,status:'pending'}, {...baseClaim,status:'cancelled'},
  {...baseClaim,currency:'ZWL'}, {...baseClaim,amountCents:4900},
  {...baseClaim,orderReference:'MMF-BBBBBBBBBBBB'},
  {...baseClaim,contractReference:'contract:approved:999'},
  {...baseClaim,provider:'stripe'},
  {...baseClaim,paymentAuthority:'mft-fmi-billing'},
  {...baseClaim,providerReferenceSha256:'unknown'},
  {...baseClaim,settledAtMs:nowMs+99999999}
 ]) {
  let signed;
  try{signed=envelope(claim);}catch{signed={claim,signature:sign(null,Buffer.from(JSON.stringify(claim)),privateKey).toString('base64url')};}
  assert.throws(()=>verifyMmfPaynowSettlement(signed,quote,opts),/DENIED/);
 }
 assert.throws(()=>verifyMmfPaynowSettlement({...envelope(baseClaim),signature:'x'.repeat(86)},quote,opts),/DENIED/);
 assert.throws(()=>verifyMmfPaynowSettlement(envelope(baseClaim),quote,{...opts,fingerprint:'b'.repeat(64)}),/DENIED/);
 assert.throws(()=>verifyMmfPaynowSettlement(envelope(baseClaim),{...quote,amountCents:4900},opts),/DENIED/);
 assert.throws(()=>verifyMmfPaynowSettlement(envelope(baseClaim),{...quote,authorityWorker:'mft-fmi-billing'},opts),/DENIED/);
});
test('bridge is intentionally non-live even with user strings claiming enabled',()=>{
 assert.throws(()=>requireMmfSpecificPaymentBinding({MMF_COMMERCE_ENABLED:'true',MMF_PAYMENT_PRODUCT_BOUND:'true',
  MMF_PAYMENT_AUTHORITY_WORKER:'mft-phase8-external-authority',
  MMF_PAYMENT_TRANSPORT_WORKER:'mft-paynow-transport-gateway',MMF_MAIL_SENDING_ENABLED:'false'}),/DENIED/);
 assert.throws(()=>requireMmfSpecificPaymentBinding({}),/DENIED/);
});
