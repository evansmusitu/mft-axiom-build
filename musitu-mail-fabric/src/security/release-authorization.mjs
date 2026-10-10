/** Defensive, two-key, time-limited release authorization for customer-network sending.
 * Separate pinned keys and signed grants must be provisioned by independent operators.
 * Staging and local simulation do not need and cannot generate a production grant.
 */
import {createHash,createPublicKey,verify} from 'node:crypto';
const FIELDS=['schema','tenantId','domain','provider','issuedMs','expiresMs','nonce'];
const ID=/^[a-z][a-z0-9_-]{2,63}$/;
const DOMAIN=/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const NONCE=/^[A-Za-z0-9._:-]{12,128}$/;
const deny=()=>{throw new Error('LIVE_RELEASE_DENIED');};
export function canonicalReleaseBytes(grant){
 if(!grant||typeof grant!=='object'||Array.isArray(grant)||Object.keys(grant).length!==FIELDS.length||FIELDS.some(k=>!Object.hasOwn(grant,k)))deny();
 if(grant.schema!=='mmf-live-release-v1'||!ID.test(grant.tenantId)||!DOMAIN.test(grant.domain)||
   !['resend','postal'].includes(grant.provider)||!Number.isSafeInteger(grant.issuedMs)||!Number.isSafeInteger(grant.expiresMs)||
   !NONCE.test(grant.nonce))deny();
 return Buffer.from(JSON.stringify(Object.fromEntries(FIELDS.map(k=>[k,grant[k]]))),'utf8');
}
function pinnedPublicKey(pem,fingerprint){
 if(typeof pem!=='string'||pem.length>4000||typeof fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(fingerprint))deny();
 const key=createPublicKey(pem);
 if(key.asymmetricKeyType!=='ed25519')deny();
 const der=key.export({format:'der',type:'spki'});
 if(createHash('sha256').update(der).digest('hex')!==fingerprint)deny();
 return {key,der};
}
function checkSig(value,bytes,key){
 if(typeof value!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(value))return false;
 const sig=Buffer.from(value,'base64url');
 return sig.length===64&&verify(null,bytes,key,sig);
}
/** 
 * Exact named recipient, tenant, domain, provider, non-future issued timestamp and at most 24h validity.
 * A grant is invalid if either independent signer, pinned public fingerprint or time window fails.
 */
export function verifyLiveRelease(env,{now=Date.now()}={}){
 if(!env||typeof env.MMF_RELEASE_GRANT_JSON!=='string'||!env.MMF_RELEASE_GRANT_JSON.trim())throw new Error('LIVE_RELEASE_MISSING');
 try{
  if(env.MMF_RELEASE_GRANT_JSON.length>8192)deny();
  const envelope=JSON.parse(env.MMF_RELEASE_GRANT_JSON);
  if(!envelope||typeof envelope!=='object'||Array.isArray(envelope)||Object.keys(envelope).length!==3||
     !Object.hasOwn(envelope,'grant')||!Object.hasOwn(envelope,'ownerSignature')||!Object.hasOwn(envelope,'approverSignature'))deny();
  const g=envelope.grant,bytes=canonicalReleaseBytes(g);
  if(g.tenantId!==env.MMF_TENANT_ID||g.domain!==env.MMF_FROM_DOMAIN||g.provider!==env.MMF_PROVIDER)deny();
  if(!Number.isSafeInteger(now)||g.issuedMs>now||g.issuedMs<now-86400000||g.expiresMs<=now||g.expiresMs<=g.issuedMs||g.expiresMs-g.issuedMs>86400000)deny();
  const owner=pinnedPublicKey(env.MMF_RELEASE_OWNER_PUBLIC_KEY_PEM,env.MMF_RELEASE_OWNER_FINGERPRINT);
  const approver=pinnedPublicKey(env.MMF_RELEASE_APPROVER_PUBLIC_KEY_PEM,env.MMF_RELEASE_APPROVER_FINGERPRINT);
  if(owner.der.equals(approver.der)||!checkSig(envelope.ownerSignature,bytes,owner.key)||!checkSig(envelope.approverSignature,bytes,approver.key))deny();
  return true;
 }catch(e){if(e?.message==='LIVE_RELEASE_MISSING')throw e;deny();}
}
