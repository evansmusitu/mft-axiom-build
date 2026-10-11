/**
 * UNDEPLOYED MMF-only extension candidate for EXISTING MUSITU payment authority.
 * Merchant key and Ed25519 signer must remain server-side in the existing
 * payment authority, not in Mail Fabric, code, browser or a stage Worker.
 *
 * No real checkout, refund or live callback is submitted by this module.
 * Before issuing any paid/refunded authority receipt, two separate genuine
 * Paynow SHA-512 authenticated messages are verified: provider callback and
 * independently fetched poll response from the exact provider URL. Production
 * caller must supply the real network transport and protect this method from
 * untrusted clients; mock transport proves a contract ONLY, not Paynow delivery.
 */
import {createPrivateKey,KeyObject,sign} from 'node:crypto';
import {parseVerifiedMmfPaynowStatus,authorizeMmfPaynowStatusForOrder} from './paynow-native-protocol.mjs';
import {canonicalMmfPaymentClaim,canonicalMmfReversalClaim,SHARED_MUSITU_PAYNOW,MMF_PREPARATION_SKU} from './fmi-paynow-reuse.mjs';
const deny=()=>{throw Error('MMF_PAYNOW_AUTHORITY_DENIED')};
const HASH=/^[a-f0-9]{64}$/;
async function boundedResponse(response){
 if(!(response instanceof Response)||response.status!==200)deny();
 const ct=response.headers.get('content-type')||'';
 if(!/^(application\/x-www-form-urlencoded|text\/plain)(?:\s*;|\s*$)/i.test(ct))deny();
 const n=response.headers.get('content-length');
 if(n!==null&&(!/^\d+$/.test(n)||Number(n)>4096))deny();
 if(!response.body||typeof response.body.getReader!=='function')deny();
 const reader=response.body.getReader();let size=0;const bytes=[];
 try{
  for(;;){const {done,value}=await reader.read();if(done)break;
   if(!(value instanceof Uint8Array))deny();size+=value.length;
   if(size>4096)deny();bytes.push(value);
  }
 }finally{try{await reader.cancel()}catch{}}
 let payload;try{
  payload=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(bytes));
 }catch{deny()}
 if(!payload||payload.includes('\ufffd'))deny();return payload;
}
function authorityKey(privateKey){
 let k;try{k=privateKey instanceof KeyObject?privateKey:createPrivateKey(privateKey)}catch{deny()}
 if(k.asymmetricKeyType!=='ed25519')deny();return k;
}
async function checkedPaynowPair({signedCallbackBody,quote,integrationKey,fetchPoll},required){
 if(typeof fetchPoll!=='function'||!quote||typeof quote!=='object')deny();
 // Validate the callback hash and product/tenant/amount BEFORE network traffic.
 const callback=parseVerifiedMmfPaynowStatus(signedCallbackBody,{integrationKey});
 authorizeMmfPaynowStatusForOrder(callback,quote,{tenantId:quote.tenantId});
 if(callback.kind!==required)deny();
 let http;
 try{http=await fetchPoll(callback.pollUrl,{method:'POST',headers:{accept:'application/x-www-form-urlencoded'},body:'',redirect:'error',signal:AbortSignal.timeout(8000)});}catch{deny()}
 const raw=await boundedResponse(http);
 const verifiedPoll=parseVerifiedMmfPaynowStatus(raw,{integrationKey});
 authorizeMmfPaynowStatusForOrder(verifiedPoll,quote,{tenantId:quote.tenantId});
 if(verifiedPoll.kind!==required||verifiedPoll.pollUrl!==callback.pollUrl||
  verifiedPoll.providerReferenceSha256!==callback.providerReferenceSha256||
  verifiedPoll.reference!==callback.reference||verifiedPoll.amountCents!==callback.amountCents)deny();
 return verifiedPoll;
}
function verifiedOptions(options){
 if(!options||typeof options!=='object'||!Number.isSafeInteger(options.nowMs)||options.nowMs<=0)deny();
 return options.nowMs;
}
function sealed(claim,makeCanonical,key){
 const bytes=makeCanonical(claim);
 const signature=sign(null,bytes,authorityKey(key)).toString('base64url');
 return Object.freeze({claim:Object.freeze(claim),signature});
}
export async function certifyMmfPaidViaAuthoritativePoll(options){
 try{
  const nowMs=verifiedOptions(options);
  const verified=await checkedPaynowPair(options,'PAID_OBSERVED');
  const claim={schema:'mmf-paynow-settlement-v1',product:MMF_PREPARATION_SKU.product,
   sku:MMF_PREPARATION_SKU.sku,tenantId:options.quote.tenantId,
   orderReference:options.quote.orderReference,contractReference:options.quote.contractReference,
   provider:'paynow',paymentAuthority:SHARED_MUSITU_PAYNOW.authorityWorker,
   providerReferenceSha256:verified.providerReferenceSha256,
   amountCents:MMF_PREPARATION_SKU.amountCents,currency:'USD',status:'paid',settledAtMs:nowMs};
  const receipt=sealed(claim,canonicalMmfPaymentClaim,options.authoritySignerPrivateKey);
  return Object.freeze({receipt,providerPollVerified:true,bankSettlementCertified:false,
   productionReleased:false,grantsMailSending:false,canGrantFmiPlan:false,
   providerOperationPerformed:'READ_ONLY_STATUS_POLL',
   warning:'Poll-proven Paid is NOT bank-account settlement, tax/legal approval, or MMF delivery entitlement.'});
 }catch{deny()}
}
export async function certifyMmfRefundViaAuthoritativePoll(options){
 try{
  const nowMs=verifiedOptions(options),prior=options.prior;
  if(!prior||!HASH.test(prior.providerReferenceSha256)||
   !Number.isSafeInteger(prior.originalSettledAtMs)||prior.originalSettledAtMs<=0||
   prior.originalSettledAtMs>nowMs)deny();
  const verified=await checkedPaynowPair(options,'REFUNDED');
  if(verified.providerReferenceSha256!==prior.providerReferenceSha256)deny();
  const claim={schema:'mmf-paynow-reversal-v1',product:MMF_PREPARATION_SKU.product,
   sku:MMF_PREPARATION_SKU.sku,tenantId:options.quote.tenantId,
   orderReference:options.quote.orderReference,contractReference:options.quote.contractReference,
   provider:'paynow',paymentAuthority:SHARED_MUSITU_PAYNOW.authorityWorker,
   providerReferenceSha256:verified.providerReferenceSha256,
   amountCents:MMF_PREPARATION_SKU.amountCents,currency:'USD',status:'refunded',
   originalSettledAtMs:prior.originalSettledAtMs,reversedAtMs:nowMs};
  const receipt=sealed(claim,canonicalMmfReversalClaim,options.authoritySignerPrivateKey);
  return Object.freeze({receipt,providerPollVerified:true,bankSettlementCertified:false,
   productionReleased:false,actualRefundRequested:false,grantsMailSending:false,
   providerOperationPerformed:'READ_ONLY_STATUS_POLL',
   warning:'Paynow refunded status confirmation is not a refund instruction or independent bank settlement certification.'});
 }catch{deny()}
}
