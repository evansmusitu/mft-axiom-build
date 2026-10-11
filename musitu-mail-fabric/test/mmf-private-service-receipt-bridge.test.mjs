import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import stageWorker from '../src/commercial/billing-stage-worker.mjs';
import {deliverMmfReceiptToPrivateStage} from '../src/commercial/paynow-private-stage-bridge.mjs';
import {draftMmfFmiPaynowQuote,canonicalMmfPaymentClaim,canonicalMmfReversalClaim,MMF_PREPARATION_SKU,SHARED_MUSITU_PAYNOW} from '../src/commercial/fmi-paynow-reuse.mjs';

const keys=generateKeyPairSync('ed25519');
const pub=keys.publicKey.export({type:'spki',format:'pem'});
const fingerprint=createHash('sha256').update(keys.publicKey.export({type:'spki',format:'der'})).digest('hex');
const TOKEN='mmf-separate-private-stage-receipt-token-20261011-local-only';
const OPERATOR='mmf-separate-order-stage-operator-token-20261011-local-only';
const fields={tenantId:'mmf_bridge_tenant',customerReference:'customer:approved:bridge1',contractReference:'contract:approved:bridge1',orderReference:'MMF-BRIDGESERVICE01'};
const quote=draftMmfFmiPaynowQuote(fields);
const now=Date.now();
const baseClaim={product:MMF_PREPARATION_SKU.product,sku:MMF_PREPARATION_SKU.sku,
 tenantId:fields.tenantId,orderReference:fields.orderReference,contractReference:fields.contractReference,
 provider:'paynow',paymentAuthority:SHARED_MUSITU_PAYNOW.authorityWorker,providerReferenceSha256:'3'.repeat(64),amountCents:9900,currency:'USD'};
const paid={schema:'mmf-paynow-settlement-v1',...baseClaim,status:'paid',settledAtMs:now};
const refunded={schema:'mmf-paynow-reversal-v1',...baseClaim,status:'refunded',originalSettledAtMs:now,reversedAtMs:now+1};
function seal(claim){const bytes=claim.schema==='mmf-paynow-settlement-v1'?canonicalMmfPaymentClaim(claim):canonicalMmfReversalClaim(claim);
 return {claim,signature:sign(null,bytes,keys.privateKey).toString('base64url')};}
function database(){const sqlite=new DatabaseSync(':memory:');
 const db={prepare(sql){return {bind(...args){const stmt=sqlite.prepare(sql);return {async run(){const x=stmt.run(...args);return {success:true,meta:{changes:Number(x.changes)}}},async first(){return stmt.get(...args)||null}}},
 async run(){const x=sqlite.prepare(sql).run();return {success:true,meta:{changes:Number(x.changes)}}}}}};
 return {db,close(){sqlite.close()}};}
function stageEnv(db){return {MMF_STAGE_ONLY:'true',MMF_COMMERCE_ENABLED:'false',MMF_REAL_SEND_ENABLED:'false',MMF_MAIL_SENDING_ENABLED:'false',
 MMF_BILLING_API_ENABLED:'true',MMF_API_ENABLED:'false',MMF_WEBHOOK_ENABLED:'false',MMF_TENANT_ID:fields.tenantId,MMF_PAYMENT_DB:db,
 MMF_BILLING_OPERATOR_TOKEN:OPERATOR,MMF_STAGE_RECEIPTS_ENABLED:'true',MMF_STAGE_RECEIPT_TOKEN:TOKEN,
 MMF_STAGE_AUTHORITY_PUBLIC_KEY_PEM:pub,MMF_STAGE_AUTHORITY_FINGERPRINT_SHA256:fingerprint};}
function makeHarness(){const x=database(),down=stageEnv(x.db),calls=[];
 const env={...down,MMF_PRIVATE_PAYMENT_STAGE:{async fetch(req){calls.push({url:req.url,method:req.method,body:await req.clone().text()});return stageWorker.fetch(req,down)}},MMF_STAGE_BRIDGE_ENABLED:'true'};
 return {env,db:x.db,calls,close:x.close,down};}
async function open(db,env){const r=await stageWorker.fetch(new Request('https://internal.invalid/v1/billing/stage/orders',{
 method:'POST',headers:{authorization:`Bearer ${OPERATOR}`,'content-type':'application/json'},
 body:JSON.stringify({customerReference:fields.customerReference,contractReference:fields.contractReference,orderReference:fields.orderReference})}),env);
 assert.equal(r.status,201);}

