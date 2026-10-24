import test from 'node:test';
import assert from 'node:assert/strict';
import {createPostgresReviewRepository} from './postgres-repository.mjs';
const DIGEST='a'.repeat(64);
const manifest={publisherId:'trusted-publisher',appId:'trial-app',packageId:'org.example.trial',
 versionCode:1,apkSha256:'b'.repeat(64),apkBytes:1000,signingCertificateSha256:'c'.repeat(64),
 privacyPolicyUrl:'https://example.org/privacy',sourceUrl:'https://github.com/example/trial'};
const record={publisherId:'trusted-publisher',actorId:'developer-actor-1',data:manifest,
 payloadDigest:DIGEST,state:'REVIEW_REQUIRED'};
const DBROW={submission_id:'sub-'+'e'.repeat(32),publisher_id:record.publisherId,
 submitting_subject:record.actorId,request_digest:DIGEST};
test('requires explicit trusted SQL executor; no default production environment',()=>{
 assert.throws(()=>createPostgresReviewRepository(),/query|database/);
});
test('atomic submission creation binds verified publisher and signer to SQL parameters; no publication',async()=>{
 const calls=[];const repo=createPostgresReviewRepository({query:async(sql,params)=>{
  calls.push({sql,params});return {rows:[{submission_id:'sub-'+'f'.repeat(32)}],rowCount:1};
 }});
 const result=await repo.create(record,'idempotency-test-key-001');
 assert.equal(result.kind,'created');assert.match(result.record.id,/^sub-[a-f0-9]{32}$/);
 assert.deepEqual(result.record.reviews,[]);
 assert.match(calls[0].sql,/INSERT INTO store_publisher_private\.submissions/);
 assert.match(calls[0].sql,/ON CONFLICT DO NOTHING/);
 assert.ok(calls[0].params.includes(record.actorId));
 assert.ok(calls[0].params.includes(record.publisherId));
 assert.ok(calls[0].params.includes(DIGEST));
 assert.ok(!calls[0].sql.includes(record.publisherId));
 assert.equal(result.record.state,'REVIEW_REQUIRED');
});
test('same publisher idempotency replay yields existing only for same exact payload digest',async()=>{
 let calls=0;
 const repo=createPostgresReviewRepository({query:async(sql,params)=>{
  calls++;
  if(sql.includes('INSERT INTO store_publisher_private.submissions'))return {rowCount:0,rows:[]};
  if(sql.includes('WHERE publisher_id=$1 AND idempotency_key=$2'))return {rowCount:1,rows:[DBROW]};
  if(sql.includes('FROM store_publisher_private.submissions WHERE submission_id=$1'))return {rowCount:1,rows:[DBROW]};
  return {rowCount:0,rows:[]};
 }});
 const result=await repo.create(record,'idempotency-test-key-001');
 assert.equal(result.kind,'existing');
 assert.equal(result.record.id,DBROW.submission_id);
 assert.equal(result.record.reviews.length,0);
 assert.ok(calls>=3);
});
test('repeated idempotency key with altered signed app metadata returns conflict',async()=>{
 const repo=createPostgresReviewRepository({query:async sql=>
  sql.includes('INSERT INTO')?{rows:[],rowCount:0}:{rows:[{...DBROW,request_digest:'d'.repeat(64)}],rowCount:1}
 });
 assert.equal((await repo.create(record,'idempotency-test-key-001')).kind,'conflict');
});
test('review write requires existing submission, distinct JWT subject and an atomic conditional INSERT',async()=>{
 const calls=[];
 const repo=createPostgresReviewRepository({query:async(sql,params)=>{
  calls.push({sql,params});
  if(sql.includes('INSERT INTO store_publisher_private.review_notes'))return {rowCount:1,rows:[{submission_id:DBROW.submission_id}]};
  if(sql.includes('FROM store_publisher_private.submissions WHERE submission_id=$1'))return {rowCount:1,rows:[DBROW]};
  return {rowCount:0,rows:[]};
 }});
 const out=await repo.addReview(DBROW.submission_id,{subject:'independent-reviewer-1',role:'review_identity',
  decision:'REQUEST_EVIDENCE',evidenceSha256:'e'.repeat(64),reviewDigest:'f'.repeat(64)});
 assert.equal(out.kind,'created');assert.equal(out.record.id,DBROW.submission_id);
 assert.match(calls[0].sql,/WHERE s\.submission_id=\$1 AND s\.submitting_subject<>\$2/);
 assert.match(calls[0].sql,/ON CONFLICT DO NOTHING/);
 assert.ok(!calls[0].sql.includes('independent-reviewer-1'));
});
test('already recorded reviewer role conflicts and unknown submission remains missing',async()=>{
 let exists=true;
 const repo=createPostgresReviewRepository({query:async sql=>{
  if(sql.includes('INSERT INTO'))return {rowCount:0,rows:[]};
  if(sql.includes('FROM store_publisher_private.submissions WHERE submission_id=$1'))
   return exists?{rowCount:1,rows:[DBROW]}:{rowCount:0,rows:[]};
  return {rowCount:0,rows:[]};
 }});
 const item={subject:'reviewer-001',role:'review_identity',decision:'REQUEST_EVIDENCE',
  evidenceSha256:'a'.repeat(64),reviewDigest:'b'.repeat(64)};
 assert.equal((await repo.addReview(DBROW.submission_id,item)).kind,'conflict');
 exists=false;
 assert.equal((await repo.addReview(DBROW.submission_id,item)).kind,'missing');
});
test('database result spoofing and missing rowCount reject rather than permitting enrollment',async()=>{
 const repo=createPostgresReviewRepository({query:async()=>({rows:[{}]})});
 await assert.rejects(()=>repo.create(record,'idempotency-test-key-001'),/database|invalid/);
});
