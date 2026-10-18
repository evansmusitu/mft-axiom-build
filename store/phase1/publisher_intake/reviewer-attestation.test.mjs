import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {verifyPublisherDualReview} from './reviewer-attestation.mjs';
const identities=['reviewer-identity','reviewer-security'].map((id,i)=>{
  const k=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const pem=k.publicKey.export({type:'spki',format:'pem'});
  return {id,role:i===0?'identity':'security',privateKey:k.privateKey,pem,pin:createHash('sha256').update(pem).digest('hex')};
});
const intake={schema:'musitu.store.publisher-review.v1',state:'REVIEW_REQUIRED',
  publisherId:'vendor-alpha',appId:'vendor-app-one',packageId:'org.vendor.alpha',versionCode:1,
  apkSha256:'a'.repeat(64),signingCertificateSha256:'b'.repeat(64)};
const now='2026-10-18T16:00:00.000Z';
const approval={schema:'musitu.store.dual-review.v1',decision:'APPROVED_FOR_CATALOG_REVIEW',
  publisherId:intake.publisherId,appId:intake.appId,packageId:intake.packageId,
  apkSha256:intake.apkSha256,signingCertificateSha256:intake.signingCertificateSha256,
  versionCode:intake.versionCode,reviewedAt:'2026-10-18T15:00:00.000Z',
  expiresAt:'2026-10-19T15:00:00.000Z'};
function fixture(overrides={}){
  const data={...approval,...overrides};const bytes=Buffer.from(JSON.stringify(data));
  const trustedReviewers=identities.map(({id,role,pem,pin})=>({id,role,publicKeyPem:pem,expectedPemSha256:pin}));
  const signatures=identities.map(k=>({reviewerId:k.id,signatureBytes:sign('sha256',bytes,k.privateKey)}));
  return {reviewBytes:bytes,signatures,trustedReviewers,verifiedIntake:intake,now};
}
test('two distinct pinned identity/security reviewers authenticate independently verified APK evidence',()=>{
  const r=verifyPublisherDualReview(fixture());
  assert.equal(r.state,'APPROVED_FOR_CATALOG_REVIEW_ONLY');
  assert.equal(r.releaseAuthorized,false);assert.equal(r.delegationIssued,false);
  assert.equal(r.paymentAuthorized,false);assert.equal(r.humanReviewEvidenceCount,2);
});
test('one reviewer or duplicated reviewer cannot approve',()=>{
  const f=fixture();
  assert.throws(()=>verifyPublisherDualReview({...f,signatures:f.signatures.slice(0,1)}),/two|reviewer|signature/i);
  assert.throws(()=>verifyPublisherDualReview({...f,signatures:[f.signatures[0],f.signatures[0]]}),/distinct|duplicate|reviewer/i);
});
test('tampered canonical approval timestamp fails cryptographic reviewer signatures',()=>{
  const f=fixture();const altered=Buffer.from(f.reviewBytes.toString('utf8').replace('2026-10-18T15:00:00.000Z','2026-10-18T14:00:00.000Z'));
  assert.throws(()=>verifyPublisherDualReview({...f,reviewBytes:altered}),/signature|JSON|schema/i);
});
test('approval must bind inspected APK digest, package identity and native version',()=>{
  for(const v of [{apkSha256:'f'.repeat(64)},{packageId:'org.another.app'},{versionCode:2}])
    assert.throws(()=>verifyPublisherDualReview(fixture(v)),/identity|artifact|intake|match/i);
});
test('review cannot self-declare publication or root-signed package delegation',()=>{
  assert.throws(()=>verifyPublisherDualReview(fixture({releaseAuthorized:true})),/schema|unknown|field/i);
  assert.throws(()=>verifyPublisherDualReview(fixture({decision:'PUBLISH_LIVE'})),/decision/i);
});
test('expired, future, and excessively long approval validity rejected',()=>{
  assert.throws(()=>verifyPublisherDualReview(fixture({expiresAt:'2026-10-18T15:30:00.000Z'})),/expired/i);
  assert.throws(()=>verifyPublisherDualReview(fixture({reviewedAt:'2026-10-19T15:00:00.000Z'})),/future/i);
  assert.throws(()=>verifyPublisherDualReview(fixture({expiresAt:'2026-12-19T15:00:00.000Z'})),/expiry|validity/i);
});
test('reviewer key pin mismatch is rejected even if the signature is cryptographically valid',()=>{
  const f=fixture();f.trustedReviewers[0].expectedPemSha256='f'.repeat(64);
  assert.throws(()=>verifyPublisherDualReview(f),/pin/i);
});
test('review requires independent identity and security roles, not two identity signers',()=>{
  const f=fixture();f.trustedReviewers[1].role='identity';
  assert.throws(()=>verifyPublisherDualReview(f),/role|identity|security/i);
});
test('reused signature with another reviewer ID is not counted as two independent attestations',()=>{
  const f=fixture();f.signatures[0].reviewerId=f.signatures[1].reviewerId;
  assert.throws(()=>verifyPublisherDualReview(f),/duplicate|signature|distinct/i);
});
test('absent independently verified native APK intake cannot authorize manual publisher review',()=>{
  assert.throws(()=>verifyPublisherDualReview({...fixture(),verifiedIntake:{state:'APPROVED'}}),/intake|review|required/i);
});
