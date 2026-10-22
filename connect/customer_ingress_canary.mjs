/**
 * NONPRODUCTION ONLY: combined authenticated customer-ingress qualification.
 * Never import this adapter into production_worker.mjs.
 */
export async function inspectIsolatedCustomerIngress(_request, _env, _options = {}) {
  return new Response(JSON.stringify({ok:false,error:'CUSTOMER_CANARY_DISABLED'}), {
    status:503, headers:{'content-type':'application/json'},
  });
}
