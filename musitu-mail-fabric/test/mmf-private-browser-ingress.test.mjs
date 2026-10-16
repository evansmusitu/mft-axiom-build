import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {IdentityAdmission,StageCommercialController} from '../src/commercial/mmf-oidc-admission.mjs';
import {CommercialPlatform} from '../src/commercial/mmf-commercial-platform.mjs';
import {PrivateOidcBrowserStage} from '../src/commercial/mmf-oidc-browser-stage.mjs';
import {createMmfPrivateBrowserIngress} from '../src/commercial/mmf-private-browser-ingress.mjs';
const NOW=Date.UTC(2026,9,16,5),issuer='https://oidc.example.net/realms/enterprise';
const origin='https://mmf-private.example.org',clientId='mmf-stage-client';
const env={MMF_REAL_SEND_ENABLED:'false',MMF_COMMERCE_ENABLED:'false',MMF_CUSTOMER_API_ENABLED:'false'};
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const publicJwk=publicKey.export({format:'jwk'});
const fingerprint=createHash('sha256').update(publicKey.export({type:'spki',format:'der'})).digest('hex');
const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
const signNonce=(nonce,sub='owner-one')=>{
 const h=enc({alg:'RS256',typ:'JWT',kid:'stage-rsa-2026'});
 const p=enc({iss:issuer,aud:clientId,sub,nonce,iat:Math.floor((NOW-1000)/1000),exp:Math.floor((NOW+240000)/1000)});
 const msg=h+'.'+p;return msg+'.'+sign('RSA-SHA256',Buffer.from(msg),privateKey).toString('base64url');
};
const defaultHeaders={host:'mmf-private.example.org','sec-fetch-site':'same-origin','sec-fetch-mode':'navigate','sec-fetch-dest':'document'};
const request=(path,{method='GET',headers={},body}={})=>new Request(origin+path,{method,headers:{...defaultHeaders,...headers},...(body===undefined?{}:{body})});
const setCookies=response=>response.headers.getSetCookie();
const namedCookie=(headers,name)=>{
 const match=headers.find(x=>x.startsWith(name+'='));assert.ok(match,'missing '+name);
 return match.split(';',1)[0];
};
const csrfFrom=(cookie)=>cookie.split('=',2)[1];
function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 const admission=new IdentityAdmission(db,{issuer,audience:clientId,keyId:'stage-rsa-2026',publicJwk,spkiFingerprint:fingerprint,sessionPepper:Buffer.alloc(32,71),env,now:()=>NOW});
 const platform=new CommercialPlatform(db,{apiPepper:Buffer.alloc(32,70),trustedPaymentKey:generateKeyPairSync('ed25519').publicKey,env,now:()=>NOW});
 const controller=new StageCommercialController({admission,platform});
 const browser=new PrivateOidcBrowserStage({admission,controller,db,env,clientId,authorizationEndpoint:issuer+'/protocol/openid-connect/auth',redirectUri:origin+'/private/oidc/callback',stageOrigin:origin,flowSecret:Buffer.alloc(32,72),now:()=>NOW});
 let exchangeCalls=0,gateCalls=0,allow=true;
 const exchangeCode=async()=>{exchangeCalls++;throw Error('replace synthetic issuer when test signs')};
 const gateRequest=async()=>{gateCalls++;return allow};
 const ingress=createMmfPrivateBrowserIngress({browser,exchangeCode,gateRequest,env,origin});
 return {db,browser,controller,admission,platform,ingress,gateRequest,exchangeCalls:()=>exchangeCalls,gateCalls:()=>gateCalls,deny:()=>{allow=false}};
}
async function authorized(t){
 const f=fixture(t);let idToken='';
 const ingress=createMmfPrivateBrowserIngress({...f,exchangeCode:async()=>({id_token:idToken}),gateRequest:f.gateRequest,env,origin});
 const login=await ingress.fetch(request('/private/login'));
 assert.equal(login.status,302);
 const authUrl=new URL(login.headers.get('location'));assert.equal(authUrl.origin,new URL(issuer).origin);
 assert.equal(authUrl.searchParams.get('code_challenge_method'),'S256');
 const transient=namedCookie(setCookies(login),'__Host-mmf_oidc_state');
 const state=authUrl.searchParams.get('state'),nonce=authUrl.searchParams.get('nonce');
 idToken=signNonce(nonce);
 const result=await ingress.fetch(request('/private/oidc/callback?code=TESTCODE_ABC123&state='+state,{headers:{cookie:transient,'sec-fetch-site':'cross-site'}}));
 assert.equal(result.status,200);assert.match(await result.text(),/Continue to private onboarding/);
 const session=namedCookie(setCookies(result),'__Host-mmf_session'),csrf=namedCookie(setCookies(result),'__Host-mmf_csrf');
 return {...f,ingress,session,csrf,allCookies:session+'; '+csrf};
}
test('private OIDC callback, session-bound onboarding and owner-only dashboard via real Request/Response',async t=>{
 const f=await authorized(t);
 const loginPage=await f.ingress.fetch(request('/private/tenants',{headers:{cookie:f.allCookies}}));
 assert.equal(loginPage.status,200);assert.match(await loginPage.text(),/Create private stage tenant/);
 const body=new URLSearchParams({tenantId:'tenant-alpha',csrf:csrfFrom(f.csrf)}).toString();
 const onboard=await f.ingress.fetch(request('/private/tenants',{method:'POST',body,headers:{cookie:f.allCookies,origin,'content-type':'application/x-www-form-urlencoded'}}));
 assert.equal(onboard.status,303);assert.equal(onboard.headers.get('location'),origin+'/private/dashboard?tenantId=tenant-alpha');
 const dashboard=await f.ingress.fetch(request('/private/dashboard?tenantId=tenant-alpha',{headers:{cookie:f.allCookies}}));
 assert.equal(dashboard.status,200);assert.equal(dashboard.headers.get('cache-control'),'no-store');
 assert.match(dashboard.headers.get('content-security-policy'),/default-src 'none'/);
 const html=await dashboard.text();assert.match(html,/tenant-alpha/);assert.match(html,/Sending disabled/);assert.match(html,/Payments disabled/);
 assert.doesNotMatch(html,/mmf_session_[A-Za-z0-9_-]+/);assert.doesNotMatch(html,/owner-one/);
 const logout=await f.ingress.fetch(request('/private/logout',{method:'POST',body:new URLSearchParams({csrf:csrfFrom(f.csrf)}),headers:{cookie:f.allCookies,origin,'content-type':'application/x-www-form-urlencoded'}}));
 assert.equal(logout.status,303);
 const revoked=await f.ingress.fetch(request('/private/dashboard?tenantId=tenant-alpha',{headers:{cookie:f.allCookies}}));assert.equal(revoked.status,403);
});

