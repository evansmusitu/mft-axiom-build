import {randomUUID,createHash} from 'node:crypto';
const appId='1096094346481018';
const secret=process.env.META_APP_SECRET;
if(typeof secret!=='string'||!/^[a-fA-F0-9]{32}$/.test(secret))throw Error('NEW_APP_SECRET_REQUIRED');
const expected='https://musitu-whatsapp-meta-receiver-20261015-pxucdj43x-evansmusitu.vercel.app/api/meta/webhook';
try{
 const response=await fetch('https://graph.facebook.com/v25.0/'+appId+'/subscriptions',{method:'GET',headers:{authorization:'Bearer '+appId+'|'+secret,accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(10000)});
 const reader=response.body.getReader();let size=0;const parts=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>16384)throw Error('META_APP_READ_BODY_TOO_LARGE');parts.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}
 let body;try{body=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw Error('META_APP_READ_JSON_REQUIRED');}
 if(response.status!==200||!Array.isArray(body.data)){
  console.log('MUSITU_META_APP_WEBHOOK_READ_FAILURE='+JSON.stringify({appId,httpStatus:response.status,providerErrorCode:Number.isSafeInteger(body?.error?.code)?body.error.code:null,providerErrorSubcode:Number.isSafeInteger(body?.error?.error_subcode)?body.error.error_subcode:null,noChangesMade:true}));process.exitCode=1;
 }else{
  const subscriptions=body.data.map(x=>({object:typeof x.object==='string'&&/^[a-z_]{1,80}$/.test(x.object)?x.object:'UNRECOGNIZED_OBJECT',callbackConfigured:typeof x.callback_url==='string'&&x.callback_url.length>0,expectedCallbackMatched:x.callback_url===expected,callbackSha256:typeof x.callback_url==='string'?createHash('sha256').update(x.callback_url).digest('hex'):null,active:typeof x.active==='boolean'?x.active:null,fields:Array.isArray(x.fields)?x.fields.map(f=>typeof f==='string'?f:f?.name).filter(f=>typeof f==='string'&&/^[a-z_]{1,80}$/.test(f)):[]}));
  console.log('MUSITU_META_APP_WEBHOOK_READ='+JSON.stringify({runId:randomUUID(),observedAt:new Date().toISOString(),appId,httpStatus:response.status,subscriptions,noChangesMade:true,scope:'GENUINE_NEW_META_APP_SUBSCRIPTION_READ_ONLY'}));
 }
}catch(error){console.log('MUSITU_META_APP_WEBHOOK_READ_FAILURE='+JSON.stringify({appId,code:['META_APP_READ_BODY_TOO_LARGE','META_APP_READ_JSON_REQUIRED'].includes(error.message)?error.message:'META_APP_READ_TRANSPORT_FAILED',noChangesMade:true}));process.exitCode=1;}
