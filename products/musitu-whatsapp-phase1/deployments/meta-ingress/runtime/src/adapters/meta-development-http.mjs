import {createHash,timingSafeEqual} from 'node:crypto';
const deniedEvents=new Set(['INVALID_META_JSON','INVALID_META_WEBHOOK','INVALID_META_STATUS','INVALID_META_TIMESTAMP','UNAUTHORIZED_CHANNEL','UNAUTHORIZED_TENANT','UNSUPPORTED_META_CHANGE','MIXED_META_EVENT_TYPES','WEBHOOK_EVENT_LIMIT','MULTI_TENANT_BATCH_DENIED','CONFLICTING_DUPLICATE_MESSAGE','STATUS_REPLAY_CONFLICT','STATUS_STATE_CONFLICT','STATUS_UPDATE_CONFLICT','UNKNOWN_OR_UNBOUND_OUTBOUND','MESSAGE_SENDER_OR_CONTENT_CONFLICT','DEVELOPMENT_RECIPIENT_NOT_ALLOWED']);
const reply=(text,status)=>new Response(text,{status,headers:{'cache-control':'no-store','content-type':'text/plain; charset=utf-8','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-frame-options':'DENY'}});
const digest=s=>createHash('sha256').update(s).digest();
/** Official callback boundary only. Never sends, calls a model or grants release. */
export function createDevelopmentMetaHandler({getIngress,getVerifyToken,maxBytes=262144,bodyTimeoutMs=5000,persistenceTimeoutMs=15000}={}){
 if(typeof getIngress!=='function'||typeof getVerifyToken!=='function'||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>262144||![bodyTimeoutMs,persistenceTimeoutMs].every(n=>Number.isSafeInteger(n)&&n>0&&n<=30000))throw Error('META_HTTP_CONFIG_REJECTED');
 return async req=>{
  if(!['GET','POST'].includes(req.method))return reply('METHOD_NOT_ALLOWED',405);
  if(req.method==='GET'){
   try{
    getIngress();
    const token=getVerifyToken();if(typeof token!=='string'||token.length<32||token.length>256)throw Error('META_VERIFY_TOKEN_REJECTED');
    const p=new URL(req.url).searchParams;
    if(p.size!==3||['hub.mode','hub.verify_token','hub.challenge'].some(k=>p.getAll(k).length!==1))return reply('INVALID_VERIFY_REQUEST',400);
    if(p.get('hub.mode')!=='subscribe'||!timingSafeEqual(digest(p.get('hub.verify_token')||''),digest(token)))return reply('FORBIDDEN',403);
    const challenge=p.get('hub.challenge');if(!/^[A-Za-z0-9_.~-]{1,256}$/.test(challenge||''))return reply('INVALID_CHALLENGE',400);
    return reply(challenge,200);
   }catch{return reply('DEVELOPMENT_CHANNEL_UNAVAILABLE',503);}
  }
  if(!/^application\/json(?:;\s*charset=utf-8)?$/i.test(req.headers.get('content-type')||''))return reply('UNSUPPORTED_MEDIA_TYPE',415);
  const signature=req.headers.get('x-hub-signature-256');
  if(!/^sha256=[a-fA-F0-9]{64}$/.test(signature||''))return reply('SIGNATURE_REJECTED',401);
  const length=req.headers.get('content-length');
  if(length!==null&&(!/^\d+$/.test(length)||Number(length)>maxBytes))return reply('BODY_TOO_LARGE',413);
  if(!req.body)return reply('BODY_REQUIRED',400);
  let reader,bodyTimer,persistenceTimer;
  try{
   reader=req.body.getReader();
   const read=async()=>{let size=0;const parts=[];for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes)throw Error('BODY_TOO_LARGE');parts.push(Buffer.from(value));}if(size===0)throw Error('EMPTY_BODY');return Buffer.concat(parts);};
   const rawBody=await Promise.race([read(),new Promise((_,reject)=>{bodyTimer=setTimeout(()=>reject(Error('BODY_TIMEOUT')),bodyTimeoutMs);})]);
   clearTimeout(bodyTimer);
   const ingress=getIngress();
   await Promise.race([ingress.ingest({rawBody,signature}),new Promise((_,reject)=>{persistenceTimer=setTimeout(()=>reject(Error('PERSISTENCE_DEADLINE')),persistenceTimeoutMs);})]);
   return reply('EVENT_RECEIVED',200);
  }catch(e){
   if(e.message==='BODY_TOO_LARGE')return reply('BODY_TOO_LARGE',413);
   if(e.message==='EMPTY_BODY')return reply('EMPTY_BODY',400);
   if(e.message==='BODY_TIMEOUT')return reply('BODY_TIMEOUT',408);
   if(e.message==='INVALID_META_SIGNATURE')return reply('SIGNATURE_REJECTED',401);
   if(deniedEvents.has(e.message))return reply('INVALID_OR_UNAUTHORIZED_EVENT',422);
   // A timeout does not establish rollback. Persistent replay guards handle retries.
   return reply('EVENT_REJECTED_OR_PERSISTENCE_UNAVAILABLE',503);
  }finally{clearTimeout(bodyTimer);clearTimeout(persistenceTimer);reader?.cancel().catch(()=>{});}
 };
}
