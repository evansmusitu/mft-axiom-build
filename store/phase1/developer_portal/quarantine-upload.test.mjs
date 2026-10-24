import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {createDeveloperPortal} from './portal.mjs';
import {createPostgresReviewRepository} from './postgres-repository.mjs';
const ORIGIN='https://store-stage.mftintelligence.com';
const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'P-256'});
const time=1792670400;
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
const sha=x=>createHash('sha256').update(x).digest('hex');
const apk=Buffer.concat([Buffer.from([80,75,3,4]),Buffer.alloc(124,0x4a)]);
function jwt(patch={}){
 const h=b64({alg:'ES256',typ:'JWT',kid:'pinned'});
 const p=b64({iss:'https://idp.example.org',aud:'store-v2-internal',sub:'developer-actor-1',
  role:'developer',publisherId:'test-publisher',amr:['mfa'],auth_time:time-10,
  iat:time-20,nbf:time-20,exp:time+300,jti:'quarantine-test-token-0001',verified:true,...patch});
 const signed=h+'.'+p;
 return signed+'.'+sign('sha256',Buffer.from(signed),{key:privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');
}
function harness({owner='test-publisher',body=apk,expectedHash=sha(apk),expectedBytes=apk.length,
 failSeal=false,failDb=false,missingStore=false}={}){
 const record={id:'sub-'+'e'.repeat(32),publisherId:owner,actorId:'developer-actor-1',
  apkSha256:expectedHash,apkBytes:expectedBytes,reviews:[]};
 const objects=[];let writes=0,aborts=0,revokes=0,dbWrites=0;
 const store={async begin(){
  writes++;
  return {async write(bytes){objects.push(Buffer.from(bytes));},
   async seal(){if(failSeal)throw Error('seal_failure');return 'private/apk/'+('a'.repeat(32));},
   async abort(){aborts++;}};
 },async revoke(){revokes++;}};
 const repo={async read(id){return id===record.id?record:null;},
  async create(){throw Error('not used');},async addReview(){throw Error('not used');},
  async recordUpload(){dbWrites++;return {kind:failDb?'conflict':'created'};}};
 const portal=createDeveloperPortal({issuer:'https://idp.example.org',audience:'store-v2-internal',
  publicKeys:{pinned:publicKey.export({format:'pem',type:'spki'})},repository:repo,
  quarantine:missingStore?undefined:store,origin:ORIGIN,now:()=>time*1000,
  isTokenActive:async()=>true});
 async function upload({path='/developer/submissions/'+record.id+'/apk',method='PUT',token=jwt(),
   type='application/vnd.android.package-archive',bytes=body,headers={}}={}){
  const all={authorization:'Bearer '+token,'content-type':type,...headers};
  const req=new Request(ORIGIN+path,{method,headers:all,body:bytes,duplex:'half'});
  return portal(req);
 }
 return {upload,record,objects,get writes(){return writes;},get aborts(){return aborts;},
  get revokes(){return revokes;},get dbWrites(){return dbWrites;}};
}
test('owner private upload quarantined only, never approved, paid, released or scanned',async()=>{
 const h=harness(),r=await h.upload();assert.equal(r.status,202);
 const data=await r.json();assert.equal(data.state,'QUARANTINED_UNSCANNED');
 assert.equal(data.publicationAuthorized,false);assert.equal(data.paymentAuthorized,false);
 assert.equal(data.publisherApproved,false);assert.equal(data.entitlementGranted,false);
 assert.equal(Buffer.concat(h.objects).equals(apk),true);
 assert.equal(h.dbWrites,1);
});
test('verified but different publisher never starts storage',async()=>{
 const h=harness(),r=await h.upload({token:jwt({publisherId:'another-publisher'})});
 assert.equal(r.status,404);assert.equal(h.writes,0);
});
test('cross-role reviewer cannot upload even if cryptographically authenticated',async()=>{
 const h=harness(),r=await h.upload({token:jwt({role:'review_security',sub:'another-reviewer'})});
 assert.equal(r.status,403);assert.equal(h.writes,0);
});
test('unauthenticated and bad signatures never allocate quarantine storage',async()=>{
 const h=harness();assert.equal((await h.upload({token:'broken.token.here'})).status,401);
 assert.equal(h.writes,0);
});
test('declared size mismatch fails before storage',async()=>{
 const h=harness();assert.equal((await h.upload({headers:{'content-length':'99'}})).status,413);
 assert.equal(h.writes,0);
});
test('stream size overrun aborts without saving receipt',async()=>{
 const h=harness({expectedBytes:apk.length-2});
 assert.equal((await h.upload()).status,413);assert.equal(h.dbWrites,0);assert.equal(h.aborts,1);
});
test('truncated stream aborts and denies receipt',async()=>{
 const h=harness({expectedBytes:apk.length+5});
 assert.equal((await h.upload()).status,422);assert.equal(h.dbWrites,0);assert.equal(h.aborts,1);
});
test('cryptographic hash mismatch and non-zip magic each abort',async()=>{
 const badHash=harness({expectedHash:'f'.repeat(64)});
 assert.equal((await badHash.upload()).status,422);assert.equal(badHash.dbWrites,0);
 const badMagic=Buffer.alloc(apk.length,0x5a);
 const badZip=harness({body:badMagic,expectedHash:sha(badMagic)});
 assert.equal((await badZip.upload()).status,422);assert.equal(badZip.dbWrites,0);
});
test('storage or journal failure returns 503/409 and quarantined object is revoked',async()=>{
 const sealed=harness({failSeal:true});assert.equal((await sealed.upload()).status,503);
 assert.equal(sealed.aborts,1);assert.equal(sealed.dbWrites,0);
 const denied=harness({failDb:true});assert.equal((await denied.upload()).status,409);
 assert.equal(denied.revokes,1);
});
test('no adapter, forged request type and disallowed Origin fail closed',async()=>{
 const none=harness({missingStore:true});assert.equal((await none.upload()).status,503);
 const wrong=harness();assert.equal((await wrong.upload({type:'text/plain'})).status,415);
 assert.equal((await wrong.upload({headers:{origin:'https://wrong.example.org'}})).status,403);
 assert.equal(wrong.writes,0);
});
test('SQL repository binds exact manifest in atomic INSERT, never trusts client path',async()=>{
 const calls=[];const repo=createPostgresReviewRepository({query:async(sql,params)=>{
  calls.push({sql,params});return {rowCount:1,rows:[{submission_id:'sub-'+'e'.repeat(32)}]};
 }});
 const x=await repo.recordUpload({submissionId:'sub-'+'e'.repeat(32),publisherId:'test-publisher',
  sha256:sha(apk),bytes:apk.length,objectKey:'private/apk/'+('a'.repeat(32))});
 assert.equal(x.kind,'created');assert.match(calls[0].sql,/s\.publisher_id=\$2/);
 assert.match(calls[0].sql,/s\.apk_sha256=\$3/);assert.match(calls[0].sql,/s\.apk_bytes=\$4/);
 assert.match(calls[0].sql,/ON CONFLICT DO NOTHING/);
 assert.equal(calls[0].params.length,5);
 assert.ok(!calls[0].sql.includes('test-publisher'));
});
