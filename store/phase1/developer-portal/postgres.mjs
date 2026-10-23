/**
 * Private parameterized PostgreSQL adapter. The caller supplies an
 * authenticated, least-privilege query executor, NEVER a public checkout role.
 * Not deployed; never creates a database or provisions credentials.
 */
const normalize=(rows,{reviewer=false}={})=>rows.map(r=>({
 submissionId:r.submission_id,
 ...(reviewer?{publisherSubject:r.publisher_subject}:{}),
 appId:r.app_id,packageId:r.package_id,versionCode:Number(r.version_code),
 apkBytes:Number(r.apk_bytes),apkSha256:r.apk_sha256,
 signingCertificateSha256:r.signing_certificate_sha256,
 privacyPolicyUrl:r.privacy_policy_url,state:'REVIEW_REQUIRED'
}));
export function createPostgresDeveloperStore({query}={}){
 if(typeof query!=='function')throw Error('trusted sql query adapter required');
 const exec=async(sql,params)=>{
  const result=await query(sql,params);
  if(!result||!Array.isArray(result.rows)||!Number.isInteger(result.rowCount)||result.rowCount<0)
   throw Error('untrusted database result');
  return result;
 };
 return Object.freeze({
  async create(publisherSubject,submission){
   const {rowCount}=await exec(`INSERT INTO store_v2_developer_submissions
    (submission_id,publisher_subject,app_id,package_id,version_code,apk_bytes,
     apk_sha256,signing_certificate_sha256,privacy_policy_url)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING RETURNING submission_id`,
    [submission.submissionId,publisherSubject,submission.appId,submission.packageId,
     submission.versionCode,submission.apkBytes,submission.apkSha256,
     submission.signingCertificateSha256,submission.privacyPolicyUrl]);
   return rowCount===1;
  },
  async list(publisherSubject){
   const {rows}=await exec(`SELECT submission_id,app_id,package_id,version_code,
    apk_bytes,apk_sha256,signing_certificate_sha256,privacy_policy_url
    FROM store_v2_developer_submissions WHERE publisher_subject = $1
    ORDER BY submitted_at DESC LIMIT 100`,[publisherSubject]);
   return normalize(rows);
  },
  async queue(){
   const {rows}=await exec(`SELECT submission_id,publisher_subject,app_id,package_id,
    version_code,apk_bytes,apk_sha256,signing_certificate_sha256,privacy_policy_url
    FROM store_v2_developer_submissions ORDER BY submitted_at DESC LIMIT 100`,[]);
   return normalize(rows,{reviewer:true});
  },
  async review(submissionId,reviewerRole,reviewerSubject,evidenceSha256){
   const {rowCount}=await exec(`INSERT INTO store_v2_developer_review_evidence
    (submission_id,reviewer_role,reviewer_subject,evidence_sha256)
    SELECT $1,$2,$3,$4 FROM store_v2_developer_submissions s
    WHERE s.submission_id=$1 AND s.publisher_subject<>$3
    ON CONFLICT DO NOTHING RETURNING submission_id`,
    [submissionId,reviewerRole,reviewerSubject,evidenceSha256]);
   return rowCount===1;
  }
 });
}
