import test from 'node:test';
import assert from 'node:assert/strict';
import { audit } from '../qualification/step1_gate1_free_isolated_account_readonly_20261114.mjs';
const account='a'.repeat(32);
const GETS = [
  `/accounts/${account}`,
  `/accounts/${account}/subscriptions`,
  `/accounts/${account}/d1/database?page=1&per_page=100`
];
const good=path=> {
  if(path===GETS[0]) return {success:true,result:{id:account}};
  if(path===GETS[1]) return {success:true,result:[]};
  if(path===GETS[2]) return {success:true,result:[],result_info:{page:1,per_page:100,count:0,total_count:0}};
  throw new Error('UNEXPECTED_PATH');
};
test('isolated Free account GET-only preflight is non-authorizing, with exact three GETs', async()=>{
  const requested=[];
  const got=await audit({account,token:'synthetic-only',get:async path=>{requested.push(path);return good(path);}});
  assert.deepEqual(requested,GETS);
  assert.equal(got.account_identity_verified,true);
  assert.equal(got.isolation_candidate_empty,true);
  for (const k of ['gate1_closed','step1_closed','step2_authorized','release_authorized','new_account_creation_authorized','d1_creation_authorized','customer_export_authorized','customer_restore_authorized','provider_hard_zero_additional_spend_verified','owner_mfa_independently_qualified']) assert.equal(got[k],false,k);
  assert.equal(got.release_status,'NOT_RELEASE');
  assert.equal(JSON.stringify(got).includes(account),false);
});

const run = (extra={})=>audit({account,token:'synthetic-only',get:async path=>good(path),...extra});
test('original Paid account is never an isolated target', async()=>{
  await assert.rejects(run({account:'93f395f5121954671f92fffa453d6b61'}), /PAID_ORIGINAL_ACCOUNT_REUSE_FORBIDDEN/);
});
test('noncanonical and malformed account ID refuses provider access', async()=>{
  for(const id of [undefined,'','A'.repeat(32),'a'.repeat(31),'../a','a'.repeat(33)])
    await assert.rejects(run({account:id}), /INVALID_OWNER_FREE_ACCOUNT_ID/);
});
test('requires an existing read-only credential', async()=>{
  for(const token of [undefined,null,'','bad\r\ntoken'])
    await assert.rejects(run({token}), /NEW_ACCOUNT_READ_TOKEN_MISSING/);
});
test('missing or wrong account identity does not qualify account', async()=>{
  const x=await run({get:async p=>p===GETS[0]?{success:true,result:{id:'b'.repeat(32)}}:good(p)});
  assert.equal(x.account_identity_verified,false);assert.equal(x.gate1_closed,false);
});
test('one active Paid subscription refuses no-paid-subscription claim', async()=>{
  const x=await run({get:async p=>p===GETS[1]?{success:true,result:[{state:'Paid'}]}:good(p)});
  assert.equal(x.active_paid_subscriptions_absent,false);
});
test('unrecognized subscription status fails closed', async()=>{
  const x=await run({get:async p=>p===GETS[1]?{success:true,result:[{state:'NewFutureBillingStatus'}]}:good(p)});
  assert.equal(x.active_paid_subscriptions_absent,false);
});
test('Trial subscription fails closed', async()=>{
  const x=await run({get:async p=>p===GETS[1]?{success:true,result:[{state:'Trial'}]}:good(p)});
  assert.equal(x.active_paid_subscriptions_absent,false);
});
test('missing subscriptions list does not prove anything', async()=>{
  const x=await run({get:async p=>p===GETS[1]?{success:true,result:null}:good(p)});
  assert.equal(x.active_paid_subscriptions_absent,false);
});
test('incomplete D1 pagination is not an empty account', async()=>{
  const x=await run({get:async p=>p===GETS[2]?{success:true,result:[],result_info:{page:1,per_page:100,count:0,total_count:1}}:good(p)});
  assert.equal(x.d1_catalog_complete,false);assert.equal(x.isolation_candidate_empty,false);
});
test('catalog with one unrelated D1 is not an isolated empty candidate', async()=>{
  const x=await run({get:async p=>p===GETS[2]?{success:true,result:[{uuid:'11111111-1111-1111-1111-111111111111',name:'other'}],result_info:{page:1,per_page:100,count:1,total_count:1}}:good(p)});
  assert.equal(x.d1_catalog_complete,true);assert.equal(x.isolation_candidate_empty,false);
});
test('original source D1 reference in separate account catalog fails closed', async()=>{
  const x=await run({get:async p=>p===GETS[2]?{success:true,result:[{uuid:'ccc473f1-fbb5-4b8d-8a24-45f3696ac10f',name:'source'}],result_info:{page:1,per_page:100,count:1,total_count:1}}:good(p)});
  assert.equal(x.d1_catalog_complete,false);
});
test('duplicate D1 names and UUIDs are not a qualified inventory', async()=>{
  const db={uuid:'11111111-1111-1111-1111-111111111111',name:'same'};
  const x=await run({get:async p=>p===GETS[2]?{success:true,result:[db,db],result_info:{page:1,per_page:100,count:2,total_count:2}}:good(p)});
  assert.equal(x.d1_catalog_complete,false);
});
test('provider 403 stays sanitized', async()=>{
  const x=await run({get:async()=>{throw new Error('SECRET_PROVIDER_BODY_SHOULD_NOT_ECHO');}});
  assert.equal(x.account_metadata_http,'PROVIDER_RESPONSE_UNAVAILABLE');
  assert.ok(!JSON.stringify(x).includes('SECRET_PROVIDER_BODY_SHOULD_NOT_ECHO'));
});
test('unsuccessful provider envelope is not a 200 qualification', async()=>{
  const x=await run({get:async()=>({success:false})});
  assert.equal(x.account_metadata_http,'BAD_PROVIDER_ENVELOPE');assert.equal(x.account_identity_verified,false);
});
test('provider can never set receipt gates via injected data', async()=>{
  const x=await run({get:async p=>({...good(p),gate1_closed:true,release_authorized:true})});
  assert.equal(x.gate1_closed,false);assert.equal(x.release_authorized,false);
});
test('owner MFA and trust anchor cannot be inferred from GET metadata', async()=>{
  const x=await run();
  assert.equal(x.owner_mfa_independently_qualified,false);
  assert.equal(x.owner_public_trust_pins_independently_activated,false);
  assert.equal(x.owner_operation_specific_signed_permission,false);
});
test('not a payment-method, billing or provider D1 spend guarantee', async()=>{
  const x=await run();
  assert.equal(x.owner_free_account_no_payment_method_verified,false);
  assert.equal(x.workers_free_plan_independently_verified,false);
  assert.equal(x.provider_hard_zero_additional_spend_verified,false);
});
test('bad current time is refused', async()=>{
  await assert.rejects(run({now:new Date(NaN)}), /INVALID_CLOCK/);
});
test('path list itself is exactly three, with no SQL endpoint', async()=>{
  const req=[];await run({get:async p=>{req.push(p);return good(p);}});
  assert.deepEqual(req,GETS);assert.ok(req.every(p=>!p.includes('/query')&&!p.includes('/execute')));
});
