import {pathToFileURL} from 'node:url';
import {writeFileSync} from 'node:fs';
import {createDevelopmentReplySender} from '../src/staging/development-reply.mjs';
import {readBoundedJson} from '../src/security/bounded-request.mjs';

const BOUNDARY='PREFLIGHT_DB_BOUNDARY_REACHED_NO_MUTATION';
const KNOWN=new Set(['DEVELOPMENT_REPLY_REJECTED','DEVELOPMENT_SENDING_DISABLED','META_RESPONSE_UNAVAILABLE','META_CREDENTIAL_REJECTED','META_ACCESS_DENIED','META_APP_ID_REJECTED','META_TEST_PHONE_REJECTED',BOUNDARY]);
/** Execute the actual sender's configuration and GET guards, then stop before
 * reservation. The injected DB boundary always throws. No session admission,
 * consent record, database call, provider POST, send or retry is possible. */
export async function diagnoseDevelopmentReply({env=process.env,request=fetch}={}){
 const operations=[];
 const enabled=env.META_DEVELOPMENT_SEND_ENABLED==='YES';
 const contentKey=Buffer.from(env.CONTENT_ENCRYPTION_KEY||'','base64');
 const recipientSha256=env.META_DEVELOPMENT_RECIPIENT_SHA256;
 const token=env.META_ACCESS_TOKEN;
 const configuration={enabled,contentKeyValid:contentKey.length===32,recipientAllowlistValid:typeof recipientSha256==='string'&&/^[a-f0-9]{64}$/.test(recipientSha256),tokenFormatValid:typeof token==='string'&&/^EAA[A-Za-z0-9_-]{30,}$/.test(token)};
 const sender=createDevelopmentReplySender({enabled,contentKey,recipientSha256,token,
  scoped:async()=>{throw Error(BOUNDARY);},
  request:async(url,options)=>{
   const operation=url==='https://graph.facebook.com/v25.0/app?fields=id'?'APP_ID':url==='https://graph.facebook.com/v25.0/1955690452095441/phone_numbers?fields=id'?'TEST_PHONE':null;
   if(options.method!=='GET'||!operation)throw Error('DIAGNOSTIC_WRITE_OR_TARGET_DENIED');
   const response=await request(url,options),entry={operation,httpStatus:response.status};operations.push(entry);
   if(response.status>=400){
    // Inspect an independently bounded clone. Never retain messages, trace IDs,
    // error data, response URLs or credential values in diagnostic output.
    try{
     const copy=response.clone(),headers={get:name=>name==='content-type'?(copy.headers.get(name)||'').split(';')[0].trim().toLowerCase():copy.headers.get(name)};
     const {error}=await readBoundedJson({headers,body:copy.body},{maxBytes:16384,timeoutMs:3000});
     for(const [source,target] of [['code','providerErrorCode'],['error_subcode','providerErrorSubcode']])if(Number.isSafeInteger(error?.[source])&&error[source]>=0&&error[source]<=2147483647)entry[target]=error[source];
     if(typeof error?.is_transient==='boolean')entry.providerErrorTransient=error.is_transient;
    }catch{/* Missing, malformed, oversized or late metadata never alters admission. */}
   }
   return response;
  }});
 let result;
 try{await sender({tenantId:'986eb904-7296-46a9-9e9b-94074db9b547',actorId:'395558180472062118',conversationId:'00000000-0000-4000-8000-000000000001',messageId:'wamid.DIAGNOSTIC_ONLY',requestKey:'read-only-preflight',body:'Synthetic preflight never submitted.',approveText:true,confirmOwnNumber:true,recheckSession:async()=>{}});result='UNEXPECTED_PREFLIGHT_RETURN';}
 catch(e){result=KNOWN.has(e.message)?e.message:'PREFLIGHT_FAILED';}
 return {scope:'ACTUAL_SENDER_CONFIG_AND_META_GET_GUARDS_ONLY',configuration,operations,result,preflightPassed:result===BOUNDARY,identityQualified:false,databaseQualified:false,consentRecorded:false,noSendAttempted:true};
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 const report={observedAt:new Date().toISOString(),...await diagnoseDevelopmentReply()};
 writeFileSync('public/development-reply-diagnostic.json',JSON.stringify(report,null,2));
 console.log('MUSITU_DEVELOPMENT_REPLY_DIAGNOSTIC='+JSON.stringify(report));
}
