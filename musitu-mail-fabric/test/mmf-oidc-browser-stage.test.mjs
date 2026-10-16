import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {IdentityAdmission,StageCommercialController} from '../src/commercial/mmf-oidc-admission.mjs';
import {CommercialPlatform} from '../src/commercial/mmf-commercial-platform.mjs';
import {PrivateOidcBrowserStage} from '../src/commercial/mmf-oidc-browser-stage.mjs';

const NOW=Date.UTC(2026,9,14,0);
const ENV={MMF_REAL_SEND_ENABLED:'false',MMF_COMMERCE_ENABLED:'false',MMF_CUSTOMER_API_ENABLED:'false'};
const issuer='https://oidc.example.net/realms/enterprise';
const clientId='mmf-stage-client';
const origin='https://mmf-stage.example.org';
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const publicJwk=publicKey.export({format:'jwk'});
const fingerprint=createHash('sha256').update(publicKey.export({type:'spki',format:'der'})).digest('hex');
const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
const cookieValue=(headers,name)=>{
 const entry=headers.find(x=>x.startsWith(name+'='));
 assert.ok(entry,'expected '+name+' cookie');
 return entry.slice(0,entry.indexOf(';'));
};
function signed(nonce,subject='owner-alpha'){
 const h=enc({alg:'RS256',typ:'JWT',kid:'mmf-oidc-v1'});
 const p=enc({iss:issuer,aud:clientId,sub:subject,nonce,iat:Math.floor((NOW-1000)/1000),auth_time:Math.floor((NOW-1000)/1000),amr:['pwd','otp'],exp:Math.floor((NOW+300000)/1000)});
 const data=h+'.'+p;
 return data+'.'+sign('RSA-SHA256',Buffer.from(data),privateKey).toString('base64url');
}
function fixture(t,db=new DatabaseSync(':memory:')){
 t.after(()=>db.close());
 const admission=new IdentityAdmission(db,{issuer,audience:clientId,keyId:'mmf-oidc-v1',publicJwk,spkiFingerprint:fingerprint,sessionPepper:Buffer.alloc(32,71),env:ENV,now:()=>NOW});
 const platform=new CommercialPlatform(db,{apiPepper:Buffer.alloc(32,70),trustedPaymentKey:generateKeyPairSync('ed25519').publicKey,env:ENV,now:()=>NOW});
 const controller=new StageCommercialController({admission,platform});
 const bridge=new PrivateOidcBrowserStage({admission,controller,db,env:ENV,clientId,authorizationEndpoint:issuer+'/protocol/openid-connect/auth',redirectUri:origin+'/private/oidc/callback',stageOrigin:origin,flowSecret:Buffer.alloc(32,72),now:()=>NOW});
 return {db,bridge,controller,admission};
}
async function signin(bridge,subject='owner-alpha'){
 const start=bridge.begin({origin});const u=new URL(start.authorizationUrl);
 const state=u.searchParams.get('state'),nonce=u.searchParams.get('nonce');
 assert.equal(u.searchParams.get('response_type'),'code');
 assert.equal(u.searchParams.get('code_challenge_method'),'S256');
 assert.equal(u.searchParams.get('redirect_uri'),origin+'/private/oidc/callback');
 const stateCookie=cookieValue(start.setCookies,'__Host-mmf_oidc_state');
 const callback=await bridge.callback({origin,cookieHeader:stateCookie,state,code:'approved_code_AAAAA123',exchangeCode:async ({code,clientId:client,redirectUri,codeVerifier,signal})=>{
  assert.equal(code,'approved_code_AAAAA123');assert.equal(client,clientId);assert.equal(redirectUri,origin+'/private/oidc/callback');
  assert.equal(createHash('sha256').update(codeVerifier).digest('base64url'),u.searchParams.get('code_challenge'));
  assert.ok(signal);
  return {id_token:signed(nonce,subject)};
 }});
 return {start,callback,state,stateCookie,sessionCookie:cookieValue(callback.setCookies,'__Host-mmf_session'),csrfCookie:cookieValue(callback.setCookies,'__Host-mmf_csrf'),csrfToken:cookieValue(callback.setCookies,'__Host-mmf_csrf').split('=')[1]};
}