test('private service-binding bridge delivers exact signed receipt to separate stage DB with no customer payment or mail entitlement',async()=>{
 const x=makeHarness();try{
  await open(x.db,x.down);
  const first=await deliverMmfReceiptToPrivateStage({quote,receipt:seal(paid),env:x.env,nowMs:now+1});
  assert.equal(first.status,'SANDBOX_SETTLEMENT_RECORD_ONLY');assert.equal(first.idempotent,false);
  assert.equal(first.realProviderSettlementVerified,false);assert.equal(first.canAcceptCustomerFunds,false);assert.equal(first.grantsMailSending,false);
  assert.equal(x.calls.length,1);assert.equal(x.calls[0].method,'POST');
  assert.equal(new URL(x.calls[0].url).pathname,'/v1/billing/stage/evidence');
  assert.equal(JSON.parse(x.calls[0].body).customerReference,fields.customerReference);
  assert.equal(JSON.parse(x.calls[0].body).receipt.signature,seal(paid).signature);
  const again=await deliverMmfReceiptToPrivateStage({quote,receipt:seal(paid),env:x.env,nowMs:now+1});
  assert.equal(again.idempotent,true);
  const reverse=await deliverMmfReceiptToPrivateStage({quote,receipt:seal(refunded),env:x.env,nowMs:now+100});
  assert.equal(reverse.status,'REVERSED_SANDBOX');
  await assert.rejects(()=>deliverMmfReceiptToPrivateStage({quote,receipt:seal(paid),env:x.env,nowMs:now+100}),/DENIED/);
  const row=await x.db.prepare('SELECT state, reversal_kind FROM mmf_prep_orders WHERE order_reference=?').bind(fields.orderReference).first();
  assert.equal(row.state,'REVERSED_SANDBOX');assert.equal(row.reversal_kind,'refunded');
 }finally{x.close()}
});

test('bridge must fail closed before service request if any release switch or private authorization is missing',async()=>{
 const x=makeHarness();try{await open(x.db,x.down);
  for(const override of [{MMF_STAGE_BRIDGE_ENABLED:'false'},{MMF_STAGE_ONLY:'false'},{MMF_COMMERCE_ENABLED:'true'},
   {MMF_REAL_SEND_ENABLED:'true'},{MMF_MAIL_SENDING_ENABLED:'true'},{MMF_STAGE_RECEIPTS_ENABLED:'false'},
   {MMF_PRIVATE_PAYMENT_STAGE:undefined},{MMF_STAGE_RECEIPT_TOKEN:'short'},{MMF_STAGE_RECEIPT_TOKEN:OPERATOR},
   {MMF_STAGE_AUTHORITY_FINGERPRINT_SHA256:'a'.repeat(64)}]){
   await assert.rejects(()=>deliverMmfReceiptToPrivateStage({quote,receipt:seal(paid),env:{...x.env,...override},nowMs:now+1}),/DENIED/,JSON.stringify(override));
  }
  assert.equal(x.calls.length,0);
  assert.equal((await x.db.prepare('SELECT state FROM mmf_prep_orders WHERE order_reference=?').bind(fields.orderReference).first()).state,'PENDING');
 }finally{x.close()}
});

test('bridge refuses forged, cross-order, cross-product or expired signed evidence before invoking stage',async()=>{
 const x=makeHarness();try{await open(x.db,x.down);
  for(const receipt of [{...seal(paid),signature:'fake'},seal({...paid,orderReference:'MMF-DIFFERENTORDER01'}),
   {...seal(paid),claim:{...paid,product:'musitu-frontier-market-intelligence'}},seal({...paid,settledAtMs:now-370*86400000})]){
   await assert.rejects(()=>deliverMmfReceiptToPrivateStage({quote,receipt,env:x.env,nowMs:now+1}),/DENIED/);
  }
  assert.equal(x.calls.length,0);
 }finally{x.close()}
});

test('bridge rejects successful HTTP response containing success-like but unsafe authorization claims',async()=>{
 const x=makeHarness();try{await open(x.db,x.down);
  const bad=JSON.stringify({orderReference:fields.orderReference,status:'SANDBOX_SETTLEMENT_RECORD_ONLY',idempotent:false,
   realProviderSettlementVerified:true,canAcceptCustomerFunds:true,grantsMailSending:true,canIssueTaxInvoice:true});
  await assert.rejects(()=>deliverMmfReceiptToPrivateStage({quote,receipt:seal(paid),env:{...x.env,MMF_PRIVATE_PAYMENT_STAGE:{fetch:async()=>new Response(bad,{status:200,headers:{'content-type':'application/json'}})}},nowMs:now+1}),/DENIED/);
  assert.equal(x.calls.length,0);
 }finally{x.close()}
});

test('private binding failures return denied without leaking tokens, secrets or treating a non-200 as paid',async()=>{
 const x=makeHarness();try{await open(x.db,x.down);
  const secret='PRIVATE_RAW_EXCEPTION_'+TOKEN;
  for(const service of [
   {fetch:async()=>{throw Error(secret)}},
   {fetch:async()=>new Response('service down',{status:503})},
   {fetch:async()=>new Response('{invalid',{status:200,headers:{'content-type':'application/json'}})},
   {fetch:async()=>new Response('X'.repeat(3000),{status:200,headers:{'content-type':'application/json'}})}
  ]){
   await assert.rejects(()=>deliverMmfReceiptToPrivateStage({quote,receipt:seal(paid),env:{...x.env,MMF_PRIVATE_PAYMENT_STAGE:service},nowMs:now+1}),e=>{
    assert.match(e.message,/MMF_PRIVATE_STAGE_BRIDGE_DENIED/);assert.equal(e.message.includes(secret),false);return true});
  }
 }finally{x.close()}
});
