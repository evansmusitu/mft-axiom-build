import test from 'node:test';
import assert from 'node:assert/strict';
import {handle} from '../customer_control_plane/worker.mjs';
import {ZITADEL_STAGING} from '../customer_control_plane/zitadel_provider_tokens_candidate.mjs';

const origin = new URL(ZITADEL_STAGING.redirect_uri).origin;
const db = {prepare(){throw Error('staging_browser_must_not_query_customer_db')}};
const grant = () => ({
  CUSTOMER_DB:db,
  CUSTOMER_IDP_STAGING_ADMITTED:'qualified_staging',
  CUSTOMER_IDP_ROUTE_ADMITTED:'qualified_private_binding'
});
const browser = (path, options = {}) => new Request(origin+path, options);
const expectNoStore = response => assert.equal(response.headers.get('cache-control'),'no-store');

const authorize = () => {
  const u = new URL(ZITADEL_STAGING.issuer+'/oauth/v2/authorize');
  u.search = new URLSearchParams({client_id:ZITADEL_STAGING.client_id,
    redirect_uri:ZITADEL_STAGING.redirect_uri,response_type:'code',scope:'openid email',
    state:'s'.repeat(43),nonce:'n'.repeat(43),code_challenge:'c'.repeat(43),code_challenge_method:'S256',max_age:'300'}).toString();
  return u.href;
};

test('staging sign-in routes through an independently admitted named browser service',async () => {
  const seen=[];
  const env={...grant(), CUSTOMER_IDP_BROWSER:{fetch:async request=>{
    seen.push([request.url,request.method]);
    return new Response('',{status:303,headers:{location:authorize(),
      'set-cookie':'__Host-axiom_login='+('a'.repeat(43))+'; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=300',
      'cache-control':'no-store'}});
  }}};
  const response=await handle(browser('/auth/start'),env);
  assert.equal(response.status,303);
  assert.equal(response.headers.get('location'),authorize());
  expectNoStore(response);
  assert.deepEqual(seen,[[origin+'/auth/start','GET']]);
});

test('staging callback and logout cannot be replaced by legacy login redirect or public identity API',async()=>{
  const seen=[];
  const env={...grant(),CUSTOMER_IDP_BROWSER:{fetch:async request=>{
    seen.push(request.url);
    return new Response('',{status:303,headers:{location:origin+'/',
      'set-cookie':request.url.endsWith('/auth/logout')?'__Host-axiom_customer=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0':'__Host-axiom_customer='+('x'.repeat(43))+'; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=120',
      'cache-control':'no-store'}});
  }}};
  const callback=await handle(browser('/auth/callback?code=opaque&state=opaque',{headers:{cookie:'__Host-axiom_login='+('y'.repeat(43))}}),env);
  assert.equal(callback.status,303);
  const logout=await handle(browser('/auth/logout',{method:'POST',headers:{origin,cookie:'__Host-axiom_customer='+('x'.repeat(43))}}),env);
  assert.equal(logout.status,303);
  assert.deepEqual(seen,[origin+'/auth/callback?code=opaque&state=opaque',origin+'/auth/logout']);
});

test('staging without approved service binding fails closed without invoking legacy login service',async()=>{
  let legacyCalls=0;
  const result=await handle(browser('/auth/start'),{CUSTOMER_DB:db,IDENTITY_LOGIN_QUALIFIED:'qualified_private_binding',
    IDENTITY_LOGIN_SERVICE:{fetch:async()=>{legacyCalls++;return Response.json({authorization_url:'https://example.test'});}}});
  assert.equal(result.status,503);
  assert.equal(legacyCalls,0);
});

