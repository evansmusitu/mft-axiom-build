import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {generateKeyPairSync,createHash,sign} from 'node:crypto';
import worker,{MmfBillingPrivateStageSqliteDO} from '../src/edge/billing-private-do-stage.mjs';
import {draftMmfFmiPaynowQuote,canonicalMmfPaymentClaim,MMF_PREPARATION_SKU,SHARED_MUSITU_PAYNOW} from '../src/commercial/fmi-paynow-reuse.mjs';
const token='private-stage-operator-credential-testing-long-enough';
const receiptToken='independent-receipt-private-stage-token-testing';
const quoteFields={customerReference:'customer:remote:synthetic:0001',contractReference:'contract:remote:synthetic:0001',orderReference:'MMF-REMOTECRYPTOTEST001'};
const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const pem=publicKey.export({format:'pem',type:'spki'});
const fingerprint=createHash('sha256').update(publicKey.export({format:'der',type:'spki'})).digest('hex');
const vars={MMF_STAGE_ONLY:'true',MMF_REAL_SEND_ENABLED:'false',MMF_MAIL_SENDING_ENABLED:'false',MMF_COMMERCE_ENABLED:'false',MMF_BILLING_API_ENABLED:'true',MMF_STAGE_RECEIPTS_ENABLED:'true',MMF_API_ENABLED:'false',MMF_WEBHOOK_ENABLED:'false',MMF_TENANT_ID:'mmf_stage_20261011',MMF_BILLING_OPERATOR_TOKEN:token,MMF_STAGE_RECEIPT_TOKEN:receiptToken,MMF_STAGE_AUTHORITY_PUBLIC_KEY_PEM:pem,MMF_STAGE_AUTHORITY_FINGERPRINT_SHA256:fingerprint};
function harness(settings){const sql=new DatabaseSync(':memory:');const ctx={storage:{sql:{exec(q,...ps){const stmt=sql.prepare(q),rows=/^\s*SELECT/i.test(q)?stmt.all(...ps):(stmt.run(...ps),[]);return {toArray:()=>rows}}}}};const actor=new MmfBillingPrivateStageSqliteDO(ctx,settings);const env={...settings,MMF_BILLING_LEDGER:{idFromName:()=>({}),get:()=>({fetch:req=>actor.fetch(req)})}};return {env,close:()=>sql.close()};}
const make=(route,body,credential=receiptToken,method='POST')=>new Request('https://only.local'+route,{method,headers:{authorization:`Bearer ${credential}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
function signedPaid(){const at=Date.now();const claim={schema:'mmf-paynow-settlement-v1',product:MMF_PREPARATION_SKU.product,sku:MMF_PREPARATION_SKU.sku,tenantId:'mmf_stage_20261011',orderReference:quoteFields.orderReference,contractReference:quoteFields.contractReference,provider:'paynow',paymentAuthority:SHARED_MUSITU_PAYNOW.authorityWorker,providerReferenceSha256:'f'.repeat(64),amountCents:9900,currency:'USD',status:'paid',settledAtMs:at};return {claim,signature:sign(null,canonicalMmfPaymentClaim(claim),privateKey).toString('base64url')}}
const evidence='/v1/billing/stage/evidence',order='/v1/billing/stage/orders';
test('a nonpublic signed evidence route is armed only inside short explicit expiry window',async()=>{
 for(const patch of [{}, {MMF_STAGE_RECEIPT_EXPIRES_MS:String(Date.now()-1000)},{MMF_STAGE_RECEIPT_EXPIRES_MS:String(Date.now()+60*60*1000)},{MMF_STAGE_RECEIPT_EXPIRES_MS:'bad'},{MMF_STAGE_RECEIPT_EXPIRES_MS:String(Date.now()+10*60*1000),MMF_COMMERCE_ENABLED:'true'}]){
  const h=harness({...vars,...patch});try{const response=await worker.fetch(make(evidence,{...quoteFields,receipt:signedPaid()}),h.env);assert.equal(response.status,503,JSON.stringify(patch));}finally{h.close()}
 }
 const h=harness({...vars,MMF_STAGE_RECEIPT_EXPIRES_MS:String(Date.now()+10*60*1000)});try{
  assert.equal((await worker.fetch(make(order,quoteFields,token),h.env)).status,201);
  const signed=signedPaid(),payload={...quoteFields,receipt:signed};
  const first=await worker.fetch(make(evidence,payload),h.env);assert.equal(first.status,200,await first.text());
  const row=await worker.fetch(make(order+'/'+quoteFields.orderReference,undefined,token,'GET'),h.env);
  assert.equal((await row.json()).status,'PAID_SANDBOX');
  assert.equal((await worker.fetch(make(evidence,payload,token),h.env)).status,401);
 }finally{h.close()}
});
