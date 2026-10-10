/** Isolated, offline-signed Resend-format reconciliation probe. NOT a Resend-delivered event.
 * Runs through real DurableMailFabric storage and evidence on the private stage Queue.
 */
import {randomBytes,createHmac,createHash} from 'node:crypto';
import {createSyntheticStageFabric,runSyntheticTransactionProbe} from './synthetic-transaction.mjs';
import {processResendWebhook} from '../webhooks/resend.mjs';
import {verifyProof} from '../evidence.mjs';

const RECIPIENT='synthetic-recipient@example.net';
const sha=s=>createHash('sha256').update(s).digest('hex');

export async function runSyntheticSignedFeedbackProbe(db,env,probeId){
 const {fabric,publicKey}=createSyntheticStageFabric(db,env,probeId);
 const transaction=await runSyntheticTransactionProbe(db,env,probeId);
 if(transaction.state!=='ACCEPTED_BY_PROVIDER'||transaction.providerIsSimulation!==true||transaction.customerMailSent!==false)
  throw Error('STAGE_FEEDBACK_NO_ACCEPTED_SYNTHETIC_MAIL');

 const providerId=transaction.proof.events.at(-1)?.detail?.providerId;
 if(providerId!=='synthetic_'+probeId)throw Error('STAGE_FEEDBACK_PROVIDER_ID_UNEXPECTED');
 const secret='whsec_'+randomBytes(32).toString('base64');
 const key=Buffer.from(secret.slice(6),'base64'),timestamp=String(Math.floor(Date.now()/1000));
 const makeSigned=(to,id,type='email.bounced')=>{
  const raw=JSON.stringify({type,created_at:new Date().toISOString(),data:{
   email_id:providerId,to:[to]}});
  const signature=createHmac('sha256',key).update(id+'.'+timestamp+'.'+raw).digest('base64');
  return {raw,headers:{'svix-id':id,'svix-timestamp':timestamp,'svix-signature':'v1,'+signature}};
 };
 const wrong=makeSigned('wrong-synthetic@example.net','svix-mismatch-'+probeId);
 let mismatchRejected=false;
 try{await processResendWebhook(fabric,wrong.raw,wrong.headers,{secret,strictRecipient:true});}
 catch(err){if(err?.message==='PROVIDER_RECIPIENT_MISMATCH')mismatchRejected=true;else throw err;}
 if(!mismatchRejected)throw Error('STAGE_FEEDBACK_RECIPIENT_MISMATCH_ACCEPTED');
 const absent=await db.prepare('SELECT COUNT(*) AS n FROM mail_provider_events WHERE tenant_id=? AND message_id=?')
  .bind('stage-tenant',transaction.messageId).first();
 if(Number(absent?.n)!==0)throw Error('STAGE_FEEDBACK_MISMATCH_PERSISTED');
 const good=makeSigned(RECIPIENT,'svix-good-'+probeId);
 const recorded=await processResendWebhook(fabric,good.raw,good.headers,{secret,strictRecipient:true});
 const duplicate=await processResendWebhook(fabric,good.raw,good.headers,{secret,strictRecipient:true});
 if(recorded.recorded!==true||duplicate.recorded!==false||duplicate.reason!=='DUPLICATE_EVENT')
  throw Error('STAGE_FEEDBACK_REPLAY_CONTROL_FAILED');
 const evidence=await fabric.getProviderEvidence(transaction.messageId,'stage-tenant');
 if(evidence?.providerStatus!=='BOUNCED_REPORTED'||evidence.events?.length!==1||
  !verifyProof(evidence.proof,{trustedPublicKey:publicKey.export({type:'spki',format:'pem'}).toString()}))
  throw Error('STAGE_FEEDBACK_CRYPTO_EVIDENCE_FAILED');
 const persisted=await db.prepare('SELECT COUNT(*) AS n FROM mail_provider_events WHERE tenant_id=? AND message_id=?')
  .bind('stage-tenant',transaction.messageId).first();
 if(Number(persisted?.n)!==1)throw Error('STAGE_FEEDBACK_NOT_DURABLE');
 const suppress=await db.prepare('SELECT COUNT(*) AS n FROM mail_suppressions WHERE tenant_id=? AND recipient_hmac=?')
  .bind('stage-tenant',fabric.ledger.opaqueRecipient(RECIPIENT)).first();
 if(Number(suppress?.n)!==1)throw Error('STAGE_FEEDBACK_SUPPRESSION_NOT_DURABLE');
 let blocked=false;
 try{await fabric.enqueue({tenantId:'stage-tenant',from:'synthetic@example.org',to:RECIPIENT,
  subject:'must not send',text:'must be blocked',kind:'SERVICE_ALERT',idempotencyKey:probeId+'-second'});}
 catch(err){if(err?.code==='RECIPIENT_SUPPRESSED')blocked=true;else throw err;}
 if(!blocked)throw Error('STAGE_FEEDBACK_SUPPRESSION_NOT_ENFORCED');
 return Object.freeze({
  status:'PASS',probeSha256:sha(probeId),providerWasSimulation:true,syntheticallySigned:true,
  originalReceiptSigned:true,recipientMismatchRejected:true,invalidFeedbackNotPersisted:true,
  exactReplayIdempotent:true,singleProviderEventPersisted:true,bounceSuppressionDurable:true,
  laterMessageBlocked:true,providerStatus:'BOUNCED_REPORTED',
  publicKeySha256:sha(publicKey.export({type:'spki',format:'der'})),
  customerMailSent:false,networkProviderCalls:0
 });
}


