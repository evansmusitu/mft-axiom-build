/**
 * Paynow Zimbabwe native wire-contract primitives FOR AN ISOLATED, UNDEPLOYED
 * FUTURE MMF AUTHORITY EXTENSION ONLY. All calls are pure (no fetch/payment).
 * The Paynow integration key must remain in the existing MUSITU payment
 * authority, never in MUSITU Mail Fabric's browser, customer API, source,
 * distributed assets or unrelated product workers.
 *
 * Paynow official documentation (2026): concatenate decoded field values in
 * their wire order, excluding hash, append the integration key, SHA-512 uppercase.
 * Merchant signature validates authenticity; poll authenticated provider status
 * separately before any actual financial state transition. No returned result
 * creates a Mail Fabric or FMI entitlement or qualifies merchant settlement.
 */
import {createHash,timingSafeEqual} from 'node:crypto';
import {MMF_PREPARATION_SKU,draftMmfFmiPaynowQuote} from './fmi-paynow-reuse.mjs';
const DENIED='MMF_PAYNOW_NATIVE_PROTOCOL_DENIED';
const deny=()=>{throw Error(DENIED)};
const ALLOWED=new Set(['reference','paynowreference','amount','status','pollurl','hash',
 // Paynow documents extra optional payment channel metadata. We do not expose it.
 'paymentchannel','paymentchannelreference','paymentfrauddecision','paymentfraudscore',
 'paymentinstrument','paymentinstrumentname','paymentinstrumentnationality','paymentchanneleci']);
const STATUS=Object.freeze({Paid:'PAID_OBSERVED','Awaiting Delivery':'PROVISIONAL',
 Delivered:'PROVISIONAL',Created:'PENDING',Sent:'PENDING',Cancelled:'CANCELLED',
 Disputed:'DISPUTED',Refunded:'REFUNDED'});
