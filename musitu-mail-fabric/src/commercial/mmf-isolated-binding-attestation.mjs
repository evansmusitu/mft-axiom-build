/**
 * Pure, local verification of MMF-only SYNTHETIC product route/binding attestations.
 * No Cloudflare or provider calls, merchant keys, production activation or emails.
 * A signed claim demonstrates an isolated contract test, not real route deployment.
 */
import {createHash,createPublicKey,verify} from 'node:crypto';
export const MMF_STAGE_ATTESTATION_DENIED='MMF_ISOLATED_ATTESTATION_DENIED';
const deny=()=>{throw Error(MMF_STAGE_ATTESTATION_DENIED)};
const record=o=>o!==null&&typeof o==='object'&&!Array.isArray(o)&&Object.getPrototypeOf(o)===Object.prototype;
const exact=(o,keys)=>record(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
const FIELDS=Object.freeze(['schema','stageOnly','role','product','tenant','worker','capabilities',
 'routes','tokenBinding','nonce','issuedAtMs','expiresAtMs','merchantPermission',
 'paymentInitiationAllowed','customerEmailAllowed','providerRequestsMade','productionSourceChanged']);
const TYPES=Object.freeze({
 AUTHORITY:Object.freeze({worker:'mft-phase8-external-authority',
  capabilities:['MMF_AUTHORITY_PRODUCT_ROUTES','MMF_AUTHORITY_PRODUCT_TOKEN'],
  routes:['/internal/paynow/sign-initiate-mmf','/internal/paynow/verify-callback-mmf'],
  tokenBinding:'MMF_AUTHORITY_BRIDGE_TOKEN'}),
 TRANSPORT:Object.freeze({worker:'mft-paynow-transport-gateway',
  capabilities:['MMF_TRANSPORT_PRODUCT_TOKEN','MMF_TRANSPORT_PRODUCT_ROUTE'],
  routes:['/internal/paynow/initiate-mmf'],tokenBinding:'MMF_TRANSPORT_BRIDGE_TOKEN'})
});
const sameList=(a,b)=>Array.isArray(a)&&a.length===b.length&&a.every((v,i)=>v===b[i]);
export function canonicalMmfStageScopeClaim(claim){
 try{
  if(!exact(claim,FIELDS))deny();
  const spec=TYPES[claim.role];if(!spec||
    claim.schema!=='mmf-stage-binding-attestation-v1'||claim.stageOnly!==true||
    claim.product!=='musitu-mail-fabric'||claim.tenant!=='mmf_stage_20261011'||
    claim.worker!==spec.worker||!sameList(claim.capabilities,spec.capabilities)||
    !sameList(claim.routes,spec.routes)||claim.tokenBinding!==spec.tokenBinding||
    typeof claim.nonce!=='string'||!/^(AUTHORITY|TRANSPORT)-[A-Z0-9-]{20,70}$/.test(claim.nonce)||
    !claim.nonce.startsWith(claim.role+'-')||
    !Number.isSafeInteger(claim.issuedAtMs)||!Number.isSafeInteger(claim.expiresAtMs)||
    claim.issuedAtMs<=0||claim.expiresAtMs<=claim.issuedAtMs||claim.expiresAtMs-claim.issuedAtMs>300_000||
    claim.merchantPermission!==false||claim.paymentInitiationAllowed!==false||
    claim.customerEmailAllowed!==false||claim.providerRequestsMade!==0||
    claim.productionSourceChanged!==false)deny();
  return Buffer.from(JSON.stringify(Object.fromEntries(FIELDS.map(k=>[k,claim[k]]))),'utf8');
 }catch{deny()}
}
/** The return value is NEVER evidence of live provider authority or installed routes. */
export function evaluateMmfIsolatedBindingAttestations(options){
 try{
  if(!exact(options,['authority','transport','authorityPublicKeyPem','authorityFingerprint',
    'transportPublicKeyPem','transportFingerprint','nowMs','usedNonces'])||
    !Number.isSafeInteger(options.nowMs)||options.nowMs<=0||
    !(options.usedNonces instanceof Set)||options.usedNonces.size>100_000||
    typeof options.authorityPublicKeyPem!=='string'||
    typeof options.transportPublicKeyPem!=='string'||
    options.authorityPublicKeyPem.length>4000||options.transportPublicKeyPem.length>4000||
    !/^[a-f0-9]{64}$/.test(options.authorityFingerprint)||
    !/^[a-f0-9]{64}$/.test(options.transportFingerprint)||
    options.authorityFingerprint===options.transportFingerprint)deny();
  const attested=[];
  for(const [role,packet,pem,fingerprint] of [
    ['AUTHORITY',options.authority,options.authorityPublicKeyPem,options.authorityFingerprint],
    ['TRANSPORT',options.transport,options.transportPublicKeyPem,options.transportFingerprint]]){
   if(!exact(packet,['claim','signature'])||packet.claim?.role!==role||
      typeof packet.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(packet.signature))deny();
   const bytes=canonicalMmfStageScopeClaim(packet.claim);
   if(packet.claim.issuedAtMs>options.nowMs+30_000||
      options.nowMs>=packet.claim.expiresAtMs||
      options.usedNonces.has(packet.claim.nonce))deny();
   const pub=createPublicKey(pem);
   if(pub.asymmetricKeyType!=='ed25519'||
      createHash('sha256').update(pub.export({type:'spki',format:'der'})).digest('hex')!==fingerprint||
      !verify(null,bytes,pub,Buffer.from(packet.signature,'base64url')))deny();
   attested.push(packet.claim);
  }
  if(attested[0].nonce===attested[1].nonce)deny();
  // All-or-nothing replay recording: never consume a nonce on partial verification.
  for(const claim of attested)options.usedNonces.add(claim.nonce);
  return Object.freeze({gate:'MMF_SYNTHETIC_PRODUCT_SCOPE_ATTESTATION',
   capabilities:Object.freeze([...attested[0].capabilities,...attested[1].capabilities]),
   syntheticOnly:true,realMerchantProductScopeProven:false,
   mayInitiatePayments:false,maySendCustomerEmail:false,mayMutateSharedWorkers:false,
   cloudflareRoutesVerified:false,providerRequestCount:0,liveSettlementProven:false,
   authoritySignerDistinctFromTransport:true,canEnableCommercialLaunch:false});
 }catch{deny()}
}