import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createPostgresDeveloperStore} from './postgres.mjs';

const record={submissionId:'submission-x010',appId:'exampleapp',packageId:'org.example.app',versionCode:13,
 apkBytes:6000,apkSha256:'a'.repeat(64),signingCertificateSha256:'b'.repeat(64),
 privacyPolicyUrl:'https://example.org/privacy'};
test('database dependency is required and cannot default to global production secrets',()=>{
 assert.throws(()=>createPostgresDeveloperStore(),/trusted sql query adapter required/);
});
test('submission uses parameterized, immutable, conflict-safe INSERT bound to verified subject',async()=>{
 const calls=[];let n=0;
 const storage=createPostgresDeveloperStore({query:async(sql,params)=>{calls.push({sql,params});return {rows:[],rowCount:n++===0?1:0};}});
 assert.equal(await storage.create('publisher_001',record),true);
 assert.equal(await storage.create('publisher_001',record),false);
 assert.match(calls[0].sql,/INSERT INTO store_v2_developer_submissions/);
 assert.match(calls[0].sql,/ON CONFLICT DO NOTHING/);
 assert.ok(!calls[0].sql.includes('publisher_001'));
 assert.ok(!calls[0].sql.includes(record.apkSha256));
 assert.ok(calls[0].params.includes('publisher_001'));
});
test('publisher listing uses SQL tenant filter; reviewer queue is bounded',async()=>{
 const calls=[];
 const storage=createPostgresDeveloperStore({query:async(sql,params)=>{calls.push({sql,params});return {
  rows:[{submission_id:'submission-x010',publisher_subject:'publisher_001',app_id:'exampleapp',package_id:'org.example.app'}],
  rowCount:1};}});
 assert.equal((await storage.list('publisher_001'))[0].submissionId,'submission-x010');
 assert.match(calls[0].sql,/WHERE publisher_subject = \$1/);
 assert.deepEqual(calls[0].params,['publisher_001']);
 assert.equal((await storage.queue())[0].publisherSubject,'publisher_001');
 assert.match(calls[1].sql,/LIMIT 100/);
});
test('review evidence is atomic, separately identified and never updates eligibility',async()=>{
 const calls=[];
 const storage=createPostgresDeveloperStore({query:async(sql,params)=>{calls.push({sql,params});return {rowCount:1,rows:[{}]};}});
 assert.equal(await storage.review('submission-x010','identity','reviewer_001','a'.repeat(64)),true);
 assert.match(calls[0].sql,/WHERE s\.submission_id=\$1 AND s\.publisher_subject<>\$3/);
 assert.match(calls[0].sql,/ON CONFLICT DO NOTHING/);
 assert.ok(!calls[0].sql.includes('reviewer_001'));
 assert.deepEqual(calls[0].params,['submission-x010','identity','reviewer_001','a'.repeat(64)]);
});
test('schema is append-only, has two distinct reviewers and zero catalog/payment columns',()=>{
 const sql=readFileSync(new URL('./schema.sql',import.meta.url),'utf8');
 assert.match(sql,/PRIMARY KEY\(submission_id,reviewer_role\)/);
 assert.match(sql,/UNIQUE \(submission_id,reviewer_subject\)/);
 assert.match(sql,/CREATE TRIGGER store_v2_developer_submission_immutable/);
 assert.match(sql,/CREATE TRIGGER store_v2_developer_review_immutable/);
 assert.match(sql,/store_v2_guard_review_self_attestation/);
 assert.doesNotMatch(sql,/CREATE TABLE.*store_checkout_intents/i);
 assert.doesNotMatch(sql,/GRANT .* PUBLIC\b/i);
});
