/**
 * NON-DEPLOYED authority-side candidate: hand an already signed, MMF-only
 * payment evidence document across a private Cloudflare service binding to
 * the separate, dark MMF stage order ledger.
 *
 * No raw Paynow merchant integration keys, external HTTP destinations,
 * checkout sessions, real payment claims or mail entitlements are created.
 * The preconfigured binding is the only network capability; there is no
 * fallback to global fetch or a customer-supplied URL.
 */
import {verifyMmfPaynowSettlement,verifyMmfPaynowReversal,draftMmfFmiPaynowQuote} from './fmi-paynow-reuse.mjs';

const deny=()=>{throw Error('MMF_PRIVATE_STAGE_BRIDGE_DENIED')};
const RECEIPT_PATH='https://mmf-private-stage.invalid/v1/billing/stage/evidence';
const SHA256=/^[a-f0-9]{64}$/;
function active(env){
 return env&&env.MMF_STAGE_BRIDGE_ENABLED==='true'&&env.MMF_STAGE_ONLY==='true'&&
  env.MMF_REAL_SEND_ENABLED==='false'&&env.MMF_MAIL_SENDING_ENABLED==='false'&&
  env.MMF_COMMERCE_ENABLED==='false'&&env.MMF_BILLING_API_ENABLED==='true'&&
  env.MMF_STAGE_RECEIPTS_ENABLED==='true'&&env.MMF_API_ENABLED!=='true'&&
  env.MMF_WEBHOOK_ENABLED!=='true'&&env.MMF_PRIVATE_PAYMENT_STAGE&&
  typeof env.MMF_PRIVATE_PAYMENT_STAGE.fetch==='function'&&
  typeof env.MMF_STAGE_RECEIPT_TOKEN==='string'&&env.MMF_STAGE_RECEIPT_TOKEN.length>=32&&
  env.MMF_STAGE_RECEIPT_TOKEN.length<=300&&
  env.MMF_STAGE_RECEIPT_TOKEN!==env.MMF_BILLING_OPERATOR_TOKEN&&
  env.MMF_STAGE_RECEIPT_TOKEN!==env.MMF_AUTH_TOKEN&&
  env.MMF_STAGE_RECEIPT_TOKEN!==env.MMF_OPERATOR_TOKEN&&
  typeof env.MMF_STAGE_AUTHORITY_PUBLIC_KEY_PEM==='string'&&
  /^[\s\S]{65,4000}$/.test(env.MMF_STAGE_AUTHORITY_PUBLIC_KEY_PEM)&&
  SHA256.test(env.MMF_STAGE_AUTHORITY_FINGERPRINT_SHA256||'');
}
async function readSmallJson(response){
 if(!(response instanceof Response)||response.status!==200||
   !/^application\/json(?:\s*;|\s*$)/i.test(response.headers.get('content-type')||''))deny();
 const size=response.headers.get('content-length');
 if(size!==null&&(!/^\d+$/.test(size)||Number(size)>1536))deny();
 if(!response.body||typeof response.body.getReader!=='function')deny();
 const reader=response.body.getReader();let len=0;const chunks=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;
  if(!(value instanceof Uint8Array))deny();len+=value.length;if(len>1536)deny();chunks.push(value);
 }}finally{try{await reader.cancel()}catch{}}
 let obj;try{obj=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)))}catch{deny()}
 if(!obj||typeof obj!=='object'||Array.isArray(obj))deny();return obj;
}
/** Returns a *non-financial* private stage receipt acknowledgement only. */
export async function deliverMmfReceiptToPrivateStage({quote,receipt,env,nowMs=Date.now()}={}){
 try{
  if(!active(env)||!Number.isSafeInteger(nowMs)||nowMs<=0)deny();
  const trusted=draftMmfFmiPaynowQuote({tenantId:quote?.tenantId,
   customerReference:quote?.customerReference,contractReference:quote?.contractReference,
   orderReference:quote?.orderReference});
  if(JSON.stringify(trusted)!==JSON.stringify(quote))deny();
  let expected;
  const opts={publicKeyPem:env.MMF_STAGE_AUTHORITY_PUBLIC_KEY_PEM,
   fingerprint:env.MMF_STAGE_AUTHORITY_FINGERPRINT_SHA256,nowMs};
  if(receipt?.claim?.schema==='mmf-paynow-settlement-v1'){
   const checked=verifyMmfPaynowSettlement(receipt,trusted,opts);
   if(checked.verified!==true||checked.canEnableMailSending!==false)deny();
   expected='SANDBOX_SETTLEMENT_RECORD_ONLY';
  }else if(receipt?.claim?.schema==='mmf-paynow-reversal-v1'){
   const checked=verifyMmfPaynowReversal(receipt,trusted,{
    ...opts,expectedProviderReferenceSha256:receipt.claim.providerReferenceSha256,
    expectedOriginalSettledAtMs:receipt.claim.originalSettledAtMs});
   if(checked.verified!==true||checked.canEnableMailSending!==false)deny();
   expected='REVERSED_SANDBOX';
  }else deny();
  const body=JSON.stringify({customerReference:trusted.customerReference,
   contractReference:trusted.contractReference,orderReference:trusted.orderReference,receipt});
  if(Buffer.byteLength(body,'utf8')>4096)deny();
  // Cloudflare service-binding URL is purely a request target identifier.
  // The preconfigured binding receives it, not the public Internet.
  const request=new Request(RECEIPT_PATH,{method:'POST',
   headers:{authorization:`Bearer ${env.MMF_STAGE_RECEIPT_TOKEN}`,
    'content-type':'application/json','cache-control':'no-store'},body});
  const response=await env.MMF_PRIVATE_PAYMENT_STAGE.fetch(request);
  const acknowledged=await readSmallJson(response);
  if(acknowledged.orderReference!==trusted.orderReference||acknowledged.status!==expected||
    typeof acknowledged.idempotent!=='boolean'||
    acknowledged.realProviderSettlementVerified!==false||
    acknowledged.canAcceptCustomerFunds!==false||
    acknowledged.canIssueTaxInvoice!==false||
    acknowledged.grantsMailSending!==false||
    (expected==='REVERSED_SANDBOX'&&acknowledged.actualRefundSubmitted!==false))deny();
  return Object.freeze({orderReference:trusted.orderReference,status:expected,
   idempotent:acknowledged.idempotent,privateStageAcknowledged:true,
   realProviderSettlementVerified:false,canAcceptCustomerFunds:false,
   canIssueTaxInvoice:false,grantsMailSending:false,
   productionReleased:false,liveMoneyOperationPerformed:false});
 }catch{deny()}
}
