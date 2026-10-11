import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash,sign} from 'node:crypto';
import {canonicalProviderQualificationBytes,verifyProviderQualification} from '../src/security/provider-qualification.mjs';
import {provisionSyntheticQualification} from './helpers/qualification-grant.mjs';
const pin=k=>createHash('sha256').update(k.export({type:'spki',format:'der'})).digest('hex');
const pem=k=>k.export({type:'spki',format:'pem'}).toString();
function fixture(){
 const env={MMF_TENANT_ID:'client1',MMF_FROM_DOMAIN:'example.org',MMF_PROVIDER:'resend'};
 const owner=generateKeyPairSync('ed25519'),approver=generateKeyPairSync('ed25519');
 env.MMF_RELEASE_OWNER_PUBLIC_KEY_PEM=pem(owner.publicKey);env.MMF_RELEASE_OWNER_FINGERPRINT=pin(owner.publicKey);
 env.MMF_RELEASE_APPROVER_PUBLIC_KEY_PEM=pem(approver.publicKey);env.MMF_RELEASE_APPROVER_FINGERPRINT=pin(approver.publicKey);
 return {env,owner,approver};
}

test('independently signed, matching short-lived provider evidence passes only the local preflight gate',()=>{
 const {env}=fixture();provisionSyntheticQualification(env);
 assert.equal(verifyProviderQualification(env),true);
});
test('absent and locally asserted webhook flags without independent evidence fail closed',()=>{
 const {env}=fixture();env.MMF_WEBHOOK_ENABLED='true';env.MMF_WEBHOOK_SECRET='whsec_forged-not-evidence';
 assert.throws(()=>verifyProviderQualification(env),/PROVIDER_QUALIFICATION_DENIED/);
});
test('cannot repurpose a live release signer as qualification auditor',()=>{
 const {env,owner,approver}=fixture();
 for(const signingPair of [owner,approver]){
  provisionSyntheticQualification(env,{auditor:signingPair});
  assert.throws(()=>verifyProviderQualification(env),/PROVIDER_QUALIFICATION_DENIED/);
 }
});
test('event evidence must be intact, scoped and fresh',()=>{
 const {env}=fixture();provisionSyntheticQualification(env);const value=JSON.parse(env.MMF_PROVIDER_QUALIFICATION_JSON);
 for(const changed of [
  { ...value, claim:{...value.claim,rawSha256:'b'.repeat(64)} },
  { ...value, claim:{...value.claim,tenantId:'client2'} },
  { ...value, claim:{...value.claim,provider:'postal'} },
  { ...value, claim:{...value.claim,eventType:'email.sent'} },
  { ...value, claim:{...value.claim,webhookId:''} },
  { ...value, claim:{...value.claim,expiresMs:Date.now()-1} },
  { ...value, claim:{...value.claim,expiresMs:value.claim.qualifiedMs+8*86400000} },
  { ...value, auditorSignature:'A'.repeat(86) },
  { ...value, unknownField:true },
 ]){
  env.MMF_PROVIDER_QUALIFICATION_JSON=JSON.stringify(changed);
  assert.throws(()=>verifyProviderQualification(env),/PROVIDER_QUALIFICATION_DENIED/);
 }
});
test('cannot substitute auditor public key without separately trusted matching pin',()=>{
 const {env}=fixture();const {auditor}=provisionSyntheticQualification(env);const other=generateKeyPairSync('ed25519');
 env.MMF_QUALIFICATION_AUDITOR_PUBLIC_KEY_PEM=pem(other.publicKey);
 assert.throws(()=>verifyProviderQualification(env),/PROVIDER_QUALIFICATION_DENIED/);
 env.MMF_QUALIFICATION_AUDITOR_FINGERPRINT=pin(other.publicKey);
 assert.throws(()=>verifyProviderQualification(env),/PROVIDER_QUALIFICATION_DENIED/);
 env.MMF_QUALIFICATION_AUDITOR_PUBLIC_KEY_PEM=pem(auditor.publicKey);
 assert.throws(()=>verifyProviderQualification(env),/PROVIDER_QUALIFICATION_DENIED/);
});
test('claim cannot be changed or broadened with unknown fields before auditor signs it',()=>{
 const {env}=fixture();const {claim}=provisionSyntheticQualification(env);
 assert.throws(()=>canonicalProviderQualificationBytes({...claim,extra:'trustme'}),/PROVIDER_QUALIFICATION_DENIED/);
 assert.throws(()=>canonicalProviderQualificationBytes({...claim,deliveryAttemptId:'x'}),/PROVIDER_QUALIFICATION_DENIED/);
 const auditKey=generateKeyPairSync('ed25519');
 assert.equal(sign(null,canonicalProviderQualificationBytes(claim),auditKey.privateKey).length,64);
});
