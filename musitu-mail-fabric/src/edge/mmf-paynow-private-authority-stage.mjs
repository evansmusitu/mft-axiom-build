/**
 * MUSITU Mail Fabric: independent private, synthetic-only authority staging Worker.
 * No live Paynow credentials or provider routes. No checkout, real payment,
 * FMI/Axiom/Chemistry entitlement, public URL or customer email capability.
 * The sole network capability is a preconfigured service binding to MMF stage.
 */
import {createHash,timingSafeEqual} from 'node:crypto';
import {readBoundedWebhookBody} from '../webhooks/bounded-body.mjs';
import {draftMmfFmiPaynowQuote,verifyMmfPaynowSettlement,verifyMmfPaynowReversal} from '../commercial/fmi-paynow-reuse.mjs';
import {deliverMmfReceiptToPrivateStage} from '../commercial/paynow-private-stage-bridge.mjs';

const PATH='/internal/mmf/stage/receipt';
const H={'content-type':'application/json; charset=utf-8','cache-control':'no-store',
 'x-content-type-options':'nosniff','referrer-policy':'no-referrer'};
const out=(status,data)=>new Response(JSON.stringify(data),{status,headers:H});
const ERR_OFF={error:'MMF_PRIVATE_AUTHORITY_DISABLED'};
const one=Object.freeze(['quote','receipt']);
const eq=(a,b)=>{
 if(typeof a!=='string'||typeof b!=='string'||a.length>300||b.length>300||!a||!b)return false;
 return timingSafeEqual(createHash('sha256').update(a).digest(),createHash('sha256').update(b).digest());
};
const active=env=>{
 const now=Date.now(),expires=Number(env?.MMF_PRIVATE_AUTHORITY_EXPIRES_MS);
 return env?.MMF_PRIVATE_AUTHORITY_STAGE_ENABLED==='true'&&
  env.MMF_STAGE_BRIDGE_ENABLED==='true'&&env.MMF_STAGE_RECEIPTS_ENABLED==='true'&&
  env.MMF_STAGE_ONLY==='true'&&env.MMF_REAL_SEND_ENABLED==='false'&&
  env.MMF_MAIL_SENDING_ENABLED==='false'&&env.MMF_COMMERCE_ENABLED==='false'&&
  env.MMF_BILLING_API_ENABLED==='true'&&env.MMF_API_ENABLED==='false'&&
  env.MMF_WEBHOOK_ENABLED==='false'&&env.MMF_TENANT_ID==='mmf_stage_20261011'&&
  typeof env.MMF_PRIVATE_AUTHORITY_EXPIRES_MS==='string'&&/^\d{13}$/.test(env.MMF_PRIVATE_AUTHORITY_EXPIRES_MS)&&
  Number.isSafeInteger(expires)&&expires>now&&expires<=now+20*60000&&
  typeof env.MMF_AUTHORITY_CALLER_TOKEN==='string'&&env.MMF_AUTHORITY_CALLER_TOKEN.length>=32&&
  env.MMF_AUTHORITY_CALLER_TOKEN!==env.MMF_STAGE_RECEIPT_TOKEN&&
  env.MMF_AUTHORITY_CALLER_TOKEN!==env.MMF_BILLING_OPERATOR_TOKEN&&
  env.MMF_PRIVATE_PAYMENT_STAGE&&typeof env.MMF_PRIVATE_PAYMENT_STAGE.fetch==='function'&&
  typeof env.MMF_STAGE_RECEIPT_TOKEN==='string'&&env.MMF_STAGE_RECEIPT_TOKEN.length>=32&&
  typeof env.MMF_STAGE_AUTHORITY_PUBLIC_KEY_PEM==='string'&&
  /^[a-f0-9]{64}$/.test(env.MMF_STAGE_AUTHORITY_FINGERPRINT_SHA256||'');
};

export async function fetchMmfPrivatePaynowAuthorityStage(request,env){
 if(!active(env))return out(503,ERR_OFF);
 let u;try{u=new URL(request.url)}catch{return out(400,{error:'INVALID_REQUEST'})}
 if(u.pathname!==PATH||request.method!=='POST'||u.search||u.hash)return out(404,{error:'NOT_FOUND'});
 const header=request.headers.get('authorization')||'';
 if(!header.startsWith('Bearer ')||!eq(header.slice(7),env.MMF_AUTHORITY_CALLER_TOKEN))
  return out(401,{error:'UNAUTHORIZED'});
 const body=await readBoundedWebhookBody(request,{maxBytes:4096});
 if(body.error)return out(body.status,{error:body.error});
 let data;try{data=JSON.parse(body.raw)}catch{return out(400,{error:'INVALID_JSON'})}
 if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).length!==2||
   one.some(k=>!Object.hasOwn(data,k)))return out(422,{error:'INVALID_RECEIPT'});
 let quote;
 try{
  quote=draftMmfFmiPaynowQuote({tenantId:data.quote?.tenantId,
   customerReference:data.quote?.customerReference,contractReference:data.quote?.contractReference,
   orderReference:data.quote?.orderReference});
  if(JSON.stringify(data.quote)!==JSON.stringify(quote)||quote.tenantId!==env.MMF_TENANT_ID)
   throw Error('QUOTE_INVALID');
  const opts={publicKeyPem:env.MMF_STAGE_AUTHORITY_PUBLIC_KEY_PEM,
   fingerprint:env.MMF_STAGE_AUTHORITY_FINGERPRINT_SHA256,nowMs:Date.now()};
  if(data.receipt?.claim?.schema==='mmf-paynow-settlement-v1')
   verifyMmfPaynowSettlement(data.receipt,quote,opts);
  else if(data.receipt?.claim?.schema==='mmf-paynow-reversal-v1')
   verifyMmfPaynowReversal(data.receipt,quote,{...opts,
    expectedProviderReferenceSha256:data.receipt.claim.providerReferenceSha256,
    expectedOriginalSettledAtMs:data.receipt.claim.originalSettledAtMs});
  else throw Error('CLAIM_INVALID');
 }catch{return out(422,{error:'INVALID_RECEIPT'});}
 try{
  const result=await deliverMmfReceiptToPrivateStage({quote,receipt:data.receipt,env,nowMs:Date.now()});
  if(result.privateStageAcknowledged!==true||result.canAcceptCustomerFunds!==false||
    result.grantsMailSending!==false||result.realProviderSettlementVerified!==false)throw Error('ACK_DENIED');
  return out(200,{...result,syntheticOnly:true,realProviderPollVerified:false});
 }catch{return out(503,{error:'MMF_PRIVATE_AUTHORITY_UNAVAILABLE'});}
}
export default {fetch:fetchMmfPrivatePaynowAuthorityStage};