test('staging logout requires correct browser method and origin before service invocation',async()=>{
  let calls=0;const env={...grant(),CUSTOMER_IDP_BROWSER:{fetch:async()=>{calls++;return new Response('',{status:303,headers:{location:origin+'/'}});}}};
  for(const request of [browser('/auth/logout'),browser('/auth/logout',{method:'POST'}),browser('/auth/logout',{method:'POST',headers:{origin:'https://evil.test'}})]) {
    const response=await handle(request,env);
    assert.notEqual(response.status,303);
  }
  assert.equal(calls,0);
});

test('wrong-origin service redirect and success body do not become browser login authority',async()=>{
  for(const bad of [new Response('',{status:303,headers:{location:'https://evil.test/capture'}}),new Response('{"verified":true}',{status:200})]){
    const env={...grant(),CUSTOMER_IDP_BROWSER:{fetch:async()=>bad}};
    const r=await handle(browser('/auth/start'),env);
    assert.equal(r.status,502);
    expectNoStore(r);
  }
});

test('other origins and business routes do not acquire staging identity authority',async()=>{
  let calls=0;const env={...grant(),CUSTOMER_IDP_BROWSER:{fetch:async()=>{calls++;throw Error('should-not-call');}}};
  assert.equal((await handle(new Request('https://portal.mftintelligence.com/auth/callback'),env)).status,404);
  const result=await handle(browser('/v1/customer/health'),env);
  assert.equal(result.status,200);
  assert.equal((await result.json()).release_qualified,false);
  assert.equal(calls,0);
});

test('prefix cookies are rejected unless they are host-only and restricted to Path=/ exactly',async()=>{
 const badCookies=[
  '__Host-axiom_login='+('a'.repeat(43))+'; Path=/other; Secure; HttpOnly; SameSite=Lax; Max-Age=300',
  '__Host-axiom_login='+('a'.repeat(43))+'; Path=/; Domain=mftintelligence.com; Secure; HttpOnly; SameSite=Lax; Max-Age=300',
  '__Host-axiom_login='+('a'.repeat(43))+'; Path=/; Secure; SameSite=Lax; Max-Age=300'
 ];
 for(const cookie of badCookies){
  const r=await handle(browser('/auth/start'),{...grant(),CUSTOMER_IDP_BROWSER:{fetch:async()=>new Response('',{
   status:303,headers:{location:authorize(),'set-cookie':cookie}})}});
  assert.equal(r.status,502,cookie);
 }
});

test('staging adapter rejects OAuth parameter injection and ambiguous browser cookies',async()=>{
 const injections=[
  u=>u.searchParams.set('prompt','none'),
  u=>u.searchParams.append('client_id','other-client'),
  u=>u.searchParams.set('max_age','999999'),
  u=>u.searchParams.set('scope','openid evil_scope')
 ];
 for(const mutate of injections){
  const u=new URL(authorize());u.searchParams.set('max_age','300');mutate(u);
  const env={...grant(),CUSTOMER_IDP_BROWSER:{fetch:async()=>new Response('',{status:303,
   headers:{location:u.href,'set-cookie':'__Host-axiom_login='+('a'.repeat(43))+'; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=300'}})}};
  assert.equal((await handle(browser('/auth/start'),env)).status,502,mutate.toString());
 }
 const cookie='__Host-axiom_login='+('a'.repeat(43))+'; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=300';
 const h=new Headers({location:authorize()});h.append('set-cookie',cookie);h.append('set-cookie',cookie);
 const r=await handle(browser('/auth/start'),{...grant(),CUSTOMER_IDP_BROWSER:{fetch:async()=>new Response('',{status:303,headers:h})}});
 assert.equal(r.status,502);
});

test('a second cookie Path attribute cannot override host-only cookie scope',async()=>{
 const cookie='__Host-axiom_login='+('a'.repeat(43))+'; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=300; Path=/other';
 const r=await handle(browser('/auth/start'),{...grant(),CUSTOMER_IDP_BROWSER:{fetch:async()=>new Response('',{
  status:303,headers:{location:authorize(),'set-cookie':cookie}})}});
 assert.equal(r.status,502);
});
