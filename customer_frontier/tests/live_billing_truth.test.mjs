import {test} from 'node:test';
import assert from 'node:assert/strict';
import {getLiveBillingTruth,EXPECTED_PLANS} from '../customer_control_plane/live_billing_truth.mjs';
const health=()=>({ok:true,service:'MUSITU Axiom Billing Ingress',catalog_configured:true,checkout_enabled:true,live_money_certified:false,provider:'paynow',d1:true,authority_reachable:true,transport_bound:true});
const catalog=()=>({ok:true,currency:'USD',billing_period:'30_days',live_money_certified:false,plans:EXPECTED_PLANS.map(x=>({...x}))});
const env=(h=health(),c=catalog(),extra={})=>({READONLY_BILLING_BRIDGE:'qualified_readonly',LIVE_AXIOM_BILLING:{fetch:async req=>{assert.equal(req.method,'GET');assert.equal(req.redirect,'error');assert.equal(new URL(req.url).origin,'https://payments.mftintelligence.com');assert.equal(req.headers.get('cookie'),null);return Response.json(req.url.endsWith('/healthz')?h:c)}},...extra});

test('existing Paynow catalog readback cannot claim settlement or entitlement',async()=>{
 const x=await getLiveBillingTruth(env());
 assert.equal(x.plans.length,3);assert.equal(x.plans[0].amount_cents,1900);
 assert.equal(x.plans[1].amount_cents,4900);assert.equal(x.plans[2].amount_cents,14900);
 assert.equal(x.checkout_route_enabled,true);
 assert.equal(x.provider_reports_live_money_certified,false);
 assert.equal(x.real_settlement_verified,false);assert.equal(x.entitlements_created,false);
 assert.equal(x.proof_level,'PUBLIC_HEALTH_AND_CATALOG_ONLY');
});
test('qualification flag alone cannot grant a binding',async()=>{await assert.rejects(getLiveBillingTruth(env(health(),catalog(),{READONLY_BILLING_BRIDGE:'true'})),/billing_binding_not_qualified/);});
test('missing private service binding rejected',async()=>{await assert.rejects(getLiveBillingTruth(env(health(),catalog(),{LIVE_AXIOM_BILLING:null})),/billing_binding_not_qualified/);});
test('price drift rejected',async()=>{const c=catalog();c.plans[0].amount_cents=1;await assert.rejects(getLiveBillingTruth(env(health(),c)),/billing_catalog_drift/);});
test('compute-unit and price-id drift rejected',async()=>{for(const key of ['monthly_unit_limit','price_id']){const c=catalog();c.plans[1][key]=key==='price_id'?'injected':999;await assert.rejects(getLiveBillingTruth(env(health(),c)),/billing_catalog_drift/);}});
test('duplicate plan and currency drift rejected',async()=>{let c=catalog();c.plans[1]=c.plans[0];await assert.rejects(getLiveBillingTruth(env(health(),c)),/billing_catalog_drift/);c=catalog();c.currency='ZWG';await assert.rejects(getLiveBillingTruth(env(health(),c)),/billing_catalog_drift/);});
test('provider and authority health failures rejected',async()=>{for(const change of [{provider:'other'},{d1:false},{authority_reachable:false},{transport_bound:false}])await assert.rejects(getLiveBillingTruth(env({...health(),...change})),/billing_health_not_verified/);});
test('conflicting certification flags rejected',async()=>{await assert.rejects(getLiveBillingTruth(env({...health(),live_money_certified:true},catalog())),/billing_certification_mismatch/);});
test('readback never calls checkout, refund or customer mutation routes',async()=>{const e=env(),calls=[];const f=e.LIVE_AXIOM_BILLING.fetch;e.LIVE_AXIOM_BILLING.fetch=async r=>{calls.push(new URL(r.url).pathname);return f(r)};await getLiveBillingTruth(e);assert.deepEqual(calls.sort(),['/billing/catalog','/billing/healthz']);});
test('upstream HTTP and response-type failure is fail closed',async()=>{const e=env();e.LIVE_AXIOM_BILLING.fetch=async()=>new Response('error',{status:503});await assert.rejects(getLiveBillingTruth(e),/billing_upstream_http_rejected/);e.LIVE_AXIOM_BILLING.fetch=async()=>new Response('ok',{status:200});await assert.rejects(getLiveBillingTruth(e),/billing_upstream_type_rejected/);});
