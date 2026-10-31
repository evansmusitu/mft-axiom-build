import test from 'node:test';
import assert from 'node:assert/strict';
import {createPrivateOidcHttpHandler} from './oidc-private-http.mjs';

const origin='https://store-stage.example.org';
const issuer='https://idp.example.org';
const state='a'.repeat(43);
const flowCookie='__Host-musitu_store_flow='+state;
function fixture({failStart=false,failComplete=false,active=true,role='review_security',expired=false,revokeEffective=true}={}){
 const calls={start:0,complete:[],lookup:[],revoke:[]};
 let revoked=false;
 const gate={async start(){calls.start++;if(failStart)throw Error('provider-down');return {authorizationUrl:issuer+'/authorize?response_type=code&state='+state};},
 async complete(url){calls.complete.push(url);if(failComplete)throw Error('bad-id-token');return {sessionId:'operator-session-id-000001',role:'review_security',publisherApproved:false,publicationAuthorized:false,paymentAuthorized:false,payoutAuthorized:false,entitlementGranted:false};}};
 const lookup=async id=>{calls.lookup.push(id);return {active:active&&!revoked,role,expiresAt:expired?120:600,subject:'owner-user-0001'};};
 const revoke=async id=>{calls.revoke.push(id);if(revokeEffective)revoked=true;return true;};
 return {calls,handler:createPrivateOidcHttpHandler({origin,issuerOrigin:issuer,gate,sessionLookup:lookup,sessionRevoke:revoke,now:()=>200000})};
}
const req=(path,options={})=>new Request(origin+path,options);
const cookie='__Host-musitu_store_session=operator-session-id-000001';

// These tests MUST fail (missing module) before implementing the HTTP boundary.
test('start redirects to pinned issuer with a Secure HttpOnly browser-bound flow cookie, no session',async()=>{
 const f=fixture(),r=await f.handler(req('/auth/oidc/start'));
 assert.equal(r.status,303);assert.equal(r.headers.get('location'),issuer+'/authorize?response_type=code&state='+state);
 assert.equal(r.headers.get('set-cookie'),flowCookie+'; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=300');
 assert.equal(r.headers.get('cache-control'),'no-store');
 assert.equal(r.headers.get('referrer-policy'),'no-referrer');
 assert.equal(f.calls.start,1);
});
test('callback sets Secure HttpOnly host-only Lax session, and introspection needs server-side authorization',async()=>{
 const f=fixture();const u='/auth/oidc/callback?code=valid-code-123&state='+state+'&iss='+encodeURIComponent(issuer);
 const result=await f.handler(req(u,{headers:{cookie:flowCookie}}));
 assert.equal(result.status,303);assert.equal(result.headers.get('location'),origin+'/auth/session');
 assert.deepEqual(result.headers.getSetCookie(),[
  '__Host-musitu_store_session=operator-session-id-000001; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=900',
  '__Host-musitu_store_flow=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0']);
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
 const denied=await f.handler(req('/auth/oidc/callback?code=secret&state='+state+'&iss='+encodeURIComponent(issuer),{headers:{cookie:flowCookie}}));assert.equal(denied.status,401);assert.ok(!(await denied.text()).includes('bad-id-token'));
 const unavailable=fixture({failStart:true});assert.equal((await unavailable.handler(req('/auth/oidc/start'))).status,503);
});


test('callback rejects login CSRF without a browser-bound, host-only flow cookie before provider exchange',async()=>{
 const f=fixture();
 const state='A'.repeat(43);
 const callback='/auth/oidc/callback?code=valid-code-123&state='+state+'&iss='+encodeURIComponent(issuer);
 const r=await f.handler(req(callback));
 assert.equal(r.status,401);
 assert.deepEqual(f.calls.complete,[],'callback must never reach OIDC exchange without browser-specific state');
});

test('cross-browser login injection, mismatched flow, duplicate flow cookie and duplicate state are denied',async()=>{
 const f=fixture(),path='/auth/oidc/callback?code=valid-code-123&state='+state+'&iss='+encodeURIComponent(issuer);
 const attempts=[
  {cookie:'__Host-musitu_store_flow='+('b'.repeat(43))},
  {cookie:flowCookie+'; '+flowCookie},
  {cookie:'__Host-musitu_store_flow=invalid%0d'},
  {cookie:flowCookie, path:path+'&state='+state}
 ];
 for(const a of attempts){
  const r=await f.handler(req(a.path??path,{headers:{cookie:a.cookie}}));
  assert.equal(r.status,401);assert.deepEqual(f.calls.complete,[]);
  assert.match(r.headers.get('set-cookie'),/Max-Age=0$/);
 }
});

test('provider rejection after valid browser flow destroys the flow cookie, never grants a session',async()=>{
 const f=fixture({failComplete:true});
 const r=await f.handler(req('/auth/oidc/callback?code=valid-code-123&state='+state+'&iss='+encodeURIComponent(issuer),{headers:{cookie:flowCookie}}));
 assert.equal(r.status,401);
 assert.equal(f.calls.complete.length,1);
 assert.equal(r.headers.get('set-cookie'),'__Host-musitu_store_flow=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0');
 assert.equal((await r.json()).paymentAuthorized,false);
});

test('unsafe or ambiguous authorization URL state fails closed before browser cookie is issued',async()=>{
 const badGate={start:async()=>({authorizationUrl:issuer+'/authorize?state=bad&state='+state}),complete:async()=>{throw Error('unexpected');}};
 const handler=createPrivateOidcHttpHandler({origin,issuerOrigin:issuer,gate:badGate,sessionLookup:async()=>null,sessionRevoke:async()=>false});
 const r=await handler(req('/auth/oidc/start'));
 assert.equal(r.status,503);
 assert.equal(r.headers.get('set-cookie'),null);
});

// A provider acknowledging the revoke call is not sufficient: require an
// independently observed inactive session before reporting logout success.
test('logout rejects acknowledged but ineffective revocation and never claims success',async()=>{
 const f=fixture({revokeEffective:false});
 const r=await f.handler(req('/auth/logout',{method:'POST',headers:{cookie,origin,'sec-fetch-site':'same-origin'}}));
 assert.equal(r.status,503);
 assert.equal((await r.json()).code,'session_revocation_unavailable');
 assert.deepEqual(f.calls.revoke,['operator-session-id-000001']);
 assert.deepEqual(f.calls.lookup,['operator-session-id-000001']);
 const stillActive=await f.handler(req('/auth/session',{headers:{cookie}}));
 assert.equal(stillActive.status,200);
});

test('successful logout requires independently observed inactive durable session',async()=>{
 const f=fixture();
 const r=await f.handler(req('/auth/logout',{method:'POST',headers:{cookie,origin,'sec-fetch-site':'same-origin'}}));
 assert.equal(r.status,204);
 assert.equal(r.headers.get('set-cookie'),'__Host-musitu_store_session=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0');
 assert.deepEqual(f.calls.revoke,['operator-session-id-000001']);
 assert.deepEqual(f.calls.lookup,['operator-session-id-000001']);
 const inactive=await f.handler(req('/auth/session',{headers:{cookie}}));
 assert.equal(inactive.status,401);
});
