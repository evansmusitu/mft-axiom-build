/**
 * Exact, OFFLINE-ONLY Ed25519 two-party release-intent qualification for MMF.
 * Signatures from ephemeral caller-supplied keys are NOT independent real-world
 * approvals and NEVER authorize production, payments, mail, or shared changes.
 * No provider, Cloudflare, filesystem, or secret APIs are accessed.
 */
import {createHash,createPublicKey,verify} from 'node:crypto';
export const MMF_DUAL_RELEASE_DENIED='MMF_DUAL_RELEASE_DENIED';
const deny=()=>{throw Error(MMF_DUAL_RELEASE_DENIED)};
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const exact=(obj,keys)=>record(obj)&&Object.keys(obj).length===keys.length&&keys.every(k=>Object.hasOwn(obj,k));
const hex=x=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x);
const intentKeys=['schema','product','scope','candidateSourceHead','candidateCiphertextSha256',
 'candidateManifestSha256','workers','nonce','issuedAtMs','expiresAtMs','sharedWorkerWritesAllowed',
 'merchantEligibilityVerified','nonExportableSecretRollbackVerified','realPaymentsAllowed','productionReleaseApproved'];
const workerKeys=['name','currentSourceSha256','legacyBindingsSha256','preparedSourceSha256'];
const expected=Object.freeze({
 candidateSourceHead:'b60f8b34cd184b3a405085b1ef46ec9db6cf7027',
 candidateCiphertextSha256:'52ed96bc4ed92e127fff36aeefc857fe31ca5c9558c59648291d867cafcac97b',
 candidateManifestSha256:'718eb22a26a4d2949647aeaa8b0e367bf596dfc96ccf852bbf35860c2850f359',
 workers:Object.freeze([
  Object.freeze({name:'mft-phase8-external-authority',
   currentSourceSha256:'66b9386b9e5966dd4a27d2498e9eb4048e806321ea5ff63b827e6b82b7539df3',
   legacyBindingsSha256:'ceacccdcd5bcaae795ab62b828065fb53c7fed8046316992809773ce8c8454a7',
   preparedSourceSha256:'46eda8f65badfd23e20c3f3309dfe1b30f72678f588b4eac93396b6c39b2bb48'}),
  Object.freeze({name:'mft-paynow-transport-gateway',
   currentSourceSha256:'293a32510bb0722f5301f8e63ca368ecc79c6bd5b7ab20d415742d9bdda103a3',
   legacyBindingsSha256:'0c1205be099d0225367f98967c93a26f7d5a361a17fcd6719b5de9b16830d978',
   preparedSourceSha256:'32702882edb62b487d302a3e266221b4c08c2159e566beb7e6ad1301956f4712'})
 ])
});
const signerKeys=['identity','signature'];
const trustKeys=['publicKeyPem','fingerprint'];
/** Verifies exact field set and exact observed/pinned candidate digests. */
export function canonicalMmfReleaseIntent(intent){
 try{
  if(!exact(intent,intentKeys)||intent.schema!=='mmf-offline-dual-release-intent-v1'||
   intent.product!=='musitu-mail-fabric'||intent.scope!=='SYNTHETIC_OFFLINE_QUALIFICATION_ONLY'||
   intent.candidateSourceHead!==expected.candidateSourceHead||
   intent.candidateCiphertextSha256!==expected.candidateCiphertextSha256||
   intent.candidateManifestSha256!==expected.candidateManifestSha256||
   !Array.isArray(intent.workers)||intent.workers.length!==2||
   !intent.workers.every((w,i)=>exact(w,workerKeys)&&workerKeys.every(k=>w[k]===expected.workers[i][k]))||
   typeof intent.nonce!=='string'||!/^MMF-[A-Z0-9-]{20,75}$/.test(intent.nonce)||
   !Number.isSafeInteger(intent.issuedAtMs)||!Number.isSafeInteger(intent.expiresAtMs)||
   intent.issuedAtMs<=0||intent.expiresAtMs<=intent.issuedAtMs||
   intent.expiresAtMs-intent.issuedAtMs>600_000||
   intent.sharedWorkerWritesAllowed!==false||intent.merchantEligibilityVerified!==false||
   intent.nonExportableSecretRollbackVerified!==false||intent.realPaymentsAllowed!==false||
   intent.productionReleaseApproved!==false)deny();
  const ordered=Object.fromEntries(intentKeys.map(k=>[k,k==='workers'?
   intent.workers.map(w=>Object.fromEntries(workerKeys.map(field=>[field,w[field]]))):intent[k]]));
  const buf=Buffer.from(JSON.stringify(ordered),'utf8');
  if(buf.length>3200)deny();
  return buf;
 }catch{deny()}
}
/**
 * Test-only trust material is supplied by the caller and cannot substitute for
 * pinned institutional trust anchors or an independently identified approver.
 */
export function evaluateMmfOfflineDualRelease(options){
 try{
  if(!exact(options,['intent','owner','reviewer','trustedOwner','trustedReviewer','nowMs','usedNonces'])||
   !Number.isSafeInteger(options.nowMs)||options.nowMs<=0||
   !(options.usedNonces instanceof Set)||options.usedNonces.size>100_000||
   options.usedNonces.has(options.intent?.nonce))deny();
  const bytes=canonicalMmfReleaseIntent(options.intent);
  if(options.intent.issuedAtMs>options.nowMs+30_000||options.nowMs>=options.intent.expiresAtMs)deny();
  const fingerprints=[];
  for(const [packet,trust,identity] of [
   [options.owner,options.trustedOwner,'OWNER'],
   [options.reviewer,options.trustedReviewer,'INDEPENDENT_REVIEWER']]){
   if(!exact(packet,signerKeys)||packet.identity!==identity||
      typeof packet.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(packet.signature)||
      !exact(trust,trustKeys)||typeof trust.publicKeyPem!=='string'||
      trust.publicKeyPem.length>3000||!hex(trust.fingerprint))deny();
   const key=createPublicKey(trust.publicKeyPem);
   if(key.asymmetricKeyType!=='ed25519'||
      createHash('sha256').update(key.export({format:'der',type:'spki'})).digest('hex')!==trust.fingerprint||
      !verify(null,bytes,key,Buffer.from(packet.signature,'base64url')))deny();
   fingerprints.push(trust.fingerprint);
  }
  if(fingerprints[0]===fingerprints[1])deny();
  // Atomic local replay accounting; not a distributed production nonce ledger.
  options.usedNonces.add(options.intent.nonce);
  return Object.freeze({gate:'MMF_OFFLINE_TWO_SIGNER_CRYPTOGRAPHIC_QUALIFICATION',
   cryptographicSignaturesValid:true,syntheticQualificationOnly:true,
   candidateCiphertextSha256:expected.candidateCiphertextSha256,
   candidateManifestSha256:expected.candidateManifestSha256,
   verifiedDistinctSigningKeys:2,
   independentRealApproverVerified:false,productionTrustAnchorsEstablished:false,
   merchantEligibilityVerified:false,nonExportableSecretRollbackVerified:false,
   productionReleaseAuthorized:false,canDeploySharedWorkers:false,
   mayInitiateRealPayments:false,maySendCustomerEmail:false});
 }catch{deny()}
}