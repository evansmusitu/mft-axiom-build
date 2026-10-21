import test from 'node:test';
import assert from 'node:assert/strict';
import {createStageHandler} from './stage.js';
const vars=['STORE_NEON_STAGING_ONLY','STORE_CHECKOUT_ENABLED',
 'STORE_CALLBACKS_CERTIFIED','STORE_PAYNOW_ID','STORE_PAYNOW_INTEGRATION_KEY',
 'STORE_NEON_DATABASE_URL'];
const DB='postgresql://musitu_store_v2_gateway:'+'a'.repeat(64)
 +'@ep-shiny-sea-b5ub1n0n.c-7.us-east-2.aws.neon.tech/musitu_store_v2_staging?sslmode=require';
function env(options={}){return {STORE_NEON_STAGING_ONLY:'true',
 STORE_CHECKOUT_ENABLED:'false',STORE_CALLBACKS_CERTIFIED:'false',...options};}
async function simulate(values,opts={},method='GET'){
 const old=Object.fromEntries(vars.map(k=>[k,process.env[k]]));
 for(const k of vars)delete process.env[k];
 Object.assign(process.env,values);
 const res={headers:{},setHeader(k,v){this.headers[k]=v;return this},
  status(n){this.code=n;return this},json(v){this.body=v;return this}};
 try{await createStageHandler(opts)({method},res);return res;}
 finally{for(const k of vars){if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];}}
}
test('new staging endpoint has no database credential and fails closed',async()=>{
 let calls=0;const res=await simulate(env(),{probe:async()=>{calls++}});
 assert.equal(res.code,503);assert.equal(res.body.code,'stage_database_not_attached');
 assert.equal(calls,0);assert.equal(res.body.checkout_enabled,false);
 assert.equal(res.body.payout_authorized,false);
 assert.equal(res.headers['Cache-Control'],'no-store, private');
});
test('bad staging flags, callback certification or Paynow secret refuse database reads',async()=>{
 let calls=0;
 for(const v of [
  {STORE_NEON_STAGING_ONLY:'false'},
  {STORE_CHECKOUT_ENABLED:'true'},
  {STORE_CALLBACKS_CERTIFIED:'true'},
  {STORE_PAYNOW_ID:'12345'},
  {STORE_PAYNOW_INTEGRATION_KEY:'fake'}
 ]){
  const res=await simulate(env({...v,STORE_NEON_DATABASE_URL:DB}),{probe:async()=>{calls++}});
  assert.equal(res.code,503);assert.equal(res.body.code,'stage_gate_closed');
 }
 assert.equal(calls,0);
});
test('rejects other database, user or host before query',async()=>{
 let calls=0;
 for(const url of [DB.replace('musitu_store_v2_staging','musitu_whatsapp'),
                    DB.replace('musitu_store_v2_gateway','musitu_store_v2_stage'),
                    DB.replace('neon.tech','attacker.invalid'),
                    DB.replace('sslmode=require','sslmode=disable')]){
  const res=await simulate(env({STORE_NEON_DATABASE_URL:url}),{probe:async()=>{calls++}});
  assert.equal(res.code,503);assert.equal(res.body.code,'stage_db_identity_rejected');
 }
 assert.equal(calls,0);
});
test('protected qualified private neon canary returns no payment authority',async()=>{
 let calls=0;const res=await simulate(env({STORE_NEON_DATABASE_URL:DB}),
  {probe:async()=>{calls++;return {rowCount:1,rows:[{db:'musitu_store_v2_staging',
   role_name:'musitu_store_v2_gateway',elevated:false,store_tables:4,product_count:0,
   order_count:0,review_count:0}]}}});
 assert.equal(calls,1);assert.equal(res.code,200);
 assert.deepEqual(Object.keys(res.body).sort(),[
  'callbacks_certified','checkout_enabled','code','entitlement_granted','ok',
  'payments_enabled','payout_authorized'].sort());
 assert.equal(res.body.payments_enabled,false);
});
test('elevated Neon role, seeded orders and provider error fail closed without leaks',async()=>{
 for(const overrides of [{elevated:true},{order_count:1},{store_tables:3}]){
 const row={db:'musitu_store_v2_staging',role_name:'musitu_store_v2_gateway',
  elevated:false,store_tables:4,product_count:0,order_count:0,review_count:0,...overrides};
 const res=await simulate(env({STORE_NEON_DATABASE_URL:DB}),
  {probe:async()=>({rowCount:1,rows:[row]})});
 assert.equal(res.code,503);assert.equal(res.body.code,'stage_database_not_qualified');
 }
 const failed=await simulate(env({STORE_NEON_DATABASE_URL:DB}),
  {probe:async()=>{throw Error('test-secret-DO-NOT-EXPOSE')}});
 assert.equal(failed.code,503);
 assert.equal(JSON.stringify(failed.body).includes('test-secret'),false);
});
test('non-GET requests are never allowed, including POST checkout attempts',async()=>{
 let calls=0;const r=await simulate(env({STORE_NEON_DATABASE_URL:DB}),
  {probe:async()=>{calls++}},'POST');
 assert.equal(r.code,405);assert.equal(calls,0);
});
