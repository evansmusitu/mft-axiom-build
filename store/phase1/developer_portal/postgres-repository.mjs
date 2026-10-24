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
   'SELECT submission_id,publisher_id,submitting_subject,request_digest,apk_sha256,apk_bytes '+
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
   apkSha256:row.apk_sha256,apkBytes:Number(row.apk_bytes),
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
 async function recordUpload({submissionId,publisherId,sha256,bytes,objectKey,actor}={}){
  if(typeof objectKey!=='string'||!/^private\/apk\/[0-9a-f]{48}$/.test(objectKey))
   throw Error('invalid quarantined storage identity');
  // The controller only gets here after signature, MFA and token-status checks.
  // The database must independently demand the same CURRENT session inside
  // the INSERT statement to close the TOCTOU window before durable evidence.
  if(!actor||actor.role!=='developer'||actor.publisherId!==publisherId||
     typeof actor.subject!=='string'||!/^[A-Za-z0-9_-]{6,120}$/.test(actor.subject)||
     typeof actor.tokenId!=='string'||!/^[A-Za-z0-9_-]{12,200}$/.test(actor.tokenId)||
     typeof actor.issuer!=='string'||!/^https:\/\/[^\s]{5,250}$/.test(actor.issuer)||
     typeof actor.audience!=='string'||actor.audience.length<5||actor.audience.length>120||
     !Number.isSafeInteger(actor.expiresAt)||actor.expiresAt<=0)
   throw Error('verified uploader session identity required for quarantine receipt');
  const result=await execute(
   `INSERT INTO store_publisher_private.apk_quarantine_receipts
     (submission_id,publisher_id,apk_sha256,apk_bytes,storage_key,
      uploader_subject,uploader_token_id)
    SELECT s.submission_id,s.publisher_id,s.apk_sha256,s.apk_bytes,$5,$6,$7
    FROM store_publisher_private.submissions s
    JOIN store_publisher_private.portal_sessions t
      ON t.token_id=$7 AND t.subject_id=$6 AND t.role='developer'
     AND t.publisher_id=$2 AND t.issuer_uri=$8 AND t.audience=$9
     AND t.expires_unix=$10 AND t.expires_unix>EXTRACT(EPOCH FROM clock_timestamp())
    JOIN store_publisher_private.principal_enrollments p
      ON p.subject_id=t.subject_id AND p.role='developer' AND p.publisher_id=$2
    WHERE s.submission_id=$1 AND s.publisher_id=$2 AND s.apk_sha256=$3
      AND s.apk_bytes=$4 AND s.submitting_subject=$6
      AND NOT EXISTS(SELECT 1 FROM store_publisher_private.session_revocations r
        WHERE r.token_id=t.token_id)
      AND NOT EXISTS(SELECT 1 FROM store_publisher_private.principal_suspensions b
        WHERE b.subject_id=p.subject_id)
    ON CONFLICT DO NOTHING RETURNING submission_id`,
   [submissionId,publisherId,sha256,bytes,objectKey,
    actor.subject,actor.tokenId,actor.issuer,actor.audience,actor.expiresAt]);
  return {kind:result.rowCount===1?'created':'conflict'};
 }
 async function readQuarantineReceipt(submissionId){
  if(typeof submissionId!=='string'||!/^sub-[a-f0-9]{32}$/.test(submissionId))
   throw Error('invalid private submission identifier');
  const result=await execute(
   `SELECT s.submission_id,s.publisher_id,s.submitting_subject,s.apk_sha256,
    s.apk_bytes,q.storage_key
    FROM store_publisher_private.submissions s
    JOIN store_publisher_private.apk_quarantine_receipts q
     ON q.submission_id=s.submission_id AND q.publisher_id=s.publisher_id
       AND q.apk_sha256=s.apk_sha256 AND q.apk_bytes=s.apk_bytes
    WHERE s.submission_id=$1 AND q.disposition='QUARANTINED_UNSCANNED'`,[submissionId]);
  if(result.rowCount===0)return null;
  if(result.rowCount!==1||result.rows.length!==1)throw Error('ambiguous private quarantine receipt');
  const x=result.rows[0];
  if(x.submission_id!==submissionId)throw Error('misbound private quarantine receipt');
  return {submissionId,publisherId:x.publisher_id,actorId:x.submitting_subject,
   apkSha256:x.apk_sha256,apkBytes:Number(x.apk_bytes),storageKey:x.storage_key};
 }
 async function recordStructuralCheck({submissionId,publisherId,apkSha256,apkBytes,
  storageKey,inspectorSubject,inspectorTokenId,inspectorIssuer,inspectorAudience,
  inspectorExpiresAt,entryCount,expandedBytes,evidenceSha256}={}){
  if(typeof submissionId!=='string'||!/^sub-[a-f0-9]{32}$/.test(submissionId)||
     typeof publisherId!=='string'||!/^[a-z][a-z0-9-]{2,63}$/.test(publisherId)||
     typeof apkSha256!=='string'||!/^[a-f0-9]{64}$/.test(apkSha256)||
     !Number.isSafeInteger(apkBytes)||apkBytes<22||apkBytes>536870912||
     typeof storageKey!=='string'||!/^private\/apk\/[0-9a-f]{48}$/.test(storageKey)||
     typeof inspectorSubject!=='string'||!/^[A-Za-z0-9_-]{6,120}$/.test(inspectorSubject)||
     typeof inspectorTokenId!=='string'||!/^[A-Za-z0-9_-]{12,200}$/.test(inspectorTokenId)||
     typeof inspectorIssuer!=='string'||!/^https:\/\/[^\s]{5,250}$/.test(inspectorIssuer)||
     typeof inspectorAudience!=='string'||inspectorAudience.length<5||inspectorAudience.length>120||
     !Number.isSafeInteger(inspectorExpiresAt)||inspectorExpiresAt<=0||
     !Number.isSafeInteger(entryCount)||entryCount<2||entryCount>4096||
     !Number.isSafeInteger(expandedBytes)||expandedBytes<0||expandedBytes>2147483648||
     typeof evidenceSha256!=='string'||!/^[a-f0-9]{64}$/.test(evidenceSha256))
    throw Error('invalid private structural evidence binding');
  const result=await execute(
   `INSERT INTO store_publisher_private.apk_structural_checks
    (submission_id,publisher_id,apk_sha256,apk_bytes,storage_key,
     inspector_subject,inspector_token_id,inspector_issuer,inspector_audience,
     inspector_expires_unix,entry_count,expanded_bytes,evidence_sha256)
    SELECT q.submission_id,q.publisher_id,q.apk_sha256,q.apk_bytes,q.storage_key,
     $6,$7,$8,$9,$10,$11,$12,$13 FROM store_publisher_private.apk_quarantine_receipts q
    JOIN store_publisher_private.submissions s ON s.submission_id=q.submission_id
     AND s.publisher_id=q.publisher_id AND s.submitting_subject<>$6
    JOIN store_publisher_private.portal_sessions t ON t.token_id=$7
     AND t.subject_id=$6 AND t.role='review_security' AND t.publisher_id IS NULL
     AND t.issuer_uri=$8 AND t.audience=$9 AND t.expires_unix=$10
     AND t.expires_unix>EXTRACT(EPOCH FROM clock_timestamp())
    JOIN store_publisher_private.principal_enrollments p ON p.subject_id=t.subject_id
     AND p.role='review_security' AND p.publisher_id IS NULL
    WHERE q.submission_id=$1 AND q.publisher_id=$2 AND q.apk_sha256=$3
     AND q.apk_bytes=$4 AND q.storage_key=$5
     AND q.disposition='QUARANTINED_UNSCANNED'
     AND NOT EXISTS(SELECT 1 FROM store_publisher_private.session_revocations r
       WHERE r.token_id=t.token_id)
     AND NOT EXISTS(SELECT 1 FROM store_publisher_private.principal_suspensions b
       WHERE b.subject_id=p.subject_id)
    ON CONFLICT DO NOTHING RETURNING submission_id`,
   [submissionId,publisherId,apkSha256,apkBytes,storageKey,
    inspectorSubject,inspectorTokenId,inspectorIssuer,inspectorAudience,
    inspectorExpiresAt,entryCount,expandedBytes,evidenceSha256]);
  return {kind:result.rowCount===1?'created':'conflict'};
 }
 return Object.freeze({create,read,addReview,recordUpload,
  readQuarantineReceipt,recordStructuralCheck});
}
