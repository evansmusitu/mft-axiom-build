// MUSITU AXIOM exact-host staging reachability gate. NOT a login service.
// This Worker deliberately grants ZERO customer/session/OAuth authority.
const HOST = 'axiom-customer-staging.mftintelligence.com';
const noStore = Object.freeze({
  'cache-control': 'no-store, max-age=0',
  'content-type': 'application/json; charset=utf-8',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
});
function answer(status, body) {
  return new Response(JSON.stringify(body), { status, headers: noStore });
}
export default {
  async fetch(request) {
    let url;
    try { url = new URL(request.url); }
    catch { return answer(400, { ok:false, error:'invalid_request' }); }
    if (url.protocol !== 'https:' || url.hostname !== HOST || url.port || url.username || url.password) {
      return answer(421, { ok:false, error:'host_not_admitted' });
    }
    if (request.method === 'GET' && url.pathname === '/_health' && !url.search && !url.hash) {
      return answer(200, {
        ok:true,
        service:'musitu-axiom-customer-staging',
        stage:'host_route_only',
        identity_live_qualified:false,
        customer_ownership_qualified:false,
        oauth_upgrade_qualified:false,
        release_qualified:false,
      });
    }
    if (url.pathname.startsWith('/auth/') || url.pathname.startsWith('/v1/customer/')) {
      return answer(503, { ok:false, error:'identity_service_not_qualified', release_qualified:false });
    }
    return answer(404, { ok:false, error:'not_found' });
  },
};
