/**
 * MUSITU Store V2 PRIVATE candidate: per-principal AND per-publisher durable
 * PostgreSQL request quota. No network/config, migration, or automatic launch.
 * Call only after JWT signature/MFA and initial revocation verification.
 * The SQL function independently rechecks the exact issuer/audience/session,
 * role, principal enrollment, expiry, revocation, and suspension. It uses its
 * own DB clock and server-owned action quotas, never applicant-provided caps.
 */
import {createHash} from 'node:crypto';
const ROLE=new Set(['developer','review_identity','review_security']);
const ROUTE=new Set(['submit','upload','read','review']);
const SUBJECT=/^[A-Za-z0-9_-]{6,120}$/;
const JTI=/^[A-Za-z0-9_-]{12,200}$/;
const PUB=/^[a-z][a-z0-9-]{2,63}$/;
function digest(...parts){return createHash('sha256').update(parts.join('\x00'),'utf8').digest('hex');}
export function createPostgresRatePermit({query}={}){
 if(typeof query!=='function')throw Error('private PostgreSQL rate gate requires a trusted parameterized query');
 return async function takeRatePermit({issuer,subject,role,publisherId,route,tokenId,audience,expiresAt}={}){
  if(typeof issuer!=='string'||!/^https:\/\/[^\s]{5,250}$/.test(issuer)||
     typeof subject!=='string'||!SUBJECT.test(subject)||
     typeof role!=='string'||!ROLE.has(role)||
     typeof tokenId!=='string'||!JTI.test(tokenId)||
     typeof audience!=='string'||audience.length<5||audience.length>120||
     !Number.isSafeInteger(expiresAt)||expiresAt<=0||
     typeof route!=='string'||!ROUTE.has(route)||
     (role==='developer'?(typeof publisherId!=='string'||!PUB.test(publisherId)):
       publisherId!==undefined&&publisherId!==null))
   throw Error('invalid verified request quota identity');
  // Stable identity keys intentionally omit JWT jti: issuing new tokens must
  // not reset the person's or publisher's server-enforced capacity.
  const actorDigest=digest('actor',issuer,subject,role);
  const publisherDigest=role==='developer'?digest('publisher',issuer,publisherId):null;
  const sql='SELECT store_publisher_private.claim_portal_rate_permit($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS permitted';
  const result=await query(sql,[tokenId,issuer,subject,role,role==='developer'?publisherId:null,
   audience,expiresAt,route,actorDigest,publisherDigest]);
  if(!result||result.rowCount!==1||!Array.isArray(result.rows)||result.rows.length!==1||
      typeof result.rows[0]?.permitted!=='boolean')
   throw Error('invalid private database rate permit result');
  return result.rows[0].permitted;
 };
}
