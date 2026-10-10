/** Private service-binding-only synthetic feedback qualification.
 * The sole enabled probe uses ephemeral test-generated Svix credentials.
 * Never exposes a public webhook route or carries customer mail.
 */
import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import ingress from './webhook-only.mjs';
import {createFeedbackSqlAdapter} from './feedback-rpc.mjs';
import {createFeedbackRecorder} from '../webhooks/feedback-recorder.mjs';
import {processResendWebhook} from '../webhooks/resend.mjs';
import {readBoundedWebhookBody} from '../webhooks/bounded-body.mjs';
import {syntheticStageRecipient} from './synthetic-transaction.mjs';
export {MmfStagingSqliteDO} from './sqlite-do.mjs';
const PATH='/__mmf_stage/signed-feedback';
const PROBE=/^probe-[a-z0-9-]{8,56}$/;
const H={'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:H});
const sha=t=>createHash('sha256').update(t).digest('hex');
function authorized(input,secret){
 if(typeof input!=='string'||typeof secret!=='string'||secret.length<32)return false;
 return timingSafeEqual(Buffer.from(sha(input),'hex'),Buffer.from(sha(secret),'hex'));
}
export default {
 async fetch(request,env){
  if(new URL(request.url).pathname!==PATH)return ingress.fetch(request,env);
  if(request.method!=='POST')return reply({error:'NOT_FOUND'},404);
  if(env?.MMF_STAGE_ONLY!=='true'||env.MMF_API_ENABLED!=='false'||
     env.MMF_REAL_SEND_ENABLED!=='false'||env.MMF_WEBHOOK_ENABLED!=='false'||
     env.MMF_PRIVATE_BRIDGE_TEST_ENABLED!=='true'||env.MMF_OUTBOX_LINK_ENABLED!=='true'||
     env.MMF_TENANT_ID!=='stage-tenant'||!env.MMF_OUTBOX||env.MMF_OUTBOX===env.MMF_RECEIPTS)
    return reply({error:'STAGING_BRIDGE_DISABLED'},503);
  if(!authorized(request.headers.get('x-mmf-stage-probe'),env.MMF_PRIVATE_BRIDGE_TEST_SECRET))
    return reply({error:'UNAUTHORIZED'},401);
  const bounded=await readBoundedWebhookBody(request,{maxBytes:400});
  if(bounded.error)return reply({error:bounded.error},bounded.status);
  let body;
  try{body=JSON.parse(bounded.raw);}catch{return reply({error:'INVALID_JSON'},400)}
  if(!body||typeof body!=='object'||Array.isArray(body)||
      Object.keys(body).length!==1||typeof body.probeId!=='string'||!PROBE.test(body.probeId))
   return reply({error:'INVALID_PROBE'},422);
  try{
   const probeId=body.probeId;
   const adapter=createFeedbackSqlAdapter(env.MMF_OUTBOX,env.MMF_OUTBOX_FEEDBACK_SECRET);
   const recorder=createFeedbackRecorder({db:adapter,tenantId:'stage-tenant'});
   const testSecret='whsec_'+randomBytes(32).toString('base64');
   const svixKey=Buffer.from(testSecret.slice(6),'base64');
   const timestamp=String(Math.floor(Date.now()/1000));
   const providerId='synthetic_'+probeId;
   const signed=(to,id)=>{
    const raw=JSON.stringify({type:'email.bounced',created_at:new Date().toISOString(),data:{
      email_id:providerId,to:[to]}});
    const signature=createHmac('sha256',svixKey).update(id+'.'+timestamp+'.'+raw).digest('base64');
    return{raw,headers:{'svix-id':id,'svix-timestamp':timestamp,'svix-signature':'v1,'+signature}};
   };
   const wrong=signed('wrong-synthetic@example.net','svix-wrong-'+probeId);
   let mismatched=false;
   try{await processResendWebhook(recorder,wrong.raw,wrong.headers,{secret:testSecret,strictRecipient:true});}
   catch(error){if(error?.message==='PROVIDER_RECIPIENT_MISMATCH')mismatched=true;else throw error}
   if(!mismatched)throw Error('TEST_WRONG_RECIPIENT_NOT_REJECTED');
   const event=signed(syntheticStageRecipient(probeId),'svix-valid-'+probeId);
   const recorded=await processResendWebhook(recorder,event.raw,event.headers,{secret:testSecret,strictRecipient:true});
   const replay=await processResendWebhook(recorder,event.raw,event.headers,{secret:testSecret,strictRecipient:true});
   if(recorded?.recorded!==true||replay?.reason!=='DUPLICATE_EVENT'||replay?.recorded!==false)
    throw Error('TEST_EVENT_REPLAY_UNVERIFIED');
   const evidence=await adapter.prepare('SELECT * FROM mail_provider_events WHERE tenant_id=? AND svix_id=?')
     .bind('stage-tenant','svix-valid-'+probeId).first();
   if(evidence?.kind!=='email.bounced'||evidence?.provider_id!==providerId)
     throw Error('TEST_DURABILITY_UNVERIFIED');
   return reply({status:'PASS',probeSha256:sha(probeId),wrongRecipientRejected:true,
    signedEventRecorded:true,duplicateIdempotent:true,
    providerWasSimulation:true,realProviderEventReceived:false,
    customerMailSent:false,publicAccess:false,
    distinctIngressSenderKeyCustody:true});
  }catch{return reply({error:'PRIVATE_BRIDGE_TEST_UNAVAILABLE'},503);}
 }
};
