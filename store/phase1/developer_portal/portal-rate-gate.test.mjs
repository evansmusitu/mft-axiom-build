import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createDeveloperPortal} from './portal.mjs';
const {publicKey,privateKey}=generateKeyPairSync('ec',{namedCurve:'P-256'});
const fixed=1792670400;
const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
function jwt(claims={}){
 const header=encode({alg:'ES256',kid:'secure',typ:'JWT'});
 const body=encode({iss:'https://idp.example.org',aud:'store-v2-internal',sub:'test-developer-01',
  publisherId:'test-publisher',role:'developer',amr:['mfa'],auth_time:fixed-10,
  iat:fixed-20,nbf:fixed-20,exp:fixed+200,verified:true,jti:'token-00000001',...claims});
 const message=header+'.'+body;
 return message+'.'+sign('sha256',Buffer.from(message),{key:privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');
}
const submission={schema:'musitu.store.publisher-submission.v1',publisherId:'test-publisher',appId:'test-app',
 packageId:'org.example.test',versionCode:1,apkSha256:'a'.repeat(64),apkBytes:32000,
 signingCertificateSha256:'b'.repeat(64),privacyPolicyUrl:'https://example.org/privacy',
 sourceUrl:'https://example.org/source',termsAccepted:true};
function fixture(takeRatePermit){let writes=0,reads=0;
 const repo={async create(){writes++;return {kind:'created',record:{id:'sub-'+'a'.repeat(32)}};},
  async read(){reads++;return null;},async addReview(){throw Error('must not review');}};
 const portal=createDeveloperPortal({issuer:'https://idp.example.org',audience:'store-v2-internal',
  publicKeys:{secure:publicKey.export({format:'pem',type:'spki'})},now:()=>fixed*1000,
  origin:'https://store.example.org',repository:repo,isTokenActive:async()=>true,takeRatePermit});
 const request=()=>new Request('https://store.example.org/developer/submissions',{
  method:'POST',headers:{authorization:'Bearer '+jwt(),'content-type':'application/json',
   'idempotency-key':'rate-test-request-0000000001'},body:JSON.stringify(submission)});
 return {portal,request,get written(){return writes;},get reads(){return reads;}};
}
test('missing durable private rate permit provider fails closed before repository access',async()=>{
 const f=fixture(undefined);const r=await f.portal(f.request());
 assert.equal(r.status,503);assert.equal(f.written,0);assert.equal(f.reads,0);
});
test('exhausted signed principal or publisher rate cap returns 429 without intake',async()=>{
 const f=fixture(async()=>false);const r=await f.portal(f.request());
 assert.equal(r.status,429);assert.equal(r.headers.get('retry-after'),'60');
 assert.equal((await r.json()).paymentAuthorized,false);assert.equal(f.written,0);
});
test('database quota outage cannot silently allow authenticated mutation',async()=>{
 const f=fixture(async()=>{throw Error('database quota offline');});
 const r=await f.portal(f.request());assert.equal(r.status,503);assert.equal(f.written,0);
});
test('valid private rate grant permits the same signed request exactly once',async()=>{
 let n=0,calls=[];
 const f=fixture(async claims=>{n++;calls.push(claims);return true;});
 const r=await f.portal(f.request());assert.equal(r.status,202);assert.equal(f.written,1);
 assert.equal(n,1);assert.deepEqual(calls[0],{issuer:'https://idp.example.org',subject:'test-developer-01',
  role:'developer',publisherId:'test-publisher',route:'submit',tokenId:'token-00000001',
  audience:'store-v2-internal',expiresAt:fixed+200});
});
test('reviewer token cannot smuggle a developer publisher binding into private authorization',async()=>{
 const f=fixture(async()=>true);
 const req=new Request('https://store.example.org/developer/submissions/sub-'+'a'.repeat(32),{
  method:'GET',headers:{authorization:'Bearer '+jwt({role:'review_security',publisherId:'test-publisher'})}});
 const r=await f.portal(req);
 assert.equal(r.status,401);assert.equal(f.reads,0);
});
