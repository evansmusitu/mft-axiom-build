/** Private independent two-person review for one independently inspected APK.
 * No network, identity accounts, Store root signing, delegation or publishing.
 * The trusted reviewer public-key roster MUST come from protected operator config.
 */
import {createHash,createPublicKey,verify as verifySignature} from 'node:crypto';
const EXPECTED=['apkSha256','appId','decision','expiresAt','packageId','publisherId','reviewedAt','schema','signingCertificateSha256','versionCode'];
const HASH=/^[a-f0-9]{64}$/;
function deny(why){throw Error('private publisher dual review: '+why);}
function iso(value){
  if(typeof value!=='string')deny('canonical timestamp required');
  const d=new Date(value);
  if(!Number.isFinite(d.getTime())||d.toISOString()!==value)deny('canonical timestamp required');
  return d.getTime();
}
export function verifyPublisherDualReview({reviewBytes,signatures,trustedReviewers,verifiedIntake,now}={}){
  if(!Buffer.isBuffer(reviewBytes)||reviewBytes.length<100||reviewBytes.length>8192)
    deny('bounded signed review bytes required');
  let record;
  try{record=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(reviewBytes));}
  catch{deny('valid UTF8 JSON approval required');}
  if(!record||Array.isArray(record)||typeof record!=='object'||
     Object.keys(record).sort().join(',')!==EXPECTED.join(',')||
     Buffer.from(JSON.stringify(record)).compare(reviewBytes)!==0)
    deny('review schema fields must be exact canonical JSON');
  if(record.schema!=='musitu.store.dual-review.v1'||record.decision!=='APPROVED_FOR_CATALOG_REVIEW')
    deny('unsupported review decision');
  if(typeof now!=='string')deny('trusted current time required');
  const t=iso(now),issued=iso(record.reviewedAt),expires=iso(record.expiresAt);
  if(issued>t+60000)deny('future reviewer approval');
  if(expires<=t)deny('expired reviewer approval');
  if(expires<=issued||expires-issued>7*24*60*60*1000)
    deny('reviewer approval validity exceeds seven days');
  if(!verifiedIntake||verifiedIntake.schema!=='musitu.store.publisher-review.v1'||
      verifiedIntake.state!=='REVIEW_REQUIRED')deny('independent inspected APK intake required');
  for(const field of ['publisherId','appId','packageId','versionCode','apkSha256','signingCertificateSha256']){
    if(record[field]!==verifiedIntake[field])deny('signed approval artifact identity does not match independent intake: '+field);
  }
  if(!HASH.test(record.apkSha256)||!HASH.test(record.signingCertificateSha256)||
     !Number.isSafeInteger(record.versionCode)||record.versionCode<=0)
    deny('invalid signed artifact identity');
  if(!Array.isArray(signatures)||signatures.length!==2||
      !Array.isArray(trustedReviewers)||trustedReviewers.length!==2)
    deny('two independently pinned reviewers and signatures required');
  const roster=new Map(),roles=new Set();
  for(const reviewer of trustedReviewers){
    if(!reviewer||!['identity','security'].includes(reviewer.role)||
       typeof reviewer.id!=='string'||!/^reviewer-[a-z0-9-]{3,48}$/.test(reviewer.id)||
       roster.has(reviewer.id)||roles.has(reviewer.role))
      deny('distinct identity and security review roles required');
    if(typeof reviewer.publicKeyPem!=='string'||typeof reviewer.expectedPemSha256!=='string'||
       createHash('sha256').update(reviewer.publicKeyPem).digest('hex')!==reviewer.expectedPemSha256)
      deny('reviewer public-key pin mismatch');
    const key=createPublicKey(reviewer.publicKeyPem);
    if(key.asymmetricKeyType!=='ec'||key.asymmetricKeyDetails?.namedCurve!=='prime256v1')
      deny('reviewer signature key must be pinned P-256');
    roster.set(reviewer.id,key);roles.add(reviewer.role);
  }
  if(!roles.has('identity')||!roles.has('security'))deny('distinct identity/security reviewers required');
  const used=new Set();
  for(const entry of signatures){
    if(!entry||!roster.has(entry.reviewerId)||used.has(entry.reviewerId)||
       !Buffer.isBuffer(entry.signatureBytes)||entry.signatureBytes.length<64||entry.signatureBytes.length>512)
      deny('duplicate, invalid or untrusted reviewer signature');
    if(!verifySignature('sha256',reviewBytes,roster.get(entry.reviewerId),entry.signatureBytes))
      deny('reviewer signature verification failed');
    used.add(entry.reviewerId);
  }
  if(used.size!==2)deny('two distinct reviewer signatures required');
  return Object.freeze({state:'APPROVED_FOR_CATALOG_REVIEW_ONLY',
    reviewSha256:createHash('sha256').update(reviewBytes).digest('hex'),
    publisherId:record.publisherId,appId:record.appId,packageId:record.packageId,
    artifactSha256:record.apkSha256,humanReviewEvidenceCount:2,
    releaseAuthorized:false,delegationIssued:false,paymentAuthorized:false});
}
