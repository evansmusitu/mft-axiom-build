import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {createDeveloperPortal} from './portal.mjs';
const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'P-256'});
const {privateKey:rogueKey}=generateKeyPairSync('ec',{namedCurve:'P-256'});
const now=1792670400;
const b64=obj=>Buffer.from(JSON.stringify(obj)).toString('base64url');
const sha=text=>createHash('sha256').update(text).digest('hex');
function token(overrides={}){
 const {key=privateKey,alg='ES256',kid='pinned',...claims}=overrides;
 const h=b64({alg,typ:'JWT',kid});
 const p=b64({iss:'https://auth.private.example.org',aud:'store-v2-internal',sub:'developer-actor-1',
  role:'developer',publisherId:'approved-test-account',amr:['pwd','mfa'],
  auth_time:now-10,iat:now-20,nbf:now-20,exp:now+300,
  jti:'private-token-test-0001',verified:true,...claims});
 const part=h+'.'+p;
 return part+'.'+sign('sha256',Buffer.from(part),{key,dsaEncoding:'ieee-p1363'}).toString('base64url');
}
const manifest={schema:'musitu.store.publisher-submission.v1',publisherId:'approved-test-account',appId:'trial-app',
 packageId:'org.example.trial',versionCode:1,apkSha256:'a'.repeat(64),apkBytes:32000,
 signingCertificateSha256:'b'.repeat(64),privacyPolicyUrl:'https://example.org/privacy',
 sourceUrl:'https://github.com/example/trial',termsAccepted:true};
