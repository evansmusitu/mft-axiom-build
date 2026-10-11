/**
 * MUSITU Mail Fabric: private, dark, STAGING-ONLY billing intake.
 * No live Paynow connection, public checkout URL, paid mutation, invoice,
 * customer email activation, or access to FMI customer/subscription tables.
 * Deployment template has workers_dev=false and no public routes.
 */
import {createHash,timingSafeEqual} from 'node:crypto';
import {readBoundedWebhookBody} from '../webhooks/bounded-body.mjs';
import {draftMmfFmiPaynowQuote} from './fmi-paynow-reuse.mjs';
import {ensureMmfPaymentTables,openMmfPreparationOrder,
 reconcileMmfSandboxSettlement,reconcileMmfSandboxReversal} from './mmf-order-ledger.mjs';

const H={'content-type':'application/json; charset=utf-8','cache-control':'no-store',
 'x-content-type-options':'nosniff','referrer-policy':'no-referrer'};
const json=(code,data)=>new Response(JSON.stringify(data),{status:code,headers:H});
const matches=/^\/v1\/billing\/stage\/orders\/(MMF-[A-Z0-9]{10,56})$/;
const fields=new Set(['customerReference','contractReference','orderReference']);
const evidenceFields=new Set([...fields,'receipt']);
const evidencePath='/v1/billing/stage/evidence';
const stageEvidenceEnabled=env=>env.MMF_STAGE_RECEIPTS_ENABLED==='true'&&
 typeof env.MMF_STAGE_RECEIPT_TOKEN==='string'&&env.MMF_STAGE_RECEIPT_TOKEN.length>=32&&
 env.MMF_STAGE_RECEIPT_TOKEN!==env.MMF_BILLING_OPERATOR_TOKEN&&
 env.MMF_STAGE_RECEIPT_TOKEN!==env.MMF_OPERATOR_TOKEN&&
 env.MMF_STAGE_RECEIPT_TOKEN!==env.MMF_AUTH_TOKEN&&
 typeof env.MMF_STAGE_AUTHORITY_PUBLIC_KEY_PEM==='string'&&
 env.MMF_STAGE_AUTHORITY_PUBLIC_KEY_PEM.length>64&&env.MMF_STAGE_AUTHORITY_PUBLIC_KEY_PEM.length<=4000&&
 /^[a-f0-9]{64}$/.test(env.MMF_STAGE_AUTHORITY_FINGERPRINT_SHA256||'');
const enabled=env=>env?.MMF_STAGE_ONLY==='true'&&
 env.MMF_REAL_SEND_ENABLED==='false'&&env.MMF_MAIL_SENDING_ENABLED==='false'&&
 env.MMF_COMMERCE_ENABLED==='false'&&env.MMF_BILLING_API_ENABLED==='true'&&
 env.MMF_API_ENABLED!=='true'&&env.MMF_WEBHOOK_ENABLED!=='true'&&
 typeof env.MMF_TENANT_ID==='string'&&/^[a-z][a-z0-9_-]{2,63}$/.test(env.MMF_TENANT_ID)&&
 env.MMF_PAYMENT_DB&&typeof env.MMF_PAYMENT_DB.prepare==='function'&&
 typeof env.MMF_BILLING_OPERATOR_TOKEN==='string'&&env.MMF_BILLING_OPERATOR_TOKEN.length>=32&&
 env.MMF_BILLING_OPERATOR_TOKEN!==env.MMF_AUTH_TOKEN&&
 env.MMF_BILLING_OPERATOR_TOKEN!==env.MMF_OPERATOR_TOKEN;
function authenticated(req,token){
 const bearer=req.headers.get('authorization');
 if(!bearer?.startsWith('Bearer ')||bearer.length>512)return false;
 const received=bearer.slice(7);
 if(!received||received.length>300)return false;
 const a=createHash('sha256').update(received).digest();
 const b=createHash('sha256').update(token).digest();
 return timingSafeEqual(a,b);
}
function visible(row,reference){return {orderReference:reference,status:row.state,
  externalCheckoutCreated:false,realProviderSettlementVerified:false,
  grantsMailSending:false,canIssueTaxInvoice:false,canAcceptCustomerFunds:false};}
