import {createHash,createPrivateKey,createPublicKey,timingSafeEqual,sign,verify} from 'node:crypto';
import {DurableMailFabric} from '../durable/fabric.mjs';
import {createResendProvider,createPostalProvider} from '../providers.mjs';
import {processResendWebhook,WebhookVerificationError} from '../webhooks/resend.mjs';
import {PolicyRejection} from '../policy.mjs';
import {SenderRegistry,SenderVerificationError} from '../security/sender-ownership.mjs';
import {verifyLiveRelease} from '../security/release-authorization.mjs';
import {assessTenantHealth} from '../ops/health.mjs';
import {addOperatorSuppression} from '../ops/operator-suppression.mjs';

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
 if(!receiveOnly&&env.MMF_REAL_SEND_ENABLED==='true'){
   verifyLiveRelease(env);
   // Dual approvals authorize network attempts only when there is at least
   // a locally configured, authenticated Resend feedback path. This is a
   // necessary preflight, NOT proof that a real webhook is registered.
   // Postal lacks a verified inbound event authentication adapter here,
   // so it must not enter commercial live-send mode yet.
   if(env.MMF_PROVIDER!=='resend'||env.MMF_WEBHOOK_ENABLED!=='true'||
      typeof env.MMF_WEBHOOK_SECRET!=='string'||
      !/^whsec_[A-Za-z0-9+/=_-]{32,}$/.test(env.MMF_WEBHOOK_SECRET)||
      Buffer.from(env.MMF_WEBHOOK_SECRET.slice(6).replace(/-/g,'+').replace(/_/g,'/'),'base64').length<24)
     throw Error('LIVE_PROVIDER_FEEDBACK_NOT_QUALIFIED');
 }
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
 const perMinute=env.MMF_MINUTE_SEND_LIMIT===undefined?20:Number(env.MMF_MINUTE_SEND_LIMIT);
 if(!Number.isSafeInteger(perMinute)||perMinute<1||perMinute>1000)throw Error('INVALID_MINUTE_RATE_LIMIT');
 const maxAgeSeconds=env.MMF_MAX_QUEUED_AGE_SECONDS===undefined?86400:Number(env.MMF_MAX_QUEUED_AGE_SECONDS);
 if(!Number.isSafeInteger(maxAgeSeconds)||maxAgeSeconds<60||maxAgeSeconds>604800)throw Error('INVALID_QUEUE_TTL');
 const perRecipient=env.MMF_DAILY_RECIPIENT_LIMIT===undefined?20:Number(env.MMF_DAILY_RECIPIENT_LIMIT);
 if(!Number.isSafeInteger(perRecipient)||perRecipient<1||perRecipient>10000)throw Error('INVALID_RECIPIENT_QUOTA');
 const config={tenantId:env.MMF_TENANT_ID,verifiedDomains:[env.MMF_FROM_DOMAIN],allowedRegions:['us-east-1'],provider,dailySendLimit:configuredLimit,dailyRecipientLimit:perRecipient,minuteSendLimit:perMinute,maxQueuedAgeMs:maxAgeSeconds*1000};
 return new DurableMailFabric(config,{db:env.MMF_DB,encryptionKey:enc,privacyKey:privacy,keys});
}
/** Isolated Cloudflare Worker entrypoint: no auto-deploy or public hostname. */
export function createWorker({providerFactory}={}){
 return {
  async fetch(request,env){
   const url=new URL(request.url);
   if(request.method==='GET'&&url.pathname==='/health')return respond({service:'MUSITU Mail Fabric',mode:'restricted'});
   if(request.method==='GET'&&url.pathname==='/v1/ops/health'){
    // Separate operator permission: no delivery flag, provider, or customer API credentials
    // required to observe a paused service. Disabled unless explicitly enabled.
    if(env?.MMF_DIAGNOSTICS_ENABLED!=='true')return respond({error:'NOT_FOUND'},404);
    if(!authorized(request,env.MMF_OPERATOR_TOKEN))return respond({error:'UNAUTHORIZED'},401);
    try{
     const report=await assessTenantHealth(env.MMF_DB,{tenantId:env.MMF_TENANT_ID});
     return respond(report);
    }catch{return respond({error:'OPERATIONAL_STORE_UNAVAILABLE'},503);}
   }
   if(request.method==='POST'&&url.pathname==='/v1/operator/senders/revoke'){
    // Emergency kill-switch for ONE configured sender domain and tenant.
    // Available even when outbound API and customer sending are paused.
    if(env?.MMF_SENDER_REVOKE_API_ENABLED!=='true')return respond({error:'NOT_FOUND'},404);
    if(typeof env.MMF_OPERATOR_TOKEN!=='string'||env.MMF_OPERATOR_TOKEN.length<32||
       env.MMF_OPERATOR_TOKEN===env.MMF_AUTH_TOKEN)return respond({error:'OPERATOR_CONFIG_UNAVAILABLE'},503);
    if(!authorized(request,env.MMF_OPERATOR_TOKEN))return respond({error:'UNAUTHORIZED'},401);
    if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))
      return respond({error:'UNSUPPORTED_MEDIA_TYPE'},415);
    const declared=request.headers.get('content-length');
    if(declared!==null&&Number(declared)>300)return respond({error:'PAYLOAD_TOO_LARGE'},413);
    let raw;
    try{
      const reader=request.body?.getReader();
      if(!reader)return respond({error:'INVALID_JSON'},400);
      const chunks=[];let total=0;
      try{for(;;){
        const {value,done}=await reader.read();if(done)break;
        total+=value.byteLength;if(total>300){await reader.cancel().catch(()=>{});return respond({error:'PAYLOAD_TOO_LARGE'},413);}
        chunks.push(value);
      }}finally{try{reader.releaseLock()}catch{}}
      raw=Buffer.concat(chunks,total).toString('utf8');
    }catch{return respond({error:'INVALID_JSON'},400);}
    let body;
    try{body=JSON.parse(raw);}catch{return respond({error:'INVALID_JSON'},400);}
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==2||
       body.domain!==env.MMF_FROM_DOMAIN||body.confirm!=='REVOKE_SENDER'||
       !Object.hasOwn(body,'domain')||!Object.hasOwn(body,'confirm'))
      return respond({error:'INVALID_REVOCATION_REQUEST'},422);
    try{
      const sender=new SenderRegistry({db:env.MMF_DB,tenantId:env.MMF_TENANT_ID});
      const result=await sender.revoke(body.domain);
      if(result?.revoked!==true||await sender.isVerified(body.domain)!==false)
        throw Error('SENDER_REVOCATION_UNVERIFIED');
      return respond({revoked:true});
    }catch{return respond({error:'SENDER_REVOCATION_UNAVAILABLE'},503);}
   }
   if(request.method==='POST'&&url.pathname==='/v1/operator/suppressions'){
    // Dedicated operator capability, independent of customer API credentials.
    // No public listing or deletion route. Must also work while mail is paused.
    if(env?.MMF_SUPPRESSION_API_ENABLED!=='true')return respond({error:'NOT_FOUND'},404);
    if(typeof env.MMF_OPERATOR_TOKEN!=='string'||env.MMF_OPERATOR_TOKEN.length<32||
       env.MMF_OPERATOR_TOKEN===env.MMF_AUTH_TOKEN)return respond({error:'OPERATOR_CONFIG_UNAVAILABLE'},503);
    if(!authorized(request,env.MMF_OPERATOR_TOKEN))return respond({error:'UNAUTHORIZED'},401);
    const rawLimit=env.MMF_OPERATOR_DAILY_SUPPRESSION_LIMIT;
    const dailyLimit=rawLimit===undefined?200:Number(rawLimit);
    if(!Number.isSafeInteger(dailyLimit)||dailyLimit<1||dailyLimit>5000)
      return respond({error:'OPERATOR_CONFIG_UNAVAILABLE'},503);
    if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))
      return respond({error:'UNSUPPORTED_MEDIA_TYPE'},415);
    const declared=request.headers.get('content-length');
    if(declared!==null&&Number(declared)>1024)return respond({error:'PAYLOAD_TOO_LARGE'},413);
    let raw;
    try{
      // Stream-read with a hard cap, avoiding unbounded request.text() allocation.
      const reader=request.body?.getReader();
      if(!reader)return respond({error:'INVALID_JSON'},400);
      const chunks=[];let total=0;
      try{for(;;){
        const {value,done}=await reader.read();if(done)break;
        total+=value.byteLength;if(total>1024){await reader.cancel().catch(()=>{});return respond({error:'PAYLOAD_TOO_LARGE'},413);}
        chunks.push(value);
      }}finally{try{reader.releaseLock()}catch{}}
      raw=Buffer.concat(chunks,total).toString('utf8');
    }catch{return respond({error:'INVALID_JSON'},400);}
    let parsed;
    try{parsed=JSON.parse(raw);}
    catch{return respond({error:'INVALID_JSON'},400);}
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||
       Object.keys(parsed).length!==1||!Object.hasOwn(parsed,'recipient'))
      return respond({error:'INVALID_OPERATOR_REQUEST'},422);
    try{
      const outcome=await addOperatorSuppression(env.MMF_DB,{
        tenantId:env.MMF_TENANT_ID,recipient:parsed.recipient,dailyLimit,
        privacyKeyBase64:env.MMF_PRIVACY_KEY_B64});
      return respond(outcome,outcome.created?201:200);
    }catch(err){
      if(err instanceof PolicyRejection&&err.code==='INVALID_ADDRESS')
        return respond({error:'INVALID_RECIPIENT'},422);
      if(err?.message==='OPERATOR_SUPPRESSION_QUOTA_EXCEEDED')
        return respond({error:'OPERATOR_SUPPRESSION_QUOTA_EXCEEDED'},429);
      return respond({error:'SUPPRESSION_STORE_UNAVAILABLE'},503);
    }
   }
   if(request.method==='POST'&&url.pathname==='/v1/webhooks/resend'){
    if(!env?.MMF_WEBHOOK_SECRET||!env?.MMF_WEBHOOK_ENABLED||env.MMF_WEBHOOK_ENABLED!=='true')return respond({error:'SERVICE_UNAVAILABLE'},503);
    try{
     const raw=await request.text();if(Buffer.byteLength(raw,'utf8')>65536)return respond({error:'PAYLOAD_TOO_LARGE'},413);
     const fab=fromEnv(env,providerFactory,{receiveOnly:true});
     const r=await processResendWebhook(fab,raw,request.headers,{secret:env.MMF_WEBHOOK_SECRET,strictRecipient:true});
     return respond({accepted:true,recorded:r.recorded},202);
    }catch(e){
      if(e instanceof WebhookVerificationError)return respond({error:'WEBHOOK_AUTH_FAILED'},401);
      if(e instanceof TypeError&&e.message==='INVALID_WEBHOOK_EVENT')return respond({error:'INVALID_WEBHOOK'},400);
      if(e instanceof TypeError&&e.message==='INVALID_WEBHOOK_RECIPIENT')return respond({error:'INVALID_WEBHOOK_RECIPIENT'},400);
      if(e?.message==='PROVIDER_RECIPIENT_MISMATCH')return respond({error:'PROVIDER_RECIPIENT_MISMATCH'},422);
      if(e?.message==='PROVIDER_CORRELATION_PENDING')return respond({error:'PROVIDER_CORRELATION_PENDING'},503);
      if(e?.message==='WEBHOOK_ID_CONFLICT')return respond({error:'WEBHOOK_ID_CONFLICT'},409);
      return respond({error:'WEBHOOK_PROCESSING_UNAVAILABLE'},503);
    }
   }
   if(env?.MMF_API_ENABLED!=='true')return respond({error:'SERVICE_UNAVAILABLE'},503);
   if(!authorized(request,env.MMF_AUTH_TOKEN))return respond({error:'UNAUTHORIZED'},401);
   if(request.method!=='POST'&&request.method!=='GET')return respond({error:'METHOD_NOT_ALLOWED'},405);
   if(url.pathname.startsWith('/v1/senders/')&&request.method==='POST'){
    try{
     const tenant=String(env.MMF_TENANT_ID||''),domain=String(env.MMF_FROM_DOMAIN||'');
     const registry=new SenderRegistry({db:env.MMF_DB,tenantId:tenant});
     if(url.pathname==='/v1/senders/challenge')return respond(await registry.issue(domain),201);
     if(url.pathname==='/v1/senders/verify')return respond(await registry.verify(domain));
    }catch(e){if(e instanceof SenderVerificationError)return respond({error:e.code},e.code==='DNS_UNAVAILABLE'?503:e.code==='CHALLENGE_EXPIRED'?410:422);
      return respond({error:'SERVICE_UNAVAILABLE'},503);}
   }
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
     if(env.MMF_REAL_SEND_ENABLED==='true'){
      const registry=new SenderRegistry({db:env.MMF_DB,tenantId:env.MMF_TENANT_ID});
      if(!await registry.isVerified(String(env.MMF_FROM_DOMAIN||'')))return respond({error:'SENDER_NOT_VERIFIED'},403);
     }
     const result=await fab.enqueue({...input,tenantId:env.MMF_TENANT_ID});
     let queued=false;
     try{if(env.MMF_QUEUE?.send){await env.MMF_QUEUE.send({tenantId:env.MMF_TENANT_ID,messageId:result.messageId});queued=true;}}catch{}// Durable cron repairs lost queue notification.
     return respond({...result,queueNotificationAccepted:queued},202);
    }catch(e){if(e instanceof PolicyRejection)return respond({error:e.code},['QUOTA_EXCEEDED','RATE_LIMIT_EXCEEDED'].includes(e.code)?429:422);
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
   if(env?.MMF_REAL_SEND_ENABLED==='true'){
    try{const reg=new SenderRegistry({db:env.MMF_DB,tenantId:env.MMF_TENANT_ID});if(!await reg.isVerified(String(env.MMF_FROM_DOMAIN||''))){for(const m of batch.messages)m.ack();return;}}
    catch{for(const m of batch.messages)m.retry();return;}
   }
   let fab;try{fab=fromEnv(env,providerFactory);}catch(e){for(const m of batch.messages)m.retry();return;}
   for(const m of batch.messages){
    const body=m.body;
    if(!body||body.tenantId!==env.MMF_TENANT_ID||typeof body.messageId!=='string'||!UUID.test(body.messageId)){m.ack();continue;}
    try{await fab.processById(body.messageId);m.ack();}catch{m.retry();}
   }
  },
  async scheduled(_controller,env){
   if(env?.MMF_REAL_SEND_ENABLED==='true'){
    try{const reg=new SenderRegistry({db:env.MMF_DB,tenantId:env.MMF_TENANT_ID});if(!await reg.isVerified(String(env.MMF_FROM_DOMAIN||'')))return {status:'SENDER_NOT_VERIFIED'};}
    catch{return {status:'SENDER_CHECK_UNAVAILABLE'};}
   }
   let fab;try{fab=fromEnv(env,providerFactory);}catch{return {status:'DISABLED'};}
   const expired=await fab.reconcileExpired();let processed=0;
   for(;processed<25;processed++){const row=await fab.processNext();if(!row)break;}
   return {status:'OK',expired,processed};
  }
 };
}
export default createWorker();
