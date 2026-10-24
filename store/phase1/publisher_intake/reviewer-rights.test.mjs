import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {verifyPublisherRightsEvidence} from './reviewer-rights.mjs';
const mkHash=x=>createHash('sha256').update(x).digest('hex');
const identities=['reviewer-identity','reviewer-security'].map((id,i)=>{
 const k=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
 const pem=k.publicKey.export({format:'pem',type:'spki'});
 return {id,role:i?'security':'identity',privateKey:k.privateKey,
         publicKeyPem:pem,expectedPemSha256:mkHash(pem)};
});
const reviewers=identities.map(({id,role,publicKeyPem,expectedPemSha256})=>
 ({id,role,publicKeyPem,expectedPemSha256}));
const verifiedIntake={schema:'musitu.store.publisher-review.v1',
 state:'REVIEW_REQUIRED',publisherId:'independent-vendor',
 appId:'independent-app',packageId:'org.example.independent',
 versionCode:3,apkSha256:'a'.repeat(64),signingCertificateSha256:'b'.repeat(64)};
const reviewedAt='2026-10-21T09:00:00.000Z';
const now='2026-10-21T10:00:00.000Z';
const expiresAt='2026-10-22T09:00:00.000Z';
const baseReview={
 schema:'musitu.store.dual-review.v1',decision:'APPROVED_FOR_CATALOG_REVIEW',
 publisherId:verifiedIntake.publisherId,appId:verifiedIntake.appId,
 packageId:verifiedIntake.packageId,versionCode:verifiedIntake.versionCode,
 apkSha256:verifiedIntake.apkSha256,
 signingCertificateSha256:verifiedIntake.signingCertificateSha256,
 reviewedAt,expiresAt
};
const signed=(payload)=>{const bytes=Buffer.from(JSON.stringify(payload));
 return {bytes,signatures:identities.map(i=>({
    reviewerId:i.id,signatureBytes:sign('sha256',bytes,i.privateKey)
 }))};};
function fixture(options={}){
 const old=signed(baseReview);
 const rights={
 schema:'musitu.store.publisher-rights.v1',
 publisherId:verifiedIntake.publisherId,appId:verifiedIntake.appId,
 packageId:verifiedIntake.packageId,versionCode:3,
 apkSha256:verifiedIntake.apkSha256,
 signingCertificateSha256:verifiedIntake.signingCertificateSha256,
 dualReviewSha256:mkHash(old.bytes),basis:'DIRECT_PUBLISHER_OPT_IN',
 publisherOptInEvidenceSha256:'c'.repeat(64),
 licenseId:'custom-distribution-agreement-v1',
 licenseTextSha256:'d'.repeat(64),
 distributionTermsEvidenceSha256:'e'.repeat(64),
 securityReviewEvidenceSha256:'f'.repeat(64),
 sourceUrl:'https://example.org/authorized-release',
 reviewedAt,expiresAt,...options
 };
 const current=signed(rights);
 return {
  rightsBytes:current.bytes,signatures:current.signatures,
  trustedReviewers:reviewers,verifiedIntake,
  dualReview:{reviewBytes:old.bytes,signatures:old.signatures},
  now
 };
}
const deny=(opts={},patch=null)=>assert.throws(()=>{
 let args=fixture(opts);
 if(patch)args=patch(args);
 verifyPublisherRightsEvidence(args);
},/rights|review|intake|approval|signature|publisher|schema|future|expired|expired|duplicate/i);
test('human-signed direct opt-in rights remain review-only, not publication or payment authority',()=>{
 const v=verifyPublisherRightsEvidence(fixture());
 assert.equal(v.state,'PRIVATE_RIGHTS_REVIEW_RECORD_VERIFIED_ONLY');
 assert.equal(v.ownerOptInRecordPresent,true);
 for(const k of ['enrolledPublisher','acceptedThirdPartyApp','publicationAuthorized',
  'releaseAuthorized','storefrontEnabled','paymentAuthorized','payoutAuthorized'])
  assert.equal(v[k],false,k);
});
test('GPL redistribution review does not imply independent publisher enrollment',()=>{
 const v=verifyPublisherRightsEvidence(fixture({
  basis:'OPEN_SOURCE_REDISTRIBUTION',licenseId:'GPL-3.0-or-later',
  publisherOptInEvidenceSha256:null
 }));
 assert.equal(v.ownerOptInRecordPresent,false);
 assert.equal(v.enrolledPublisher,false);
 assert.equal(v.acceptedThirdPartyApp,false);
});
test('open-source mode cannot fabricate publisher opt-in and no unreviewed license passes',()=>{
 deny({basis:'OPEN_SOURCE_REDISTRIBUTION',licenseId:'GPL-3.0-only'});
 deny({basis:'OPEN_SOURCE_REDISTRIBUTION',licenseId:'Unverified',publisherOptInEvidenceSha256:null});
});
test('direct publisher mode requires independently preserved consent digest',()=>{
 deny({publisherOptInEvidenceSha256:null});
 deny({publisherOptInEvidenceSha256:'bogus'});
});
test('unknown rights-basis and private/unsafe source URLs denied',()=>{
 deny({basis:'BYPASS'});
 deny({sourceUrl:'http://example.org/app'});
 deny({sourceUrl:'https://localhost/app'});
 deny({sourceUrl:'https://127.0.0.1/app'});
});
test('APK and dual reviewer identities must match the actual independently inspected file',()=>{
 deny({apkSha256:'9'.repeat(64)});
 deny({signingCertificateSha256:'1'.repeat(64)});
 deny({versionCode:4});
 deny({dualReviewSha256:'0'.repeat(64)});
});
test('rights reviewer signature cannot be tampered or one signer duplicated',()=>{
 deny({},a=>({...a,rightsBytes:Buffer.from(a.rightsBytes.toString().replace('custom-distribution','other-distribution'))}));
 deny({},a=>({...a,signatures:[a.signatures[0],a.signatures[0]]}));
 deny({},a=>({...a,signatures:a.signatures.slice(0,1)}));
});
test('operator-pinned keys and roles are mandatory',()=>{
 deny({},a=>({...a,trustedReviewers:[a.trustedReviewers[0],a.trustedReviewers[0]]}));
 deny({},a=>({...a,trustedReviewers:a.trustedReviewers.map((r,i)=>({...r,expectedPemSha256:i?'0'.repeat(64):r.expectedPemSha256}))}));
});
test('signed manual review must be reverified, fabricated state is rejected',()=>{
 deny({},a=>({...a,dualReview:{state:'APPROVED_FOR_CATALOG_REVIEW_ONLY'}}));
 deny({},a=>({...a,dualReview:{...a.dualReview,signatures:a.dualReview.signatures.slice(0,1)}}));
});
test('expired or artificially prolonged review and forged direct permission are rejected',()=>{
 deny({expiresAt:'2026-10-21T09:30:00.000Z'});
 deny({expiresAt:'2026-12-01T09:00:00.000Z'});
 deny({reviewedAt:'2026-10-22T09:00:00.000Z'});
 deny({distributionTermsEvidenceSha256:null});
});
test('applicant cannot append self-approval flags to canonical rights record',()=>{
 deny({enrolledPublisher:true});
 deny({paymentAuthorized:true});
});
