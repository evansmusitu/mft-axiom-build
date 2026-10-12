import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, generateKeyPairSync, sign} from 'node:crypto';
import {canonicalMmfReleaseIntent, evaluateMmfOfflineDualRelease} from '../src/commercial/mmf-dual-release-gate.mjs';

const NOW=1791792000000;
const SHA={
  encrypted:'52ed96bc4ed92e127fff36aeefc857fe31ca5c9558c59648291d867cafcac97b',
  manifest:'718eb22a26a4d2949647aeaa8b0e367bf596dfc96ccf852bbf35860c2850f359',
  sourceA:'66b9386b9e5966dd4a27d2498e9eb4048e806321ea5ff63b827e6b82b7539df3',
  sourceT:'293a32510bb0722f5301f8e63ca368ecc79c6bd5b7ab20d415742d9bdda103a3',
  bindingA:'ceacccdcd5bcaae795ab62b828065fb53c7fed8046316992809773ce8c8454a7',
  bindingT:'0c1205be099d0225367f98967c93a26f7d5a361a17fcd6719b5de9b16830d978',
  patchA:'46eda8f65badfd23e20c3f3309dfe1b30f72678f588b4eac93396b6c39b2bb48',
  patchT:'32702882edb62b487d302a3e266221b4c08c2159e566beb7e6ad1301956f4712'
};
const makeIntent=()=>({
  schema:'mmf-offline-dual-release-intent-v1',product:'musitu-mail-fabric',
  scope:'SYNTHETIC_OFFLINE_QUALIFICATION_ONLY',
  candidateSourceHead:'b60f8b34cd184b3a405085b1ef46ec9db6cf7027',
  candidateCiphertextSha256:SHA.encrypted, candidateManifestSha256:SHA.manifest,
  workers:[
    {name:'mft-phase8-external-authority',currentSourceSha256:SHA.sourceA,legacyBindingsSha256:SHA.bindingA,preparedSourceSha256:SHA.patchA},
    {name:'mft-paynow-transport-gateway',currentSourceSha256:SHA.sourceT,legacyBindingsSha256:SHA.bindingT,preparedSourceSha256:SHA.patchT}
  ],
  nonce:'MMF-DUAL-RELEASE-QUALIFY-20261012-00001',issuedAtMs:NOW-1000,expiresAtMs:NOW+60_000,
  sharedWorkerWritesAllowed:false,merchantEligibilityVerified:false,nonExportableSecretRollbackVerified:false,
  realPaymentsAllowed:false,productionReleaseApproved:false
});
const key=()=>{
 const {publicKey,privateKey}=generateKeyPairSync('ed25519');
 const publicKeyPem=publicKey.export({type:'spki',format:'pem'});
 const fingerprint=createHash('sha256').update(publicKey.export({type:'spki',format:'der'})).digest('hex');
 return {privateKey,publicKeyPem,fingerprint};
};
const fixture=()=>{
 const intent=makeIntent(),owner=key(),reviewer=key();
 const packet=(identity,keyPair,payload=intent)=>({identity,signature:sign(null,canonicalMmfReleaseIntent(payload),keyPair.privateKey).toString('base64url')});
 const opt={intent,owner:packet('OWNER',owner),reviewer:packet('INDEPENDENT_REVIEWER',reviewer),
   trustedOwner:{publicKeyPem:owner.publicKeyPem,fingerprint:owner.fingerprint},
   trustedReviewer:{publicKeyPem:reviewer.publicKeyPem,fingerprint:reviewer.fingerprint},
   nowMs:NOW,usedNonces:new Set()};
 return {opt,owner,reviewer,packet};
};
const denied=(fn)=>assert.throws(fn,/MMF_DUAL_RELEASE_DENIED/);

test('two independent ephemeral Ed25519 signatures bind exact encrypted MMF candidate and current legacy digests but NEVER grant production rights',()=>{
 const {opt}=fixture();const result=evaluateMmfOfflineDualRelease(opt);
 assert.equal(result.gate,'MMF_OFFLINE_TWO_SIGNER_CRYPTOGRAPHIC_QUALIFICATION');
 assert.equal(result.cryptographicSignaturesValid,true);
 assert.equal(result.productionReleaseAuthorized,false);
 assert.equal(result.canDeploySharedWorkers,false);
 assert.equal(result.mayInitiateRealPayments,false);
 assert.equal(result.independentRealApproverVerified,false);
 assert.equal(opt.usedNonces.size,1);
 denied(()=>evaluateMmfOfflineDualRelease(opt));
});

test('changing any ciphertext/manifest/current-source/binding/prepared-source digest is rejected even with fresh valid signatures',()=>{
 const edits=[
  v=>{v.candidateCiphertextSha256='1'.repeat(64)},
  v=>{v.candidateManifestSha256='2'.repeat(64)},
  v=>{v.workers[0].currentSourceSha256='3'.repeat(64)},
  v=>{v.workers[1].legacyBindingsSha256='4'.repeat(64)},
  v=>{v.workers[1].preparedSourceSha256='5'.repeat(64)},
  v=>{v.workers.reverse()},
 ];
 for(const edit of edits){const intent=makeIntent();edit(intent);denied(()=>canonicalMmfReleaseIntent(intent));}
});

test('extra merchant fields, wrong product, false release claims and altered worker roster fail closed',()=>{
 const edits=[v=>{v.merchantKey='secret'},v=>{v.product='musitu-fmi'},
  v=>{v.scope='PRODUCTION'},v=>{v.productionReleaseApproved=true},
  v=>{v.sharedWorkerWritesAllowed=true},v=>{v.realPaymentsAllowed=true},
  v=>{v.merchantEligibilityVerified=true},v=>{v.nonExportableSecretRollbackVerified=true},
  v=>{v.workers[0].extra='untrusted'},v=>{v.workers[0].name='mft-fmi-billing'}];
 for(const edit of edits){const intent=makeIntent();edit(intent);denied(()=>canonicalMmfReleaseIntent(intent));}
});

test('signature swap, counterfeit keys, identical signer, stale time and unknown caller argument fail without consuming nonce',()=>{
 const {opt}=fixture();const invalid=[
  {...opt,owner:opt.reviewer,reviewer:opt.owner},
  {...opt,trustedReviewer:opt.trustedOwner},
  {...opt,nowMs:NOW+90_000},
  {...opt,nowMs:NOW-90_000},
  {...opt,customerEmailAllowed:true},
  {...opt,owner:{...opt.owner,signature:opt.reviewer.signature}},
  {...opt,trustedReviewer:{...opt.trustedReviewer,fingerprint:'b'.repeat(64)}}
 ];
 for(const x of invalid)denied(()=>evaluateMmfOfflineDualRelease(x));
 assert.equal(opt.usedNonces.size,0);
});

test('reviewer missing, malformed signature, reused nonce and forged owner identity are rejected atomically',()=>{
 const {opt}=fixture();
 denied(()=>evaluateMmfOfflineDualRelease({...opt,reviewer:null}));
 denied(()=>evaluateMmfOfflineDualRelease({...opt,reviewer:{...opt.reviewer,signature:'x'}}));
 denied(()=>evaluateMmfOfflineDualRelease({...opt,owner:{...opt.owner,identity:'INDEPENDENT_REVIEWER'}}));
 denied(()=>evaluateMmfOfflineDualRelease({...opt,usedNonces:new Set([opt.intent.nonce])}));
 assert.equal(opt.usedNonces.size,0);
});