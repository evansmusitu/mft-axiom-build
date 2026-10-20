import {createHash,randomUUID} from 'node:crypto';
import {encryptLedger,decryptLedger} from '../security/ledger-encryption.mjs';
import {buildMetaTextSubmission,classifyMetaSendOutcome} from '../adapters/meta-send-protocol.mjs';
const TENANT='986eb904-7296-46a9-9e9b-94074db9b547',OWNER='395558180472062118',APP='1096094346481018',WABA='1955690452095441',PHONE='1292923853915392';
const BASE='https://graph.facebook.com/v25.0/';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha=s=>createHash('sha256').update(s).digest('hex');
const fail=code=>{throw Error(code);};
const KEYS=new Set(['tenantId','actorId','conversationId','messageId','requestKey','body','approveText','confirmOwnNumber','recheckSession']);
/** Private owner self-test only. A committed UNKNOWN reservation is consumed
 * even if this process dies before submission. It must never be retried.
 * No timer, queue, template, arbitrary destination or public sending release. */
export function createDevelopmentReplySender({scoped,token,enabled=false,contentKey,recipientSha256,request=fetch}={}){
 if(typeof scoped!=='function'||typeof request!=='function')fail('DEVELOPMENT_SENDER_CONFIG_REQUIRED');
 async function call(path,submission){
  const controller=new AbortController();let reader;
  const timer=setTimeout(()=>{controller.abort();reader?.cancel().catch(()=>{});},8000);
  try{
   const response=await request(BASE+path,{method:submission?'POST':'GET',redirect:'error',headers:{authorization:'Bearer '+token,accept:'application/json',...(submission?{'content-type':'application/json'}:{})},...(submission?{body:JSON.stringify(submission)}:{}),signal:controller.signal});
   if(!response.body)fail('META_RESPONSE_UNAVAILABLE');reader=response.body.getReader();let size=0;const parts=[];
   for(;;){const{done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>16384)fail('META_RESPONSE_UNAVAILABLE');parts.push(Buffer.from(value));}
   if(controller.signal.aborted)fail('META_RESPONSE_UNAVAILABLE');
   const body=JSON.parse(Buffer.concat(parts).toString('utf8'));return{httpStatus:response.status,body};
  }catch{fail('META_RESPONSE_UNAVAILABLE');}
  finally{clearTimeout(timer);await reader?.cancel().catch(()=>{});}
 }
 return async input=>{
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!KEYS.has(k))||input.tenantId!==TENANT||input.actorId!==OWNER||!UUID.test(input.conversationId??'')||typeof input.messageId!=='string'||!/^wamid\.[A-Za-z0-9._~-]{1,180}$/.test(input.messageId)||typeof input.requestKey!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(input.requestKey)||typeof input.body!=='string'||!input.body.trim()||Buffer.byteLength(input.body)>1000||input.body.includes('\u0000')||input.approveText!==true||input.confirmOwnNumber!==true||typeof input.recheckSession!=='function')fail('DEVELOPMENT_REPLY_REJECTED');
  if(enabled!==true||!Buffer.isBuffer(contentKey)||contentKey.length!==32||typeof recipientSha256!=='string'||!/^[a-f0-9]{64}$/.test(recipientSha256)||typeof token!=='string'||!/^EAA[A-Za-z0-9_-]{30,}$/.test(token))fail('DEVELOPMENT_SENDING_DISABLED');
  await input.recheckSession();
  const app=await call('app?fields=id');
  if(app.httpStatus===401)fail('META_CREDENTIAL_REJECTED');if(app.httpStatus===403)fail('META_ACCESS_DENIED');
  if(app.httpStatus!==200||app.body?.id!==APP)fail('META_APP_ID_REJECTED');
  const phones=await call(WABA+'/phone_numbers?fields=id');
  if(phones.httpStatus===401)fail('META_CREDENTIAL_REJECTED');if(phones.httpStatus===403)fail('META_ACCESS_DENIED');
  if(phones.httpStatus!==200||phones.body?.paging?.next||!Array.isArray(phones.body?.data)||phones.body.data.length!==1||phones.body.data[0]?.id!==PHONE)fail('META_TEST_PHONE_REJECTED');
  await input.recheckSession();
  const attemptId=randomUUID(),bodyDigest=sha(input.body),encryptedBody=encryptLedger(input.body,contentKey,[TENANT,PHONE,attemptId]);
  // scoped() must COMMIT before resolving. An uncertain commit also prevents
  // a provider POST here; the unique reservation prevents any future replay.
  const r=await scoped(TENANT,OWNER,['OWNER'],async c=>(await c.query('SELECT musitu.reserve_development_reply($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result',[OWNER,input.conversationId,input.messageId,input.requestKey,attemptId,encryptedBody,bodyDigest,true,true])).rows[0]?.result);
  if(!r||typeof r.admitted!=='boolean'||!UUID.test(r.attemptId??''))fail('DEVELOPMENT_RESERVATION_REJECTED');
  const safe={tenantId:TENANT,attemptId:r.attemptId,automaticRetry:false};
  if(!r.admitted)return{...safe,status:['UNKNOWN','ACCEPTED','DELIVERED','FAILED'].includes(r.status)?r.status:'UNKNOWN',idempotent:true};
  let recipient,approvedBody;
  try{
   if(r.attemptId!==attemptId||r.phoneNumberId!==PHONE||!/^hmac256:[a-f0-9]{64}$/.test(r.recipientHash??''))throw Error();
   recipient=decryptLedger(r.encryptedRecipient,contentKey,[TENANT,PHONE,'contact:'+r.recipientHash]);
   approvedBody=decryptLedger(r.encryptedBody,contentKey,[TENANT,PHONE,attemptId]);
   if(!/^[0-9]{6,20}$/.test(recipient)||sha(recipient)!==recipientSha256||sha(approvedBody)!==r.bodyDigest||r.bodyDigest!==bodyDigest||approvedBody!==input.body)throw Error();
  }catch{fail('DEVELOPMENT_BINDING_REJECTED');}
  const payload=buildMetaTextSubmission({graphVersion:'v25.0',phoneNumberId:PHONE,recipientWaId:recipient,body:approvedBody});
  let outcome={status:'UNKNOWN',providerMessageId:null,automaticRetry:false},httpStatus=null;
  try{const response=await call(PHONE+'/messages',payload.body);httpStatus=response.httpStatus;outcome=classifyMetaSendOutcome({httpStatus,response:response.body,expectedRecipient:recipient});}catch{/* Unknown means consumed, never retry. */}
  const status=outcome.status==='REJECTED'?'FAILED':outcome.status;
  try{
   await scoped(TENANT,OWNER,['OWNER'],async c=>(await c.query('SELECT musitu.complete_development_reply($1,$2,$3,$4,$5) AS result',[OWNER,attemptId,status,outcome.providerMessageId,httpStatus])).rows[0]?.result);
  }catch{return{...safe,status:'UNKNOWN',outcomeRecorded:false,idempotent:false};}
  return{...safe,status,outcomeRecorded:true,idempotent:false};
 };
}
