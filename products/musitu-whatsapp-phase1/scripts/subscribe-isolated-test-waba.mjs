import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {writeFileSync} from 'node:fs';
const APP='1096094346481018',WABA='1955690452095441',PHONE='1292923853915392';
const BASE='https://graph.facebook.com/v25.0/',APPLY='--apply-app-1096094346481018-to-test-waba-1955690452095441';
const fail=code=>{throw Error(code);};
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const digest=x=>createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');
function snapshot(body){
 if(!Array.isArray(body?.data)||body.data.length>50||body?.paging?.next)fail('SUBSCRIPTION_SNAPSHOT_UNQUALIFIED');
 const rows=new Map();for(const row of body.data){const id=row?.whatsapp_business_api_data?.id;if(typeof id!=='string'||!/^\d{1,40}$/.test(id)||rows.has(id))fail('SUBSCRIPTION_SNAPSHOT_UNQUALIFIED');rows.set(id,digest(row));}return rows;
}
/** Explicit one-off operator action, authorized Phase1 test integration only.
 * No DELETE, callback override, message send, token rotation or automatic retry.
 * Never use this as the project's default build command. */
export async function subscribeIsolatedTestWaba({token,apply=false,inspectTokenAppOnly=false,request=fetch,onWriteStart=()=>{}}={}){
 const report={scope:'EXACT_TEST_WABA_ADD_CURRENT_DEV_APP_PRESERVE_EXISTING_SUBSCRIBERS',appId:APP,wabaId:WABA,phoneId:PHONE,writeAttempted:false,operations:[]};
 if(!apply&&!inspectTokenAppOnly)return {...report,status:'EXPLICIT_APPLY_REQUIRED'};
 if(typeof token!=='string'||!/^EAA[A-Za-z0-9_-]{30,}$/.test(token))return {...report,status:'META_TOKEN_REQUIRED'};
 async function call(path,method='GET'){
  let reader;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
  try{
   const options={method,redirect:'error',headers:{authorization:'Bearer '+token,accept:'application/json'},signal:controller.signal};
   if(method==='POST'){options.headers['content-type']='application/json';options.body='{}';}
   const response=await request(BASE+path,options);report.operations.push({method,operation:path==='app?fields=id'?'TOKEN_APP_ID':path.includes('phone_numbers')?'TEST_PHONE_ID':'TEST_WABA_SUBSCRIBED_APPS',httpStatus:response.status});
   if(!response.body)fail('META_BODY_REQUIRED');reader=response.body.getReader();let size=0;const parts=[];
   for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>16384)fail('META_BODY_TOO_LARGE');parts.push(Buffer.from(value));}
   let body;try{body=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{fail('META_JSON_REQUIRED');}
   if(response.status!==200){report.lastProviderError={code:Number.isSafeInteger(body?.error?.code)?body.error.code:null,subcode:Number.isSafeInteger(body?.error?.error_subcode)?body.error.error_subcode:null};fail('META_HTTP_DENIED');}
   return body;
  }catch(e){if(['META_BODY_REQUIRED','META_BODY_TOO_LARGE','META_JSON_REQUIRED','META_HTTP_DENIED'].includes(e.message))throw e;fail('META_TRANSPORT_FAILED');}
  finally{clearTimeout(timer);await reader?.cancel().catch(()=>{});}
 }
 try{
  const app=await call('app?fields=id');if(typeof app?.id!=='string'||!/^\d{1,40}$/.test(app.id))fail('TOKEN_APP_ID_UNQUALIFIED');report.tokenAppId=app.id;if(app.id!==APP)fail('TOKEN_APP_ID_MISMATCH');report.tokenAppMatched=true;
  if(inspectTokenAppOnly)return {...report,status:'TOKEN_APP_ID_VERIFIED_NO_WRITE'};
  const phones=await call(WABA+'/phone_numbers?fields=id');if(!Array.isArray(phones?.data)||phones.data.length!==1||phones.data[0]?.id!==PHONE||phones?.paging?.next)fail('EXACT_TEST_PHONE_REQUIRED');
  const before=snapshot(await call(WABA+'/subscribed_apps?limit=50'));report.beforeCount=before.size;report.beforeSnapshotDigest=digest([...before].sort());
  if(before.has(APP))return {...report,status:'ALREADY_SUBSCRIBED_NO_WRITE',appSubscribed:true};
  report.writeAttempted=true;onWriteStart();
  try{const ack=await call(WABA+'/subscribed_apps','POST');report.writeAcknowledged=ack?.success===true;}catch(e){report.writeOutcome='UNKNOWN_OR_DENIED';}
  // One independent readback, even after an uncertain POST. Never repeat the POST.
  const after=snapshot(await call(WABA+'/subscribed_apps?limit=50'));
  report.afterCount=after.size;report.appSubscribed=after.has(APP);
  report.existingSubscriberIdsPreserved=[...before.keys()].every(id=>after.has(id));
  report.existingSubscriberMetadataPreserved=[...before].every(([id,hash])=>after.get(id)===hash);
  report.onlyExpectedAppAdded=after.size===before.size+1&&[...after.keys()].every(id=>id===APP||before.has(id));
  report.afterSnapshotDigest=digest([...after].sort());
  report.status=report.appSubscribed&&report.existingSubscriberIdsPreserved&&report.existingSubscriberMetadataPreserved&&report.onlyExpectedAppAdded?'SUBSCRIBED_READBACK_VERIFIED':'SUBSCRIPTION_POSTSTATE_UNQUALIFIED';
  return report;
 }catch(e){return {...report,status:['TOKEN_APP_ID_UNQUALIFIED','TOKEN_APP_ID_MISMATCH','EXACT_TEST_PHONE_REQUIRED','SUBSCRIPTION_SNAPSHOT_UNQUALIFIED','META_BODY_REQUIRED','META_BODY_TOO_LARGE','META_JSON_REQUIRED','META_HTTP_DENIED','META_TRANSPORT_FAILED'].includes(e.message)?e.message:'SUBSCRIPTION_OPERATION_FAILED'};}
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 const inspect=process.argv.length===3&&process.argv[2]==='--inspect-token-app';
 const report=await subscribeIsolatedTestWaba({token:process.env.META_ACCESS_TOKEN,apply:process.argv.length===3&&process.argv[2]===APPLY,inspectTokenAppOnly:inspect,onWriteStart:()=>console.log('MUSITU_TEST_WABA_WRITE_STARTED='+JSON.stringify({appId:APP,wabaId:WABA,phoneId:PHONE,method:'POST',noCallbackOverride:true,noSend:true}))});
 const result={observedAt:new Date().toISOString(),...report,noSendAttempted:true,noCallbackOverride:true};
 writeFileSync('public/meta-waba-subscription.json',JSON.stringify(result,null,2));console.log('MUSITU_TEST_WABA_SUBSCRIPTION='+JSON.stringify(result));
 if(!['SUBSCRIBED_READBACK_VERIFIED','ALREADY_SUBSCRIBED_NO_WRITE',...(inspect?['TOKEN_APP_ID_VERIFIED_NO_WRITE','TOKEN_APP_ID_MISMATCH']:[])].includes(result.status))process.exitCode=1;
}
