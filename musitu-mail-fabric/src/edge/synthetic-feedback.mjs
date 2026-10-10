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
