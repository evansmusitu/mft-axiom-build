/**
 * Private Store V2 session allowlist and revocation contract.
 * No session can become authorized merely because JWT signature/MFA passes.
 * A separate operator must register actual provider-verified principals and
 * exact token claims in the private SQL journal. Never grants roles or releases.
 * Caller injects trusted parameterized SQL; no environment credentials here.
 */
const TOKEN=/^[A-Za-z0-9_-]{12,200}$/;
const SUBJECT=/^[A-Za-z0-9_-]{6,120}$/;
const PUBLISHER=/^[a-z][a-z0-9-]{2,63}$/;
const ROLES=new Set(['developer','review_identity','review_security']);

const ACTIVE_SQL=`SELECT TRUE AS is_active
 FROM store_publisher_private.portal_sessions AS s
 JOIN store_publisher_private.principal_enrollments AS p
   ON p.subject_id=s.subject_id AND p.role=s.role
   AND p.publisher_id IS NOT DISTINCT FROM s.publisher_id
 WHERE s.token_id=$1 AND s.subject_id=$2 AND s.role=$3
  AND s.publisher_id IS NOT DISTINCT FROM $4
  AND s.expires_unix=$5 AND s.issuer_uri=$6 AND s.audience=$7
  AND s.expires_unix>EXTRACT(EPOCH FROM clock_timestamp())
  AND NOT EXISTS (SELECT 1 FROM store_publisher_private.session_revocations AS r
    WHERE r.token_id=s.token_id)
  AND NOT EXISTS (SELECT 1 FROM store_publisher_private.principal_suspensions AS d
    WHERE d.subject_id=s.subject_id)`;

export function createPostgresSessionStatus({query}={}){
 if(typeof query!=='function')throw Error('trusted PostgreSQL query required');
 return async function isTokenActive({tokenId,subject,role,publisherId,expiresAt,issuer,audience}={}){
  if(typeof tokenId!=='string'||!TOKEN.test(tokenId)||
    typeof subject!=='string'||!SUBJECT.test(subject)||!ROLES.has(role)||
    !Number.isSafeInteger(expiresAt)||expiresAt<=0 ||
    typeof issuer!=='string'||!issuer.startsWith('https://')||issuer.length>256||
    typeof audience!=='string'||audience.length<5||audience.length>120||
    (role==='developer'?typeof publisherId!=='string'||!PUBLISHER.test(publisherId):publisherId!==undefined&&publisherId!==null))
    throw Error('invalid signed session identity metadata');
  const params=[tokenId,subject,role,role==='developer'?publisherId:null,expiresAt,issuer,audience];
  const result=await query(ACTIVE_SQL,params);
  if(!result||!Array.isArray(result.rows)||!Number.isInteger(result.rowCount)||
     result.rowCount<0||result.rowCount!==result.rows.length)
   throw Error('invalid SQL session query result');
  // Only one unique, strongly-typed database authorization may pass.
  return result.rowCount===1&&result.rows[0]?.is_active===true;
 };
}
