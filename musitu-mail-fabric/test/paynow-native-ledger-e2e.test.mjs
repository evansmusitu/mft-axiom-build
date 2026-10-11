import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {draftMmfFmiPaynowQuote} from '../src/commercial/fmi-paynow-reuse.mjs';
import {certifyMmfPaidViaAuthoritativePoll,certifyMmfRefundViaAuthoritativePoll} from '../src/commercial/paynow-private-authority-candidate.mjs';
import {ensureMmfPaymentTables,openMmfPreparationOrder,reconcileMmfSandboxSettlement,reconcileMmfSandboxReversal} from '../src/commercial/mmf-order-ledger.mjs';
const KEY='ISOLATED_EMULATED_PAYNOW_SECRET_NOT_LIVE';
const now=Date.UTC(2026,9,11,8);
const poll='https://www.paynow.co.zw/Interface/CheckPayment/?guid=9f24be04-f4a6-4dff-8ab5-455263ba7b6b';
const quote=draftMmfFmiPaynowQuote({tenantId:'mail_tenant_a',customerReference:'customer:approved:01',contractReference:'contract:approved:02',orderReference:'MMF-FULLPIPELINE01'});
const env={MMF_STAGE_ONLY:'true',MMF_COMMERCE_ENABLED:'false',MMF_REAL_SEND_ENABLED:'false'};
const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const verification={publicKeyPem:publicKey.export({type:'spki',format:'pem'}),
 fingerprint:createHash('sha256').update(publicKey.export({type:'spki',format:'der'})).digest('hex'),nowMs:now};
function event(status){
 const p={reference:quote.orderReference,amount:'99.00',paynowreference:'PAYNOW-XX1234',status,pollurl:poll},entries=Object.entries(p);
 const hash=createHash('sha512').update(entries.map(([,v])=>v).join('')+KEY).digest('hex').toUpperCase();
 return new URLSearchParams([...entries,['hash',hash]]).toString();
}
function authority(status,other=status){return {signedCallbackBody:event(status),quote,integrationKey:KEY,authoritySignerPrivateKey:privateKey,
 nowMs:now,fetchPoll:async()=>new Response(event(other),{status:200,headers:{'content-type':'application/x-www-form-urlencoded'}})};}
function database(){const sqlite=new DatabaseSync(':memory:');return {close:()=>sqlite.close(),db:{prepare(sql){return {bind(...args){const p=sqlite.prepare(sql);return {
 async first(){return p.get(...args)??null;},async run(){const z=p.run(...args);return {success:true,meta:{changes:Number(z.changes)}};}}},
 async run(){const z=sqlite.prepare(sql).run();return {success:true,meta:{changes:Number(z.changes)}};}}}}};}
test('full isolated Paynow-protocol → poll → trusted authority receipt → MMF D1 pending→paid→refunded with no mail privilege',async()=>{
 const {db,close}=database();try{
  await ensureMmfPaymentTables(db);
  const o=await openMmfPreparationOrder({db,quote,env,nowMs:now});
  assert.equal(o.status,'PENDING');assert.equal(o.externalCheckoutCreated,false);
  const a=await certifyMmfPaidViaAuthoritativePoll(authority('Paid'));
  const paid=await reconcileMmfSandboxSettlement({db,quote,receipt:a.receipt,verification,env});
  assert.equal(paid.status,'SANDBOX_SETTLEMENT_RECORD_ONLY');
  assert.equal(paid.realProviderSettlementVerified,false);assert.equal(paid.grantsMailSending,false);
  assert.equal((await reconcileMmfSandboxSettlement({db,quote,receipt:a.receipt,verification,env})).idempotent,true);
  const prior={originalSettledAtMs:a.receipt.claim.settledAtMs,providerReferenceSha256:a.receipt.claim.providerReferenceSha256};
  const b=await certifyMmfRefundViaAuthoritativePoll({...authority('Refunded'),prior});
  const reversed=await reconcileMmfSandboxReversal({db,quote,receipt:b.receipt,verification,env});
  assert.equal(reversed.status,'REVERSED_SANDBOX');assert.equal(reversed.actualRefundSubmitted,false);
  assert.equal((await reconcileMmfSandboxReversal({db,quote,receipt:b.receipt,verification,env})).idempotent,true);
  await assert.rejects(()=>reconcileMmfSandboxSettlement({db,quote,receipt:a.receipt,verification,env}),/DENIED/);
  const row=await db.prepare('SELECT state,provider_ref_sha256,reversal_kind FROM mmf_prep_orders WHERE order_reference=?').bind(quote.orderReference).first();
  assert.equal(row.state,'REVERSED_SANDBOX');assert.equal(row.reversal_kind,'refunded');
  assert.equal(row.provider_ref_sha256,prior.providerReferenceSha256);
 }finally{close()}
});
test('full isolated Paynow protocol cannot turn Created or Disputed into staged paid entitlement',async()=>{
 const {db,close}=database();try{
  await ensureMmfPaymentTables(db);await openMmfPreparationOrder({db,quote,env,nowMs:now});
  for(const status of ['Created','Disputed','Awaiting Delivery'])
   await assert.rejects(()=>certifyMmfPaidViaAuthoritativePoll(authority(status)),/DENIED/);
  const row=await db.prepare('SELECT state FROM mmf_prep_orders WHERE order_reference=?').bind(quote.orderReference).first();
  assert.equal(row.state,'PENDING');
 }finally{close()}
});
