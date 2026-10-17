import test from 'node:test';
import assert from 'node:assert/strict';
import {createPrivateOidcCodeExchanger} from '../src/commercial/mmf-oidc-private-token-exchange.mjs';

const opts={issuer:'https://login.example.org/realms/mmf',
 tokenEndpoint:'https://login.example.org/realms/mmf/protocol/openid-connect/token',
 clientId:'mmf-private-browser-client',redirectUri:'https://stage.example.org/private/oidc/callback'};
const input={code:'EXAMPLE-AUTH-CODE-2026',codeVerifier:'A'.repeat(43),
 clientId:opts.clientId,redirectUri:opts.redirectUri,signal:AbortSignal.timeout(4000)};
const jwt='eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJ0ZXN0In0.c2ln';
const ok=(value)=>new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json; charset=utf-8'}});

test('root HTTPS issuer permits its pinned token endpoint without rewriting the issuer',async()=>{
 const root='https://login.example.org';const tokenEndpoint=root+'/oauth/v2/token';
 const exchange=createPrivateOidcCodeExchanger({...opts,issuer:root,tokenEndpoint,fetchImpl:async(url)=>{
  assert.equal(url,tokenEndpoint);return ok({id_token:jwt});
 }});
 assert.deepEqual(await exchange(input),{id_token:jwt});
 for(const issuer of [root+'?x=1',root+'#frag','https://user@login.example.org','http://login.example.org'])
  assert.throws(()=>createPrivateOidcCodeExchanger({...opts,issuer,tokenEndpoint}),/MMF_PRIVATE_OIDC_EXCHANGE_DENIED/);
 assert.throws(()=>createPrivateOidcCodeExchanger({...opts,issuer:root,tokenEndpoint:'https://other.example.org/oauth/v2/token'}),/MMF_PRIVATE_OIDC_EXCHANGE_DENIED/);
});

test('registered @ client ID is form-encoded exactly and cannot be substituted',async()=>{
 const clientId='170086824411201793@portal';let calls=0;
 const exchange=createPrivateOidcCodeExchanger({...opts,clientId,fetchImpl:async(url,req)=>{
  calls++;assert.equal(url,opts.tokenEndpoint);
  assert.match(req.body,/client_id=170086824411201793%40portal(?:&|$)/);
  const form=new URLSearchParams(req.body);
  assert.equal(form.get('client_id'),clientId);
  assert.equal(form.get('code_verifier'),input.codeVerifier);
  assert.equal(form.get('grant_type'),'authorization_code');
  return ok({id_token:jwt});
 }});
 assert.deepEqual(await exchange({...input,clientId}),{id_token:jwt});
 await assert.rejects(()=>exchange({...input,clientId:'170086824411201793@other'}),/MMF_PRIVATE_OIDC_EXCHANGE_DENIED/);
 assert.equal(calls,1);
 for(const bad of ['client\n@portal','client @portal','client@portal/other','client@portal?x=1'])
  assert.throws(()=>createPrivateOidcCodeExchanger({...opts,clientId:bad}),/MMF_PRIVATE_OIDC_EXCHANGE_DENIED/);
});

test('exchange uses exact approved endpoint, confidential POST, PKCE, and returns only ID token',async()=>{
 let calls=0;
 const exchanger=createPrivateOidcCodeExchanger({...opts,fetchImpl:async(url,req)=>{
  calls++;
  assert.equal(url,opts.tokenEndpoint);
  assert.equal(req.method,'POST');assert.equal(req.redirect,'error');
  assert.equal(req.credentials,'omit');assert.equal(req.cache,'no-store');
  assert.equal(req.referrerPolicy,'no-referrer');
  assert.equal(req.headers['content-type'],'application/x-www-form-urlencoded');
  const body=new URLSearchParams(req.body);
  assert.deepEqual(Object.fromEntries(body),{
   grant_type:'authorization_code',code:input.code,code_verifier:input.codeVerifier,
   client_id:input.clientId,redirect_uri:input.redirectUri});
  return ok({access_token:'DO_NOT_RETURN',id_token:jwt,token_type:'Bearer',expires_in:300});
 }});
 assert.deepEqual(await exchanger(input),{id_token:jwt});
 assert.equal(calls,1);
});

test('unapproved endpoint, redirect URI, issuer and credential override are rejected before network',async()=>{
 let calls=0;const fake=async()=>{calls++;return ok({id_token:jwt})};
 for(const patch of [
  {tokenEndpoint:'https://evil.example.org/token'},
  {tokenEndpoint:'https://login.example.org/realms/mmf-evil/token'},
  {tokenEndpoint:'http://login.example.org/realms/mmf/token'},
  {tokenEndpoint:opts.tokenEndpoint+'?response=unsafe'},
  {issuer:'https://login.example.org/realms/mmf?x=1'},
  {redirectUri:'https://stage.example.org/private/oidc/callback#frag'}
 ])assert.throws(()=>createPrivateOidcCodeExchanger({...opts,...patch,fetchImpl:fake}),/MMF_PRIVATE_OIDC_EXCHANGE_DENIED/);
 const exchange=createPrivateOidcCodeExchanger({...opts,fetchImpl:fake});
 for(const patch of [
  {clientId:'attacker-client'}, {redirectUri:'https://evil.example.org/callback'},
  {code:'bad\ncode'}, {codeVerifier:'A'.repeat(42)}, {signal:'invalid'}
 ])await assert.rejects(()=>exchange({...input,...patch}),/MMF_PRIVATE_OIDC_EXCHANGE_DENIED/);
 assert.equal(calls,0);
});

test('all remote failure modes deny generically, never return provider errors or tokens',async()=>{
 const bodies=[
  new Response('server is down',{status:503}),
  new Response('INVALID_CLIENT secret here',{status:400}),
  new Response('<html>bad</html>',{status:200,headers:{'content-type':'text/html'}}),
  ok({access_token:'no-id-token',token_type:'Bearer'}),
  ok({id_token:jwt,token_type:'Basic'}),
  ok({id_token:jwt,expires_in:-1}),
  new Response('x'.repeat(17000),{status:200,headers:{'content-type':'application/json'}}),
  new Response('redirect',{status:302,headers:{location:'https://evil.example.org'}})
 ];
 for(const response of bodies){
  const exchange=createPrivateOidcCodeExchanger({...opts,fetchImpl:async()=>response});
  await assert.rejects(()=>exchange(input),e=>e.message==='MMF_PRIVATE_OIDC_EXCHANGE_DENIED');
 }
 const network=createPrivateOidcCodeExchanger({...opts,fetchImpl:async()=>{throw Error('PRIVATE_PROVIDER_SECRET')}});
 await assert.rejects(()=>network(input),e=>e.message==='MMF_PRIVATE_OIDC_EXCHANGE_DENIED');
});