test('private OIDC code+PKCE callback creates secure cookie session and owner-only read model',async t=>{
 const {bridge,controller}=fixture(t);const s=await signin(bridge);
 for(const c of [s.start.setCookies[0],...s.callback.setCookies]){
  assert.match(c,/Secure/);assert.match(c,/Path=\//);assert.match(c,/SameSite=(?:Lax|Strict)/);
 }
 assert.match(s.sessionCookie,/^__Host-mmf_session=mmf_session_/);
 assert.match(s.callback.setCookies.find(x=>x.startsWith('__Host-mmf_session=')),/HttpOnly/);
 controller.createTenant({sessionToken:s.sessionCookie.split('=')[1],tenantId:'tenant-alpha'});
 const dashboard=bridge.readDashboard({origin,cookieHeader:s.sessionCookie,tenantId:'tenant-alpha'});
 assert.equal(dashboard.tenantId,'tenant-alpha');
 assert.equal(dashboard.canSendMail,false);assert.equal(dashboard.canInitiatePayments,false);
 assert.equal(JSON.stringify(dashboard).includes('mmf_session_'),false);
 assert.throws(()=>bridge.readDashboard({origin,cookieHeader:s.sessionCookie,tenantId:'tenant-bravo'}),/MMF_/);
 const ended=bridge.logout({origin,cookieHeader:s.sessionCookie+'; '+s.csrfCookie,csrfHeader:s.csrfToken});
 assert.equal(ended.revoked,true);
 assert.equal(ended.clearCookies.length,2);
 assert.throws(()=>bridge.readDashboard({origin,cookieHeader:s.sessionCookie,tenantId:'tenant-alpha'}),/MMF_/);
});

test('browser flow rejects CSRF, cross-origin callbacks, duplicate cookies and replay; no exchange on invalid state',async t=>{
 const {bridge}=fixture(t);const start=bridge.begin({origin}),u=new URL(start.authorizationUrl);
 const state=u.searchParams.get('state'),nonce=u.searchParams.get('nonce');
 const cookie=cookieValue(start.setCookies,'__Host-mmf_oidc_state');let calls=0;
 const exchangeCode=async()=>{calls++;return {id_token:signed(nonce)}};
 const body={origin,cookieHeader:cookie,state,code:'approved_code_AAAAA123',exchangeCode};
 await assert.rejects(bridge.callback({...body,origin:'https://attacker.example.org'}),/MMF_/);
 await assert.rejects(bridge.callback({...body,cookieHeader:cookie+'; '+cookie}),/MMF_/);
 await assert.rejects(bridge.callback({...body,state:'wrong-State'}),/MMF_/);
 assert.equal(calls,0);
 const valid=await bridge.callback(body);
 assert.ok(valid.setCookies.length>=2);assert.equal(calls,1);
 await assert.rejects(bridge.callback(body),/MMF_/);assert.equal(calls,1);
});

test('missing, forged CSRF headers and cross-origin logout cannot revoke legitimate session',async t=>{
 const {bridge,admission}=fixture(t),s=await signin(bridge);
 const token=s.sessionCookie.split('=')[1];
 for(const bad of [{origin,cookieHeader:s.sessionCookie+'; '+s.csrfCookie,csrfHeader:''},{origin,cookieHeader:s.sessionCookie+'; '+s.csrfCookie,csrfHeader:'A'.repeat(43)},{origin,cookieHeader:s.sessionCookie+'; '+s.csrfCookie+'; '+s.csrfCookie,csrfHeader:s.csrfToken},{origin:'https://evil.test',cookieHeader:s.sessionCookie+'; '+s.csrfCookie,csrfHeader:s.csrfToken}]){
  assert.throws(()=>bridge.logout(bad),/MMF_/);
  assert.ok(admission.authenticateSession(token).actorSubject);
 }
});

test('browser flow refuses unsafe configurations, disabled flags and open redirects',t=>{
 const {bridge,db,controller,admission}=fixture(t);
 for(const redirectUri of ['http://mmf-stage.example.org/private/oidc/callback','https://mmf-stage.example.org/other','https://mmf-stage.example.org/private/oidc/callback?to=evil']){
  assert.throws(()=>new PrivateOidcBrowserStage({admission,controller,db,env:ENV,clientId,authorizationEndpoint:issuer+'/protocol/openid-connect/auth',stageOrigin:origin,redirectUri,flowSecret:Buffer.alloc(32,72),now:()=>NOW}),/MMF_/);
 }
 assert.throws(()=>bridge.begin({origin:'https://attacker.example.org'}),/MMF_/);
});

test('failed provider exchange consumes state without admission; callback cannot retry using same code',async t=>{
 const {bridge,db}=fixture(t);const s=bridge.begin({origin});const u=new URL(s.authorizationUrl);
 const input={origin,cookieHeader:cookieValue(s.setCookies,'__Host-mmf_oidc_state'),state:u.searchParams.get('state'),code:'approved_code_AAAAA123'};
 await assert.rejects(bridge.callback({...input,exchangeCode:async()=>{throw Error('very-secret-provider-internal-error')}}),e=>e.message==='MMF_BROWSER_STAGE_DENIED');
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mmf_oidc_browser_pending WHERE consumed=1').get().n,1);
 await assert.rejects(bridge.callback({...input,exchangeCode:async()=>({id_token:signed(u.searchParams.get('nonce'))})}),/MMF_BROWSER_STAGE_DENIED/);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mmf_oidc_sessions').get().n,0);
});

test('expired browser state and token mismatch fail before creating a stage session',async t=>{
 let current=NOW;
 const {bridge,db}=fixture(t);bridge.now=()=>current;
 const started=bridge.begin({origin}),u=new URL(started.authorizationUrl);
 const input={origin,state:u.searchParams.get('state'),code:'approved_code_AAAAA123',cookieHeader:cookieValue(started.setCookies,'__Host-mmf_oidc_state')};
 current+=5*60000+1;
 let called=0;
 await assert.rejects(bridge.callback({...input,exchangeCode:async()=>{called++;return {id_token:signed(u.searchParams.get('nonce'))}}}),/MMF_BROWSER_STAGE_DENIED/);
 assert.equal(called,0);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mmf_oidc_sessions').get().n,0);
});

test('valid PKCE exchange with forged signed ID-token nonce fails closed and burns state',async t=>{
 const {bridge,db}=fixture(t),s=bridge.begin({origin}),u=new URL(s.authorizationUrl);
 const payload={origin,state:u.searchParams.get('state'),cookieHeader:cookieValue(s.setCookies,'__Host-mmf_oidc_state'),code:'approved_code_AAAAA123'};
 await assert.rejects(bridge.callback({...payload,exchangeCode:async()=>({id_token:signed('wrong-nonce')})}),/MMF_BROWSER_STAGE_DENIED/);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mmf_oidc_sessions').get().n,0);
 await assert.rejects(bridge.callback({...payload,exchangeCode:async()=>({id_token:signed(u.searchParams.get('nonce'))})}),/MMF_BROWSER_STAGE_DENIED/);
});
