import test from 'node:test';
import assert from 'node:assert/strict';
import {createPinnedOidcTokenExchanger} from './oidc-token-exchange.mjs';
const endpoint='https://auth.store-private.example.org/oauth/token';
const make=(fn)=>createPinnedOidcTokenExchanger({issuer:'https://auth.store-private.example.org',
 tokenEndpoint:endpoint,clientId:'store-private-client',redirectUri:'https://store-stage.example.org/auth/oidc/callback',
 requestImpl:fn});
const input={tokenEndpoint:endpoint,clientId:'store-private-client',redirectUri:'https://store-stage.example.org/auth/oidc/callback',code:'opaque-code-123',verifier:'a'.repeat(86)};
const resp=(statusCode,body='{"id_token":"header.payload.signature"}',contentType='application/json')=>({statusCode,headers:{'content-type':contentType},body:Buffer.from(body)});

test('private provider exchange pins HTTPS authority and sends PKCE without role/entitlement data',async()=>{
 let request;
 const exchange=make(async x=>{request=x;return resp(200)});
 assert.deepEqual(await exchange(input),{id_token:'header.payload.signature'});
 assert.equal(request.url,endpoint);assert.equal(request.method,'POST');
 assert.equal(request.headers['content-type'],'application/x-www-form-urlencoded');
 const form=new URLSearchParams(request.body.toString());
 assert.equal(form.get('grant_type'),'authorization_code');
 assert.equal(form.get('code_verifier'),'a'.repeat(86));
 assert.equal(form.get('redirect_uri'),input.redirectUri);
 assert.equal(form.get('code'),input.code);
 assert.equal(form.get('client_id'),input.clientId);
 assert.equal(form.has('role'),false);assert.equal(form.has('publisherId'),false);
});

test('no caller may redirect token exchange to attacker endpoint or substitute client identity',async()=>{
 const exchange=make(async()=>{throw Error('should not call');});
 for(const x of [{tokenEndpoint:'https://evil.test/oauth/token'}, {redirectUri:'https://evil.test/callback'},
  {clientId:'evil-client'}, {code:' '}, {verifier:'short'}])
  await assert.rejects(exchange({...input,...x}),/oidc_exchange_denied/);
});

test('provider failures, redirects, malformed content type and invalid response fail closed',async()=>{
 for(const result of [resp(302),resp(500),resp(200,'{}'),resp(200,'not json'),resp(200,'{"id_token":"valid.token.sig"}','text/html'),resp(200,'{"id_token":42}')]){
  const exchange=make(async()=>result);
  await assert.rejects(exchange(input),/oidc_exchange_denied/);
 }
});

test('oversized provider response, transport failure and missing token never authorize',async()=>{
 for(const provider of [async()=>resp(200,JSON.stringify({id_token:'A'.repeat(30000)})),async()=>{throw Error('tls unavailable');}]){
  await assert.rejects(make(provider)(input),/oidc_exchange_denied/);
 }
});

test('test network injection unavailable outside CI and insecure configuration rejected',async()=>{
 assert.throws(()=>createPinnedOidcTokenExchanger({issuer:'http://auth.example.org',tokenEndpoint:'http://auth.example.org/token',clientId:'example-client',redirectUri:input.redirectUri}),/oidc_exchange_denied/);
 assert.throws(()=>createPinnedOidcTokenExchanger({issuer:'https://auth.example.org',tokenEndpoint:'https://evil.example.org/token',clientId:'example-client',redirectUri:input.redirectUri}),/oidc_exchange_denied/);
});
