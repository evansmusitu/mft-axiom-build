import test from 'node:test';
import assert from 'node:assert/strict';
import {qualifiedLoginRedirect} from '../customer_control_plane/login_broker.mjs';

// Reject untrusted IdP broker output before redirect; no real identity or billing calls.
const clientId='axiom-browser-client';
const callback='https://portal.mftintelligence.com/oauth/callback';
const url=()=>{
 const u=new URL('https://auth.mftintelligence.com/oauth/authorize');
 for(const [name,value] of Object.entries({
  client_id:clientId, redirect_uri:callback, response_type:'code',
  state:'A'.repeat(43), nonce:'C'.repeat(43),
  code_challenge:'B'.repeat(43),code_challenge_method:'S256',scope:'openid profile'
 }))u.searchParams.set(name,value);
 return u;
};
const env=(authorization_url,extra={})=>({
 CUSTOMER_OAUTH_CLIENT_ID:clientId,
 CUSTOMER_LOGIN_REDIRECT_URI:callback,
 IDENTITY_LOGIN_QUALIFIED:'qualified_private_binding',
 IDENTITY_LOGIN_SERVICE:{fetch:async()=>new Response(JSON.stringify({authorization_url}),{status:200})},
 ...extra
});
const rejects=async(u,opts)=>assert.rejects(qualifiedLoginRedirect(env(u.toString(),opts)),/invalid_login_redirect|login_configuration_unqualified/);

test('valid pinned authorization-code OIDC redirect is admitted through qualified binding',async()=>{
 const good=url().toString();
 assert.equal(await qualifiedLoginRedirect(env(good)),good);
});

test('private broker cannot substitute OAuth client, callback or response type',async()=>{
 for(const [name,value] of [['client_id','attacker-browser'],['redirect_uri','https://evil.example/steal'],['response_type','token']]){
  const u=url();u.searchParams.set(name,value);await rejects(u);
 }
 await rejects(url(),{CUSTOMER_OAUTH_CLIENT_ID:'different-client'});
 await rejects(url(),{CUSTOMER_LOGIN_REDIRECT_URI:'https://evil.example/callback'});
});

test('client and callback must be configured under owned HTTPS domain',async()=>{
 for(const patch of [
  {CUSTOMER_OAUTH_CLIENT_ID:null},{CUSTOMER_OAUTH_CLIENT_ID:'short'},
  {CUSTOMER_LOGIN_REDIRECT_URI:'http://portal.mftintelligence.com/callback'},
  {CUSTOMER_LOGIN_REDIRECT_URI:'https://mftintelligence.com.evil.example/callback'},
  {CUSTOMER_LOGIN_REDIRECT_URI:'https://portal.mftintelligence.com/callback?next=evil'}
 ])await rejects(url(),patch);
});

test('ambiguous duplicated OAuth parameters are denied',async()=>{
 for(const name of ['client_id','redirect_uri','response_type','state','nonce','code_challenge','code_challenge_method','scope']){
  const u=url();u.searchParams.append(name,u.searchParams.get(name));await rejects(u);
 }
});

test('weak or absent state, nonce, PKCE, code flow or openid scope is denied',async()=>{
 for(const [name,value] of [
  ['state','short'],['nonce','short'],['code_challenge','weak'],
  ['code_challenge_method','plain'],['scope','email profile'],['response_type','id_token']
 ]){const u=url();u.searchParams.set(name,value);await rejects(u);}
 for(const name of ['nonce','state','code_challenge','client_id','redirect_uri','scope']){
  const u=url();u.searchParams.delete(name);await rejects(u);
 }
});

test('private service qualification is required',async()=>{
 const good=url().toString();
 await assert.rejects(qualifiedLoginRedirect(env(good,{IDENTITY_LOGIN_QUALIFIED:'not_qualified'})),/login_not_qualified/);
 await assert.rejects(qualifiedLoginRedirect(env(good,{IDENTITY_LOGIN_SERVICE:null})),/login_not_qualified/);
});
