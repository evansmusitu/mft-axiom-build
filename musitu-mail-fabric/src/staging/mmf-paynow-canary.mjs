/** Isolated, deny-all Cloudflare infrastructure canary. No payment, mail, secrets, services or egress. */
const HEADERS={
 'content-type':'application/json; charset=utf-8',
 'cache-control':'no-store',
 'x-content-type-options':'nosniff',
 'referrer-policy':'no-referrer'
};
export default {
 fetch(_request){
  return new Response(JSON.stringify({
   error:'MMF_PAYMENT_INTEGRATION_DISABLED',
   paymentsEnabled:false,
   customerEmailEnabled:false,
   syntheticCanary:true
  }),{status:503,headers:HEADERS});
 }
};