import test from 'node:test';
import assert from 'node:assert/strict';
import {createPostgresSessionStatus} from './postgres-session-status.mjs';
const subject='verified-developer-01',tokenId='signed-jwt-token-0001',publisherId='publisher-alpha';
const ctx={tokenId,subject,role:'developer',publisherId,expiresAt:1792670400,issuer:'https://auth.example.org',audience:'store-v2-internal'};
function mock(rows=[{is_active:true}],rowCount=rows.length){
 const calls=[];
 const query=async(sql,params)=>{calls.push({sql,params});return {rows,rowCount};};
 return {status:createPostgresSessionStatus({query}),calls};
}
test('exact issuer-bound token, subject, role, publisher and expiration are parameterized',async()=>{
 const h=mock();assert.equal(await h.status(ctx),true);assert.equal(h.calls.length,1);
 assert.deepEqual(h.calls[0].params,[tokenId,subject,'developer',publisherId,1792670400,'https://auth.example.org','store-v2-internal']);
 for(const field of ['token_id','subject_id','publisher_id','expires_unix','issuer_uri','audience','session_revocations','principal_enrollments'])
  assert.match(h.calls[0].sql,new RegExp(field));
 assert.ok(!h.calls[0].sql.includes(subject));
});
test('unknown, revoked, disabled, expired, wrong tenant and ambiguous sessions deny',async()=>{
 for(const [rows,count] of [[[],0],[{is_active:false}], [{is_active:'t'}], [{is_active:1}]] ){
  const arr=Array.isArray(rows)?rows:[rows];const h=mock(arr,count===undefined?arr.length:count);
  assert.equal(await h.status(ctx),false);
 }
});
test('ambiguous query results fail closed as infrastructure error',async()=>{
 const h=mock([{is_active:true},{is_active:true}],2);
 assert.equal(await h.status(ctx),false);
});
test('invalid token identity, role and publisher metadata fail without SQL',async()=>{
 const h=mock(); const cases=[{...ctx,tokenId:'../bad'}, {...ctx,subject:'x'},
  {...ctx,role:'admin'},{...ctx,publisherId:'../other'}, {...ctx,expiresAt:-1},
  {...ctx,expiresAt:Infinity},{...ctx,role:'review_security',publisherId},
  {...ctx,publisherId:null}, {...ctx,tokenId:'x'.repeat(300)}, {...ctx,issuer:'http://evil'}, {...ctx,audience:''}];
 for(const value of cases)await assert.rejects(h.status(value),/session|identity|metadata/);
 assert.equal(h.calls.length,0);
});
test('reviewers must carry no publisher and must be independently enrolled',async()=>{
 const h=mock();assert.equal(await h.status({...ctx,role:'review_security',publisherId:undefined}),true);
 assert.equal(h.calls[0].params[3],null);
});
test('infrastructure failure is never converted into authorization',async()=>{
 const status=createPostgresSessionStatus({query:async()=>{throw Error('SQL timeout');}});
 await assert.rejects(status(ctx),/SQL timeout/);
 assert.throws(()=>createPostgresSessionStatus(),/query/);
 const malformed=createPostgresSessionStatus({query:async()=>null});
 await assert.rejects(malformed(ctx),/query result/);
});

test('real portal bearer verifier cannot bypass exact private SQL session authorization',async()=>{
 const {generateKeyPairSync,sign}=await import('node:crypto');
 const {createDeveloperPortal}=await import('./portal.mjs');
 const pair=generateKeyPairSync('ec',{namedCurve:'P-256'});
 const seconds=1792670400,id='sub-'+'c'.repeat(32);
 const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
 function jwt(changes={}){
  const header=b64({alg:'ES256',typ:'JWT',kid:'controlled-test-key'});
  const claims=b64({iss:'https://auth.example.org',aud:'store-v2-internal',
   sub:subject,role:'developer',publisherId,amr:['mfa'],verified:true,
   auth_time:seconds-4,iat:seconds-5,nbf:seconds-5,exp:seconds+300,jti:tokenId,...changes});
  const message=header+'.'+claims;
  return message+'.'+sign('sha256',Buffer.from(message),{key:pair.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');
 }
 let allowed=true,failDB=false,reads=0;
 const status=createPostgresSessionStatus({query:async(sql,params)=>{
  if(failDB)throw Error('database offline');
  const exact=params[0]===tokenId&&params[1]===subject&&params[2]==='developer'&&
   params[3]===publisherId&&params[4]===seconds+300&&
   params[5]==='https://auth.example.org'&&params[6]==='store-v2-internal';
  return {rowCount:allowed&&exact?1:0,rows:allowed&&exact?[{is_active:true}]:[]};
 }});
 const repository={async read(){reads++;return {id,publisherId,reviews:[]};},
  async create(){throw Error('unexpected create');},async addReview(){throw Error('unexpected review');}};
 const portal=createDeveloperPortal({issuer:'https://auth.example.org',audience:'store-v2-internal',
  publicKeys:{'controlled-test-key':pair.publicKey.export({type:'spki',format:'pem'})},
  now:()=>seconds*1000,origin:'https://private.example.org',repository,isTokenActive:status,takeRatePermit:async()=>true});
 const request=(claims={})=>portal(new Request('https://private.example.org/developer/submissions/'+id,
  {headers:{authorization:'Bearer '+jwt(claims)},method:'GET'}));
 assert.equal((await request()).status,200);
 assert.equal((await request({publisherId:'attacker-publisher'})).status,401);
 assert.equal((await request({jti:'other-token-id-123456'})).status,401);
 assert.equal(reads,1,'unauthorized bearer must not invoke data repository');
 allowed=false;assert.equal((await request()).status,401);
 failDB=true;assert.equal((await request()).status,503);
 assert.equal(reads,1);
});
