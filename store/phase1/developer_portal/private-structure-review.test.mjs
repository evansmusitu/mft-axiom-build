import test from 'node:test';
import assert from 'node:assert/strict';
import {runPrivateStructuralPreflight} from './private-structure-review.mjs';
import {createPostgresReviewRepository} from './postgres-repository.mjs';
const sid='sub-'+'c'.repeat(32), hash='d'.repeat(64), key='private/apk/'+'e'.repeat(48);
const record={submissionId:sid,publisherId:'test-publisher',actorId:'developer-human-001',apkSha256:hash,apkBytes:10097,storageKey:key};
const actor={subject:'independent-scanner-001',role:'review_security',tokenId:'operator-test-session-01',
 issuer:'https://idp.example.org',audience:'store-v2-internal',expiresAt:1792680000};
const passed={status:'STRUCTURAL_PREFLIGHT_ONLY',entryCount:5,declaredExpandedBytes:10437,
 signatureVerified:false,malwareCleared:false,publicationAuthorized:false,
 publisherApproved:false,paymentAuthorized:false,entitlementGranted:false};
function fixture({receipt=record,out=passed,allowed=true,writer='created'}={}){
 const t={reads:0,inspections:0,writes:0,checks:0,args:null};
 const repository={async readQuarantineReceipt(){t.reads++;return receipt;},
  async recordStructuralCheck(args){t.args=args;t.writes++;return {kind:writer};}};
 const inspector={async inspect(storageKey,manifest){t.inspections++;
  assert.equal(storageKey,key);assert.equal(manifest.expectedSha256,hash);
  assert.equal(manifest.expectedBytes,10097);
  if(out instanceof Error)throw out;return out;}};
 const isAuthorized=async args=>{t.checks++;assert.equal(args.subject,actor.subject);return allowed;};
 return {t,repository,inspector,isAuthorized};
}
const run=(f,extra={})=>runPrivateStructuralPreflight({...f,actor,submissionId:sid,...extra});
test('independent security reviewer can record only private structural evidence',async()=>{
 const f=fixture(),out=await run(f);
 assert.equal(out.status,'STRUCTURAL_PREFLIGHT_ONLY');assert.equal(f.t.inspections,1);
 assert.equal(f.t.writes,1);assert.equal(f.t.args.submissionId,sid);
 assert.equal(f.t.args.inspectorSubject,actor.subject);
 assert.equal(f.t.args.inspectorTokenId,actor.tokenId);assert.match(f.t.args.evidenceSha256,/^[a-f0-9]{64}$/);
 for(const forbidden of ['signatureVerified','malwareCleared','publicationAuthorized','publisherApproved','paymentAuthorized','entitlementGranted'])
  assert.equal(out[forbidden],false);
 assert.equal('storageKey' in out,false);
});
test('signed role, independent human and revocation authorization are mandatory',async()=>{
 for(const user of [{...actor,role:'developer'},{...actor,subject:record.actorId}]){
  const f=fixture();await assert.rejects(run(f,{actor:user}),/role|self|independent/i);
  assert.equal(f.t.inspections,0);assert.equal(f.t.writes,0);
 }
 const inactive=fixture({allowed:false});await assert.rejects(run(inactive),/auth|active|revok/i);
 assert.equal(inactive.t.inspections,0);assert.equal(inactive.t.writes,0);
 const absent=fixture();await assert.rejects(run({...absent,isAuthorized:undefined}),/trusted|auth|required/i);
});
test('unknown record, manifest mismatch or untrusted storage identity fail before reading bytes',async()=>{
 for(const receipt of [null,{...record,apkSha256:'NOT_SHA'},{...record,apkBytes:0},
  {...record,storageKey:'../../etc/passwd'}, {...record,submissionId:'sub-'+'f'.repeat(32)}]){
  const f=fixture({receipt});await assert.rejects(run(f));
  assert.equal(f.t.inspections,0);assert.equal(f.t.writes,0);
 }
});
test('structural errors and unsupported scanner statuses never create approval or receipts',async()=>{
 for(const out of [new Error('unsafe ZIP'),{...passed,malwareCleared:true},
  {...passed,status:'FULLY_APPROVED'},{...passed,entryCount:0}]){
  const f=fixture({out});await assert.rejects(run(f));assert.equal(f.t.writes,0);
 }
});
test('immutable receipt collision is denial, not idempotent approval',async()=>{
 const f=fixture({writer:'conflict'});await assert.rejects(run(f),/conflict|recorded/i);
 assert.equal(f.t.inspections,1);assert.equal(f.t.writes,1);
});
test('SQL read binds original sealed object to submission and manifest before operator sees it',async()=>{
 const calls=[];
 const r=createPostgresReviewRepository({query:async(sql,params)=>{
  calls.push({sql,params});return {rows:[{submission_id:sid,publisher_id:record.publisherId,
   submitting_subject:record.actorId,apk_sha256:hash,apk_bytes:record.apkBytes,storage_key:key}],rowCount:1};
 }});
 const got=await r.readQuarantineReceipt(sid);
 assert.equal(got.storageKey,key);assert.match(calls[0].sql,/JOIN store_publisher_private\.apk_quarantine_receipts/);
 assert.match(calls[0].sql,/WHERE s\.submission_id=\$1/);
 assert.deepEqual(calls[0].params,[sid]);
});
test('SQL receipt INSERT binds uploader digest, size, tenant and independent reviewer',async()=>{
 const calls=[];const r=createPostgresReviewRepository({query:async(sql,params)=>{
  calls.push({sql,params});return {rows:[{submission_id:sid}],rowCount:1};
 }});
 const x=await r.recordStructuralCheck({submissionId:sid,publisherId:record.publisherId,apkSha256:hash,
  apkBytes:record.apkBytes,storageKey:key,inspectorSubject:actor.subject,inspectorTokenId:actor.tokenId,
  inspectorIssuer:actor.issuer,inspectorAudience:actor.audience,inspectorExpiresAt:actor.expiresAt,
  entryCount:5,expandedBytes:10437,evidenceSha256:'f'.repeat(64)});
 assert.equal(x.kind,'created');assert.match(calls[0].sql,/ON CONFLICT DO NOTHING/);
 assert.match(calls[0].sql,/q\.apk_sha256=\$3/);
 assert.match(calls[0].sql,/q\.apk_bytes=\$4/);
 assert.match(calls[0].sql,/q\.storage_key=\$5/);
 assert.equal(calls[0].params.length,13);
});

