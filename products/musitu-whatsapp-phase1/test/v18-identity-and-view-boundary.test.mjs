import test from 'node:test';
import assert from 'node:assert/strict';
import {identityConfig,assertActiveIntrospection,assertIdentityFlow,providerLogoutUrl} from '../src/staging/identity-policy.mjs';
import {createScopeFence} from '../src/dashboard/scope-fence.mjs';
const cfg=identityConfig({OIDC_ISSUER:'https://identity.example.invalid/realms/private',OIDC_CLIENT_ID:'musitu-private',OIDC_CLIENT_SECRET:'synthetic-not-a-real-secret',APP_ORIGIN:'https://app.example.invalid'});
test('online introspection fails closed for missing or malformed expiry, revocation and mismatched identities',()=>{
 const claims={sub:'synthetic-staff',exp:2000};const good={active:true,sub:claims.sub,exp:2000};
 assert.doesNotThrow(()=>assertActiveIntrospection(good,claims,cfg,1000));
 for(const bad of [null,{}, {...good,active:false},{...good,active:'true'},{...good,sub:'other-staff'}, {...good,exp:undefined}, {...good,exp:'2000'},{...good,exp:1999},{...good,client_id:'other-client'},{...good,iss:'https://untrusted.invalid'}])assert.throws(()=>assertActiveIntrospection(bad,claims,cfg,1000),/SESSION_REVOKED/);
 assert.throws(()=>assertActiveIntrospection(good,claims,cfg,2000),/SESSION_REVOKED/);
});
test('provider logout is pinned, has an exact callback and never carries session tokens or client secrets',()=>{
 const state='S'.repeat(43),url=new URL(providerLogoutUrl(cfg,state));
 assert.equal(url.origin,'https://identity.example.invalid');assert.equal(url.pathname,'/realms/private/protocol/openid-connect/logout');
 assert.deepEqual([...url.searchParams.keys()],['client_id','post_logout_redirect_uri','state']);
 assert.equal(url.searchParams.get('post_logout_redirect_uri'),'https://app.example.invalid/auth/logged-out');
 assert.equal(url.href.includes(cfg.secret),false);assert.throws(()=>providerLogoutUrl(cfg,'unsafe'),/STATE_REJECTED/);
});
test('logout and login flow purposes cannot be interchanged or returned with another state',()=>{
 const state='S'.repeat(43),flow={purpose:'logout',state};
 assert.doesNotThrow(()=>assertIdentityFlow(flow,'logout',state));
 for(const [purpose,returned] of [['login',state],['logout','T'.repeat(43)],['logout',null]])assert.throws(()=>assertIdentityFlow(flow,purpose,returned),/STATE_REJECTED/);
});
test('late business responses cannot repopulate a changed view, including switching back to the original business',async()=>{
 const fence=createScopeFence();let resolve,records=null;
 const ticket=fence.begin();const pending=new Promise(r=>{resolve=r;}).then(value=>{if(fence.current(ticket))records=value;});
 fence.invalidate(); // A -> B
 fence.invalidate(); // B -> A, still must not accept the first A reply
 resolve({tenantId:'A',body:'private synthetic record'});await pending;
 assert.equal(records,null);
});
test('new requests supersede older replies and logout invalidates pending messages and errors',()=>{
 const fence=createScopeFence(),older=fence.begin(),current=fence.begin();
 assert.equal(fence.current(older),false);assert.equal(fence.current(current),true);
 fence.invalidate();assert.equal(fence.current(current),false);
});