test('forged, absent, duplicate, cross-origin and cross-site CSRF requests cannot create tenant',async t=>{
 const f=await authorized(t);const body=csrf=>new URLSearchParams({tenantId:'tenant-alpha',csrf}).toString();
 const valid=csrfFrom(f.csrf);
 const failures=[
  {headers:{cookie:f.allCookies,origin:'https://evil.example.org','content-type':'application/x-www-form-urlencoded'},body:body(valid)},
  {headers:{cookie:f.allCookies,origin,'content-type':'application/x-www-form-urlencoded','sec-fetch-site':'cross-site'},body:body(valid)},
  {headers:{cookie:f.session,origin,'content-type':'application/x-www-form-urlencoded'},body:body(valid)},
  {headers:{cookie:f.allCookies,origin,'content-type':'application/x-www-form-urlencoded'},body:body('A'.repeat(43))},
  {headers:{cookie:f.allCookies,origin,'content-type':'application/x-www-form-urlencoded'},body:body(valid)+'&tenantId=tenant-beta'},
  {headers:{cookie:f.allCookies,origin,'content-type':'application/x-www-form-urlencoded'},body:body(valid)+'&plan=GROWTH'},
 ];
 for(const x of failures){const r=await f.ingress.fetch(request('/private/tenants',{method:'POST',...x}));assert.equal(r.status,403);}
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM mmf_tenants').get().n,0);
});

