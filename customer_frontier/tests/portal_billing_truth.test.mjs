import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {AXIOMCustomerAdapter} from '../customer_control_plane/browser_adapter.mjs';
import {handle} from '../customer_control_plane/worker.mjs';
import {openTestDB} from '../customer_control_plane/sqlite_d1_test_adapter.mjs';
import {execute,one} from '../customer_control_plane/ledger.mjs';
const dir=dirname(fileURLToPath(import.meta.url)),schema=resolve(dir,'../customer_control_plane/schema.sql');
const products=[
 {id:'developer',price_id:'axiom-developer-monthly',amount_cents:1900,currency:'USD',monthly_unit_limit:1000},
 {id:'pro',price_id:'axiom-pro-monthly',amount_cents:4900,currency:'USD',monthly_unit_limit:5000},
 {id:'enterprise',price_id:'axiom-enterprise-monthly',amount_cents:14900,currency:'USD',monthly_unit_limit:25000},
];
const health=()=>({ok:true,service:'MUSITU Axiom Billing Ingress',catalog_configured:true,checkout_enabled:true,live_money_certified:false,provider:'paynow',d1:true,authority_reachable:true,transport_bound:true});
const catalog=()=>({ok:true,currency:'USD',billing_period:'30_days',live_money_certified:false,plans:products.map(x=>({...x}))});
async function setup(role='owner'){
 const db=openTestDB(schema);
 await execute(db,"INSERT INTO tenants(id,name) VALUES('tenant','Personal')");
 await execute(db,"INSERT INTO identities(id,issuer,external_sub) VALUES('u','https://example.invalid','subject')");
 await execute(db,"INSERT INTO memberships(tenant_id,identity_id,role) VALUES('tenant','u',?)",role);
 return db;
}
const env=(db,opts={})=>({
 CUSTOMER_DB:db,
 IDENTITY_VERIFIER:{fetch:async()=>Response.json({authenticated:true,issuer:'https://example.invalid',subject:'subject',tenant_id:'tenant',audience:'customer-control-plane'})},
 READONLY_BILLING_BRIDGE:'qualified_readonly',
 LIVE_AXIOM_BILLING:{fetch:async req=>{
  assert.equal(req.method,'GET');assert.equal(new URL(req.url).origin,'https://payments.mftintelligence.com');
  return Response.json(req.url.endsWith('/healthz')?health():catalog());
 }},
 ...opts
});
const get=()=>new Request('https://localhost/v1/customer/billing/truth',{method:'GET'});
test('owner can inspect existing Paynow pricing but no settlement claims',async()=>{
 const db=await setup();try{
  const r=await handle(get(),env(db));assert.equal(r.status,200);const j=await r.json();
  assert.equal(j.plans.length,3);assert.equal(j.plans[0].amount_cents,1900);
  assert.equal(j.real_settlement_verified,false);assert.equal(j.entitlements_created,false);
  assert.equal(j.proof_level,'PUBLIC_HEALTH_AND_CATALOG_ONLY');
  assert.equal((await one(db,'SELECT COUNT(*) n FROM orders')).n,0);
 }finally{db.close()}
});
test('member cannot inspect billing catalog even with valid provider binding',async()=>{
 const db=await setup('member');try{const r=await handle(get(),env(db));assert.equal(r.status,403)}finally{db.close()}
});
test('missing or unqualified service binding yields 503 without orders',async()=>{
 const db=await setup();try{
  for(const override of [{LIVE_AXIOM_BILLING:null},{READONLY_BILLING_BRIDGE:'false'}]){
   const r=await handle(get(),env(db,override));assert.equal(r.status,503);
  }
  assert.equal((await one(db,'SELECT COUNT(*) n FROM orders')).n,0);
 }finally{db.close()}
});
test('provider catalog mismatch blocks readback, does not enable purchase',async()=>{
 const db=await setup();const evil=catalog();evil.plans[1].amount_cents=1;
 try{const r=await handle(get(),env(db,{LIVE_AXIOM_BILLING:{fetch:async req=>Response.json(req.url.endsWith('/healthz')?health():evil)}}));assert.equal(r.status,503);assert.equal((await one(db,'SELECT COUNT(*) n FROM orders')).n,0)}
 finally{db.close()}
});
test('browser adapter uses only credentialed same-origin GET with no raw tokens',async()=>{
 const adapter=new AXIOMCustomerAdapter();const observed=[];const old=globalThis.fetch;
 try{
  globalThis.fetch=async (url,options)=>{observed.push({url,options});return Response.json({ok:true,plans:[]})};
  await adapter.getLiveBillingTruth();
  assert.equal(observed.length,1);
  assert.equal(observed[0].url,'/v1/customer/billing/truth');
  assert.equal(observed[0].options.method,'GET');
  assert.equal(observed[0].options.credentials,'same-origin');
  assert.equal(observed[0].options.redirect,'error');
  assert.equal(observed[0].options.cache,'no-store');
  assert.equal(observed[0].options.body,undefined);
  assert.ok(!('authorization' in observed[0].options.headers));
 }finally{globalThis.fetch=old}
});
test('standalone portal has read-only provider catalog and no checkout invocation',()=>{
 const src=readFileSync(resolve(dir,'../standalone_portal/portal.js'),'utf8');
 assert.ok(src.includes('api.getLiveBillingTruth()'));
 assert.ok(src.includes('Existing Paynow plan catalog'));
 assert.ok(src.includes('No successful customer payment'));
 const functionStart=src.indexOf('async function viewBilling(');
 const functionEnd=src.indexOf('async function viewProjects(',functionStart);
 const display=src.slice(functionStart,functionEnd);
 assert.ok(!display.includes('api.createOrder('));
 assert.ok(!display.includes('window.location'));
});
