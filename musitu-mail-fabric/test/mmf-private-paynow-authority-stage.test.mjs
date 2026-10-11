import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash,sign} from 'node:crypto';
import worker from '../src/edge/mmf-paynow-private-authority-stage.mjs';
import {draftMmfFmiPaynowQuote,canonicalMmfPaymentClaim,MMF_PREPARATION_SKU,SHARED_MUSITU_PAYNOW} from '../src/commercial/fmi-paynow-reuse.mjs';

const {privateKey,publicKey}=generateKeyPairSync('ed25519');
const publicKeyPem=publicKey.export({format:'pem',type:'spki'});
const fingerprint=createHash('sha256').update(publicKey.export({format:'der',type:'spki'})).digest('hex');
const token='mmf-solely-private-authority-caller-token-20261011';
const stageReceiptToken='mmf-private-stage-separate-receipt-token-20261011';
const quote=draftMmfFmiPaynowQuote({tenantId:'mmf_stage_20261011',customerReference:'customer:stage:authority:01',contractReference:'contract:stage:authority:01',orderReference:'MMF-PRIVATEAUTHORITY01'});
const at=Date.now();
const paid={schema:'mmf-paynow-settlement-v1',product:MMF_PREPARATION_SKU.product,sku:MMF_PREPARATION_SKU.sku,tenantId:quote.tenantId,
 orderReference:quote.orderReference,contractReference:quote.contractReference,provider:'paynow',paymentAuthority:SHARED_MUSITU_PAYNOW.authorityWorker,
 providerReferenceSha256:'f'.repeat(64),amountCents:9900,currency:'USD',status:'paid',settledAtMs:at};
function seal(claim){return {claim,signature:sign(null,canonicalMmfPaymentClaim(claim),privateKey).toString('base64url')}}
function makeEnv(patch={}){const calls=[];const service={async fetch(req){calls.push({url:req.url,auth:req.headers.get('authorization'),payload:await req.clone().json()});return new Response(JSON.stringify({orderReference:quote.orderReference,status:'SANDBOX_SETTLEMENT_RECORD_ONLY',idempotent:false,realProviderSettlementVerified:false,canAcceptCustomerFunds:false,canIssueTaxInvoice:false,grantsMailSending:false}),{status:200,headers:{'content-type':'application/json'}})}};
 const env={MMF_PRIVATE_AUTHORITY_STAGE_ENABLED:'true',MMF_STAGE_BRIDGE_ENABLED:'true',MMF_STAGE_ONLY:'true',MMF_REAL_SEND_ENABLED:'false',MMF_MAIL_SENDING_ENABLED:'false',MMF_COMMERCE_ENABLED:'false',MMF_BILLING_API_ENABLED:'true',MMF_STAGE_RECEIPTS_ENABLED:'true',MMF_API_ENABLED:'false',MMF_WEBHOOK_ENABLED:'false',MMF_TENANT_ID:'mmf_stage_20261011',MMF_AUTHORITY_CALLER_TOKEN:token,MMF_STAGE_RECEIPT_TOKEN:stageReceiptToken,MMF_STAGE_AUTHORITY_PUBLIC_KEY_PEM:publicKeyPem,MMF_STAGE_AUTHORITY_FINGERPRINT_SHA256:fingerprint,MMF_PRIVATE_AUTHORITY_EXPIRES_MS:String(Date.now()+600000),MMF_PRIVATE_PAYMENT_STAGE:service,...patch};return {env,calls};}
function request(body={quote,receipt:seal(paid)},auth=token,route='/internal/mmf/stage/receipt',method='POST'){
 return new Request('https://local-only.invalid'+route,{method,headers:{authorization:'Bearer '+auth,'content-type':'application/json'},...(method==='POST'?{body:JSON.stringify(body)}:{})});
}
const invoke=(req,env)=>worker.fetch(req,env);
test('separate MMF private authority Worker validates signed receipt and delivers via fixed service binding only',async()=>{
 const x=makeEnv();const response=await invoke(request(),x.env);const body=await response.json();
 assert.equal(response.status,200);assert.equal(body.privateStageAcknowledged,true);assert.equal(body.status,'SANDBOX_SETTLEMENT_RECORD_ONLY');
 assert.equal(body.realProviderSettlementVerified,false);assert.equal(body.canAcceptCustomerFunds,false);assert.equal(body.grantsMailSending,false);
 assert.equal(x.calls.length,1);assert.equal(new URL(x.calls[0].url).pathname,'/v1/billing/stage/evidence');
 assert.equal(x.calls[0].auth,'Bearer '+stageReceiptToken);
});
test('default disabled worker and expired or unsafe authority stage never access billing service',async()=>{
 for(const patch of [{MMF_PRIVATE_AUTHORITY_STAGE_ENABLED:'false'}, {MMF_PRIVATE_AUTHORITY_EXPIRES_MS:String(Date.now()-1)},
  {MMF_PRIVATE_AUTHORITY_EXPIRES_MS:String(Date.now()+21*60*1000)}, {MMF_COMMERCE_ENABLED:'true'},
  {MMF_REAL_SEND_ENABLED:'true'}, {MMF_MAIL_SENDING_ENABLED:'true'}, {MMF_STAGE_RECEIPTS_ENABLED:'false'},
  {MMF_PRIVATE_PAYMENT_STAGE:undefined}, {MMF_AUTHORITY_CALLER_TOKEN:stageReceiptToken}, {MMF_API_ENABLED:'true'},
  {MMF_TENANT_ID:'fmi_production'}]){
  const x=makeEnv(patch);const r=await invoke(request(),x.env);assert.equal(r.status,503,JSON.stringify(patch));assert.equal(x.calls.length,0);
 }
});
test('authorization, method, path and query string are private-only and fail closed',async()=>{
 const x=makeEnv();for(const [req,status] of [[request(undefined,'wrong-token'),401],[request(undefined,token,'/internal/mmf/stage/other'),404],
  [request(undefined,token,'/internal/mmf/stage/receipt?x=1'),404],[request(undefined,token,'/internal/mmf/stage/receipt','GET'),404]]){
  const r=await invoke(req,x.env);assert.equal(r.status,status);
 }assert.equal(x.calls.length,0);
});
test('forged receipts, wrong product, unknown fields, different tenant and large bodies never reach billing Worker',async()=>{
 const x=makeEnv();const cases=[{quote,receipt:{...seal(paid),signature:'A'.repeat(86)}},
  {quote,receipt:{...seal(paid),claim:{...paid,product:'musitu-fmi'}}},
  {quote:{...quote,tenantId:'fmi_production'},receipt:seal(paid)},
  {quote,receipt:seal(paid),paid:true},
  {quote,receipt:seal(paid),junk:'x'.repeat(5000)}];
 for(const data of cases){const r=await invoke(request(data),x.env);assert.equal(r.status, data.junk?413:422);}
 assert.equal(x.calls.length,0);
});
test('private service failure cannot leak raw tokens or produce a paid receipt',async()=>{
 const x=makeEnv({MMF_PRIVATE_PAYMENT_STAGE:{async fetch(){throw Error('SECRET-'+stageReceiptToken)}}});
 const r=await invoke(request(),x.env);assert.equal(r.status,503);assert.equal((await r.text()).includes(stageReceiptToken),false);
});
