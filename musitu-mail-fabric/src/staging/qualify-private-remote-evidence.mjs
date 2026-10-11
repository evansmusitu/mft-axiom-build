/** LIVE Cloudflare STAGE-ONLY signed synthetic receipt exercise. No Paynow API,
 * real payment, customer consent, tax invoice, mail delivery or entitlement. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createPrivateKey,randomBytes,createHash,sign} from 'node:crypto';
import {canonicalMmfPaymentClaim,canonicalMmfReversalClaim,MMF_PREPARATION_SKU,SHARED_MUSITU_PAYNOW} from '../commercial/fmi-paynow-reuse.mjs';
let diagnosticPhase='VALIDATE_INPUT';
const deny=()=>{throw Error('MMF_PRIVATE_SYNTHETIC_CLOUD_QUALIFICATION_DENIED_'+diagnosticPhase)};
const path='/v1/billing/stage',ORDER=/^MMF-[A-Z0-9]{10,56}$/;
async function result(r){let x;try{x=await r.json()}catch{deny()}if(!x||typeof x!=='object'||Array.isArray(x))deny();return {code:r.status,body:x}}
export async function qualifyRemoteSyntheticEvidence({origin,operatorToken,receiptToken,signingKey,orderReference,fetchFn=fetch}={}){
 if(!['http://127.0.0.1:8793','http://localhost:8793'].includes(origin)||
  typeof fetchFn!=='function'||typeof operatorToken!=='string'||operatorToken.length<32||
  typeof receiptToken!=='string'||receiptToken.length<32||operatorToken===receiptToken||!ORDER.test(orderReference))deny();
 let signer;try{signer=createPrivateKey(signingKey)}catch{deny()}
 if(signer.asymmetricKeyType!=='ed25519')deny();
 const input={customerReference:'customer:cloud:synthetic:receipt',contractReference:'contract:cloud:synthetic:receipt',orderReference};
 const request=(route,method,body,token)=>fetchFn(origin+route,{method,headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(18000)}).then(result);
 diagnosticPhase='OPEN_ORDER';const opened=await request(path+'/orders','POST',input,operatorToken);
 if(opened.code!==201||opened.body.status!=='PENDING'||opened.body.canAcceptCustomerFunds!==false)deny();
 const at=Date.now(),providerReferenceSha256=createHash('sha256').update(randomBytes(32)).digest('hex');
 const base={product:MMF_PREPARATION_SKU.product,sku:MMF_PREPARATION_SKU.sku,tenantId:'mmf_stage_20261011',orderReference,contractReference:input.contractReference,provider:'paynow',paymentAuthority:SHARED_MUSITU_PAYNOW.authorityWorker,providerReferenceSha256,amountCents:9900,currency:'USD'};
 const paid={schema:'mmf-paynow-settlement-v1',...base,status:'paid',settledAtMs:at};
 const signed=(claim)=>({claim,signature:sign(null,claim.schema==='mmf-paynow-settlement-v1'?canonicalMmfPaymentClaim(claim):canonicalMmfReversalClaim(claim),signer).toString('base64url')});
 const payment=signed(paid),body={...input,receipt:payment};
 diagnosticPhase='CHECK_OPERATOR_DENIED';const wrongAuth=await request(path+'/evidence','POST',body,operatorToken);
 if(wrongAuth.code!==401)deny();
 diagnosticPhase='CHECK_FORGED_SIGNATURE';const forged=await request(path+'/evidence','POST',{...body,receipt:{...payment,signature:'A'.repeat(86)}},receiptToken);
 if(forged.code===200)deny();
 diagnosticPhase='RECEIVE_SIGNED_PAID';const a=await request(path+'/evidence','POST',body,receiptToken);
 if(a.code!==200||a.body.status!=='SANDBOX_SETTLEMENT_RECORD_ONLY'||a.body.idempotent!==false||a.body.realProviderSettlementVerified!==false||a.body.canAcceptCustomerFunds!==false||a.body.grantsMailSending!==false)deny();
 diagnosticPhase='READ_PAID_SANDBOX';const readPaid=await request(path+'/orders/'+orderReference,'GET',null,operatorToken);
 if(readPaid.code!==200||readPaid.body.status!=='PAID_SANDBOX'||readPaid.body.grantsMailSending!==false)deny();
 diagnosticPhase='REPLAY_PAID_IDEMPOTENT';const duplicate=await request(path+'/evidence','POST',body,receiptToken);
 if(duplicate.code!==200||duplicate.body.idempotent!==true)deny();
 const reversed={schema:'mmf-paynow-reversal-v1',...base,status:'refunded',originalSettledAtMs:at,reversedAtMs:Date.now()};
 const reverseBody={...input,receipt:signed(reversed)};
 diagnosticPhase='RECEIVE_SIGNED_REVERSAL';const b=await request(path+'/evidence','POST',reverseBody,receiptToken);
 if(b.code!==200||b.body.status!=='REVERSED_SANDBOX'||b.body.actualRefundSubmitted!==false||b.body.grantsMailSending!==false)deny();
 diagnosticPhase='REPLAY_REVERSAL_IDEMPOTENT';const reverseReplay=await request(path+'/evidence','POST',reverseBody,receiptToken);
 if(reverseReplay.code!==200||reverseReplay.body.idempotent!==true)deny();
 diagnosticPhase='REJECT_PAID_RESURRECTION';const resurrection=await request(path+'/evidence','POST',body,receiptToken);
 if(resurrection.code===200)deny();
 diagnosticPhase='READ_REVERSED_SANDBOX';const final=await request(path+'/orders/'+orderReference,'GET',null,operatorToken);
 if(final.code!==200||final.body.status!=='REVERSED_SANDBOX'||final.body.canAcceptCustomerFunds!==false)deny();
 return Object.freeze({gate:'MMF_PRIVATE_CLOUDFLARE_SYNTHETIC_RECEIPT',status:'PASS',createdPendingOrder:true,signedSyntheticPaymentRecorded:true,signatureForgeryRejected:true,wrongAuthRejected:true,duplicateIdempotence:true,signedSyntheticReversalRecorded:true,paidResurrectionRejected:true,privateOrderState:'REVERSED_SANDBOX',providerPollVerified:false,livePaymentCalls:0,customerFunds:false,customerEmail:false,publicAccess:false});
}
if(import.meta.url===`file://${process.argv[1]}`){try{
 const file=key=>{const p=process.env[key];if(!p||!p.startsWith('/'))deny();return readFileSync(p,'utf8').trim()};
 const reference='MMF-SYNTHETICCLOUD'+randomBytes(10).toString('hex').toUpperCase();
 const proof=await qualifyRemoteSyntheticEvidence({origin:'http://127.0.0.1:8793',operatorToken:file('MMF_OPERATOR_TOKEN_FILE'),receiptToken:file('MMF_RECEIPT_TOKEN_FILE'),signingKey:file('MMF_SYNTHETIC_SIGNER_FILE'),orderReference:reference});
 console.log(JSON.stringify(proof));const target=process.env.MMF_CLOUD_QUALIFICATION_EVIDENCE;
 if(target)writeFileSync(target,JSON.stringify({...proof,verifiedAt:new Date().toISOString(),runId:process.env.GITHUB_RUN_ID})+'\n',{mode:0o600});
 }catch(e){const marker=e?.message||'';console.error(/^MMF_PRIVATE_SYNTHETIC_CLOUD_QUALIFICATION_DENIED_[A-Z_]+$/.test(marker)?marker:'MMF_PRIVATE_SYNTHETIC_CLOUD_QUALIFICATION_FAILED_UNKNOWN');process.exitCode=1}}
