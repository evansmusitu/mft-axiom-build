/** Private/offline Paynow signed-callback review. No network, keys, settlements,
 * refunds, entitlements, charge initiation or production merchant access here.
 * Provider: https://developers.paynow.co.zw/docs/paynow/validating_hash/
 */
import {createHash,timingSafeEqual} from 'node:crypto';
const FIELDS=new Set(['reference','amount','paynowreference','pollurl','status','hash']);
const STATUSES=new Set(['Paid','Awaiting Delivery','Delivered','Created','Sent','Cancelled','Disputed','Refunded']);
const IDENT=/^[A-Za-z0-9_-]{3,80}$/;
const AMOUNT=/^(?:[1-9]\d{0,9}|0)\.\d{2}$/;
function deny(why){throw Error('private Paynow review: '+why);}
function checkAmount(value){
  if(typeof value!=='string'||!AMOUNT.test(value)||BigInt(value.replace('.',''))===0n)
    deny('invalid exact two-decimal positive amount');
}
function checkPoll(value){
  let url;
  try{url=new URL(value);}catch{deny('invalid provider poll URL');}
  if(url.protocol!=='https:'||url.hostname!=='www.paynow.co.zw'||url.port||
    url.username||url.password||url.hash||url.pathname!=='/Interface/CheckPayment/'||
    url.href!==value||[...url.searchParams.keys()].length!==1||
    !/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(url.searchParams.get('guid')??''))
    deny('untrusted Paynow poll URL or host');
}
function decode(raw){
  if(/%(?![0-9a-fA-F]{2})/.test(raw))deny('malformed URL encoding');
  try{return decodeURIComponent(raw.replace(/\+/g,' '));}
  catch{deny('malformed URL encoding');}
}
function parse(body){
  if(typeof body!=='string'&&!Buffer.isBuffer(body))deny('invalid form data format');
  const n=Buffer.byteLength(body);
  if(n>12*1024)deny('status response size unsupported');
  let raw;
  try{raw=new TextDecoder('utf-8',{fatal:true}).decode(typeof body==='string'?Buffer.from(body):body);}
  catch{deny('invalid UTF-8 encoding');}
  if(n<10||!raw||raw.includes('\0'))deny('invalid form data format');
  const values=Object.create(null),signed=[];
  for(const pair of raw.split('&')){
    if(!pair)deny('invalid empty form field');
    const eq=pair.indexOf('=');
    if(eq<=0||pair.indexOf('=',eq+1)!==-1)deny('invalid form field format');
    const key=decode(pair.slice(0,eq)).toLowerCase(),value=decode(pair.slice(eq+1));
    if(Object.hasOwn(values,key))deny('duplicate form field: '+key);
    if(!FIELDS.has(key))deny('unsupported provider field or tokenization');
    if(value.length===0||value.length>2048)deny('invalid provider field format');
    values[key]=value;
    if(key!=='hash')signed.push(value);
  }
  if(Object.keys(values).length!==6||[...FIELDS].some(x=>!Object.hasOwn(values,x)))
    deny('missing required provider status field');
  return {values,signed};
}
export function verifyPaynowStatusUpdate({body,integrationKey,order}={}){
  if(!order||typeof order!=='object'||Array.isArray(order)||
    typeof order.reference!=='string'||!IDENT.test(order.reference))
    deny('trusted merchant order reference required');
  checkAmount(order.amount);checkPoll(order.pollurl);
  if(typeof integrationKey!=='string'||integrationKey.length<16||integrationKey.length>512)
    deny('independently provisioned merchant integration key required');
  const {values,signed}=parse(body);
  if(!/^[0-9A-F]{128}$/.test(values.hash))deny('invalid provider hash format');
  const expected=createHash('sha512').update(signed.join('')+integrationKey,'utf8').digest();
  const actual=Buffer.from(values.hash,'hex');
  if(actual.length!==expected.length||!timingSafeEqual(actual,expected))
    deny('provider hash signature mismatch');
  if(values.reference!==order.reference)deny('merchant reference does not match known order');
  checkAmount(values.amount);
  if(values.amount!==order.amount)deny('provider amount does not match known order');
  checkPoll(values.pollurl);
  if(values.pollurl!==order.pollurl)deny('provider poll URL does not match initiated order');
  if(!IDENT.test(values.paynowreference))deny('invalid provider transaction reference');
  if(!STATUSES.has(values.status))deny('unsupported provider status');
  return Object.freeze({state:'SIGNATURE_VERIFIED_REVIEW_ONLY',merchantReference:values.reference,
    providerReference:values.paynowreference,amount:values.amount,pollurl:values.pollurl,
    providerStatus:values.status,entitlementGranted:false,settled:false});
}
/** Caller must fetch poll independently using authenticated provider transport.
 * This pure function cannot grant purchases, refunds or publisher settlement. */
export function reconcilePaynowPaymentForReview({callbackBody,polledBody,integrationKey,order}={}){
  const callback=verifyPaynowStatusUpdate({body:callbackBody,integrationKey,order});
  if(polledBody===undefined||polledBody===null)
    return Object.freeze({state:'AWAITING_INDEPENDENT_PROVIDER_POLL',entitlementGranted:false,
      publisherSettlementAuthorized:false,refundFinalized:false,merchantReference:callback.merchantReference});
  const polled=verifyPaynowStatusUpdate({body:polledBody,integrationKey,order});
  if(callback.providerReference!==polled.providerReference)
    deny('provider reference changed between callback and independently polled transaction');
  return Object.freeze({state:callback.providerStatus==='Paid'&&polled.providerStatus==='Paid'
      ?'PAYMENT_CONFIRMED_REVIEW_REQUIRED':'PAYMENT_HOLD_REVIEW_REQUIRED',
    merchantReference:callback.merchantReference,providerReference:callback.providerReference,
    latestProviderStatus:polled.providerStatus,entitlementGranted:false,
    publisherSettlementAuthorized:false,refundFinalized:false});
}