test('strict transport, fetch-metadata, host, callback replay, rate gate and query bounds',async t=>{
 const f=await authorized(t);const cases=[
  request('/private/tenants',{headers:{cookie:f.allCookies,host:'evil.example.org'}}),
  request('/private/tenants',{headers:{cookie:f.allCookies,'x-forwarded-host':'evil.example.org'}}),
  request('/private/tenants',{headers:{cookie:f.allCookies,'sec-fetch-site':'cross-site'}}),
  request('/private/tenants',{headers:{cookie:f.allCookies,'sec-fetch-mode':'cors'}}),
  request('/private/dashboard?tenantId=tenant-alpha&tenantId=tenant-bravo',{headers:{cookie:f.allCookies}}),
  request('/private/dashboard?tenantId=%3Cscript%3E',{headers:{cookie:f.allCookies}}),
  request('/private/oidc/callback?code=short&state=short&extra=bad',{headers:{'sec-fetch-site':'cross-site'}}),
 ];
 for(const req of cases){const response=await f.ingress.fetch(req);assert.equal(response.status,403);assert.equal(response.headers.get('cache-control'),'no-store');}
 const denied=await f.ingress.fetch(request('/private/tenants',{method:'POST',body:new URLSearchParams({tenantId:'tenant-alpha',csrf:csrfFrom(f.csrf)}),headers:{cookie:f.allCookies,origin,'content-type':'application/x-www-form-urlencoded'}}));
 assert.equal(denied.status,303);
 f.deny();const blocked=await f.ingress.fetch(request('/private/dashboard?tenantId=tenant-alpha',{headers:{cookie:f.allCookies}}));assert.equal(blocked.status,403);
});

test('session-bound domain enrollment publishes private pending TXT only, never mail authority',async t=>{
 const f=await authorized(t),csrf=csrfFrom(f.csrf);
 const create=new URLSearchParams({tenantId:'tenant-alpha',csrf}).toString();
 const provision=await f.ingress.fetch(request('/private/tenants',{method:'POST',body:create,headers:{cookie:f.allCookies,origin,'content-type':'application/x-www-form-urlencoded'}}));
 assert.equal(provision.status,303);
 const domainBody=new URLSearchParams({tenantId:'tenant-alpha',domain:'mail.example.org',csrf}).toString();
 const enroll=await f.ingress.fetch(request('/private/domains',{method:'POST',body:domainBody,headers:{cookie:f.allCookies,origin,'content-type':'application/x-www-form-urlencoded'}}));
 assert.equal(enroll.status,200);
 const html=await enroll.text();assert.match(html,/PENDING_DNS/);assert.match(html,/_mmf-verify.mail.example.org/);
 assert.match(html,/mmf-verify=/);assert.match(html,/Mail sending remains disabled/);
 const dashboard=await f.ingress.fetch(request('/private/dashboard?tenantId=tenant-alpha',{headers:{cookie:f.allCookies}}));
 assert.match(await dashboard.text(),/mail.example.org/);
 const denied=await f.ingress.fetch(request('/private/domains',{method:'POST',body:new URLSearchParams({tenantId:'tenant-alpha',domain:'other.example.org',csrf:'A'.repeat(43)}),headers:{cookie:f.allCookies,origin,'content-type':'application/x-www-form-urlencoded'}}));
 assert.equal(denied.status,403);
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM mmf_domains').get().n,1);
});

test('direct top-level browser navigation to login is permitted only for login, not protected state',async t=>{
 const f=fixture(t);
 const direct=await f.ingress.fetch(request('/private/login',{headers:{'sec-fetch-site':'none'}}));
 assert.equal(direct.status,302);
 const protectedRoute=await f.ingress.fetch(request('/private/tenants',{headers:{'sec-fetch-site':'none'}}));
 assert.equal(protectedRoute.status,403);
});

test('constructor denies missing externally enforced gate and enabled production capabilities',t=>{
 const {browser}=fixture(t);
 assert.throws(()=>createMmfPrivateBrowserIngress({browser,exchangeCode:async()=>{},env,origin}),/MMF_PRIVATE_BROWSER_INGRESS_DENIED/);
 assert.throws(()=>createMmfPrivateBrowserIngress({browser,gateRequest:async()=>true,exchangeCode:async()=>{},env:{...env,MMF_COMMERCE_ENABLED:'true'},origin}),/MMF_PRIVATE_BROWSER_INGRESS_DENIED/);
});