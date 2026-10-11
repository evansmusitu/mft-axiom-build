/**
 * Isolated MMF billing order ledger. This module never contacts Paynow, creates
 * a live checkout or accepts customer-supplied "paid". Receipts in this module
 * are stage-only contract examples, NOT production settlement certification.
 * An actual MMF-specific service binding and signed provider-verification
 * implementation must be independently reviewed and deployed separately.
 */
import {createHash} from 'node:crypto';
import {draftMmfFmiPaynowQuote,verifyMmfPaynowSettlement,verifyMmfPaynowReversal} from './fmi-paynow-reuse.mjs';
export const MMF_PREP_BILLING_SCHEMA=Object.freeze([
 `CREATE TABLE IF NOT EXISTS mmf_prep_orders (
  order_reference TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  quote_sha256 TEXT NOT NULL CHECK(length(quote_sha256)=64),
  state TEXT NOT NULL CHECK(state IN ('PENDING','PAID_SANDBOX','REVERSED_SANDBOX')),
  provider_ref_sha256 TEXT UNIQUE CHECK(provider_ref_sha256 IS NULL OR length(provider_ref_sha256)=64),
  created_ms INTEGER NOT NULL CHECK(created_ms>0),
  settled_ms INTEGER CHECK(settled_ms IS NULL OR settled_ms>0),
  reversed_ms INTEGER CHECK(reversed_ms IS NULL OR reversed_ms>0),
  reversal_kind TEXT CHECK(reversal_kind IS NULL OR reversal_kind IN ('refunded','chargeback'))
 ) STRICT`,
 'CREATE INDEX IF NOT EXISTS mmf_prep_tenant_idx ON mmf_prep_orders(tenant_id,state)'
]);
const deny=()=>{throw Error('MMF_BILLING_LEDGER_DENIED')};
const sha=s=>createHash('sha256').update(s).digest('hex');
const okDb=db=>db&&typeof db.prepare==='function';
function vettedQuote(quote){
 if(!quote||typeof quote!=='object'||Array.isArray(quote))deny();
 let trusted;
 try{trusted=draftMmfFmiPaynowQuote({tenantId:quote.tenantId,
  customerReference:quote.customerReference,contractReference:quote.contractReference,
  orderReference:quote.orderReference});}catch{deny()}
 if(JSON.stringify(quote)!==JSON.stringify(trusted))deny();
 return trusted;
}
function boundedNow(now){if(!Number.isSafeInteger(now)||now<=0)deny();return now}
function stage(env){
 if(!env||env.MMF_STAGE_ONLY!=='true'||env.MMF_REAL_SEND_ENABLED!=='false'||env.MMF_COMMERCE_ENABLED!=='false')deny();
}
export async function ensureMmfPaymentTables(db){
 if(!okDb(db))deny();
 try{for(const sql of MMF_PREP_BILLING_SCHEMA){const out=await db.prepare(sql).run();if(out?.success===false)deny();}}
 catch{deny()}
 return Object.freeze({createdOrPresent:true,product:'musitu-mail-fabric',realProviderPaymentCalled:false});
}
export async function openMmfPreparationOrder({db,quote,env,nowMs=Date.now()}){
 stage(env);if(!okDb(db))deny();
 const trusted=vettedQuote(quote),at=boundedNow(nowMs),digest=sha(JSON.stringify(trusted));
 try{
  const insert=await db.prepare(`INSERT OR IGNORE INTO mmf_prep_orders
   (order_reference,tenant_id,quote_sha256,state,created_ms)
   VALUES (?,?,?,'PENDING',?)`).bind(trusted.orderReference,trusted.tenantId,digest,at).run();
  if(insert?.success!==true||!Number.isSafeInteger(insert.meta?.changes))deny();
  const row=await db.prepare('SELECT tenant_id,quote_sha256,state,provider_ref_sha256 FROM mmf_prep_orders WHERE order_reference=?')
   .bind(trusted.orderReference).first();
  if(!row||row.tenant_id!==trusted.tenantId||row.quote_sha256!==digest||
     !['PENDING','PAID_SANDBOX','REVERSED_SANDBOX'].includes(row.state))deny();
  return Object.freeze({orderReference:trusted.orderReference,status:row.state,
   idempotent:insert.meta.changes===0,grantsMailSending:false,
   externalCheckoutCreated:false,canIssueTaxInvoice:false,realPaymentProcessed:false});
 }catch{deny()}
}
/**
 * This stage-only method exercises the SQL uniqueness/idempotency policy against
 * *synthetic* signed receipts; it MUST NOT be wired to live provider callbacks.
 */