test('revoked independent reviewer during slow structural inspection never appends an audit receipt',async()=>{
 const f=fixture();let checks=0;
 f.isAuthorized=async()=>++checks===1;
 await assert.rejects(run(f),/auth|revok|session/i);
 assert.equal(f.t.inspections,1,'revocation occurs after inspection begins');
 assert.equal(f.t.writes,0,'revoked review cannot produce even structural acceptance evidence');
 assert.equal(checks,2);
});

test('temporary session-status outage just before committing inspection evidence fails closed',async()=>{
 const f=fixture();let checks=0;
 f.isAuthorized=async()=>{if(++checks===2)throw Error('session registry offline');return true;};
 await assert.rejects(run(f),/session registry offline/);
 assert.equal(f.t.inspections,1);
 assert.equal(f.t.writes,0);
});


test('structural reviewer requires cryptographically bound issuer, audience and current token expiry before private read',async()=>{
 for(const edited of [
  {...actor,issuer:undefined},{...actor,audience:undefined},{...actor,expiresAt:undefined},
  {...actor,issuer:'http://idp.example.org'},{...actor,audience:''},{...actor,expiresAt:0}
 ]){
  const f=fixture();
  await assert.rejects(run(f,{actor:edited}),/identity|session|issuer|audience|expir|role/i);
  assert.equal(f.t.reads,0);assert.equal(f.t.inspections,0);assert.equal(f.t.writes,0);
 }
});

test('structural receipt PostgreSQL admission binds exact signed token claims and consults revocations in the INSERT',async()=>{
 const calls=[];const r=createPostgresReviewRepository({query:async(sql,params)=>{
  calls.push({sql,params});return {rows:[{submission_id:sid}],rowCount:1};
 }});
 const x=await r.recordStructuralCheck({submissionId:sid,publisherId:record.publisherId,apkSha256:hash,
  apkBytes:record.apkBytes,storageKey:key,inspectorSubject:actor.subject,inspectorTokenId:actor.tokenId,
  inspectorIssuer:actor.issuer,inspectorAudience:actor.audience,inspectorExpiresAt:actor.expiresAt,
  entryCount:5,expandedBytes:10437,evidenceSha256:'f'.repeat(64)});
 assert.equal(x.kind,'created');
 assert.match(calls[0].sql,/JOIN store_publisher_private\.portal_sessions/);
 assert.match(calls[0].sql,/session_revocations/);
 assert.match(calls[0].sql,/principal_suspensions/);
 assert.equal(calls[0].params.length,13);
 for(const value of [actor.issuer,actor.audience,actor.expiresAt])assert.ok(calls[0].params.includes(value));
});
