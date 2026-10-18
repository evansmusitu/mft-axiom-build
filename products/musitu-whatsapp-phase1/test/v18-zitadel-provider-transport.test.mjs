import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {identityConfig} from '../src/staging/identity-policy.mjs';
import {createIdentityProvider,identityJson} from '../src/staging/identity-provider.mjs';
import {identityAction} from '../src/staging/identity.mjs';
const env={OIDC_PROVIDER:'zitadel',OIDC_ISSUER:'https://musitu-synthetic.zitadel.cloud',OIDC_CLIENT_ID:'web-synthetic',OIDC_CLIENT_SECRET:'synthetic-web-secret',OIDC_AUDIENCE:'api-synthetic',OIDC_INTROSPECTION_CLIENT_ID:'api-synthetic',OIDC_INTROSPECTION_CLIENT_SECRET:'synthetic-api-secret',APP_ORIGIN:'https://app.example.invalid'};
const cfg=identityConfig(env),now=Math.floor(Date.now()/1000),pair=await generateKeyPair('RS256'),jwk={...await exportJWK(pair.publicKey),kid:'synthetic-key',alg:'RS256',use:'sig'};
async function signed(claims={},key=pair.privateKey,alg='RS256'){
 return new SignJWT({sub:'staff-synthetic',azp:cfg.client,iss:cfg.issuer,aud:cfg.audience,iat:now,exp:now+300,...claims}).setProtectedHeader({alg,kid:'synthetic-key'}).sign(key);
}
function fixture(){
 const calls=[];let active=true,introStatus=200;
 const request=async(url,options)=>{
  calls.push({url:String(url),options});assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');assert.equal(options.credentials,'omit');
  if(String(url)===cfg.endpoints.jwks)return Response.json({keys:[jwk]});
  if(String(url)===cfg.endpoints.introspection){assert.equal(options.headers.authorization,'Basic '+Buffer.from('api-synthetic:synthetic-api-secret').toString('base64'));return Response.json({active,sub:'staff-synthetic',exp:now+300,iss:cfg.issuer,client_id:cfg.client,aud:cfg.audience},{status:introStatus});}
  throw Error('UNEXPECTED_NETWORK_DESTINATION');
 };
 return {calls,request,setActive:v=>active=v,setStatus:v=>introStatus=v};
}
test('cryptographic JWT verification precedes online introspection; revoked tokens fail on immediate reuse',async()=>{
 const f=fixture(),p=createIdentityProvider(cfg,{request:f.request}),token=await signed();
 assert.equal((await p.verifyAccess(token)).sub,'staff-synthetic');assert.equal((await p.verifyAccess(token)).sub,'staff-synthetic');
 assert.equal(f.calls.filter(c=>c.url===cfg.endpoints.jwks).length,1);assert.equal(f.calls.filter(c=>c.url===cfg.endpoints.introspection).length,2);
 f.setActive(false);await assert.rejects(p.verifyAccess(token),/SESSION_REVOKED/);assert.equal(f.calls.filter(c=>c.url===cfg.endpoints.introspection).length,3);
});
test('wrong issuer, audience, client, expiry, signature and algorithm never reach introspection',async()=>{
 const f=fixture(),p=createIdentityProvider(cfg,{request:f.request});
 const foreign=await generateKeyPair('RS256');
 for(const token of [await signed({iss:'https://other.zitadel.cloud'}),await signed({aud:'other-api'}),await signed({azp:'other-client'}),await signed({exp:now-1}),await signed({},foreign.privateKey),await new SignJWT({sub:'staff-synthetic'}).setProtectedHeader({alg:'HS256'}).sign(new TextEncoder().encode('synthetic-only-symmetric-key-32-bytes'))])await assert.rejects(p.verifyAccess(token));
 assert.equal(f.calls.filter(c=>c.url===cfg.endpoints.introspection).length,0);
});
test('provider failure after an earlier successful request cannot reuse cached active status',async()=>{
 const f=fixture(),p=createIdentityProvider(cfg,{request:f.request}),token=await signed();await p.verifyAccess(token);f.setStatus(503);await assert.rejects(p.verifyAccess(token),/PROVIDER_UNAVAILABLE/);
});
test('ID token must bind nonce, subject and authorized client to the same login flow',async()=>{
 const f=fixture(),p=createIdentityProvider(cfg,{request:f.request}),flow={nonce:'synthetic-nonce'},claims={sub:'staff-synthetic'};
 const idClaims={aud:cfg.client,nonce:flow.nonce,amr:['pwd','mfa'],auth_time:now};
 const token=await signed(idClaims);assert.equal((await p.verifyId(token,flow,claims)).sub,claims.sub);
 for(const changes of [{nonce:'other-nonce'},{sub:'other-staff'},{azp:'other-client'},{aud:'other-web'}])await assert.rejects(p.verifyId(await signed({...idClaims,...changes}),flow,claims));
});
test('code exchange forwards PKCE to pinned token endpoint and uses web credentials only',async()=>{
 let count=0;
 const p=createIdentityProvider(cfg,{request:async(url,o)=>{count++;assert.equal(String(url),cfg.endpoints.token);assert.equal(o.redirect,'error');assert.equal(o.body.get('code_verifier'),'synthetic-verifier');assert.equal(o.body.get('redirect_uri'),cfg.origin+'/auth/callback');assert.equal(o.headers.authorization,'Basic '+Buffer.from('web-synthetic:synthetic-web-secret').toString('base64'));return Response.json({token_type:'Bearer',synthetic:true});}});
 assert.equal((await p.exchange('synthetic-code','synthetic-verifier')).synthetic,true);assert.equal(count,1);
});
test('unresponsive HTTP or response stream is bounded even if the transport ignores abort',async()=>{
 await assert.rejects(identityJson(cfg.endpoints.token,{},()=>new Promise(()=>{}),20),/PROVIDER_TIMEOUT/);
 await assert.rejects(identityJson(cfg.endpoints.token,{},async()=>new Response(new ReadableStream({pull(){return new Promise(()=>{});}}),{headers:{'content-type':'application/json'}}),20),/PROVIDER_TIMEOUT/);
});
test('identity transport rejects redirects, unexpected status/type and oversized JSON',async()=>{
 for(const response of [new Response(null,{status:302,headers:{location:'https://evil.invalid'}}),Response.json({},{status:201}),new Response('{}',{headers:{'content-type':'text/html'}}),new Response('x'.repeat(65537),{headers:{'content-type':'application/json'}})])await assert.rejects(identityJson(cfg.endpoints.token,{},async()=>response));
});
test('real login route uses qualified pinned ZITADEL authorization, PKCE/state/nonce and secure flow cookie',async()=>{
 const oldFetch=globalThis.fetch,saved={};for(const key of [...Object.keys(env),'SESSION_ENCRYPTION_KEY'])saved[key]=process.env[key];Object.assign(process.env,env,{SESSION_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64')});
 globalThis.fetch=async(url)=>{assert.equal(String(url),cfg.issuer+'/.well-known/openid-configuration');return Response.json({issuer:cfg.issuer,authorization_endpoint:cfg.endpoints.authorization,token_endpoint:cfg.endpoints.token,introspection_endpoint:cfg.endpoints.introspection,jwks_uri:cfg.endpoints.jwks,end_session_endpoint:cfg.endpoints.logout,id_token_signing_alg_values_supported:['RS256'],code_challenge_methods_supported:['S256'],response_types_supported:['code'],token_endpoint_auth_methods_supported:['client_secret_basic']});};
 try{const response=await identityAction(new Request(cfg.origin+'/auth/login'),'login'),url=new URL(response.headers.get('location'));assert.equal(response.status,302);assert.equal(url.origin+url.pathname,cfg.endpoints.authorization);for(const name of ['state','nonce','code_challenge'])assert.match(url.searchParams.get(name),/^[A-Za-z0-9_-]{43}$/);assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.equal(url.searchParams.get('response_type'),'code');assert.equal(url.searchParams.get('max_age'),'600');assert.equal(url.searchParams.get('redirect_uri'),cfg.origin+'/auth/callback');assert.match(response.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Lax; Max-Age=600/);assert.equal(url.href.includes(cfg.secret),false);}
 finally{globalThis.fetch=oldFetch;for(const [key,value]of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
