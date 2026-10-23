/**
 * MUSITU Store V2 private PostgreSQL reviewer journal adapter.
 * Does not connect, provision, migrate or deploy a database by itself.
 * Trusted caller supplies the real PostgreSQL parameterized query function
 * of a separately provisioned narrow role; never accept an applicant DB URL.
 * All states are REVIEW_REQUIRED. No approval, catalog signing, payouts or commerce.
 */
import {randomBytes} from 'node:crypto';

export function createPostgresReviewRepository({query}={}){
 if(typeof query!=='function')throw Error('trusted PostgreSQL query required');
 async function execute(sql,params){
  const result=await query(sql,params);
  if(!result||!Array.isArray(result.rows)||!Number.isInteger(result.rowCount)||
    result.rowCount<0)throw Error('invalid PostgreSQL query result');
  return result;
 }
 async function read(id){
  const result=await execute(
   'SELECT submission_id,publisher_id,submitting_subject,request_digest '+
   'FROM store_publisher_private.submissions WHERE submission_id=$1',
   [id]);
  if(result.rowCount===0)return null;
  if(result.rowCount!==1)throw Error('ambiguous developer submission');
  const row=result.rows[0];
  if(!row||row.submission_id!==id||!row.publisher_id||
    !row.submitting_subject)throw Error('invalid stored developer provenance');
  const reviews=await execute(
   'SELECT reviewer_subject,reviewer_role,decision,evidence_sha256,review_digest '+
   'FROM store_publisher_private.review_notes WHERE submission_id=$1 ORDER BY created_at ASC',
   [id]);
  if(reviews.rowCount>2)throw Error('invalid reviewer count');
  return {id,publisherId:row.publisher_id,actorId:row.submitting_subject,
   payloadDigest:row.request_digest,state:'REVIEW_REQUIRED',
   reviews:reviews.rows.map(x=>({
    subject:x.reviewer_subject,role:x.reviewer_role,decision:x.decision,
    evidenceSha256:x.evidence_sha256,reviewDigest:x.review_digest}))};
 }
 async function create(record,idempotencyKey){
  if(!record||!record.data||typeof idempotencyKey!=='string')throw Error('trusted validated developer submission required');
  const data=record.data,id='sub-'+randomBytes(16).toString('hex');
  const inserted=await execute(
   `INSERT INTO store_publisher_private.submissions
    (submission_id,publisher_id,submitting_subject,idempotency_key,
     request_digest,app_id,package_id,version_code,apk_sha256,apk_bytes,
     signer_sha256,privacy_policy_url,source_url)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    ON CONFLICT DO NOTHING RETURNING submission_id`,
   [id,record.publisherId,record.actorId,idempotencyKey,record.payloadDigest,
    data.appId,data.packageId,data.versionCode,data.apkSha256,data.apkBytes,
    data.signingCertificateSha256,data.privacyPolicyUrl,data.sourceUrl]);
  if(inserted.rowCount===1){
   return {kind:'created',record:{...record,id,reviews:[],state:'REVIEW_REQUIRED'}};
  }
  // Unique publisher+idempotency key is the only basis for treating a retry
  // as identical. An app-version collision with a different request is NOT success.
  const prior=await execute(
   'SELECT submission_id,request_digest FROM store_publisher_private.submissions '+
   'WHERE publisher_id=$1 AND idempotency_key=$2',
   [record.publisherId,idempotencyKey]);
  if(prior.rowCount!==1||prior.rows[0]?.request_digest!==record.payloadDigest)
   return {kind:'conflict'};
  const previous=await read(prior.rows[0].submission_id);
  if(!previous)return {kind:'conflict'};
  return {kind:'existing',record:previous};
 }
 async function addReview(id,item){
  if(!item||typeof item.subject!=='string'||typeof item.role!=='string')
   throw Error('trusted verified reviewer required');
  // Single SQL statement: two unique constraints + self-review database trigger
  // guarantee one review per role and one role per human under concurrent writers.
  const result=await execute(
   `INSERT INTO store_publisher_private.review_notes
    (submission_id,reviewer_subject,reviewer_role,decision,evidence_sha256,review_digest)
    SELECT $1,$2,$3,$4,$5,$6 FROM store_publisher_private.submissions s
    WHERE s.submission_id=$1 AND s.submitting_subject<>$2
    ON CONFLICT DO NOTHING RETURNING submission_id`,
   [id,item.subject,item.role,item.decision,item.evidenceSha256,item.reviewDigest]);
  if(result.rowCount===1){
   const record=await read(id);
   if(!record)throw Error('committed reviewer evidence cannot be re-read');
   return {kind:'created',record};
  }
  const exists=await read(id);
  return exists?{kind:'conflict'}:{kind:'missing'};
 }
 return Object.freeze({create,read,addReview});
}
