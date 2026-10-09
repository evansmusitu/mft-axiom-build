import {createHash,createPrivateKey,createPublicKey,timingSafeEqual,sign,verify} from 'node:crypto';
import {DurableMailFabric} from '../durable/fabric.mjs';
import {createResendProvider,createPostalProvider} from '../providers.mjs';
import {processResendWebhook,WebhookVerificationError} from '../webhooks/resend.mjs';
import {PolicyRejection} from '../policy.mjs';

const HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const respond=(payload,status=200)=>new Response(JSON.stringify(payload),{status,headers:HEADERS});
const TENANT=/^[a-z][a-z0-9_-]{2,63}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function authorized(request,secret){
 if(typeof secret!=='string'||secret.length<32)return false;
 const sent=request.headers.get('authorization')||'';
 if(!sent.startsWith('Bearer '))return false;
 const a=createHash('sha256').update(sent.slice(7)).digest(),b=createHash('sha256').update(secret).digest();
 return timingSafeEqual(a,b);
}
function fromEnv(env,providerFactory,{receiveOnly=false}={}){
 if(!env?.MMF_DB?.prepare)throw Error('PERSISTENCE_UNAVAILABLE');
 if(!TENANT.test(String(env.MMF_TENANT_ID||'')))throw Error('INVALID_TENANT_CONFIG');
 if(!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(String(env.MMF_FROM_DOMAIN||'')))throw Error('INVALID_SENDER_CONFIG');
 const enc=Buffer.from(String(env.MMF_ENCRYPTION_KEY_B64||''),'base64'),privacy=Buffer.from(String(env.MMF_PRIVACY_KEY_B64||''),'base64');
 if(enc.length!==32||privacy.length<32)throw Error('KEY_MATERIAL_MISSING');
 if(!env.MMF_SIGNING_PRIVATE_KEY_PEM||!env.MMF_SIGNING_PUBLIC_KEY_PEM)throw Error('SIGNING_KEYS_MISSING');
 const keys={privateKey:createPrivateKey(env.MMF_SIGNING_PRIVATE_KEY_PEM),publicKey:createPublicKey(env.MMF_SIGNING_PUBLIC_KEY_PEM)};
 const probe=Buffer.from('MUSITU-MAIL-FABRIC-SIGNING-PAIR-CHECK');
 if(!verify(null,probe,keys.publicKey,sign(null,probe,keys.privateKey)))throw Error('SIGNING_KEY_MISMATCH');
 const provider=providerFactory?providerFactory(env):env.MMF_REAL_SEND_ENABLED==='true'
    ?env.MMF_PROVIDER==='postal'
      ?createPostalProvider({baseUrl:env.MMF_POSTAL_BASE_URL,apiKey:env.MMF_POSTAL_API_KEY,region:'us-east-1',allowNetwork:true})
      :env.MMF_PROVIDER==='resend'
        ?createResendProvider({apiKey:env.MMF_RESEND_API_KEY,region:'us-east-1',allowNetwork:true})
        :null
    :null;
 // Authenticated inbound delivery events must still be stored when outbound
 // sending is paused. Queue and scheduled processors continue to fail closed.
 if(!provider&&receiveOnly){
   const passive={name:'resend-receipt-only',region:'us-east-1',async send(){return {outcome:'unknown'}}};
   return new DurableMailFabric({tenantId:env.MMF_TENANT_ID,verifiedDomains:[env.MMF_FROM_DOMAIN],
     allowedRegions:['us-east-1'],provider:passive,dailySendLimit:100},
     {db:env.MMF_DB,encryptionKey:enc,privacyKey:privacy,keys});
 }
 if(!provider)throw Error('DELIVERY_DISABLED');
 const configuredLimit=env.MMF_DAILY_SEND_LIMIT===undefined?100:Number(env.MMF_DAILY_SEND_LIMIT);
 if(!Number.isSafeInteger(configuredLimit)||configuredLimit<1||configuredLimit>100000)throw Error('INVALID_QUOTA_CONFIGURATION');
 const config={tenantId:env.MMF_TENANT_ID,verifiedDomains:[env.MMF_FROM_DOMAIN],allowedRegions:['us-east-1'],provider,dailySendLimit:configuredLimit};
 return new DurableMailFabric(config,{db:env.MMF_DB,encryptionKey:enc,privacyKey:privacy,keys});
}
/** Isolated Cloudflare Worker entrypoint: no auto-deploy or public hostname. */
export function createWorker({providerFactory}={}){
 return {
  async fetch(request,env){
   const url=new URL(request.url);
   if(request.method==='GET'&&url.pathname==='/health')return respond({service:'MUSITU Mail Fabric',mode:'restricted'});
   if(request.method==='POST'&&url.pathname==='/v1/webhooks/resend'){
    if(!env?.MMF_WEBHOOK_SECRET||!env?.MMF_WEBHOOK_ENABLED||env.MMF_WEBHOOK_ENABLED!=='true')return respond({error:'SERVICE_UNAVAILABLE'},503);
    try{
     const raw=await request.text();if(Buffer.byteLength(raw,'utf8')>65536)return respond({error:'PAYLOAD_TOO_LARGE'},413);
     const fab=fromEnv(env,providerFactory,{receiveOnly:true});
     const r=await processResendWebhook(fab,raw,request.headers,{secret:env.MMF_WEBHOOK_SECRET});
     return respond({accepted:true,recorded:r.recorded},202);
    }catch(e){
      if(e instanceof WebhookVerificationError)return respond({error:'WEBHOOK_AUTH_FAILED'},401);
      if(e instanceof TypeError&&e.message==='INVALID_WEBHOOK_EVENT')return respond({error:'INVALID_WEBHOOK'},400);
      if(e?.message==='WEBHOOK_ID_CONFLICT')return respond({error:'WEBHOOK_ID_CONFLICT'},409);
      return respond({error:'WEBHOOK_PROCESSING_UNAVAILABLE'},503);
    }
   }
   if(env?.MMF_API_ENABLED!=='true')return respond({error:'SERVICE_UNAVAILABLE'},503);
   if(!authorized(request,env.MMF_AUTH_TOKEN))return respond({error:'UNAUTHORIZED'},401);
   if(request.method!=='POST'&&request.method!=='GET')return respond({error:'METHOD_NOT_ALLOWED'},405);
   let fab;try{fab=fromEnv(env,providerFactory);}catch{return respond({error:'SERVICE_UNAVAILABLE'},503);}
   if(url.pathname==='/v1/keys/current'&&request.method==='GET'){
    const publicKey=String(env.MMF_SIGNING_PUBLIC_KEY_PEM||'');
    const fingerprint=createHash('sha256').update(publicKey).digest('hex');
    return respond({algorithm:'Ed25519',publicKey,fingerprint,trustNote:'Pin this fingerprint through an independent authenticated channel; this endpoint alone is not a trust anchor.'});
   }
   if(url.pathname==='/v1/messages'&&request.method==='POST'){
    try{
     const raw=await request.text();if(Buffer.byteLength(raw,'utf8')>30000)return respond({error:'PAYLOAD_TOO_LARGE'},413);
     const input=JSON.parse(raw);
     const result=await fab.enqueue({...input,tenantId:env.MMF_TENANT_ID});
     let queued=false;
     try{if(env.MMF_QUEUE?.send){await env.MMF_QUEUE.send({tenantId:env.MMF_TENANT_ID,messageId:result.messageId});queued=true;}}catch{}// Durable cron repairs lost queue notification.
     return respond({...result,queueNotificationAccepted:queued},202);
    }catch(e){if(e instanceof PolicyRejection)return respond({error:e.code},e.code==='QUOTA_EXCEEDED'?429:422);
      if(e instanceof SyntaxError)return respond({error:'INVALID_JSON'},400);return respond({error:'SERVICE_UNAVAILABLE'},503);}
   }
   const proofMatch=url.pathname.match(/^\/v1\/messages\/([0-9a-f-]{36})\/evidence$/i);
   if(request.method==='GET'&&proofMatch&&UUID.test(proofMatch[1])){
    try{const result=await fab.getProviderEvidence(proofMatch[1],env.MMF_TENANT_ID);return result?respond(result):respond({error:'NOT_FOUND'},404);}catch{return respond({error:'SERVICE_UNAVAILABLE'},503);}
   }
   const match=url.pathname.match(/^\/v1\/messages\/([0-9a-f-]{36})$/i);
   if(request.method==='GET'&&match&&UUID.test(match[1])){
    try{const result=await fab.get(match[1],env.MMF_TENANT_ID);return result?respond(result):respond({error:'NOT_FOUND'},404);}catch{return respond({error:'SERVICE_UNAVAILABLE'},503);}
   }
   return respond({error:'NOT_FOUND'},404);
  },
  async queue(batch,env){
   let fab;try{fab=fromEnv(env,providerFactory);}catch(e){for(const m of batch.messages)m.retry();return;}
   for(const m of batch.messages){
    const body=m.body;
    if(!body||body.tenantId!==env.MMF_TENANT_ID||typeof body.messageId!=='string'||!UUID.test(body.messageId)){m.ack();continue;}
    try{await fab.processById(body.messageId);m.ack();}catch{m.retry();}
   }
  },
  async scheduled(_controller,env){
   let fab;try{fab=fromEnv(env,providerFactory);}catch{return {status:'DISABLED'};}
   const expired=await fab.reconcileExpired();let processed=0;
   for(;processed<25;processed++){const row=await fab.processNext();if(!row)break;}
   return {status:'OK',expired,processed};
  }
 };
}
export default createWorker();
