import test from 'node:test';
import assert from 'node:assert/strict';
import {stagingIdentityRoute} from '../customer_control_plane/staging_identity_frontdoor.mjs';

const origin = 'https://axiom-customer-staging.mftintelligence.com';
const issuer = 'https://musitu-whatsapp-staging-mpqgsc.eu1.zitadel.cloud';
const admitted = (response) => ({
 CUSTOMER_IDP_STAGING_ADMITTED:'qualified_staging',
 CUSTOMER_IDP_ROUTE_ADMITTED:'qualified_private_binding',
 CUSTOMER_IDP_BROWSER:{fetch:async () => response}
});
const browser = () => new Request(origin+'/auth/start');
const cookie = '__Host-axiom_login='+('a'.repeat(43))+'; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=300';
const authorize = () => {
 const u=new URL(issuer+'/oauth/v2/authorize');
 u.search=new URLSearchParams({
  client_id:'398295490183089708',
  redirect_uri:origin+'/auth/callback',
  response_type:'code',scope:'openid email',state:'s'.repeat(43),nonce:'n'.repeat(43),
  code_challenge:'c'.repeat(43),code_challenge_method:'S256',max_age:'300'
 }).toString();
 return u.href;
};

test('upstream identity errors cannot issue cookies, redirects or disclose private error details',async()=>{
 for(const status of [400,401,503]){
  const upstream=new Response('private provider token=never-reflect',{status,headers:{
   'set-cookie':'__Host-axiom_customer='+('z'.repeat(43))+'; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=300',
   location:'https://evil.invalid/redirect',
   'access-control-allow-origin':'*',
   'x-private-provider':'secret',
   'content-type':'text/plain'
  }});
  const result=await stagingIdentityRoute(browser(),admitted(upstream));
  assert.equal(result.status,status);
  assert.equal(result.headers.get('set-cookie'),null,'error cannot issue a browser session');
  assert.equal(result.headers.get('location'),null,'error cannot redirect');
  assert.equal(result.headers.get('access-control-allow-origin'),null);
  assert.equal(result.headers.get('x-private-provider'),null);
  assert.equal(result.headers.get('cache-control'),'no-store');
  assert.deepEqual(await result.json(),{ok:false,error:'identity_not_qualified'});
 }
});

test('admitted login redirects forward only validated location and host-only cookies',async()=>{
 const upstream=new Response('provider-private-body',{status:303,headers:{
  location:authorize(),'set-cookie':cookie,'cache-control':'public, max-age=3600',
  'access-control-allow-origin':'*','x-provider-internal':'never-leak',refresh:'0;url=https://evil.invalid'
 }});
 const result=await stagingIdentityRoute(browser(),admitted(upstream));
 assert.equal(result.status,303);
 assert.equal(result.headers.get('location'),authorize());
 assert.equal(result.headers.get('set-cookie'),cookie);
 assert.equal(result.headers.get('access-control-allow-origin'),null);
 assert.equal(result.headers.get('x-provider-internal'),null);
 assert.equal(result.headers.get('refresh'),null);
 assert.equal(result.headers.get('cache-control'),'no-store');
 assert.equal(await result.text(),'');
});