const note={schema:'musitu.store.portal-review-note.v1',decision:'REQUEST_EVIDENCE',evidenceSha256:'c'.repeat(64)};
class FakeDurableContract {
 constructor(){this.records=new Map();this.idempotency=new Map();}
 async create(record,key){
  const prev=this.idempotency.get(record.publisherId+':'+key);
  if(prev){const saved=this.records.get(prev);return saved.payloadDigest===record.payloadDigest?
   {kind:'existing',record:saved}:{kind:'conflict'};}
  const id='sub-'+String(this.records.size+1).padStart(5,'0'),entry={...record,id,reviews:[]};
  this.records.set(id,entry);this.idempotency.set(record.publisherId+':'+key,id);
  return {kind:'created',record:entry};
 }
 async read(id){return this.records.get(id)||null;}
 async addReview(id,item){
  const r=this.records.get(id);
  if(!r)return {kind:'missing'};
  if(r.reviews.some(x=>x.role===item.role||x.subject===item.subject))return {kind:'conflict'};
  r.reviews.push(item);return {kind:'created',record:r};
 }
}
function harness(){
 const repository=new FakeDurableContract();
 const portal=createDeveloperPortal({issuer:'https://auth.private.example.org',audience:'store-v2-internal',
   publicKeys:{pinned:publicKey.export({format:'pem',type:'spki'})},now:()=>now*1000,
   origin:'https://store-stage.mftintelligence.com',repository});
 const call=(method,path,{jwt=token(),body,headers={}}={})=>portal(new Request(
  'https://store-stage.mftintelligence.com'+path,{method,headers:{
   ...(jwt?{authorization:'Bearer '+jwt}:{}),
   ...(body?{'content-type':'application/json'}:{}),...headers},
   ...(body?{body:typeof body==='string'?body:JSON.stringify(body)}:{})}));
 const create=opts=>call('POST','/developer/submissions',{body:manifest,
  headers:{'idempotency-key':'test-request-idempotency-000001'},...opts});
 return {call,create,repository};
}
test('P-256 JWT with MFA creates REVIEW_REQUIRED not authorization',async()=>{
 const h=harness(),r=await h.create(),body=await r.json();
 assert.equal(r.status,202);assert.equal(body.state,'REVIEW_REQUIRED');
 for(const f of ['publisherApproved','publicationAuthorized','paymentAuthorized','payoutAuthorized','entitlementGranted'])
  assert.equal(body[f],false);
 assert.equal(h.repository.records.size,1);
});
test('missing, forged, expired, audience/issuer confusion, algorithm confusion and no MFA fail',async()=>{
 const h=harness();
 const bad=[null,token({key:rogueKey}),token({exp:now-2}),token({nbf:now+300}),
  token({iss:'https://evil.example'}),token({aud:'attacker'}),token({alg:'none'}),
  token({kid:'wrong'}),token({amr:['pwd']}),token({auth_time:now-2000}),token({verified:false}),
  token({exp:now+3000})];
 for(const jwt of bad){const r=await h.create({jwt});assert.equal(r.status,401);}
 assert.equal(h.repository.records.size,0);
});
test('developer identity cannot impersonate another publisher',async()=>{
 const h=harness(),r=await h.create({jwt:token({publisherId:'other-publisher'})});
 assert.equal(r.status,403);assert.equal(h.repository.records.size,0);
});
test('reviewer cannot submit and publisher cannot review',async()=>{
 const h=harness();assert.equal((await h.create({jwt:token({role:'review_identity'})})).status,403);
 await h.create();
 assert.equal((await h.call('POST','/review/submissions/sub-00001',{body:note})).status,403);
});
test('malformed or oversized manifests cannot be persisted',async()=>{
 const h=harness();
 const bad=[{...manifest,termsAccepted:false},{...manifest,apkSha256:'BAD'},
  {...manifest,sourceUrl:'https://127.0.0.1/private'},
  {...manifest,privacyPolicyUrl:'http://example.org/privacy'},
  {...manifest,packageId:'bad!'}, {...manifest,versionCode:9007199254740992},
  {...manifest,unexpected:'field'},
  JSON.stringify(manifest).replace('"appId":','"appId":"duplicate","appId":')];
 for(const body of bad){const r=await h.create({body});assert.equal(r.status,400);}
 const huge=await h.create({body:'x'.repeat(8500)});
 assert.equal(huge.status,413);
 assert.equal(h.repository.records.size,0);
});
test('idempotency replays identical body only; rejects changed content',async()=>{
 const h=harness(),a=await h.create();assert.equal(a.status,202);
 const b=await h.create();assert.equal(b.status,200);
 const c=await h.create({body:{...manifest,versionCode:2}});assert.equal(c.status,409);
 assert.equal(h.repository.records.size,1);
});
test('cross-publisher reads are indistinguishable from unknown IDs',async()=>{
 const h=harness();await h.create();
 assert.equal((await h.call('GET','/developer/submissions/sub-00001')).status,200);
 assert.equal((await h.call('GET','/developer/submissions/sub-00001',{jwt:token({publisherId:'other-publisher'})})).status,404);
 assert.equal((await h.call('GET','/developer/submissions/sub-99999')).status,404);
});
test('two separately authenticated reviewer roles record only review evidence',async()=>{
 const h=harness();await h.create();
 const identity=token({role:'review_identity',sub:'identity-reviewer-01'});
 const security=token({role:'review_security',sub:'security-reviewer-02'});
 const url='/review/submissions/sub-00001';
 let r=await h.call('POST',url,{jwt:identity,body:note});assert.equal(r.status,202);
 assert.equal((await r.json()).publicationAuthorized,false);
 assert.equal((await h.call('POST',url,{jwt:identity,body:note})).status,409);
 r=await h.call('POST',url,{jwt:security,body:note});
 assert.equal(r.status,202);const payload=await r.json();
 assert.equal(payload.reviewEvidenceCount,2);assert.equal(payload.state,'REVIEW_REQUIRED');
 assert.equal(payload.publisherApproved,false);
});
test('review body cannot manufacture approval, payout or signed release',async()=>{
 const h=harness();await h.create();
 const jwt=token({role:'review_security'});
 for(const body of [{...note,decision:'APPROVE'}, {...note,publish:true},{...note,evidenceSha256:'corrupt'}])
  assert.equal((await h.call('POST','/review/submissions/sub-00001',{jwt,body})).status,400);
});
test('forbid cookies, cross-origin writes, unsupported paths and missing content type',async()=>{
 const h=harness();
 assert.equal((await h.call('POST','/developer/submissions')).status,415);
 assert.equal((await h.call('POST','/developer/submissions',
  {body:manifest,headers:{origin:'https://attacker.invalid'}})).status,403);
 assert.equal((await h.call('GET','/admin/publish')).status,404);
 assert.equal((await h.call('GET','/developer/submissions/sub-00001',
  {headers:{cookie:'stolen=session'}})).status,401);
});

test('32-byte-hex database submission ID is accessible to owner and independently authenticated reviewer',async()=>{
 const h=harness();await h.create();
 const id='sub-'+'a'.repeat(32);
 const prior=h.repository.records.get('sub-00001');
 h.repository.records.set(id,{...prior,id,reviews:[]});
 const owner=await h.call('GET','/developer/submissions/'+id);
 assert.equal(owner.status,200);
 const reviewer=await h.call('POST','/review/submissions/'+id,{
  jwt:token({role:'review_security',sub:'cryptorandom-reviewer-02'}),body:note
 });
 assert.equal(reviewer.status,202);
 assert.equal((await reviewer.json()).publicationAuthorized,false);
});