const HASH=/^[A-F0-9]{128}$/;
const REF=/^MMF-[A-Z0-9]{10,56}$/;
const GUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8a-f][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const AUTHORITATIVE=new WeakSet();
const own=(obj,key)=>Object.hasOwn(obj,key);
function secret(key){if(typeof key!=='string'||key.length<18||key.length>2048||/\s/.test(key)||/^(wrong|PAYNOW_INTEGRATION_KEY)$/i.test(key))deny();return key;}
function requireQuote(q){
 if(!q||typeof q!=='object'||Array.isArray(q))deny();
 let trusted;try{trusted=draftMmfFmiPaynowQuote({tenantId:q.tenantId,customerReference:q.customerReference,
  contractReference:q.contractReference,orderReference:q.orderReference});}catch{deny()}
 if(JSON.stringify(q)!==JSON.stringify(trusted))deny();
 return trusted;
}
const signature=(entries,key)=>createHash('sha512').update(
 entries.filter(([name])=>name.toLowerCase()!=='hash').map(([,v])=>v).join('')+secret(key),'utf8').digest('hex').toUpperCase();
function strictForm(raw){
 if(typeof raw!=='string'||raw.length<30||Buffer.byteLength(raw,'utf8')>4096||
   /%(?![0-9A-Fa-f]{2})/.test(raw)||raw.includes('\0'))deny();
 const parts=raw.split('&'),out=[],seen=new Set();
 for(const part of parts){
  const idx=part.indexOf('=');if(idx<=0)deny();
  const name=decodeURIComponent(part.slice(0,idx).replaceAll('+',' '));
  let value;try{value=decodeURIComponent(part.slice(idx+1).replaceAll('+',' '));}catch{deny()}
  const lower=name.toLowerCase();
  if(!ALLOWED.has(lower)||seen.has(lower)||!value||value.includes('\uFFFD')||/[^A-Za-z]/.test(name))deny();
  seen.add(lower);out.push([lower,value]);
 }
 if(parts.length<6||parts.length>ALLOWED.size||!seen.has('hash'))deny();
 return out;
}
function amountCents(value){
 if(typeof value!=='string'||!/^(0|[1-9][0-9]{0,8})\.[0-9]{2}$/.test(value))deny();
 const [whole,cents]=value.split('.');const n=Number(whole)*100+Number(cents);
 if(!Number.isSafeInteger(n)||n<=0)deny();return n;
}
export function validateMmfPaynowPollUrl(input){
 if(typeof input!=='string'||input.length>500||!input.startsWith('https://')||
  /[\s\u0000-\u001f#]/.test(input))deny();
 let u;try{u=new URL(input)}catch{deny()}
 if(u.origin!=='https://www.paynow.co.zw'||u.username||u.password||u.port||u.hash||
  u.pathname!=='/Interface/CheckPayment/'||u.searchParams.size!==1||
  !GUID.test(u.searchParams.get('guid')||'')||
  input!==u.href)deny();
 return input;
}
export function parseVerifiedMmfPaynowStatus(raw,{integrationKey}={}){
 try{
  const key=secret(integrationKey),entries=strictForm(raw),data=Object.fromEntries(entries);
  // Paynow may explicitly mark a signed Paid response for rejection/manual review.
  // Neither a signed callback nor a matching poll may elevate this to paid.
  if(data.status==='Paid'&&own(data,'paymentfrauddecision')&&data.paymentfrauddecision!=='Issue')deny();
  if(!HASH.test(data.hash)||!own(data,'reference')||!own(data,'paynowreference')||
    !own(data,'amount')||!own(data,'pollurl')||!own(data,'status'))deny();
  const expected=signature(entries,key);
  if(!timingSafeEqual(Buffer.from(data.hash,'ascii'),Buffer.from(expected,'ascii')))deny();
  if(!REF.test(data.reference)||!/^[-A-Za-z0-9]{1,90}$/.test(data.paynowreference)||
     !own(STATUS,data.status))deny();
  const amount=amountCents(data.amount),poll=validateMmfPaynowPollUrl(data.pollurl);
  const result=Object.freeze({providerVerified:true,provider:'paynow',
   reference:data.reference,providerReference:data.paynowreference,
   providerReferenceSha256:createHash('sha256').update(data.paynowreference).digest('hex'),
   pollUrl:poll,kind:STATUS[data.status],amountCents:amount,currency:'USD',
   grantsMailSending:false,canGrantFmiEntitlement:false,canIssueTaxInvoice:false,
   requiresIndependentProviderPoll:true,bankSettlementCertified:false});
  AUTHORITATIVE.add(result);return result;
 }catch{deny()}
}
export function authorizeMmfPaynowStatusForOrder(event,quote,{tenantId}={}){
 if(!event||!AUTHORITATIVE.has(event))deny();
 const q=requireQuote(quote);
 if(tenantId!==q.tenantId||event.reference!==q.orderReference||event.amountCents!==q.amountCents||
    event.currency!==q.currency||event.provider!=='paynow')deny();
 return Object.freeze({orderReference:q.orderReference,kind:event.kind,
  tenantId:q.tenantId,providerReferenceSha256:event.providerReferenceSha256,
  requiresIndependentProviderPoll:true,bankSettlementCertified:false,
  canActivateMailService:false,canProvisionFmiPlan:false,canAcceptCustomerFunds:false});
}
function exactReturnUrl(value,order,kind){
 const expected=`https://payments.mftintelligence.com/mmf/${kind}/${order}`;
 if(value!==expected)deny();return value;
}
export function buildMmfPaynowInitiateRequest({quote,integrationId,integrationKey,returnUrl,resultUrl}={}){
 const q=requireQuote(quote);
 if(integrationId!=='26343')deny(); // verified existing MUSITU merchant integration; re-audit on change
 const key=secret(integrationKey);
 const fields=[['id',integrationId],['reference',q.orderReference],
  ['amount',(MMF_PREPARATION_SKU.amountCents/100).toFixed(2)],
  ['additionalinfo','MUSITU Mail Fabric verified communications readiness'],
  ['returnurl',exactReturnUrl(returnUrl,q.orderReference,'return')],
  ['resulturl',exactReturnUrl(resultUrl,q.orderReference,'result')],
  ['status','Message']];
 const body=new URLSearchParams([...fields,['hash',signature(fields,key)]]).toString();
 return Object.freeze({method:'POST',url:'https://www.paynow.co.zw/interface/initiatetransaction',
  contentType:'application/x-www-form-urlencoded',body,providerCalled:false,
  releaseAuthorized:false,mayReturnCheckoutToCustomer:false,grantsMailSending:false});
}