export async function reconcileMmfSandboxSettlement({db,quote,receipt,verification,env}){
 stage(env);if(!okDb(db)||!verification||typeof verification!=='object')deny();
 const trusted=vettedQuote(quote),digest=sha(JSON.stringify(trusted));
 let evidence;
 try{evidence=verifyMmfPaynowSettlement(receipt,trusted,verification);}catch{deny()}
 if(evidence.verified!==true||evidence.canEnableMailSending!==false||
    evidence.tenantId!==trusted.tenantId||evidence.orderReference!==trusted.orderReference)deny();
 const ref=receipt.claim.providerReferenceSha256;
 try{
  const u=await db.prepare(`UPDATE mmf_prep_orders SET state='PAID_SANDBOX', provider_ref_sha256=?,
   settled_ms=? WHERE order_reference=? AND tenant_id=? AND quote_sha256=? AND state='PENDING'`)
   .bind(ref,receipt.claim.settledAtMs,trusted.orderReference,trusted.tenantId,digest).run();
  if(u?.success!==true||![0,1].includes(u.meta?.changes))deny();
  const row=await db.prepare('SELECT tenant_id,quote_sha256,state,provider_ref_sha256,settled_ms FROM mmf_prep_orders WHERE order_reference=?')
   .bind(trusted.orderReference).first();
  if(!row||row.tenant_id!==trusted.tenantId||row.quote_sha256!==digest||
     row.state!=='PAID_SANDBOX'||row.provider_ref_sha256!==ref||row.settled_ms!==receipt.claim.settledAtMs)deny();
  return Object.freeze({orderReference:trusted.orderReference,status:'SANDBOX_SETTLEMENT_RECORD_ONLY',
   idempotent:u.meta.changes===0,realProviderSettlementVerified:false,
   externalCheckoutCreated:false,grantsMailSending:false,grantsFmiPlan:false,
   canIssueTaxInvoice:false,canAcceptCustomerFunds:false});
 }catch{deny()}
}
/** Stage ONLY: reversal of an already-recorded synthetic signed settlement.
 * This method cannot accept a real Paynow callback and cannot issue refunds.
 */
export async function reconcileMmfSandboxReversal({db,quote,receipt,verification,env}){
 stage(env);if(!okDb(db)||!verification||typeof verification!=='object')deny();
 const trusted=vettedQuote(quote),digest=sha(JSON.stringify(trusted));
 try{
  const before=await db.prepare(`SELECT tenant_id,quote_sha256,state,provider_ref_sha256,settled_ms,
   reversed_ms,reversal_kind FROM mmf_prep_orders WHERE order_reference=?`)
   .bind(trusted.orderReference).first();
  if(!before||before.tenant_id!==trusted.tenantId||before.quote_sha256!==digest||
     !['PAID_SANDBOX','REVERSED_SANDBOX'].includes(before.state)||
     !before.provider_ref_sha256||!Number.isSafeInteger(before.settled_ms))deny();
  const evidence=verifyMmfPaynowReversal(receipt,trusted,{
   ...verification,
   expectedProviderReferenceSha256:before.provider_ref_sha256,
   expectedOriginalSettledAtMs:before.settled_ms
  });
  if(evidence.verified!==true||evidence.canEnableMailSending!==false||
     evidence.orderReference!==trusted.orderReference||evidence.tenantId!==trusted.tenantId)deny();
  const claim=receipt.claim;
  const u=await db.prepare(`UPDATE mmf_prep_orders SET state='REVERSED_SANDBOX',
   reversed_ms=?,reversal_kind=? WHERE order_reference=? AND tenant_id=?
   AND quote_sha256=? AND state='PAID_SANDBOX' AND provider_ref_sha256=? AND settled_ms=?`)
   .bind(claim.reversedAtMs,claim.status,trusted.orderReference,trusted.tenantId,
    digest,claim.providerReferenceSha256,claim.originalSettledAtMs).run();
  if(u?.success!==true||![0,1].includes(u.meta?.changes))deny();
  const row=await db.prepare(`SELECT tenant_id,quote_sha256,state,provider_ref_sha256,settled_ms,
   reversed_ms,reversal_kind FROM mmf_prep_orders WHERE order_reference=?`)
   .bind(trusted.orderReference).first();
  if(!row||row.tenant_id!==trusted.tenantId||row.quote_sha256!==digest||
     row.state!=='REVERSED_SANDBOX'||row.provider_ref_sha256!==claim.providerReferenceSha256||
     row.settled_ms!==claim.originalSettledAtMs||row.reversed_ms!==claim.reversedAtMs||
     row.reversal_kind!==claim.status)deny();
  return Object.freeze({orderReference:trusted.orderReference,status:'REVERSED_SANDBOX',
   idempotent:u.meta.changes===0,realProviderReversalVerified:false,
   actualRefundSubmitted:false,grantsMailSending:false,grantsFmiPlan:false,
   canIssueTaxInvoice:false,canAcceptCustomerFunds:false});
 }catch{deny()}
}
