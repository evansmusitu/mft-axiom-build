// Local cryptographic/provider-contract tests, not real ZITADEL acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {identityConfig} from '../src/staging/identity-policy.mjs';
import {createIdentityProvider} from '../src/staging/identity-provider.mjs';
const env={OIDC_PROVIDER:'zitadel',OIDC_ISSUER:'https://mfa-synthetic.zitadel.cloud',OIDC_CLIENT_ID:'web-synthetic',OIDC_CLIENT_SECRET:'synthetic-web-secret',OIDC_AUDIENCE:'api-synthetic',OIDC_INTROSPECTION_CLIENT_ID:'api-synthetic',OIDC_INTROSPECTION_CLIENT_SECRET:'synthetic-api-secret',APP_ORIGIN:'https://app.example.invalid'};
const cfg=identityConfig(env),pair=await generateKeyPair('RS256'),jwk={...await exportJWK(pair.publicKey),kid:'mfa-synthetic',alg:'RS256',use:'sig'};
const flow={nonce:'synthetic-flow-nonce'},accessClaims={sub:'synthetic-staff'};
function provider(config=cfg){return createIdentityProvider(config,{request:async(url)=>{assert.equal(String(url),config.endpoints.jwks);return Response.json({keys:[jwk]});}});}
async function token(changes={},key=pair.privateKey,config=cfg){
 const now=Math.floor(Date.now()/1000);
 return new SignJWT({iss:config.issuer,aud:config.client,azp:config.client,sub:accessClaims.sub,nonce:flow.nonce,iat:now,exp:now+300,amr:['pwd','mfa'],auth_time:now-10,...changes}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).sign(key);
}
test('signed ZITADEL ID token requires explicit well-formed MFA evidence',async()=>{
 const p=provider();
 for(const amr of [undefined,null,[],['pwd'],['pwd','otp'],'pwd mfa',['MFA'],['mfa',42],['mfa','']]){
  await assert.rejects(p.verifyId(await token({amr}),flow,accessClaims),/OIDC_MFA_REQUIRED/);
 }
});
test('fresh explicitly signed MFA proof succeeds with either password or hardware factor evidence',async()=>{
 const p=provider();for(const amr of [['pwd','mfa'],['hwk','mfa']])assert.equal((await p.verifyId(await token({amr}),flow,accessClaims)).sub,accessClaims.sub);
});
test('signed MFA cannot substitute for missing, stale, malformed or future authentication time',async()=>{
 const p=provider(),now=Math.floor(Date.now()/1000);
 for(const auth_time of [undefined,null,'123',0,now-601,now+60,now-0.5])await assert.rejects(p.verifyId(await token({auth_time}),flow,accessClaims),/OIDC_AUTH_TIME_REJECTED/);
 await assert.rejects(p.verifyId(await token({iat:now-30,auth_time:now-10}),flow,accessClaims),/OIDC_AUTH_TIME_REJECTED/);
});
test('forged MFA proof fails cryptographic verification even with the expected issuer and nonce',async()=>{
 const other=await generateKeyPair('RS256');await assert.rejects(provider().verifyId(await token({},other.privateKey),flow,accessClaims));
});
test('existing Keycloak ID-token contract is unchanged by the explicit ZITADEL MFA policy',async()=>{
 const keycloak=identityConfig({...env,OIDC_PROVIDER:'keycloak',OIDC_ISSUER:'https://id.example.invalid/realms/staging'});
 assert.equal((await provider(keycloak).verifyId(await token({amr:undefined,auth_time:undefined},pair.privateKey,keycloak),flow,accessClaims)).sub,accessClaims.sub);
});
test('old or restored access-token-only ZITADEL sessions are rejected before contacting the provider',async()=>{
 const p=createIdentityProvider(cfg,{request:async()=>{assert.fail('Legacy session must not reach the provider');}});
 for(const session of [null,{}, {accessToken:'synthetic-only'}, {accessToken:'synthetic-only',idToken:'synthetic-only'}, {accessToken:'synthetic-only',idToken:42,nonce:flow.nonce}])await assert.rejects(p.verifySession(session),/SESSION_MFA_REQUIRED/);
});
test('each ZITADEL session use rechecks signed MFA, nonce, freshness and online revocation',async()=>{
 const exp=Math.floor(Date.now()/1000)+300,accessToken=await token({aud:cfg.audience,exp});let active=true,introspections=0;
 const p=createIdentityProvider(cfg,{request:async(url,o)=>{
  if(String(url)===cfg.endpoints.jwks)return Response.json({keys:[jwk]});
  assert.equal(String(url),cfg.endpoints.introspection);assert.equal(o.body.get('token'),accessToken);introspections++;
  return Response.json({active,sub:accessClaims.sub,exp,iss:cfg.issuer,client_id:cfg.client,aud:cfg.audience});
 }});
 const session={accessToken,idToken:await token(),nonce:flow.nonce};
 assert.equal((await p.verifySession(session)).sub,accessClaims.sub);
 await assert.rejects(p.verifySession({...session,idToken:await token({amr:['pwd']})}),/OIDC_MFA_REQUIRED/);
 await assert.rejects(p.verifySession({...session,nonce:'other-flow'}),/OIDC_NONCE_OR_SUBJECT_REJECTED/);
 await assert.rejects(p.verifySession({...session,idToken:await token({auth_time:Math.floor(Date.now()/1000)-601})}),/OIDC_AUTH_TIME_REJECTED/);
 active=false;await assert.rejects(p.verifySession(session),/SESSION_REVOKED/);assert.equal(introspections,5);
});
test('existing Keycloak encrypted session format continues to use online access-token validation',async()=>{
 const k=identityConfig({...env,OIDC_PROVIDER:'keycloak',OIDC_ISSUER:'https://id.example.invalid/realms/staging'}),exp=Math.floor(Date.now()/1000)+300,accessToken=await token({aud:k.audience,exp,amr:undefined,auth_time:undefined},pair.privateKey,k);
 const p=createIdentityProvider(k,{request:async(url)=>String(url)===k.endpoints.jwks?Response.json({keys:[jwk]}):Response.json({active:true,sub:accessClaims.sub,exp,client_id:k.client,iss:k.issuer})});
 assert.equal((await p.verifySession({accessToken})).sub,accessClaims.sub);
});