/** Actual SQLite / Queue race rehearsal: signed event arrives BEFORE provider ID
 * is recorded, receives a retryable result, then succeeds on an identical retry.
 * Every provider send is an in-process simulation; zero network mail.
 */
export async function runSyntheticEarlyFeedbackProbe(db,env,probeId){
 const {fabric,publicKey}=createSyntheticStageFabric(db,env,probeId);
 const input={tenantId:'stage-tenant',from:'synthetic@example.org',to:RECIPIENT,
   subject:'Synthetic isolated transaction',text:'Internal-only staging probe; no customer email is sent.',
   kind:'SERVICE_ALERT',idempotencyKey:probeId};
 const queued=await fabric.enqueue(input);
 if(queued.state!=='QUEUED')throw Error('STAGE_EARLY_SEND_NOT_QUEUED');
 const secret='whsec_'+randomBytes(32).toString('base64');
 const timestamp=String(Math.floor(Date.now()/1000));
 const id='svix-early-'+probeId;
 const raw=JSON.stringify({type:'email.delivered',created_at:new Date().toISOString(),data:{
   email_id:'synthetic_'+probeId,to:[RECIPIENT]}});
 const signature=createHmac('sha256',Buffer.from(secret.slice(6),'base64'))
   .update(id+'.'+timestamp+'.'+raw).digest('base64');
 const headers={'svix-id':id,'svix-timestamp':timestamp,'svix-signature':'v1,'+signature};
 let pendingWasRetryable=false;
 try{await processResendWebhook(fabric,raw,headers,{secret,strictRecipient:true});}
 catch(e){if(e?.message==='PROVIDER_CORRELATION_PENDING')pendingWasRetryable=true;else throw e;}
 if(!pendingWasRetryable)throw Error('EARLY_PROVIDER_EVENT_ACKNOWLEDGED_FALSELY');
 const before=await db.prepare('SELECT COUNT(*) AS n FROM mail_provider_events WHERE tenant_id=? AND message_id=?')
  .bind('stage-tenant',queued.messageId).first();
 if(Number(before?.n)!==0)throw Error('EARLY_PROVIDER_EVENT_WRITTEN_UNATTRIBUTED');
 const accepted=await fabric.processById(queued.messageId);
 if(accepted?.state!=='ACCEPTED_BY_PROVIDER'||
    accepted?.proof?.events?.at(-1)?.detail?.providerId!=='synthetic_'+probeId)
    throw Error('STAGE_EARLY_PROVIDER_ACCEPTANCE_MISSING');
 const stored=await processResendWebhook(fabric,raw,headers,{secret,strictRecipient:true});
 const again=await processResendWebhook(fabric,raw,headers,{secret,strictRecipient:true});
 const evidence=await fabric.getProviderEvidence(queued.messageId,'stage-tenant');
 if(stored.recorded!==true||again.reason!=='DUPLICATE_EVENT'||again.recorded!==false||
    evidence?.providerStatus!=='DELIVERED_REPORTED'||evidence.events.length!==1||
    !verifyProof(evidence.proof,{trustedPublicKey:publicKey.export({type:'spki',format:'pem'}).toString()}))
   throw Error('STAGE_EARLY_FEEDBACK_RETRY_NOT_VERIFIED');
 const count=await db.prepare('SELECT COUNT(*) AS n FROM mail_provider_events WHERE tenant_id=? AND message_id=?')
  .bind('stage-tenant',queued.messageId).first();
 if(Number(count?.n)!==1)throw Error('STAGE_EARLY_FEEDBACK_NOT_DURABLE');
 return Object.freeze({
  status:'PASS',probeSha256:sha(probeId),
  earlyWebhookRetryable:true,unmatchedEventNeverAcknowledged:true,
  sameSignatureReplayed:true,eventRecordedAfterAcceptance:true,exactReplayIdempotent:true,
  providerStatus:'DELIVERED_REPORTED',signatureEvidenceVerified:true,
  publicKeySha256:sha(publicKey.export({format:'der',type:'spki'})),
  providerWasSimulation:true,realResendWebhookReceived:false,
  customerMailSent:false,networkProviderCalls:0
 });
}
