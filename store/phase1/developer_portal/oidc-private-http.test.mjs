import test from 'node:test';
import assert from 'node:assert/strict';
import {createPrivateOidcHttpHandler} from './oidc-private-http.mjs';

const origin='https://store-stage.example.org';
const issuer='https://idp.example.org';
function fixture({failStart=false,failComplete=false,active=true,role='review_security',expired=false}={}){
 const calls={start:0,complete:[],lookup:[],revoke:[]};
 const gate={async start(){calls.start++;if(failStart)throw Error('provider-down');return {authorizationUrl:issuer+'/authorize?response_type=code&state=synthetic'};},
 async complete(url){calls.complete.push(url);if(failComplete)throw Error('bad-id-token');return {sessionId:'operator-session-id-000001',role:'review_security',publisherApproved:false,publicationAuthorized:false,paymentAuthorized:false,payoutAuthorized:false,entitlementGranted:false};}};
 const lookup=async id=>{calls.lookup.push(id);return {active,role,expiresAt:expired?120:600,subject:'owner-user-0001'};};
 const revoke=async id=>{calls.revoke.push(id);return true;};
 return {calls,handler:createPrivateOidcHttpHandler({origin,issuerOrigin:issuer,gate,sessionLookup:lookup,sessionRevoke:revoke,now:()=>200000})};
}
const req=(path,options={})=>new Request(origin+path,options);
const cookie='__Host-musitu_store_session=operator-session-id-000001';

// These tests MUST fail (missing module) before implementing the HTTP boundary.
test('start safely redirects to pinned issuer, with no session cookie or commerce capability',async()=>{
 const f=fixture(),r=await f.handler(req('/auth/oidc/start'));
 assert.equal(r.status,303);assert.equal(r.headers.get('location'),issuer+'/authorize?response_type=code&state=synthetic');
 assert.equal(r.headers.get('set-cookie'),null);
 assert.equal(r.headers.get('cache-control'),'no-store');
 assert.equal(r.headers.get('referrer-policy'),'no-referrer');
 assert.equal(f.calls.start,1);
});
test('callback sets Secure HttpOnly host-only Lax session, and introspection needs server-side authorization',async()=>{
 const f=fixture();const u='/auth/oidc/callback?code=valid-code-123&state=abcd&iss='+encodeURIComponent(issuer);
 const result=await f.handler(req(u));
 assert.equal(result.status,303);assert.equal(result.headers.get('location'),origin+'/auth/session');
 assert.match(result.headers.get('set-cookie'),/^__Host-musitu_store_session=operator-session-id-000001; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=900$/);
 assert.deepEqual(f.calls.complete,[origin+u]);
 const denied=await f.handler(req('/auth/session'));assert.equal(denied.status,401);
 const ok=await f.handler(req('/auth/session',{headers:{cookie}}));assert.equal(ok.status,200);
 const body=await ok.json();assert.equal(body.role,'review_security');assert.equal(body.authenticated,true);
 for(const k of ['paymentAuthorized','payoutAuthorized','publicationAuthorized','entitlementGranted','publisherApproved'])assert.equal(body[k],false);
 assert.equal(f.calls.lookup.length,1);
});
test('expired, revoked, corrupt or duplicated cookie never authorizes',async()=>{
 for(const f of [fixture({active:false}),fixture({expired:true})]){
  const r=await f.handler(req('/auth/session',{headers:{cookie}}));assert.equal(r.status,401);
 }
 const f=fixture();for(const bad of [cookie+'; '+cookie,'__Host-musitu_store_session=invalid%0a','__Host-musitu_store_session=short']){
  const r=await f.handler(req('/auth/session',{headers:{cookie:bad}}));assert.equal(r.status,401);
 }
});
test('logout requires same-origin POST and revokes durable session; clears cookie',async()=>{
 const f=fixture();for(const headers of [{cookie},{cookie,origin:'https://evil.example.org'},{cookie,origin,'sec-fetch-site':'cross-site'}]){
  const r=await f.handler(req('/auth/logout',{method:'POST',headers}));assert.equal(r.status,403);
 }
 assert.equal(f.calls.revoke.length,0);
 const good=await f.handler(req('/auth/logout',{method:'POST',headers:{cookie,origin,'sec-fetch-site':'same-origin'}}));
 assert.equal(good.status,204);assert.deepEqual(f.calls.revoke,['operator-session-id-000001']);
 assert.match(good.headers.get('set-cookie'),/Max-Age=0/);
});
test('no open redirects, origin confusion, non-GET callbacks or exception disclosure',async()=>{
 const f=fixture({failComplete:true});
 for(const r of [new Request('https://evil.example.org/auth/oidc/start'),req('/auth/oidc/start?next=https://evil.example.org'),req('/auth/oidc/callback',{method:'POST'}),req('/auth/oidc/callback?x=1')]){
  const res=await f.handler(r);assert.notEqual(res.status,200);assert.notEqual(res.status,303);
 }
 const denied=await f.handler(req('/auth/oidc/callback?code=secret&state=abc'));assert.equal(denied.status,401);assert.ok(!(await denied.text()).includes('bad-id-token'));
 const unavailable=fixture({failStart:true});assert.equal((await unavailable.handler(req('/auth/oidc/start'))).status,503);
});
