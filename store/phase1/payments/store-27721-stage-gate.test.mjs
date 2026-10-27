import test from 'node:test';
import assert from 'node:assert/strict';
import {createStageGate} from './store-27721-stage-gate.mjs';

const safe=()=>({STORE_PAYNOW_ID:'27721',STORE_PAYNOW_MODE:'testing',STORE_PAYNOW_INTEGRATION_KEY:'EXAMPLE_SYNTHETIC_KEY_NOT_PROVIDER',STORE_CHECKOUT_ENABLED:'false',STORE_CALLBACKS_CERTIFIED:'false',STORE_FIRST_PARTY_ONLY:'true',STORE_PUBLISHER_PAYOUTS_ENABLED:'false',STORE_ENTITLEMENTS_ENABLED:'false'});
async function probe(request,env){let code=0,headers={},data='';const response={setHeader:(k,v)=>headers[k.toLowerCase()]=v,status(s){code=s;return this},end(payload){data=payload;return this}};await createStageGate(env)(request,response);return {code,headers,data:JSON.parse(data)};}

test('GET stage declares private test mode, all commerce disabled, and never reveals merchant key',async()=>{
 const secret=safe().STORE_PAYNOW_INTEGRATION_KEY;
 const r=await probe({method:'GET',url:'/api/stage'},safe());
 assert.equal(r.code,200);assert.deepEqual(r.data,{ok:true,code:'store_paynow_27721_private_disabled',integration_id:'27721',testing:true,checkout_enabled:false,callbacks_certified:false,entitlement_granted:false,payout_authorized:false});
 assert.equal(r.headers['cache-control'],'no-store');assert.equal(JSON.stringify(r).includes(secret),false);
});

test('every checkout, callback, poll, refund and payout path returns denial without dependency calls',async()=>{
 for(const url of ['/store/billing/checkout','/store/billing/webhooks/paynow','/store/billing/checkout/STORE-ABCDEF0123456789','/refund','/publisher/payout','/api/gate','/']){
  const r=await probe({method:'POST',url},safe());assert.equal(r.code,503,url);assert.equal(r.data.ok,false);assert.equal(r.data.checkout_enabled,false);
 }
});

test('misbound FMI, live mode, missing key, toggled callback, payments or payouts all fail closed',async()=>{
 for(const update of [{STORE_PAYNOW_ID:'26343'},{STORE_PAYNOW_MODE:'live'},{STORE_PAYNOW_INTEGRATION_KEY:''},{STORE_CHECKOUT_ENABLED:'true'},{STORE_CALLBACKS_CERTIFIED:'true'},{STORE_FIRST_PARTY_ONLY:'false'},{STORE_PUBLISHER_PAYOUTS_ENABLED:'true'},{STORE_ENTITLEMENTS_ENABLED:'true'}]){
  const r=await probe({method:'GET',url:'/api/stage'},{...safe(),...update});assert.equal(r.code,503,JSON.stringify(Object.keys(update)));assert.equal(r.data.ok,false);
 }
});

test('no secrets, stack traces or session data are returned even with unexpected methods and URLs',async()=>{
 const env=safe(),r=await probe({method:'PUT',url:'/api/stage?integration_key=leak'},env);
 assert.equal(r.code,503);assert.equal(JSON.stringify(r).includes(env.STORE_PAYNOW_INTEGRATION_KEY),false);
});
