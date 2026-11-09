import test from 'node:test';
import assert from 'node:assert/strict';
import {verifiedEvent} from '../customer_control_plane/worker.mjs';

// This tests the INTERNAL admission boundary, not a real Paynow receipt.
const liveEnvelope=(evidence,extra={})=>({
 verified:true,production_qualified:true,source:'provider_verifier',
 evidence:{kind:'settlement',eventId:'example-01',provider:'paynow',
  transactionId:'provider-ref-001',orderId:'order-001',amountMinor:1900,
  currency:'USD',...evidence},...extra
});
const attempt=async data=>{
 const calls=[];
 const env={ALLOW_INTERNAL_RECONCILIATION:'qualified_private_binding',
  PROVIDER_VERIFIER:{fetch:async request=>{calls.push(request);return Response.json(data);}}};
 const req=new Request('https://axiom-internal/private-reconcile',{
  method:'POST',headers:{'content-type':'application/json'},body:'{"kind":"settlement"}'});
 return {promise:verifiedEvent(req,env),calls};
};
test('Paynow merchant faked-success description cannot be promoted as real settlement',async()=>{
 const {promise,calls}=await attempt(liveEnvelope({provider_status:'Paid (TESTING: Faked Success)'}));
 await assert.rejects(promise,/provider_test_mode_denied|provider_not_verified/);
 assert.equal(calls.length,1);
});
test('explicit sandbox or testing flags must be denied even when wrapper says production_qualified',async()=>{
 for(const payload of [
  liveEnvelope({test_mode:true}),
  liveEnvelope({provider_mode:'sandbox'}),
  liveEnvelope({status_message:'TESTING: Faked Success'}),
  liveEnvelope({}, {test_mode:true}),
  liveEnvelope({}, {provider_status:'Paid (TESTING: Faked Success)'}),
  liveEnvelope({}, {live_money_certified:false}),
 ]){
  const {promise}=await attempt(payload);
  await assert.rejects(promise,/provider_test_mode_denied|provider_not_verified/);
 }
});
test('boundary still accepts mock separately qualified opaque live evidence without implying money was paid',async()=>{
 const evidence={kind:'settlement',provider:'paynow',provider_status:'Paid',
  eventId:'example-01',transactionId:'provider-ref-001',orderId:'order-001',
  amountMinor:1900,currency:'USD'};
 const {promise}=await attempt(liveEnvelope(evidence,{live_money_certified:true}));
 const returned=await promise;
 assert.deepEqual(returned,evidence);
 // No customer credit ledger is used or mutated by this boundary-level test.
});

test('private reconciliation cannot substitute a different payment provider for Paynow',async()=>{
 for(const provider of ['sandbox-provider','psp','PAYNOW','paynow-test']){
  const {promise}=await attempt(liveEnvelope({provider}));
  await assert.rejects(promise,/provider_identity_denied|provider_not_verified/,
   'only the existing Paynow PSP is an admitted transaction authority');
 }
});

test('synthetic Paynow fixture cannot manufacture settlement even if named provider is Paynow',async()=>{
 for(const evidence of [{synthetic:true},{live_payment:false}]){
  const {promise}=await attempt(liveEnvelope({provider:'paynow',...evidence}));
  await assert.rejects(promise,/provider_test_mode_denied|provider_not_verified/);
 }
});
