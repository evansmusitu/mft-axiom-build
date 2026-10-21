import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifyPaynowStatusUpdate,reconcilePaynowPaymentForReview} from './paynow-review.mjs';

const integrationKey='local-disposable-paynow-ci-key-not-a-real-merchant-key';
const pollurl='https://www.paynow.co.zw/Interface/CheckPayment/?guid=ad1a986c-3434-44a4-8f5b-111111111111';
const order={reference:'ORDER-TEST-904',amount:'12.34',pollurl};
function signed(fields={}){
  const values={reference:order.reference,paynowreference:'PAYNOW-FIXTURE-1',
    amount:order.amount,status:'Paid',pollurl,...fields};
  const entries=Object.entries(values);
  const hash=createHash('sha512').update(entries.map(([,v])=>String(v)).join('')+integrationKey,'utf8').digest('hex').toUpperCase();
  return entries.map(([k,v])=>k+'='+encodeURIComponent(v).replaceAll('%20','+')).join('&')+'&hash='+hash;
}
const verify=(body,o={})=>verifyPaynowStatusUpdate({body,integrationKey,order,...o});
test('signed status binds trusted reference/amount/provider transaction and cannot grant entitlement',()=>{
  const v=verify(signed());assert.equal(v.state,'SIGNATURE_VERIFIED_REVIEW_ONLY');
  assert.equal(v.merchantReference,order.reference);assert.equal(v.amount,'12.34');
  assert.equal(v.providerStatus,'Paid');assert.equal(v.providerReference,'PAYNOW-FIXTURE-1');
  assert.equal(v.entitlementGranted,false);assert.equal(v.settled,false);
});
test('tampered status and amount without fresh provider signature are rejected',()=>{
  assert.throws(()=>verify(signed().replace('12.34','12.35')),/hash|signature/i);
  assert.throws(()=>verify(signed().replace('Paid','Refunded')),/hash|signature/i);
});
test('even correctly signed statuses cannot be applied to a different merchant order',()=>{
  assert.throws(()=>verify(signed({reference:'DIFFERENT-ORDER'})),/reference/i);
  assert.throws(()=>verify(signed({amount:'12.35'})),/amount/i);
});
test('duplicate case-insensitive fields cannot override signed state',()=>{
  assert.throws(()=>verify(signed()+'&STATUS=Refunded'),/duplicate/i);
  assert.throws(()=>verify(signed()+'&Hash='+'A'.repeat(128)),/duplicate/i);
});
test('unknown instrument tokens and sensitive fields fail closed',()=>{
  assert.throws(()=>verify(signed({token:'NEVER_STORE_TOKEN'})),/unsupported/i);
});
test('signed callback cannot direct a server to poll an untrusted host',()=>{
  assert.throws(()=>verify(signed({pollurl:'https://attacker.example/Interface/CheckPayment/?guid=abc'})),/poll|host/i);
});
test('malformed encoding, UTF8, empty pair, and oversized callback rejected',()=>{
  assert.throws(()=>verify(signed().replace('Paid','%ZZ')),/encoding/i);
  assert.throws(()=>verify(Buffer.from([0xff,0xfe])),/encoding/i);
  assert.throws(()=>verify(signed()+'&'),/field/i);
  assert.throws(()=>verify('x'.repeat(13000)),/size/i);
});
test('monetary amounts must be canonical exact positive decimals',()=>{
  for(const bad of ['0.00','012.34','12.345'])assert.throws(()=>verify(signed({amount:bad})),/amount/i);
});
test('a Paynow notification alone is never payment settlement or paid-download access',()=>{
  const v=reconcilePaynowPaymentForReview({callbackBody:signed(),integrationKey,order});
  assert.equal(v.state,'AWAITING_INDEPENDENT_PROVIDER_POLL');assert.equal(v.entitlementGranted,false);
  assert.equal(v.publisherSettlementAuthorized,false);
});
test('two matching signed views require continued manual review and no automated payout',()=>{
  const v=reconcilePaynowPaymentForReview({callbackBody:signed(),polledBody:signed(),integrationKey,order});
  assert.equal(v.state,'PAYMENT_CONFIRMED_REVIEW_REQUIRED');assert.equal(v.entitlementGranted,false);
  assert.equal(v.publisherSettlementAuthorized,false);assert.equal(v.refundFinalized,false);
});
test('different transaction IDs cannot be reconciled even with valid signatures',()=>{
  assert.throws(()=>reconcilePaynowPaymentForReview({
    callbackBody:signed(),polledBody:signed({paynowreference:'DIFFERENT-PAYNOW'}),integrationKey,order
  }),/provider reference/i);
});
test('refunded/disputed/awaiting delivery/cancelled never count as settled',()=>{
  for(const status of ['Refunded','Disputed','Cancelled','Awaiting Delivery','Delivered','Created','Sent']){
    const v=reconcilePaynowPaymentForReview({callbackBody:signed({status}),polledBody:signed({status}),integrationKey,order});
    assert.equal(v.state,'PAYMENT_HOLD_REVIEW_REQUIRED');assert.equal(v.entitlementGranted,false);
  }
});
test('stale Paid callback cannot override later signed Refunded provider poll',()=>{
  const v=reconcilePaynowPaymentForReview({callbackBody:signed(),polledBody:signed({status:'Refunded'}),integrationKey,order});
  assert.equal(v.state,'PAYMENT_HOLD_REVIEW_REQUIRED');assert.equal(v.refundFinalized,false);
});
test('wrong merchant key fails closed for otherwise valid signed callback',()=>{
  assert.throws(()=>verify(signed(),{integrationKey:'wrong-merchant-key-fixture'}),/hash|signature/i);
});
