import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {certifyMmfPaidViaAuthoritativePoll,certifyMmfRefundViaAuthoritativePoll} from '../src/commercial/paynow-private-authority-candidate.mjs';
import {draftMmfFmiPaynowQuote,verifyMmfPaynowSettlement,verifyMmfPaynowReversal} from '../src/commercial/fmi-paynow-reuse.mjs';
const now=Date.UTC(2026,9,11,8),KEY='OFFLINE_FAKE_PAYNOW_INTEGRATION_KEY_NEVER_SHIP',
 quote=draftMmfFmiPaynowQuote({tenantId:'mail_tenant_a',customerReference:'customer:approved:01',contractReference:'contract:approved:02',orderReference:'MMF-PAYNOWQUALIFY01'}),
 poll='https://www.paynow.co.zw/Interface/CheckPayment/?guid=9f24be04-f4a6-4dff-8ab5-455263ba7b6b';
const {publicKey,privateKey}=generateKeyPairSync('ed25519'),
 pub=publicKey.export({type:'spki',format:'pem'}),
 fingerprint=createHash('sha256').update(publicKey.export({type:'spki',format:'der'})).digest('hex');
const verifyOptions={publicKeyPem:pub,fingerprint,nowMs:now};
function payload(status='Paid',extra={}){
 const data={reference:quote.orderReference,amount:'99.00',paynowreference:'P-ABCD-012345',status,pollurl:poll,...extra};
 const entries=Object.entries(data);
 const hash=createHash('sha512').update(entries.map(([,v])=>v).join('')+KEY).digest('hex').toUpperCase();
 return new URLSearchParams([...entries,['hash',hash]]).toString();
}
function setup(callback='Paid',polled='Paid',remote={}){
 const calls=[];const fetchPoll=async(url,options)=>{
  calls.push({url,method:options.method,body:options.body});
  return new Response(payload(polled,remote),{status:200,headers:{'content-type':'application/x-www-form-urlencoded'}});
 };
 return {calls,options:{signedCallbackBody:payload(callback),quote,integrationKey:KEY,
  authoritySignerPrivateKey:privateKey,fetchPoll,nowMs:now}};
}
test('MMF isolated authority candidate: independently polls verified Paynow Paid after valid callback, signs exact MMF receipt',async()=>{
 const {calls,options}=setup();const out=await certifyMmfPaidViaAuthoritativePoll(options);
 assert.equal(calls.length,1);assert.equal(calls[0].url,poll);assert.equal(calls[0].method,'POST');
 assert.equal(out.bankSettlementCertified,false);assert.equal(out.productionReleased,false);
 assert.equal(out.providerPollVerified,true);assert.equal(out.grantsMailSending,false);
 assert.equal(out.receipt.claim.product,'musitu-mail-fabric');assert.equal(out.receipt.claim.amountCents,9900);
 assert.equal(out.receipt.claim.status,'paid');assert.equal(out.receipt.claim.orderReference,quote.orderReference);
 assert.equal(verifyMmfPaynowSettlement(out.receipt,quote,verifyOptions).verified,true);
});
test('MMF isolated authority candidate: never polls if callback unauthenticated or cross-order',async()=>{
 const {calls,options}=setup();
 await assert.rejects(()=>certifyMmfPaidViaAuthoritativePoll({...options,signedCallbackBody:options.signedCallbackBody.replace('99.00','98.00')}),/DENIED/);
 assert.equal(calls.length,0);
 await assert.rejects(()=>certifyMmfPaidViaAuthoritativePoll({...options,signedCallbackBody:payload('Paid',{reference:'FMI-PAYNOW-ORDER'})}),/DENIED/);
 assert.equal(calls.length,0);
});
test('MMF isolated authority candidate: provisional/failed/invalid poll never mints paid receipt',async()=>{
 for(const [cb,po] of [['Paid','Created'],['Paid','Awaiting Delivery'],['Paid','Refunded'],['Created','Paid'],['Disputed','Paid']]){
  const {options}=setup(cb,po);await assert.rejects(()=>certifyMmfPaidViaAuthoritativePoll(options),/DENIED/,`${cb}/${po}`);
 }
 const {options}=setup('Paid','Paid',{amount:'99.01'});
 await assert.rejects(()=>certifyMmfPaidViaAuthoritativePoll(options),/DENIED/);
});
test('MMF isolated authority candidate: bad or oversized provider poll does not produce a signed receipt',async()=>{
 const {options}=setup();
 for(const response of [new Response('Error=Invalid',{status:503}),
  new Response('A'.repeat(5000),{headers:{'content-type':'application/x-www-form-urlencoded'}}),
  new Response(payload(),{headers:{'content-type':'text/html'}})]){
  await assert.rejects(()=>certifyMmfPaidViaAuthoritativePoll({...options,fetchPoll:async()=>response}),/DENIED/);
 }
});
test('MMF isolated authority candidate: only matching authenticated Paynow refunded callback+poll permits signed reversal',async()=>{
 const original=(await certifyMmfPaidViaAuthoritativePoll(setup().options)).receipt;
 const prior={providerReferenceSha256:original.claim.providerReferenceSha256,originalSettledAtMs:original.claim.settledAtMs};
 const {options}=setup('Refunded','Refunded');
 const reversal=await certifyMmfRefundViaAuthoritativePoll({...options,prior});
 assert.equal(reversal.providerPollVerified,true);assert.equal(reversal.bankSettlementCertified,false);
 assert.equal(reversal.receipt.claim.status,'refunded');assert.equal(reversal.actualRefundRequested,false);
 assert.equal(verifyMmfPaynowReversal(reversal.receipt,quote,{
  ...verifyOptions,expectedProviderReferenceSha256:prior.providerReferenceSha256,
  expectedOriginalSettledAtMs:prior.originalSettledAtMs}).verified,true);
});
test('MMF isolated authority candidate: disputed is NOT a refund, wrong prior reference and mismatched paid poll fail closed',async()=>{
 const prior={providerReferenceSha256:'f'.repeat(64),originalSettledAtMs:now-100};
 const {options}=setup('Refunded','Refunded');
 await assert.rejects(()=>certifyMmfRefundViaAuthoritativePoll({...options,prior}),/DENIED/);
 await assert.rejects(()=>certifyMmfRefundViaAuthoritativePoll({...setup('Disputed','Disputed').options,prior}),/DENIED/);
 await assert.rejects(()=>certifyMmfRefundViaAuthoritativePoll({...setup('Refunded','Paid').options,prior}),/DENIED/);
});