export async function fetchPrivateMmfBillingStage(request,env){
 // Deny everything unless operating a dark, non-commerce, non-sending stage.
 if(!enabled(env))return json(503,{error:'BILLING_STAGE_DISABLED'});
 let url;try{url=new URL(request.url)}catch{return json(400,{error:'INVALID_REQUEST'})}
 const isEvidence=url.pathname===evidencePath&&request.method==='POST';
 // Receipt intake requires a distinct non-customer credential and an explicit,
 // separately disabled-by-default flag. Never let order operators mint receipts.
 if(isEvidence&&!stageEvidenceEnabled(env))return json(503,{error:'BILLING_EVIDENCE_DISABLED'});
 const accessToken=isEvidence?env.MMF_STAGE_RECEIPT_TOKEN:env.MMF_BILLING_OPERATOR_TOKEN;
 if(!authenticated(request,accessToken))return json(401,{error:'UNAUTHORIZED'});
 const isCreate=url.pathname==='/v1/billing/stage/orders'&&request.method==='POST';
 const query=url.pathname.match(matches);
 const isRead=!!query&&request.method==='GET';
 if((!isCreate&&!isRead&&!isEvidence)||url.search)return json(404,{error:'NOT_FOUND'});
 try{
  await ensureMmfPaymentTables(env.MMF_PAYMENT_DB);
  if(isRead){
   const row=await env.MMF_PAYMENT_DB.prepare(
    'SELECT tenant_id,state FROM mmf_prep_orders WHERE order_reference=? AND tenant_id=?')
    .bind(query[1],env.MMF_TENANT_ID).first();
   if(!row||row.tenant_id!==env.MMF_TENANT_ID||!['PENDING','PAID_SANDBOX','REVERSED_SANDBOX'].includes(row.state))
    return json(404,{error:'NOT_FOUND'});
   return json(200,visible(row,query[1]));
  }
  const bounded=await readBoundedWebhookBody(request,{maxBytes:isEvidence?4096:2048});
  if(bounded.error)return json(bounded.status,{error:bounded.error});
  let data;try{data=JSON.parse(bounded.raw)}catch{return json(400,{error:'INVALID_JSON'})}
  const allowed=isEvidence?evidenceFields:fields;
  if(!data||typeof data!=='object'||Array.isArray(data)||
     Object.keys(data).length!==allowed.size||Object.keys(data).some(k=>!allowed.has(k)))
    return json(422,{error:isEvidence?'INVALID_RECEIPT_REQUEST':'INVALID_ORDER_REQUEST'});
  let quote;
  try{quote=draftMmfFmiPaynowQuote({tenantId:env.MMF_TENANT_ID,
    customerReference:data.customerReference,contractReference:data.contractReference,
    orderReference:data.orderReference});}
  catch{return json(422,{error:isEvidence?'INVALID_RECEIPT_REQUEST':'INVALID_ORDER_REQUEST'});}
  if(isEvidence){
   // Only an authority-signed, product-and-order-bound synthetic receipt may
   // transition a pending stage order. No FMI/Billing account is queried or used.
   const receipt=data.receipt;
   if(!receipt||typeof receipt!=='object'||Array.isArray(receipt)||
      Object.keys(receipt).length!==2||!Object.hasOwn(receipt,'claim')||
      !Object.hasOwn(receipt,'signature')||typeof receipt.signature!=='string')
    return json(422,{error:'INVALID_RECEIPT_REQUEST'});
   const verification={publicKeyPem:env.MMF_STAGE_AUTHORITY_PUBLIC_KEY_PEM,
    fingerprint:env.MMF_STAGE_AUTHORITY_FINGERPRINT_SHA256,nowMs:Date.now()};
   let result;
   if(receipt.claim?.schema==='mmf-paynow-settlement-v1')
    result=await reconcileMmfSandboxSettlement({db:env.MMF_PAYMENT_DB,quote,receipt,verification,env});
   else if(receipt.claim?.schema==='mmf-paynow-reversal-v1')
    result=await reconcileMmfSandboxReversal({db:env.MMF_PAYMENT_DB,quote,receipt,verification,env});
   else return json(422,{error:'INVALID_RECEIPT_REQUEST'});
   return json(200,{...result,realProviderSettlementVerified:false,
    canAcceptCustomerFunds:false,canIssueTaxInvoice:false,grantsMailSending:false});
  }
  const result=await openMmfPreparationOrder({db:env.MMF_PAYMENT_DB,quote,env});
  return json(result.idempotent?200:201,{
   ...result,realProviderSettlementVerified:false,
   canAcceptCustomerFunds:false,canIssueTaxInvoice:false
  });
 }catch{return json(503,{error:'BILLING_STAGE_UNAVAILABLE'});}
}
export default {fetch:fetchPrivateMmfBillingStage};
