/** Independent, short-lived operator qualification gate for live Resend sending.
 * A signed assessor statement is not cryptographic proof that Resend sent an
 * event. The assessor must inspect the original signed provider event and the
 * provider's delivery-attempt record OUTSIDE this process. Missing evidence
 * fails closed. This never registers webhooks or sends email.
 */
import {createHash,createPublicKey,verify} from 'node:crypto';

const FIELDS=['schema','tenantId','domain','provider','webhookId','svixId',
 'providerMessageId','deliveryAttemptId','eventType','rawSha256',
 'qualifiedMs','expiresMs','nonce'];
const TENANT=/^[a-z][a-z0-9_-]{2,63}$/;
const DOMAIN=/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const PROVIDER_ID=/^[A-Za-z0-9._:-]{8,200}$/;
const NONCE=/^[A-Za-z0-9._:-]{16,128}$/;
const DIGEST=/^[a-f0-9]{64}$/;
const deny=()=>{throw Error('PROVIDER_QUALIFICATION_DENIED');};

export function canonicalProviderQualificationBytes(claim){
 if(!claim||typeof claim!=='object'||Array.isArray(claim)||
    Object.keys(claim).length!==FIELDS.length||FIELDS.some(k=>!Object.hasOwn(claim,k)))deny();
 if(claim.schema!=='mmf-provider-qualification-v1'||!TENANT.test(claim.tenantId)||
   !DOMAIN.test(claim.domain)||claim.provider!=='resend'||
   ![claim.webhookId,claim.svixId,claim.providerMessageId,claim.deliveryAttemptId].every(x=>
     typeof x==='string'&&PROVIDER_ID.test(x))||
   claim.eventType!=='email.delivered'||typeof claim.rawSha256!=='string'||!DIGEST.test(claim.rawSha256)||
   !Number.isSafeInteger(claim.qualifiedMs)||!Number.isSafeInteger(claim.expiresMs)||
   typeof claim.nonce!=='string'||!NONCE.test(claim.nonce))deny();
 return Buffer.from(JSON.stringify(Object.fromEntries(FIELDS.map(k=>[k,claim[k]]))),'utf8');
}
function strictPublicKey(pem,pin){
 if(typeof pem!=='string'||pem.length>4000||typeof pin!=='string'||!DIGEST.test(pin))deny();
 const key=createPublicKey(pem);
 if(key.asymmetricKeyType!=='ed25519')deny();
 const der=key.export({format:'der',type:'spki'});
 if(createHash('sha256').update(der).digest('hex')!==pin)deny();
 return {key,der};
}
/** Enforces an independently pinned assessor distinct from BOTH live-release signers.
 * Accepting this attestation is not equivalent to independent security review
 * or direct verification of the provider webhook in the cloud.
 */
export function verifyProviderQualification(env,{now=Date.now()}={}){
 try{
  if(!env||typeof env.MMF_PROVIDER_QUALIFICATION_JSON!=='string'||
     env.MMF_PROVIDER_QUALIFICATION_JSON.length>8192||
     !Number.isSafeInteger(now)||now<=0)deny();
  const statement=JSON.parse(env.MMF_PROVIDER_QUALIFICATION_JSON);
  if(!statement||typeof statement!=='object'||Array.isArray(statement)||
    Object.keys(statement).length!==2||
    !Object.hasOwn(statement,'claim')||!Object.hasOwn(statement,'auditorSignature'))deny();
  const claim=statement.claim;
  const bytes=canonicalProviderQualificationBytes(claim);
  if(claim.tenantId!==env.MMF_TENANT_ID||claim.domain!==env.MMF_FROM_DOMAIN||
     claim.provider!==env.MMF_PROVIDER||claim.qualifiedMs>now||
     claim.qualifiedMs<now-7*86400000||claim.expiresMs<=now||
     claim.expiresMs<=claim.qualifiedMs||claim.expiresMs-claim.qualifiedMs>7*86400000)deny();
  const assessor=strictPublicKey(env.MMF_QUALIFICATION_AUDITOR_PUBLIC_KEY_PEM,
    env.MMF_QUALIFICATION_AUDITOR_FINGERPRINT);
  const owner=strictPublicKey(env.MMF_RELEASE_OWNER_PUBLIC_KEY_PEM,
    env.MMF_RELEASE_OWNER_FINGERPRINT);
  const approver=strictPublicKey(env.MMF_RELEASE_APPROVER_PUBLIC_KEY_PEM,
    env.MMF_RELEASE_APPROVER_FINGERPRINT);
  if(assessor.der.equals(owner.der)||assessor.der.equals(approver.der))deny();
  const sig=statement.auditorSignature;
  if(typeof sig!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(sig))deny();
  const decoded=Buffer.from(sig,'base64url');
  if(decoded.length!==64||!verify(null,bytes,assessor.key,decoded))deny();
  return true;
 }catch{deny();}
}
