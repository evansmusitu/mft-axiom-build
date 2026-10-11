/**
 * MUSITU Mail Fabric: private, dark, STAGING-ONLY billing intake.
 * No live Paynow connection, public checkout URL, paid mutation, invoice,
 * customer email activation, or access to FMI customer/subscription tables.
 * Deployment template has workers_dev=false and no public routes.
 */
import {createHash,timingSafeEqual} from 'node:crypto';
import {readBoundedWebhookBody} from '../webhooks/bounded-body.mjs';
import {draftMmfFmiPaynowQuote} from './fmi-paynow-reuse.mjs';
import {ensureMmfPaymentTables,openMmfPreparationOrder} from './mmf-order-ledger.mjs';

const H={'content-type':'application/json; charset=utf-8','cache-control':'no-store',
 'x-content-type-options':'nosniff','referrer-policy':'no-referrer'};
const json=(code,data)=>new Response(JSON.stringify(data),{status:code,headers:H});
const matches=/^\/v1\/billing\/stage\/orders\/(MMF-[A-Z0-9]{10,56})$/;
const fields=new Set(['customerReference','contractReference','orderReference']);
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
 // Fail closed BEFORE parsing auth or user-controlled body. Never enable public checkout.
 if(!enabled(env))return json(503,{error:'BILLING_STAGE_DISABLED'});
 if(!authenticated(request,env.MMF_BILLING_OPERATOR_TOKEN))return json(401,{error:'UNAUTHORIZED'});
 let url;try{url=new URL(request.url);}catch{return json(400,{error:'INVALID_REQUEST'});}
 const isCreate=url.pathname==='/v1/billing/stage/orders'&&request.method==='POST';
 const query=url.pathname.match(matches);
 const isRead=!!query&&request.method==='GET';
 if((!isCreate&&!isRead)||url.search)return json(404,{error:'NOT_FOUND'});
 try{
  await ensureMmfPaymentTables(env.MMF_PAYMENT_DB);
  if(isRead){
   const row=await env.MMF_PAYMENT_DB.prepare(
    'SELECT tenant_id,state FROM mmf_prep_orders WHERE order_reference=? AND tenant_id=?')
    .bind(query[1],env.MMF_TENANT_ID).first();
   if(!row||row.tenant_id!==env.MMF_TENANT_ID||!['PENDING','PAID_SANDBOX'].includes(row.state))
    return json(404,{error:'NOT_FOUND'});
   return json(200,visible(row,query[1]));
  }
  const bounded=await readBoundedWebhookBody(request,{maxBytes:2048});
  if(bounded.error)return json(bounded.status,{error:bounded.error});
  let data;try{data=JSON.parse(bounded.raw)}catch{return json(400,{error:'INVALID_JSON'});}
  if(!data||typeof data!=='object'||Array.isArray(data)||
     Object.keys(data).length!==3||Object.keys(data).some(k=>!fields.has(k)))
    return json(422,{error:'INVALID_ORDER_REQUEST'});
  let quote;
  try{quote=draftMmfFmiPaynowQuote({tenantId:env.MMF_TENANT_ID,
    customerReference:data.customerReference,contractReference:data.contractReference,
    orderReference:data.orderReference});}
  catch{return json(422,{error:'INVALID_ORDER_REQUEST'});}
  const result=await openMmfPreparationOrder({db:env.MMF_PAYMENT_DB,quote,env});
  return json(result.idempotent?200:201,{
    ...result,realProviderSettlementVerified:false,
    canAcceptCustomerFunds:false,canIssueTaxInvoice:false
  });
 }catch{return json(503,{error:'BILLING_STAGE_UNAVAILABLE'});}
}
export default {fetch:fetchPrivateMmfBillingStage};
