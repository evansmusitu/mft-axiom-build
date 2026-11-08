import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const BASE='https://graph.facebook.com/v25.0/';
const TEST_WABA='1955690452095441',TEST_PHONE='1292923853915392';
const EXCLUDED_WABA='2701086983679304';
const SCOPES=['whatsapp_business_management','whatsapp_business_messaging'];
const fail=(code,details)=>{const error=Error(code);if(details)error.qualificationDetails=details;throw error;};
const safeError=(operation,result)=>({operation,httpStatus:result.status,...(Number.isSafeInteger(result.body?.error?.code)?{providerErrorCode:result.body.error.code}:{})});

/** Read-only qualification of the app-specific development grant. No sends,
 * subscriptions, account mutations, retries, customer records or raw logging.
 * The excluded-account probe requests IDs only and must be denied by Meta.
 */
export async function qualifyMetaDevelopmentToken({token,request=fetch}={}){
 if(typeof token!=='string'||!/^EAA[A-Za-z0-9_-]{30,}$/.test(token)||typeof request!=='function')fail('META_TOKEN_REQUIRED');
 const results=[];
 async function read(path){
  let response;
  try{response=await request(BASE+path,{method:'GET',headers:{authorization:'Bearer '+token,accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(8000)});}
  catch{fail('META_READ_TRANSPORT_FAILED');}
  if(!response.body)fail('META_READ_BODY_REQUIRED');
  let length=0,reader=response.body.getReader();const parts=[];
  try{
   for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>16384)fail('META_READ_BODY_TOO_LARGE');parts.push(Buffer.from(value));}
  }finally{await reader.cancel().catch(()=>{});}
  let body;try{body=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{fail('META_READ_JSON_REQUIRED');}
  return {status:response.status,body};
 }
 const phones=await read(TEST_WABA+'/phone_numbers?fields=id');
 if(phones.status!==200||!Array.isArray(phones.body?.data)||phones.body.data.length!==1||phones.body.data[0]?.id!==TEST_PHONE)fail('META_TEST_PHONE_BINDING_NOT_QUALIFIED',safeError('GET_TEST_WABA_PHONE_IDS',phones));
 results.push({operation:'GET_TEST_WABA_PHONE_IDS',httpStatus:phones.status,wabaId:TEST_WABA,expectedPhoneId:TEST_PHONE,pass:true});

 const permissions=await read('me/permissions');
 if(permissions.status!==200||!Array.isArray(permissions.body?.data)||!SCOPES.every(scope=>permissions.body.data.some(x=>x.permission===scope&&x.status==='granted')))fail('META_REQUIRED_SCOPES_NOT_QUALIFIED',safeError('GET_GRANTED_PERMISSION_NAMES',permissions));
 results.push({operation:'GET_GRANTED_PERMISSION_NAMES',httpStatus:permissions.status,requiredScopes:SCOPES,pass:true});

 const excluded=await read(EXCLUDED_WABA+'/phone_numbers?fields=id');
 if(![400,403].includes(excluded.status)||![10,100,200,803].includes(excluded.body?.error?.code))fail('META_EXCLUDED_ACCOUNT_DENIAL_NOT_QUALIFIED',safeError('GET_EXCLUDED_WABA_PHONE_IDS_DENIED',excluded));
 results.push({operation:'GET_EXCLUDED_WABA_PHONE_IDS_DENIED',httpStatus:excluded.status,providerErrorCode:excluded.body.error.code,wabaId:EXCLUDED_WABA,pass:true});
 return {runId:randomUUID(),observedAt:new Date().toISOString(),scope:'GENUINE_META_GRAPH_READ_ONLY_NO_SEND_OR_CALLBACK',appId:'1096094346481018',graphVersion:'v25.0',pass:results.length,fail:0,results};
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 try{const result=await qualifyMetaDevelopmentToken({token:process.env.META_ACCESS_TOKEN});for(const row of result.results)console.log('MUSITU_META_READ_CASE='+JSON.stringify(row));const {results,...summary}=result;console.log('MUSITU_META_READ_QUALIFICATION='+JSON.stringify(summary));}
 catch(error){const known=new Set(['META_TOKEN_REQUIRED','META_READ_TRANSPORT_FAILED','META_READ_BODY_REQUIRED','META_READ_BODY_TOO_LARGE','META_READ_JSON_REQUIRED','META_TEST_PHONE_BINDING_NOT_QUALIFIED','META_REQUIRED_SCOPES_NOT_QUALIFIED','META_EXCLUDED_ACCOUNT_DENIAL_NOT_QUALIFIED']);console.log('MUSITU_META_READ_FAILURE='+JSON.stringify({pass:false,code:known.has(error.message)?error.message:'META_QUALIFICATION_FAILED',details:error.qualificationDetails,noSendAttempted:true}));process.exitCode=1;}
}
