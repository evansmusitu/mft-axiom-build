/**
 * Offline, private two-reviewer rights-evidence gate for MUSITU Store V2.
 * This never grants app publication, publisher enrollment, payment or payout.
 * Do not commit operator pins, signed rights bytes or identity records.
 */
import {createHash,createPublicKey,verify as checkSignature} from 'node:crypto';
import {isIP} from 'node:net';
import {verifyPublisherDualReview} from './reviewer-attestation.mjs';

const EXPECTED=[
  'apkSha256','appId','basis','distributionTermsEvidenceSha256',
  'dualReviewSha256','expiresAt','licenseId','licenseTextSha256',
  'packageId','publisherId','publisherOptInEvidenceSha256','reviewedAt',
  'schema','securityReviewEvidenceSha256','signingCertificateSha256',
  'sourceUrl','versionCode'
].sort();
const HEX=/^[a-f0-9]{64}$/;
const LICENSES=new Set(['GPL-3.0-only','GPL-3.0-or-later','Apache-2.0','MIT']);
function reject(message){throw Error('MUSITU_STORE_PRIVATE_RIGHTS_DENIED: '+message);}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function exactJson(bytes){
  if(!Buffer.isBuffer(bytes)||bytes.length<200||bytes.length>16384)reject('bounded signed bytes required');
  let x;
  try{x=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{reject('invalid UTF-8 JSON');}
  if(!x||typeof x!=='object'||Array.isArray(x)||
     Object.keys(x).sort().join(',')!==EXPECTED.join(',')||
     Buffer.compare(Buffer.from(JSON.stringify(x),'utf8'),bytes)!==0)
    reject('schema must be exact and canonical');
  return x;
}
function time(s){
  if(typeof s!=='string')reject('canonical timestamp required');
  const d=new Date(s);
  if(!Number.isFinite(d.getTime())||d.toISOString()!==s)reject('canonical timestamp required');
  return d.getTime();
}
function https(s){
  try{
    const u=new URL(s);
    if(u.protocol!=='https:'||!u.hostname.includes('.')||isIP(u.hostname)!==0||u.username||u.password||
       u.port||u.hash||u.search||/[\s\\]/.test(s)||
       !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(u.hostname)||
       /(?:^|\.)(?:local|localhost|internal)$/.test(u.hostname))
      reject('public clean HTTPS source URL required');
  }catch{reject('public clean HTTPS source URL required');}
}
function pins(roster){
  if(!Array.isArray(roster)||roster.length!==2)reject('two operator-pinned reviewer keys required');
  const keys=new Map(),roles=new Set();
  for(const r of roster){
    if(!r||!/^reviewer-[a-z0-9-]{3,48}$/.test(r.id)||keys.has(r.id)||
       !['identity','security'].includes(r.role)||roles.has(r.role)||
       typeof r.publicKeyPem!=='string'||hash(Buffer.from(r.publicKeyPem))!==r.expectedPemSha256)
      reject('independently pinned reviewer identity/security roster required');
    let key;
    try{key=createPublicKey(r.publicKeyPem);}catch{reject('malformed reviewer public key');}
    if(key.asymmetricKeyType!=='ec'||key.asymmetricKeyDetails?.namedCurve!=='prime256v1')
      reject('P-256 reviewer key required');
    keys.set(r.id,key);roles.add(r.role);
  }
  if(!roles.has('identity')||!roles.has('security'))reject('identity and security reviewers required');
  return keys;
}
export function verifyPublisherRightsEvidence({
  rightsBytes,signatures,trustedReviewers,verifiedIntake,dualReview,now
}={}){
  // This function re-verifies the preceding P-256 dual-review artifact:
  // caller-supplied fake state strings do not count.
  if(!dualReview||!verifiedIntake)reject('signed independently inspected APK required');
  const prior=verifyPublisherDualReview({
    ...dualReview,trustedReviewers,verifiedIntake,now
  });
  const x=exactJson(rightsBytes),t=time(now),start=time(x.reviewedAt),end=time(x.expiresAt);
  if(x.schema!=='musitu.store.publisher-rights.v1')reject('rights schema');
  if(t<start-60000||t>=end||end<=start||end-start>7*86400000)
    reject('expiry or future approval');
  for(const key of ['publisherId','appId','packageId','versionCode',
                     'apkSha256','signingCertificateSha256']){
    if(x[key]!==verifiedIntake[key])reject('rights are not bound to the actual APK: '+key);
  }
  if(x.dualReviewSha256!==prior.reviewSha256)reject('unbound earlier manual review');
  for(const field of ['apkSha256','signingCertificateSha256','dualReviewSha256',
      'licenseTextSha256','distributionTermsEvidenceSha256','securityReviewEvidenceSha256']){
    if(typeof x[field]!=='string'||!HEX.test(x[field]))reject('missing independently hashed '+field);
  }
  if(!['DIRECT_PUBLISHER_OPT_IN','OPEN_SOURCE_REDISTRIBUTION'].includes(x.basis))
    reject('rights basis');
  if(x.basis==='DIRECT_PUBLISHER_OPT_IN'){
    if(typeof x.publisherOptInEvidenceSha256!=='string'||
       !HEX.test(x.publisherOptInEvidenceSha256)||
       typeof x.licenseId!=='string'||x.licenseId.length<2||x.licenseId.length>72)
      reject('direct opt-in requires durable publisher consent and terms');
  }else if(x.publisherOptInEvidenceSha256!==null||!LICENSES.has(x.licenseId)){
    reject('open-source redistribution must not impersonate enrolled publisher');
  }
  https(x.sourceUrl);
  const keys=pins(trustedReviewers),seen=new Set();
  if(!Array.isArray(signatures)||signatures.length!==2)
    reject('two rights-review signatures required');
  for(const s of signatures){
    if(!s||seen.has(s.reviewerId)||!keys.has(s.reviewerId)||
       !Buffer.isBuffer(s.signatureBytes)||s.signatureBytes.length<64||
       s.signatureBytes.length>512)
      reject('unknown/duplicate rights reviewer signature');
    if(!checkSignature('sha256',rightsBytes,keys.get(s.reviewerId),s.signatureBytes))
      reject('tampered rights signature');
    seen.add(s.reviewerId);
  }
  return Object.freeze({
    state:'PRIVATE_RIGHTS_REVIEW_RECORD_VERIFIED_ONLY',
    rightsSha256:hash(rightsBytes),apkSha256:x.apkSha256,
    basis:x.basis,ownerOptInRecordPresent:x.basis==='DIRECT_PUBLISHER_OPT_IN',
    enrolledPublisher:false,acceptedThirdPartyApp:false,
    publicationAuthorized:false,releaseAuthorized:false,
    storefrontEnabled:false,merchantApprovedByThisGate:false,
    paymentAuthorized:false,payoutAuthorized:false
  });
}
