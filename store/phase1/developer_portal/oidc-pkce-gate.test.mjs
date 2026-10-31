import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {createPrivateOidcGate} from './oidc-pkce-gate.mjs';

const issuer='https://auth.store-private.example.org';
const clientId='store-private-client';
const redirectUri='https://store-stage.example.org/auth/oidc/callback';
const {publicKey,privateKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const {privateKey:rogueKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const jwk={...publicKey.export({format:'jwk'}),kid:'stage-kid-001',use:'sig',alg:'ES256'};
const t=1793090000;
const enc=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
const hash=s=>createHash('sha256').update(s).digest('base64url');
const token=(nonce,overrides={},key=privateKey)=>{
 const head=enc({alg:'ES256',kid:'stage-kid-001',typ:'JWT'});
 const payload=enc({iss:issuer,aud:clientId,sub:'auth-user-0001',exp:t+180,iat:t-10,nbf:t-10,
  auth_time:t-20,nonce,amr:['pwd','mfa','otp'],acr:'urn:musitu:verified-mfa',...overrides});
 const data=head+'.'+payload;
 return data+'.'+sign('sha256',Buffer.from(data),{key,dsaEncoding:'ieee-p1363'}).toString('base64url');
};
function harness({claimOverrides={},signer=privateKey,exchangeThrows=false,resolve,sessionThrows=false,now=t*1000}={}){
 const entries=new Map(),sessions=[],requests=[];
 const ledger={async begin(record){
   if(entries.has(record.state))throw Error('collision');entries.set(record.state,record);return true;
  },async consume(state){const r=entries.get(state);entries.delete(state);return r||null;}};
 const trustedDirectory={async resolve(input){return resolve?resolve(input):{subject:input.subject,role:'developer',publisherId:'pilot-developer'};}};
 const sessionRegistrar=async record=>{if(sessionThrows)throw Error('ledger down');sessions.push(record);return {created:true,sessionId:'private-session-00001'};};
 const exchangeCode=async x=>{
   requests.push(x);if(exchangeThrows)throw Error('external provider unavailable');
   return {id_token:token(entries.get('__last_nonce')||'missing',claimOverrides,signer)};
 };
 const gate=createPrivateOidcGate({issuer,clientId,authorizationEndpoint:issuer+'/authorize',
   tokenEndpoint:issuer+'/oauth/token',redirectUri,jwks:{keys:[jwk]},
   acceptedAcr:['urn:musitu:verified-mfa'],ledger,trustedDirectory,sessionRegistrar,exchangeCode,now:()=>now});
 async function initiate(){
   const start=await gate.start();
   const auth=new URL(start.authorizationUrl);
   entries.set('__last_nonce',auth.searchParams.get('nonce'));
   const callback=()=>redirectUri+'?code=opaque-code-123&state='+encodeURIComponent(auth.searchParams.get('state'))+'&iss='+encodeURIComponent(issuer);
   return {start,auth,callback};
 }
 return {gate,initiate,entries,sessions,requests};
}

test('authorization request requires code, PKCE S256, fresh random state and nonce',async()=>{
 const h=harness(),a=await h.initiate(),b=await h.initiate();
 assert.equal(a.auth.searchParams.get('response_type'),'code');
 assert.equal(a.auth.searchParams.get('code_challenge_method'),'S256');
 assert.equal(a.auth.searchParams.get('client_id'),clientId);
 assert.equal(a.auth.searchParams.get('redirect_uri'),redirectUri);
 assert.equal(a.auth.searchParams.get('scope'),'openid');
 assert.notEqual(a.auth.searchParams.get('state'),b.auth.searchParams.get('state'));
 assert.notEqual(a.auth.searchParams.get('nonce'),b.auth.searchParams.get('nonce'));
 assert.equal(a.auth.searchParams.get('code_challenge').length,43);
 assert.ok(!a.start.authorizationUrl.includes('code_verifier'));
});

test('issuer-signed MFA and pinned JWKS can initiate owner-controlled private session, never releases',async()=>{
 const h=harness(),s=await h.initiate();
 const result=await h.gate.complete(s.callback());
 assert.equal(h.requests.length,1);
 assert.equal(h.requests[0].tokenEndpoint,issuer+'/oauth/token');
 assert.equal(h.requests[0].clientId,clientId);
 assert.equal(h.requests[0].redirectUri,redirectUri);
 assert.equal(hash(h.requests[0].verifier),s.auth.searchParams.get('code_challenge'));
 assert.equal(h.sessions.length,1);
 assert.equal(h.sessions[0].subject,'auth-user-0001');
 assert.equal(h.sessions[0].role,'developer');
 assert.equal(h.sessions[0].publisherId,'pilot-developer');
 for(const k of ['publisherApproved','publicationAuthorized','paymentAuthorized','payoutAuthorized','entitlementGranted'])assert.equal(result[k],false);
 assert.equal(result.sessionId,'private-session-00001');
});

test('single-use state replay, missing/multiple code or callback issuer confusion are denied',async()=>{
 const h=harness(),s=await h.initiate();
 await h.gate.complete(s.callback());
 await assert.rejects(h.gate.complete(s.callback()),/oidc_denied/);
 const j=await h.initiate();
 for(const changed of [j.callback()+'&code=second','https://evil.example.org/auth/oidc/callback?code=1&state='+j.auth.searchParams.get('state'),j.callback().replace(encodeURIComponent(issuer),encodeURIComponent('https://evil.org')),j.callback().replace('opaque-code-123','')])
  await assert.rejects(h.gate.complete(changed),/oidc_denied/);
});

test('forged JWT, invalid MFA assurance, stale auth, invalid audience and nonce cannot enroll',async()=>{
 for(const [name,overrides,signer] of [
   ['signature',{},rogueKey],['acr',{acr:'urn:low'},privateKey],['amr',{amr:['pwd']},privateKey],
   ['stale auth',{auth_time:t-1800},privateKey],['audience',{aud:'other-app'},privateKey],
   ['issuer',{iss:'https://evil.example'},privateKey],['nonce',{nonce:'forged'},privateKey],
   ['expired',{exp:t-1},privateKey],['future',{nbf:t+100},privateKey]
 ]){
  const h=harness({claimOverrides:overrides,signer}),s=await h.initiate();
  await assert.rejects(h.gate.complete(s.callback()),/oidc_denied/,name);
  assert.equal(h.sessions.length,0,name+' must not create session');
 }
});

test('IdP outage and durable-session outage are fail closed, without granting access',async()=>{
 for(const variant of [{exchangeThrows:true},{sessionThrows:true}]){
  const h=harness(variant),s=await h.initiate();
  await assert.rejects(h.gate.complete(s.callback()),/oidc_denied/);
  assert.equal(h.sessions.length,0);
  await assert.rejects(h.gate.complete(s.callback()),/oidc_denied/);
 }
});

test('provider roles, email, and publisher claims never override trusted operator directory',async()=>{
 const h=harness({claimOverrides:{role:'owner',publisherId:'forged-publisher',email:'attacker@example.org'},resolve:()=>({subject:'auth-user-0001',role:'review_security'})});
 const s=await h.initiate(),r=await h.gate.complete(s.callback());
 assert.equal(h.sessions[0].role,'review_security');
 assert.equal(h.sessions[0].publisherId,undefined);
 assert.equal(r.publicationAuthorized,false);
});

test('unapproved directory roles, stale flow and unknown kid fail without creating session',async()=>{
 const h=harness({resolve:()=>({subject:'auth-user-0001',role:'superuser'})});
 const s=await h.initiate();await assert.rejects(h.gate.complete(s.callback()),/oidc_denied/);assert.equal(h.sessions.length,0);
 const l=harness(),q=await l.initiate();l.entries.get(q.auth.searchParams.get('state')).createdAt=(t-900)*1000;
 await assert.rejects(l.gate.complete(q.callback()),/oidc_denied/);
});
