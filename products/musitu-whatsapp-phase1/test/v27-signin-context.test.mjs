import test from 'node:test';
import assert from 'node:assert/strict';
import {jwtDecrypt} from 'jose';
import {identityAction} from '../src/staging/identity.mjs';
import {businessIdentifier,businessSignInPath,businessDestination} from '../src/shared/business-navigation.mjs';

const business='986eb904-7296-46a9-9e9b-94074db9b547';
const env={OIDC_PROVIDER:'zitadel',OIDC_ISSUER:'https://signin-context-synthetic.zitadel.cloud',OIDC_CLIENT_ID:'web-synthetic',OIDC_CLIENT_SECRET:'synthetic-secret',OIDC_AUDIENCE:'api-synthetic',OIDC_INTROSPECTION_CLIENT_ID:'api-synthetic',OIDC_INTROSPECTION_CLIENT_SECRET:'synthetic-api-secret',APP_ORIGIN:'https://app.example.invalid',SESSION_ENCRYPTION_KEY:Buffer.alloc(32,17).toString('base64')};
async function fixture(work){
 const saved=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]])),previousFetch=globalThis.fetch;let requests=0;Object.assign(process.env,env);
 globalThis.fetch=async url=>{
  requests++;assert.equal(String(url),env.OIDC_ISSUER+'/.well-known/openid-configuration');
  return Response.json({issuer:env.OIDC_ISSUER,authorization_endpoint:env.OIDC_ISSUER+'/oauth/v2/authorize',token_endpoint:env.OIDC_ISSUER+'/oauth/v2/token',introspection_endpoint:env.OIDC_ISSUER+'/oauth/v2/introspect',jwks_uri:env.OIDC_ISSUER+'/oauth/v2/keys',end_session_endpoint:env.OIDC_ISSUER+'/oidc/v1/end_session',id_token_signing_alg_values_supported:['RS256'],code_challenge_methods_supported:['S256'],response_types_supported:['code'],token_endpoint_auth_methods_supported:['client_secret_basic']});
 };
 try{await work(()=>requests);}finally{globalThis.fetch=previousFetch;for(const[k,v]of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
}

test('selected business survives in the encrypted sign-in flow without changing the registered callback',async()=>fixture(async()=>{
 const response=await identityAction(new Request(env.APP_ORIGIN+'/auth/login?business='+business),'login');
 assert.equal(response.status,302);
 const provider=new URL(response.headers.get('location'));
 assert.equal(provider.searchParams.get('redirect_uri'),env.APP_ORIGIN+'/auth/callback');
 assert.equal(provider.searchParams.has('business'),false);
 const cookie=response.headers.get('set-cookie'),sealed=cookie.split(';')[0].slice('__Host-musitu-flow='.length);
 const {payload}=await jwtDecrypt(sealed,Buffer.from(env.SESSION_ENCRYPTION_KEY,'base64'));
 assert.equal(payload.business,business);
 assert.equal(payload.purpose,'login');assert.equal(payload.exp-payload.iat,600);
 assert.match(cookie,/HttpOnly; Secure; SameSite=Lax; Max-Age=600$/);
}));

test('preview-host sign-in moves to the pinned application host before issuing a flow cookie',async()=>fixture(async requests=>{
 const response=await identityAction(new Request('https://preview.example.invalid/auth/login?business='+business+'&returnTo=https://foreign.invalid'),'login');
 assert.equal(response.status,302);
 assert.equal(response.headers.get('location'),env.APP_ORIGIN+'/auth/login?business='+business);
 assert.equal(response.headers.has('set-cookie'),false);assert.equal(requests(),0);
}));

test('business navigation accepts only a UUID and cannot choose an external or credential-bearing destination',()=>{
 assert.equal(businessSignInPath(business),'/auth/login?business='+business);
 assert.equal(businessDestination(business.toUpperCase()),'/?business='+business);
 for(const value of [null,undefined,{},[business],'https://foreign.invalid','//foreign.invalid','/'+business,business+'#secret',business+'\r\nlocation: https://foreign.invalid']){
  assert.equal(businessIdentifier(value),null);assert.equal(businessDestination(value),'/');assert.equal(businessSignInPath(value),'/auth/login');
 }
});

test('untrusted destinations are omitted from the actual encrypted login flow',async()=>fixture(async()=>{
 const response=await identityAction(new Request(env.APP_ORIGIN+'/auth/login?business=https://foreign.invalid&returnTo=https://foreign.invalid'),'login');
 const sealed=response.headers.get('set-cookie').split(';')[0].slice('__Host-musitu-flow='.length);
 const {payload}=await jwtDecrypt(sealed,Buffer.from(env.SESSION_ENCRYPTION_KEY,'base64'));
 assert.equal(payload.business,undefined);assert.equal(payload.returnTo,undefined);
 assert.equal(businessDestination(payload.business),'/');
}));
