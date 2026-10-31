import test from 'node:test';
import assert from 'node:assert/strict';
import {createStageHandler} from './stage.js';

// Pure in-process adversarial tests: no payment, actual database reads or user records.
const KEYS=['STORE_NEON_STAGING_ONLY','STORE_CHECKOUT_ENABLED','STORE_CALLBACKS_CERTIFIED','STORE_PAYNOW_ID','STORE_PAYNOW_INTEGRATION_KEY','STORE_NEON_DATABASE_URL','STORE_PAYOUTS_ENABLED','STORE_ENTITLEMENTS_ENABLED'];
const DB='postgresql://musitu_store_v2_gateway:'+'a'.repeat(64)+'@ep-shiny-sea-b5ub1n0n.c-7.us-east-2.aws.neon.tech/musitu_store_v2_staging?sslmode=require';
const good={db:'musitu_store_v2_staging',role_name:'musitu_store_v2_gateway',elevated:false,store_tables:4,product_count:0,order_count:0,review_count:0,token_count:0,role_superuser:false,role_can_createdb:false,role_can_createrole:false,role_can_bypassrls:false,role_can_login:true};
async function invoke(row=good, overrides={}){
 const snapshot=Object.fromEntries(KEYS.map(k=>[k,process.env[k]]));
 for(const k of KEYS) delete process.env[k];
 Object.assign(process.env,{STORE_NEON_STAGING_ONLY:'true',STORE_CHECKOUT_ENABLED:'false',STORE_CALLBACKS_CERTIFIED:'false',STORE_NEON_DATABASE_URL:DB},overrides);
 const res={headers:{},setHeader(k,v){this.headers[k]=v;return this},status(n){this.code=n;return this},json(o){this.body=o;return this}};
 try{await createStageHandler({probe:async()=>({rowCount:1,rows:[row]})})({method:'GET'},res);return res}
 finally{for(const k of KEYS){if(snapshot[k]===undefined) delete process.env[k];else process.env[k]=snapshot[k];}}
}
test('staging canary refuses privileged gateway roles and seeded customer tokens',async()=>{
 for(const patch of [{role_superuser:true},{role_can_createdb:true},{role_can_createrole:true},{role_can_bypassrls:true},{role_can_login:false},{token_count:1}]){
  const result=await invoke({...good,...patch});
  assert.equal(result.code,503,JSON.stringify(patch));
  assert.equal(result.body.code,'stage_database_not_qualified');
 }
});
test('staging canary refuses attempts to turn on entitlements or payouts',async()=>{
 for(const overrides of [{STORE_PAYOUTS_ENABLED:'true'},{STORE_ENTITLEMENTS_ENABLED:'true'},{STORE_PAYOUTS_ENABLED:'1'},{STORE_ENTITLEMENTS_ENABLED:'yes'}]){
  const result=await invoke(good,overrides);
  assert.equal(result.code,503,JSON.stringify(overrides));
  assert.equal(result.body.code,'stage_gate_closed');
 }
});
test('minimum privilege, zero-data canary remains read-only and disabled',async()=>{
 const result=await invoke();
 assert.equal(result.code,200);assert.equal(result.body.code,'stage_db_connected_disabled');
 for(const k of ['checkout_enabled','callbacks_certified','payments_enabled','entitlement_granted','payout_authorized'])assert.equal(result.body[k],false);
 assert.equal(result.headers['Cache-Control'],'no-store, private');
});
