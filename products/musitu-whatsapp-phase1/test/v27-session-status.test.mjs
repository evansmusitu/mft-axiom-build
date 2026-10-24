import test from 'node:test';
import assert from 'node:assert/strict';
import {createSessionStatusHandler} from '../src/staging/session-status.mjs';
import {readBusinessSession} from '../src/dashboard/session-status.mjs';
import {GET} from '../app/api/session/route.js';

test('session status authenticates the actual request and returns no identity or credential material',async()=>{
 const request=new Request('https://app.example.invalid/api/session?subject=forged');let seen;
 const handler=createSessionStatusHandler({authenticate:async value=>{seen=value;return{subject:'synthetic-private-subject',accessToken:'synthetic-private-token'};}});
 const response=await handler(request);assert.equal(seen,request);assert.equal(response.status,200);
 assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('referrer-policy'),'no-referrer');
 assert.deepEqual(await response.json(),{signedIn:true});assert.equal(response.headers.has('set-cookie'),false);
});

test('expired, revoked and unverified sessions never appear signed in; provider failure remains unknown',async()=>{
 for(const reason of ['SESSION_REQUIRED','SESSION_REVOKED','SESSION_MFA_REQUIRED','OIDC_AUTH_TIME_REJECTED','ERR_JWT_EXPIRED','ERR_JWE_DECRYPTION_FAILED','ERR_JWS_SIGNATURE_VERIFICATION_FAILED','private provider error with synthetic-token']){
  const handler=createSessionStatusHandler({authenticate:async()=>{throw Error(reason);}}),response=await handler(new Request('https://app.example.invalid/api/session'));
  const rejected=!reason.startsWith('private');assert.equal(response.status,rejected?401:503);assert.deepEqual(await response.json(),{signedIn:rejected?false:null});
 }
 for(const actor of [undefined,{}, {subject:42},{subject:''}]){
  const response=await createSessionStatusHandler({authenticate:async()=>actor})(new Request('https://app.example.invalid/api/session'));
  assert.equal(response.status,401);assert.deepEqual(await response.json(),{signedIn:false});
 }
});

test('real unauthenticated status route ignores browser identity claims without provider transport',async()=>{
 const saved=globalThis.fetch;globalThis.fetch=()=>assert.fail('No-cookie status must not reach the provider');
 try{
  const response=await GET(new Request('https://app.example.invalid/api/session?signedIn=true',{headers:{'x-user-id':'forged-owner','x-signed-in':'true'}}));
  assert.equal(response.status,401);assert.deepEqual(await response.json(),{signedIn:false});
 }finally{globalThis.fetch=saved;}
});

test('dashboard accepts only explicit validated status contracts and uses same-origin session cookies',async()=>{
 for(const [status,body,expected]of [[200,{signedIn:true},true],[401,{signedIn:false},false],[503,{signedIn:null},null],[200,{signedIn:'true'},null],[401,{signedIn:true},null]]){
  const result=await readBusinessSession(async(url,options)=>{assert.equal(url,'/api/session');assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');assert.equal(options.credentials,'same-origin');return Response.json(body,{status});});
  assert.equal(result,expected);
 }
 for(const transport of [async()=>new Response('<html>hosting sign-in</html>'),async()=>{throw Error('network unavailable');},async()=>({redirected:true})])assert.equal(await readBusinessSession(transport),null);
});
