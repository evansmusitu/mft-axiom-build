// Staging candidate ONLY: read-only private service-binding to existing AXIOM Paynow.
 // Neither public catalog nor health is authentic settlement/bank-credit evidence.
export const EXPECTED_PLANS = Object.freeze([
  Object.freeze({id:'developer',price_id:'axiom-developer-monthly',amount_cents:1900,currency:'USD',monthly_unit_limit:1000}),
  Object.freeze({id:'pro',price_id:'axiom-pro-monthly',amount_cents:4900,currency:'USD',monthly_unit_limit:5000}),
  Object.freeze({id:'enterprise',price_id:'axiom-enterprise-monthly',amount_cents:14900,currency:'USD',monthly_unit_limit:25000}),
]);
const origin='https://payments.mftintelligence.com';
function reject(code){throw new Error(code)}
async function read(service,path){
  let response;
  try {
    response=await service.fetch(new Request(origin+path,{
      method:'GET',redirect:'error',cache:'no-store',headers:{accept:'application/json'}
    }));
  }catch{reject('billing_upstream_unavailable')}
  if(response.status!==200)reject('billing_upstream_http_rejected');
  if(!String(response.headers.get('content-type')||'').toLowerCase().includes('application/json'))reject('billing_upstream_type_rejected');
  const raw=await response.text();
  if(raw.length>16384)reject('billing_upstream_oversized');
  try{return JSON.parse(raw)}catch{reject('billing_upstream_json_invalid')}
}
const exact=(a,b)=>a && a.id===b.id && a.price_id===b.price_id &&
  a.amount_cents===b.amount_cents && a.currency===b.currency &&
  a.monthly_unit_limit===b.monthly_unit_limit;
export async function getLiveBillingTruth(env){
  if(env?.READONLY_BILLING_BRIDGE!=='qualified_readonly' ||
     !env.LIVE_AXIOM_BILLING?.fetch)reject('billing_binding_not_qualified');
  const [health,catalog]=await Promise.all([
    read(env.LIVE_AXIOM_BILLING,'/billing/healthz'),
    read(env.LIVE_AXIOM_BILLING,'/billing/catalog'),
  ]);
  if(health?.ok!==true||health.service!=='MUSITU Axiom Billing Ingress' ||
     health.provider!=='paynow'||health.d1!==true||
     health.catalog_configured!==true||health.authority_reachable!==true||
     health.transport_bound!==true)reject('billing_health_not_verified');
  if(catalog?.ok!==true||catalog.currency!=='USD'||
     catalog.billing_period!=='30_days'||!Array.isArray(catalog.plans)||
     catalog.plans.length!==EXPECTED_PLANS.length||
     EXPECTED_PLANS.some(e=>catalog.plans.filter(x=>x?.id===e.id).length!==1||
       !exact(catalog.plans.find(x=>x?.id===e.id),e)))reject('billing_catalog_drift');
  if(health.live_money_certified!==catalog.live_money_certified)
    reject('billing_certification_mismatch');
  // Reporting provider flags never creates entitlements or independently
  // certifies genuine money settlement, invoices, refunds or tax correctness.
  return Object.freeze({
    ok:true,provider:'paynow',source:'existing_musitu_axiom_billing_ingress',
    plans:EXPECTED_PLANS.map(x=>({...x})),billing_period:'30_days',
    checkout_route_enabled:health.checkout_enabled===true,
    provider_reports_live_money_certified:health.live_money_certified===true,
    proof_level:'PUBLIC_HEALTH_AND_CATALOG_ONLY',
    real_settlement_verified:false,entitlements_created:false,
  });
}
