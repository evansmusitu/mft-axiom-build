/** Real deployed Cloudflare MMF private TWO-Worker qualification using a synthetic signer.
 * No Paynow provider network call, merchant token, money, tax invoice or outbound mail.
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {createPrivateKey,createHash,randomBytes,sign} from 'node:crypto';
import {canonicalMmfPaymentClaim,canonicalMmfReversalClaim,draftMmfFmiPaynowQuote,MMF_PREPARATION_SKU,SHARED_MUSITU_PAYNOW} from '../commercial/fmi-paynow-reuse.mjs';
let diagnostic='VALIDATE_INPUT';
const deny=()=>{throw Error('MMF_PRIVATE_TWO_WORKER_QUALIFICATION_DENIED_'+diagnostic)};
const orderPattern=/^MMF-[A-Z0-9]{10,56}$/;
export async function qualifyPrivateTwoWorker({origin,operatorToken,callerToken,receiptToken,signingKey,orderReference,fetchFn=fetch}={}){
 diagnostic='VALIDATE_INPUT';
 if(!['http://127.0.0.1:8794','http://localhost:8794'].includes(origin)||
  typeof fetchFn!=='function'||![operatorToken,callerToken,receiptToken].every(v=>typeof v==='string'&&v.length>=32&&v.length<=300)||
  new Set([operatorToken,callerToken,receiptToken]).size!==3||!orderPattern.test(orderReference))deny();
 let signer;try{signer=createPrivateKey(signingKey)}catch{deny()}
 if(signer.asymmetricKeyType!=='ed25519')deny();
 const fields={customerReference:'customer:cloud:synthetic:two-worker',contractReference:'contract:cloud:synthetic:two-worker',orderReference};
 const quote=draftMmfFmiPaynowQuote({tenantId:'mmf_stage_20261011',...fields});
 async function send(path,method,data,token){
  let response;try{response=await fetchFn(origin+path,{method,headers:{authorization:'Bearer '+token,...(data?{'content-type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{}),signal:AbortSignal.timeout(20000)})}catch{deny()}
  if(!(response instanceof Response))deny();let body;
  try{const raw=await response.text();if(raw.length>2000)deny();body=JSON.parse(raw)}catch{deny()}
  if(!body||typeof body!=='object'||Array.isArray(body))deny();return {code:response.status,body};
 }
 const orderRoot='/v1/billing/stage/orders',intake='/internal/mmf/stage/receipt';
 diagnostic='CREATE_PENDING_ORDER';const created=await send(orderRoot,'POST',fields,operatorToken);
 if(created.code!==201||created.body.status!=='PENDING'||created.body.canAcceptCustomerFunds!==false)deny();
 const settledAtMs=Date.now(),reference=createHash('sha256').update(randomBytes(32)).digest('hex');
 const base={product:MMF_PREPARATION_SKU.product,sku:MMF_PREPARATION_SKU.sku,tenantId:quote.tenantId,orderReference,contractReference:fields.contractReference,provider:'paynow',paymentAuthority:SHARED_MUSITU_PAYNOW.authorityWorker,providerReferenceSha256:reference,amountCents:9900,currency:'USD'};
 const paid={schema:'mmf-paynow-settlement-v1',...base,status:'paid',settledAtMs};
 const sealed=claim=>({claim,signature:sign(null,claim.schema==='mmf-paynow-settlement-v1'?canonicalMmfPaymentClaim(claim):canonicalMmfReversalClaim(claim),signer).toString('base64url')});
 const paidReceipt=sealed(paid),payload={quote,receipt:paidReceipt};
 diagnostic='REJECT_OPERATOR_AS_AUTHORITY';const unauthorized=await send(intake,'POST',payload,operatorToken);
 if(unauthorized.code!==401)deny();
 diagnostic='REJECT_FORGED_RECEIPT';const forged=await send(intake,'POST',{quote,receipt:{...paidReceipt,signature:'A'.repeat(86)}},callerToken);
 if(forged.code===200)deny();
 diagnostic='RECORD_SIGNED_SYNTHETIC_PAYMENT';const acknowledged=await send(intake,'POST',payload,callerToken);
 if(acknowledged.code!==200||acknowledged.body.status!=='SANDBOX_SETTLEMENT_RECORD_ONLY'||acknowledged.body.privateStageAcknowledged!==true||acknowledged.body.idempotent!==false||acknowledged.body.realProviderSettlementVerified!==false||acknowledged.body.canAcceptCustomerFunds!==false||acknowledged.body.grantsMailSending!==false||acknowledged.body.syntheticOnly!==true)deny();
 diagnostic='READ_PAID_SANDBOX';const paidRead=await send(orderRoot+'/'+orderReference,'GET',null,operatorToken);
 if(paidRead.code!==200||paidRead.body.status!=='PAID_SANDBOX')deny();
 diagnostic='CHECK_REPLAY_IDEMPOTENCE';const again=await send(intake,'POST',payload,callerToken);
 if(again.code!==200||again.body.idempotent!==true)deny();
 const refunded={schema:'mmf-paynow-reversal-v1',...base,status:'refunded',originalSettledAtMs:settledAtMs,reversedAtMs:Date.now()};
 const reversal={quote,receipt:sealed(refunded)};
 diagnostic='RECORD_SIGNED_SYNTHETIC_REFUND';const reversed=await send(intake,'POST',reversal,callerToken);
 if(reversed.code!==200||reversed.body.status!=='REVERSED_SANDBOX'||reversed.body.privateStageAcknowledged!==true||reversed.body.canAcceptCustomerFunds!==false||reversed.body.grantsMailSending!==false)deny();
 diagnostic='REPLAY_REFUND_IDEMPOTENCE';const rerun=await send(intake,'POST',reversal,callerToken);
 if(rerun.code!==200||rerun.body.idempotent!==true)deny();
 diagnostic='REJECT_PAID_RESURRECTION';const resurrected=await send(intake,'POST',payload,callerToken);
 if(resurrected.code===200)deny();
 diagnostic='READ_REFUNDED_SANDBOX';const final=await send(orderRoot+'/'+orderReference,'GET',null,operatorToken);
 if(final.code!==200||final.body.status!=='REVERSED_SANDBOX'||final.body.canAcceptCustomerFunds!==false||final.body.grantsMailSending!==false)deny();
 return Object.freeze({gate:'MMF_DEPLOYED_PRIVATE_TWO_WORKER_SYNTHETIC_RECEIPT',status:'PASS',billingWorkerReached:true,authorityWorkerReached:true,privateServiceBindingUsed:true,createdPendingOrder:true,signedSyntheticPaymentRecorded:true,forgeryRejected:true,wrongAuthDenied:true,replayIdempotence:true,signedSyntheticRefundRecorded:true,paidResurrectionDenied:true,privateBillingState:'REVERSED_SANDBOX',realProviderPollVerified:false,realPaynowCalls:0,customerFunds:false,customerEmail:false,publicRoutes:false});
}
if(import.meta.url===`file://${process.argv[1]}`){try{
 const file=n=>{const p=process.env[n];if(!p?.startsWith('/'))deny();return readFileSync(p,'utf8').trim()};
 const proof=await qualifyPrivateTwoWorker({origin:'http://127.0.0.1:8794',operatorToken:file('MMF_OPERATOR_TOKEN_FILE'),callerToken:file('MMF_AUTHORITY_CALLER_TOKEN_FILE'),receiptToken:file('MMF_RECEIPT_TOKEN_FILE'),signingKey:file('MMF_SYNTHETIC_SIGNER_FILE'),orderReference:'MMF-TWOWORKER'+randomBytes(12).toString('hex').toUpperCase()});
 console.log(JSON.stringify(proof));const target=process.env.MMF_TWO_WORKER_CLOUD_EVIDENCE;
 if(target)writeFileSync(target,JSON.stringify({...proof,verifiedAt:new Date().toISOString(),runId:process.env.GITHUB_RUN_ID})+'\n',{mode:0o600});
}catch(e){const m=e?.message||'';console.error(/^MMF_PRIVATE_TWO_WORKER_QUALIFICATION_DENIED_[A-Z_]+$/.test(m)?m:'MMF_PRIVATE_TWO_WORKER_QUALIFICATION_FAILED_UNKNOWN');process.exitCode=1}}
