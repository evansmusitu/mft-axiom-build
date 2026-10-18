import test from 'node:test';
import assert from 'node:assert/strict';
import {endBusinessSession} from '../src/dashboard/logout.mjs';
import {logoutResponse} from '../src/staging/identity.mjs';
test('browser logout uses same-origin POST without following provider redirects inside fetch',async()=>{
 let navigated;
 const redirect='https://synthetic.zitadel.cloud/oidc/v1/end_session?state=synthetic';
 await endBusinessSession({request:async(url,options)=>{assert.equal(url,'/auth/logout');assert.equal(options.method,'POST');assert.equal(options.credentials,'same-origin');assert.equal(options.redirect,'error');assert.equal(options.headers.accept,'application/json');return Response.json({redirect});},navigate:value=>{navigated=value;}});
 assert.equal(navigated,redirect);
 for(const response of [Response.json({error:'denied'},{status:403}),Response.json({redirect:'javascript:private-value'}),Response.json({redirect:'https://user:private-value@synthetic.zitadel.cloud/'})])await assert.rejects(endBusinessSession({request:async()=>response,navigate:()=>assert.fail('Rejected logout must not navigate')}));
});
test('logout JSON response preserves revocation cookies and privacy headers without an HTTP redirect',async()=>{
 const location='https://synthetic.zitadel.cloud/oidc/v1/end_session?state=synthetic';
 const headers=()=>{const h=new Headers({location,'cache-control':'no-store','referrer-policy':'no-referrer'});h.append('set-cookie','__Host-musitu-session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');h.append('set-cookie','__Host-musitu-flow=synthetic-encrypted-flow; Path=/; HttpOnly; Secure; SameSite=Lax');return h;};
 const r=logoutResponse(new Request('https://app.example.invalid/auth/logout',{headers:{accept:'application/json'}}),headers());
 assert.equal(r.status,200);assert.equal(r.headers.get('location'),null);assert.deepEqual(await r.json(),{redirect:location});assert.equal(r.headers.getSetCookie().length,2);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('referrer-policy'),'no-referrer');
 const legacy=logoutResponse(new Request('https://app.example.invalid/auth/logout'),headers());assert.equal(legacy.status,303);assert.equal(legacy.headers.get('location'),location);
});
