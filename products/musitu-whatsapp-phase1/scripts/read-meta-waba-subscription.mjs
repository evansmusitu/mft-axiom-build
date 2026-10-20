import {pathToFileURL} from 'node:url';
import {writeFileSync} from 'node:fs';
const WABA='1955690452095441',PHONE='1292923853915392',APP='1096094346481018';
const BASE='https://graph.facebook.com/v25.0/';
const fail=code=>{throw Error(code);};
/** Operator-only GET diagnostic. Never sends, subscribes, retries or prints provider payloads. */
export async function readMetaWabaSubscription({token,request=fetch}={}){
 if(typeof token!=='string'||!/^EAA[A-Za-z0-9_-]{30,}$/.test(token))fail('META_TOKEN_REQUIRED');
 const operations=[];
 async function read(path){
  let reader;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
  try{
   const response=await request(BASE+path,{method:'GET',redirect:'error',headers:{authorization:'Bearer '+token,accept:'application/json'},signal:controller.signal});
   if(!response.body)fail('META_BODY_REQUIRED');
   reader=response.body.getReader();let length=0;const parts=[];
   for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>16384)fail('META_BODY_TOO_LARGE');parts.push(Buffer.from(value));}
   let body;try{body=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{fail('META_JSON_REQUIRED');}
   operations.push({operation:path.includes('/phone_numbers')?'GET_EXACT_TEST_PHONE':'GET_TEST_WABA_SUBSCRIBED_APPS',httpStatus:response.status});
   if(response.status!==200)return {ok:false,providerErrorCode:Number.isSafeInteger(body?.error?.code)?body.error.code:null,providerErrorSubcode:Number.isSafeInteger(body?.error?.error_subcode)?body.error.error_subcode:null};
   return {ok:true,body};
  }catch(e){if(['META_BODY_REQUIRED','META_BODY_TOO_LARGE','META_JSON_REQUIRED'].includes(e.message))throw e;fail('META_TRANSPORT_FAILED');}
  finally{clearTimeout(timer);await reader?.cancel().catch(()=>{});}
 }
 const base={scope:'GENUINE_META_TEST_WABA_READ_ONLY_NO_SEND_NO_SUBSCRIPTION_WRITE',appId:APP,wabaId:WABA,phoneId:PHONE,operations};
 const phones=await read(WABA+'/phone_numbers?fields=id');
 if(!phones.ok)return {...base,status:'PHONE_READ_DENIED',providerErrorCode:phones.providerErrorCode,providerErrorSubcode:phones.providerErrorSubcode};
 if(!Array.isArray(phones.body?.data)||phones.body.data.length!==1||phones.body.data[0]?.id!==PHONE||phones.body?.paging?.next)return {...base,status:'EXACT_TEST_PHONE_NOT_QUALIFIED'};
 const apps=await read(WABA+'/subscribed_apps?limit=50');
 if(!apps.ok)return {...base,status:'SUBSCRIPTION_READ_DENIED',providerErrorCode:apps.providerErrorCode,providerErrorSubcode:apps.providerErrorSubcode};
 const data=apps.body?.data;
 if(!Array.isArray(data)||data.length>50)return {...base,status:'SUBSCRIPTION_SHAPE_UNQUALIFIED'};
 const ids=data.map(x=>x?.whatsapp_business_api_data?.id);
 if(ids.some(x=>typeof x!=='string'||!/^\d{1,40}$/.test(x))||new Set(ids).size!==ids.length)return {...base,status:'SUBSCRIPTION_SHAPE_UNQUALIFIED'};
 const next=typeof apps.body?.paging?.next==='string'&&apps.body.paging.next.length>0,present=ids.includes(APP);
 return {...base,status:present?'APP_SUBSCRIBED':next?'SUBSCRIPTION_INCOMPLETE_PAGE':'APP_NOT_SUBSCRIBED',appSubscribed:present?true:next?null:false,subscribedAppCount:data.length,otherAppsPresent:ids.some(x=>x!==APP),additionalPagePresent:next};
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 let report;try{report=await readMetaWabaSubscription({token:process.env.META_ACCESS_TOKEN});}
 catch(e){report={scope:'META_READ_DIAGNOSTIC_NOT_COMPLETED',status:['META_TOKEN_REQUIRED','META_BODY_REQUIRED','META_BODY_TOO_LARGE','META_JSON_REQUIRED','META_TRANSPORT_FAILED'].includes(e.message)?e.message:'META_READ_FAILED'};}
 report={observedAt:new Date().toISOString(),...report,noSendAttempted:true,noSubscriptionChanged:true};
 writeFileSync('public/meta-waba-read.json',JSON.stringify(report,null,2));
 console.log('MUSITU_META_WABA_READ='+JSON.stringify(report));
}
