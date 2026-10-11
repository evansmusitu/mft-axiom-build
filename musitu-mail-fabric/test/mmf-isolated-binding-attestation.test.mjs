import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync, createHash, sign} from 'node:crypto';
import {canonicalMmfStageScopeClaim,evaluateMmfIsolatedBindingAttestations} from '../src/commercial/mmf-isolated-binding-attestation.mjs';

const time=1791734400000;
const signing=(role)=>{
 const {privateKey,publicKey}=generateKeyPairSync('ed25519');
 const key=publicKey.export({type:'spki',format:'pem'});
 const fingerprint=createHash('sha256').update(publicKey.export({type:'spki',format:'der'})).digest('hex');
 const expected=role==='AUTHORITY'?{
  worker:'mft-phase8-external-authority',
  capabilities:['MMF_AUTHORITY_PRODUCT_ROUTES','MMF_AUTHORITY_PRODUCT_TOKEN'],
  routes:['/internal/paynow/sign-initiate-mmf','/internal/paynow/verify-callback-mmf'],
  tokenBinding:'MMF_AUTHORITY_BRIDGE_TOKEN'
 }:{worker:'mft-paynow-transport-gateway',
  capabilities:['MMF_TRANSPORT_PRODUCT_TOKEN','MMF_TRANSPORT_PRODUCT_ROUTE'],
  routes:['/internal/paynow/initiate-mmf'],tokenBinding:'MMF_TRANSPORT_BRIDGE_TOKEN'};
 const claim={schema:'mmf-stage-binding-attestation-v1',stageOnly:true,
  role,product:'musitu-mail-fabric',tenant:'mmf_stage_20261011',
  ...expected,nonce:role+'-NONCE-ISOLATED-20261011-0001',
  issuedAtMs:time-1000,expiresAtMs:time+60_000,
  merchantPermission:false,paymentInitiationAllowed:false,customerEmailAllowed:false,
  providerRequestsMade:0,productionSourceChanged:false};
 const make=(payload=claim)=>({claim:payload,
  signature:sign(null,canonicalMmfStageScopeClaim(payload),privateKey).toString('base64url')});
 return {claim,make,key,fingerprint,privateKey};
};
const setup=()=>{
 const a=signing('AUTHORITY'),b=signing('TRANSPORT');
 return {a,b,options:{authority:a.make(),transport:b.make(),
  authorityPublicKeyPem:a.key,authorityFingerprint:a.fingerprint,
  transportPublicKeyPem:b.key,transportFingerprint:b.fingerprint,
  nowMs:time,usedNonces:new Set()}};
};
test('two distinct isolated synthetic signers attest both MMF-specific authority and transport boundaries without any payment or mail rights',()=>{
 const {options}=setup();const r=evaluateMmfIsolatedBindingAttestations(options);
 assert.deepEqual(r.capabilities,[
  'MMF_AUTHORITY_PRODUCT_ROUTES','MMF_AUTHORITY_PRODUCT_TOKEN',
  'MMF_TRANSPORT_PRODUCT_TOKEN','MMF_TRANSPORT_PRODUCT_ROUTE']);
 assert.equal(r.syntheticOnly,true);assert.equal(r.realMerchantProductScopeProven,false);
 assert.equal(r.mayInitiatePayments,false);assert.equal(r.maySendCustomerEmail,false);
 assert.equal(r.mayMutateSharedWorkers,false);assert.equal(options.usedNonces.size,2);
 assert.throws(()=>evaluateMmfIsolatedBindingAttestations(options),/MMF_ISOLATED_ATTESTATION_DENIED/);
});
test('wrong tenant, product, route, token binding, role and forged activation claims fail before nonce use',()=>{
 const patches=[{tenant:'fmi_stage'},{product:'musitu-fmi'},
  {worker:'mft-fmi-billing'}, {routes:['/internal/paynow/sign-initiate-fmi','/internal/paynow/verify-callback-mmf']},
  {tokenBinding:'FMI_AUTHORITY_BRIDGE_TOKEN'}, {merchantPermission:true},
  {paymentInitiationAllowed:true}, {customerEmailAllowed:true},
  {providerRequestsMade:1}, {productionSourceChanged:true},
  {capabilities:['MMF_AUTHORITY_PRODUCT_ROUTES']},{merchantKey:'SHOULD_NEVER_APPEAR'}];
 for(const patch of patches){const {a,options}=setup();
  const malicious={...a.claim,...patch};
  assert.throws(()=>evaluateMmfIsolatedBindingAttestations({...options,authority:a.make(malicious)}),/MMF_ISOLATED_ATTESTATION_DENIED/,JSON.stringify(patch));
  assert.equal(options.usedNonces.size,0);
 }
});
test('signature substitution, identical keys, stale claims, duplicated nonces and extra parameters fail closed',()=>{
 const {a,b,options}=setup();
 const bad=[
  {...options,authority:{...options.authority,signature:options.transport.signature}},
  {...options,transportPublicKeyPem:options.authorityPublicKeyPem,transportFingerprint:options.authorityFingerprint},
  {...options,nowMs:time+3600_000},
  {...options,usedNonces:new Set([a.claim.nonce])},
  {...options,merchantIntegrationKey:'PRIVATE'},
 ];
 for(const invalid of bad){assert.throws(()=>evaluateMmfIsolatedBindingAttestations(invalid),/MMF_ISOLATED_ATTESTATION_DENIED/);}
 assert.equal(options.usedNonces.size,0);
});