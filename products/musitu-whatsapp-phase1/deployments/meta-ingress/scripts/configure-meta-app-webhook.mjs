import {randomUUID} from 'node:crypto';
import {validateReceiverCallback,assertExpectedReceiverSubscription} from './receiver-callback-guard.mjs';
const APP='1096094346481018',OBJECT='whatsapp_business_account';
// The operator must freshly verify and explicitly supply the predecessor.
// Never bootstrap an empty subscription or overwrite an unexpected callback.
const PREVIOUS=validateReceiverCallback(process.argv[3]);
const secret=process.env.META_APP_SECRET,verify=process.env.META_VERIFY_TOKEN;
const target=new URL(validateReceiverCallback(process.argv[2]));
if(!/^[a-fA-F0-9]{32}$/.test(secret||'')||!(/^[A-Za-z0-9_-]{32,256}$/).test(verify||''))throw Error('META_APP_CONFIGURATION_REQUIRED');
const redact=text=>String(text||'').split(secret).join('[REDACTED]').split(verify).join('[REDACTED]').slice(0,1000);
async function bounded(response){const reader=response.body.getReader();let size=0;const parts=[];try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>16384)throw Error('PROVIDER_BODY_TOO_LARGE');parts.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}return Buffer.concat(parts).toString('utf8');}
async function graph(method,body){
 const response=await fetch('https://graph.facebook.com/v25.0/'+APP+'/subscriptions',{method,headers:{authorization:'Bearer '+APP+'|'+secret,...(body?{'content-type':'application/x-www-form-urlencoded'}:{})},body,redirect:'error',signal:AbortSignal.timeout(20000)});
 let data;try{data=JSON.parse(await bounded(response));}catch{throw Error('META_SUBSCRIPTION_JSON_REQUIRED');}
 if(response.status!==200){console.log('MUSITU_META_APP_CONFIGURATION_ERROR='+JSON.stringify({appId:APP,method,httpStatus:response.status,providerErrorCode:Number.isSafeInteger(data?.error?.code)?data.error.code:null,providerErrorSubcode:Number.isSafeInteger(data?.error?.error_subcode)?data.error.error_subcode:null,message:redact(data?.error?.message),noMessageSent:true}));throw Error('META_SUBSCRIPTION_API_REJECTED');}
 return data;
}
try{
 // A direct handshake is a transport preflight, not a Meta event claim.
 const challenge=randomUUID().replaceAll('-',''),preflight=new URL(target);
 preflight.searchParams.set('hub.mode','subscribe');preflight.searchParams.set('hub.verify_token',verify);preflight.searchParams.set('hub.challenge',challenge);
 const ready=await fetch(preflight,{redirect:'error',signal:AbortSignal.timeout(10000)});
 if(ready.status!==200||await bounded(ready)!==challenge)throw Error('CALLBACK_PREFLIGHT_REJECTED');
 const before=await graph('GET');if(!Array.isArray(before.data))throw Error('META_SUBSCRIPTION_STATE_REQUIRED');
 const replacementRequired=assertExpectedReceiverSubscription({subscriptions:before.data,target:target.href,expectedPrevious:PREVIOUS});
 let changed=false;
 if(replacementRequired){
  const body=new URLSearchParams({object:OBJECT,callback_url:target.href,verify_token:verify,fields:'messages'}).toString();
  const saved=await graph('POST',body);if(saved.success!==true)throw Error('META_SUBSCRIPTION_SUCCESS_REQUIRED');changed=true;
 }
 const after=await graph('GET');const matches=Array.isArray(after.data)?after.data.filter(x=>x.object===OBJECT&&x.callback_url===target.href):[];
 if(matches.length!==1||!Array.isArray(matches[0].fields)||!matches[0].fields.some(f=>(typeof f==='string'?f:f?.name)==='messages'))throw Error('META_SUBSCRIPTION_READBACK_FAILED');
 const otherBefore=before.data.filter(x=>x.object!==OBJECT).map(x=>JSON.stringify(x)).sort();const otherAfter=after.data.filter(x=>x.object!==OBJECT).map(x=>JSON.stringify(x)).sort();
 if(JSON.stringify(otherBefore)!==JSON.stringify(otherAfter))throw Error('UNRELATED_APP_SUBSCRIPTIONS_CHANGED');
 console.log('MUSITU_META_APP_CONFIGURATION='+JSON.stringify({runId:randomUUID(),observedAt:new Date().toISOString(),appId:APP,object:OBJECT,callbackUrl:target.href,fields:['messages'],active:typeof matches[0].active==='boolean'?matches[0].active:null,changed,readbackVerified:true,otherAppObjectsPreserved:true,wabaSubscriptionsChanged:false,appPublished:false,noMessageSent:true,scope:'GENUINE_META_APP_WEBHOOK_CONFIGURATION_AND_READBACK'}));
}catch(error){const known=new Set(['PROVIDER_BODY_TOO_LARGE','META_SUBSCRIPTION_JSON_REQUIRED','META_SUBSCRIPTION_API_REJECTED','CALLBACK_PREFLIGHT_REJECTED','META_SUBSCRIPTION_STATE_REQUIRED','UNEXPECTED_EXISTING_APP_CALLBACK','META_SUBSCRIPTION_SUCCESS_REQUIRED','META_SUBSCRIPTION_READBACK_FAILED','UNRELATED_APP_SUBSCRIPTIONS_CHANGED']);console.log('MUSITU_META_APP_CONFIGURATION_FAILURE='+JSON.stringify({appId:APP,code:known.has(error.message)?error.message:'META_CONFIGURATION_TRANSPORT_FAILED',noMessageSent:true}));process.exitCode=1;}
