import test from 'node:test';
import assert from 'node:assert/strict';
import {identityFailureDiagnostic} from '../src/staging/identity-diagnostics.mjs';
import {identityAction} from '../src/staging/identity.mjs';

test('identity diagnostics report only bounded stages, error codes and claim names',()=>{
 const error=Object.assign(new Error('private token and credentials must never be logged'),{code:'ERR_JWT_CLAIM_VALIDATION_FAILED',claim:'aud',value:'private-claim-value'});
 assert.deepEqual(identityFailureDiagnostic('ACCESS_VALIDATION',error),{event:'MUSITU_IDENTITY_DENIED',stage:'ACCESS_VALIDATION',reason:'ERR_JWT_CLAIM_VALIDATION_FAILED',claim:'aud'});
 const unknown=identityFailureDiagnostic('private-stage',Object.assign(error,{code:'private-error',claim:'private-claim'}));
 assert.deepEqual(unknown,{event:'MUSITU_IDENTITY_DENIED',stage:'REQUEST',reason:'UNCLASSIFIED',claim:'NONE'});
 assert.equal(JSON.stringify(unknown).includes('private'),false);
});
test('callback failure stages distinguish flow rejection from actual token transport without exposing flow material',async()=>{
 const env={OIDC_PROVIDER:'zitadel',OIDC_ISSUER:'https://diagnostic-synthetic.zitadel.cloud',OIDC_CLIENT_ID:'web-synthetic',OIDC_CLIENT_SECRET:'synthetic-secret',OIDC_AUDIENCE:'api-synthetic',OIDC_INTROSPECTION_CLIENT_ID:'api-synthetic',OIDC_INTROSPECTION_CLIENT_SECRET:'synthetic-api-secret',APP_ORIGIN:'https://app.example.invalid',SESSION_ENCRYPTION_KEY:Buffer.alloc(32,9).toString('base64')};
 const saved=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]])),oldFetch=globalThis.fetch,stages=[];Object.assign(process.env,env);
 const onStage=stage=>stages.push(stage);
 globalThis.fetch=async(url)=>{
  if(String(url).endsWith('/.well-known/openid-configuration'))return Response.json({issuer:env.OIDC_ISSUER,authorization_endpoint:env.OIDC_ISSUER+'/oauth/v2/authorize',token_endpoint:env.OIDC_ISSUER+'/oauth/v2/token',introspection_endpoint:env.OIDC_ISSUER+'/oauth/v2/introspect',jwks_uri:env.OIDC_ISSUER+'/oauth/v2/keys',end_session_endpoint:env.OIDC_ISSUER+'/oidc/v1/end_session',id_token_signing_alg_values_supported:['RS256'],code_challenge_methods_supported:['S256'],response_types_supported:['code'],token_endpoint_auth_methods_supported:['client_secret_basic']});
  assert.equal(String(url),env.OIDC_ISSUER+'/oauth/v2/token');return Response.json({error:'synthetic_invalid_client'},{status:401});
 };
 try{
  await assert.rejects(identityAction(new Request(env.APP_ORIGIN+'/auth/callback'),'callback',{onStage}));assert.equal(stages.at(-1),'FLOW_VALIDATION');
  const login=await identityAction(new Request(env.APP_ORIGIN+'/auth/login'),'login'),target=new URL(login.headers.get('location')),cookie=login.headers.get('set-cookie').split(';')[0];stages.length=0;
  await assert.rejects(identityAction(new Request(env.APP_ORIGIN+'/auth/callback?'+new URLSearchParams({state:target.searchParams.get('state'),code:'synthetic-authorization-code'}),{headers:{cookie}}),'callback',{onStage}),/IDENTITY_PROVIDER_UNAVAILABLE/);
  assert.equal(stages.at(-1),'TOKEN_EXCHANGE');assert.equal(stages.includes('ACCESS_VALIDATION'),false);
 }finally{globalThis.fetch=oldFetch;for(const [k,v]of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});
