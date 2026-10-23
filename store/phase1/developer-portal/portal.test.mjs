import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign as signRaw,createHash} from 'node:crypto';
import {createPrivateDeveloperPortal} from './portal.mjs';

const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const PUBLIC=publicKey.export({type:'spki',format:'pem'}),PIN=createHash('sha256').update(PUBLIC).digest('hex');
const ISSUER='https://login.example.test',AUDIENCE='musitu-store-v2-private-publisher-pilot',KID='owner-approved-test-key';
const now=Date.parse('2026-10-23T03:00:00.000Z'),encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
function token(scope='publisher.submit',subject='publisher_001',patch={},head={}){
 const header=encode({alg:'ES256',typ:'at+jwt',kid:KID,...head});
 const payload=encode({iss:ISSUER,aud:AUDIENCE,sub:subject,scope,iat:Math.floor(now/1000)-5,nbf:Math.floor(now/1000)-5,exp:Math.floor(now/1000)+300,...patch});
 const signingInput=header+'.'+payload;
 const sig=signRaw('sha256',Buffer.from(signingInput),{key:privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');
 return signingInput+'.'+sig;
}
function form(overrides={}){
 return {schema:'musitu.store.publisher-submission.v2',submissionId:'submission-001',appId:'exampleapp',
 packageId:'org.example.app',versionCode:42,apkBytes:5120,apkSha256:'a'.repeat(64),
 signingCertificateSha256:'b'.repeat(64),privacyPolicyUrl:'https://developer.example.org/privacy',...overrides};
}
function req(method,path,bearer,body,headers={}){
 return new Request('https://private-store.example.test'+path,{method,headers:{
 ...headers,...(bearer?{authorization:'Bearer '+bearer}:{}),
 ...(body?{'content-type':'application/json'}:{})},
 body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body)});
}
function fixture(){
 const submissions=new Map(),reviews=new Map(),storage={
  async create(subject,s){if(submissions.has(s.submissionId))return false;submissions.set(s.submissionId,{...s,publisherSubject:subject,state:'REVIEW_REQUIRED'});return true;},
  async list(subject){return [...submissions.values()].filter(s=>s.publisherSubject===subject);},
  async queue(){return [...submissions.values()];},
  async review(id,role,subject,digest){const s=submissions.get(id);if(!s||s.publisherSubject===subject)return false;
   const list=reviews.get(id)||[];if(list.some(x=>x.subject===subject||x.role===role))return false;
   list.push({role,subject,digest});reviews.set(id,list);return true;}
 };
 return createPrivateDeveloperPortal({identity:{issuer:ISSUER,audience:AUDIENCE,kid:KID,publicKeyPem:PUBLIC,publicKeySha256:PIN},storage,now:()=>now});
}
test('P-256 access token can submit evidence, but never grant app publication or commerce',async()=>{
 const handle=fixture(),p='/store/private/developer/submissions';
 const r=await handle(req('POST',p,token(),form()));
 assert.equal(r.status,202);const out=await r.json();
 assert.equal(out.state,'REVIEW_REQUIRED');
 for(const k of ['publicationAuthorized','payoutAuthorized','entitlementGranted','commerceEnabled','enrolledPublisher'])assert.equal(out[k],false);
 assert.equal((await handle(req('POST',p,token(),form()))).status,409);
});
test('publisher cannot enumerate other tenant or read identity-review queue',async()=>{
 const handle=fixture(),p='/store/private/developer/submissions';
 assert.equal((await handle(req('POST',p,token(),form()))).status,202);
 const mine=await handle(req('GET',p,token('publisher.submit','publisher_002')));
 assert.equal(mine.status,200);assert.deepEqual((await mine.json()).submissions,[]);
 assert.equal((await handle(req('GET','/store/private/reviewer/queue',token()))).status,403);
});
test('reject missing/unsigned/expired/wrong issuer or audience/rogue alg/spoofed role headers',async()=>{
 const handle=fixture(),p='/store/private/developer/submissions';
 for(const bad of [undefined,token().slice(0,-5)+'xxxxx',
  token('publisher.submit','publisher_001',{exp:Math.floor(now/1000)-1}),
  token('publisher.submit','publisher_001',{iss:'https://evil.invalid'}),
  token('publisher.submit','publisher_001',{aud:'other-audience'}),
  token('publisher.submit','publisher_001',{}, {alg:'none'}),'not-jwt']){
  assert.equal((await handle(req('GET',p,bad,undefined,{'x-user-id':'publisher_001','x-user-role':'admin'}))).status,401);
 }
});
test('reject escalation of reviewer tokens or client-provided publisher identity',async()=>{
 const handle=fixture(),p='/store/private/developer/submissions';
 assert.equal((await handle(req('POST',p,token('review.identity','reviewer_001'),form()))).status,403);
 assert.equal((await handle(req('POST',p,token(),form({publisherSubject:'admin'})))).status,422);
});
test('reject bad package data, URL injection, unsafe integers, duplicate JSON keys and oversized body',async()=>{
 const handle=fixture(),p='/store/private/developer/submissions';
 for(const bad of [form({apkSha256:'bad'}),form({privacyPolicyUrl:'http://localhost/a'}),
  form({versionCode:9007199254740992}),form({appId:'../attack'})]){
  assert.equal((await handle(req('POST',p,token(),bad))).status,422);
 }
 assert.equal((await handle(req('POST',p,token(),'{\"schema\":\"x\",\"schema\":\"y\"}'))).status,422);
 assert.equal((await handle(req('POST',p,token(),'x'.repeat(17000)))).status,413);
});
test('distinct reviewer evidence never approves a real publisher or installs any package',async()=>{
 const handle=fixture(),p='/store/private/developer/submissions';
 assert.equal((await handle(req('POST',p,token(),form()))).status,202);
 const queue=await handle(req('GET','/store/private/reviewer/queue',token('review.identity','reviewer_001')));
 assert.equal(queue.status,200);assert.equal((await queue.json()).submissions.length,1);
 const rp='/store/private/reviewer/submissions/submission-001/reviews';
 assert.equal((await handle(req('POST',rp,token(),{evidenceSha256:'c'.repeat(64)}))).status,403);
 assert.equal((await handle(req('POST',rp,token('review.identity','publisher_001'),{evidenceSha256:'c'.repeat(64)}))).status,409);
 const first=await handle(req('POST',rp,token('review.identity','reviewer_001'),{evidenceSha256:'c'.repeat(64)}));
 assert.equal(first.status,202);assert.equal((await first.json()).publicationAuthorized,false);
 assert.equal((await handle(req('POST',rp,token('review.identity','reviewer_001'),{evidenceSha256:'c'.repeat(64)}))).status,409);
 const second=await handle(req('POST',rp,token('review.security','reviewer_002'),{evidenceSha256:'d'.repeat(64)}));
 assert.equal(second.status,202);assert.equal((await second.json()).publicationAuthorized,false);
 assert.equal((await handle(req('POST',rp,token('review.security','reviewer_001'),{evidenceSha256:'e'.repeat(64)}))).status,409);
});
test('unknown commerce routes and forbidden methods are never implemented',async()=>{
 const handle=fixture();
 assert.equal((await handle(req('DELETE','/store/private/developer/submissions',token()))).status,405);
 assert.equal((await handle(req('GET','/store/private/checkout',token()))).status,404);
});
