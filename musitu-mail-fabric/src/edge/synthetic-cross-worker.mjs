/** Cloudflare private service-binding verification for two *separate* Workers.
 * All traffic is synthetic, no public route, customer API or provider network send.
 * Proof requires independent sender-owned SQLite/signed evidence after ingress call.
 */
import {createHash} from 'node:crypto';
import {createSyntheticStageFabric,runSyntheticTransactionProbe,syntheticStageRecipient} from './synthetic-transaction.mjs';
import {verifyProof} from '../evidence.mjs';
const PROBE=/^probe-[a-z0-9-]{8,56}$/;
export async function runPrivateCrossWorkerFeedbackProbe(db,env,probeId){
 if(typeof probeId!=='string'||!PROBE.test(probeId)||!db?.prepare||
    env?.MMF_STAGE_ONLY!=='true'||env.MMF_REAL_SEND_ENABLED!=='false'||
    env.MMF_API_ENABLED!=='false'||env.MMF_WEBHOOK_ENABLED!=='false'||
    typeof env.MMF_PRIVATE_BRIDGE_TEST_SECRET!=='string'||env.MMF_PRIVATE_BRIDGE_TEST_SECRET.length<32||
    typeof env.MMF_PRIVATE_FEEDBACK_INGRESS?.fetch!=='function')
    throw Error('STAGE_CROSS_WORKER_NOT_AUTHORIZED');
 const transaction=await runSyntheticTransactionProbe(db,env,probeId);
 if(transaction?.state!=='ACCEPTED_BY_PROVIDER'||transaction.providerIsSimulation!==true||
    transaction.customerMailSent!==false)throw Error('STAGE_CROSS_WORKER_NO_SYNTHETIC_ACCEPTANCE');
 const request=new Request('https://mmf-internal.invalid/__mmf_stage/signed-feedback',{
  method:'POST',headers:{'content-type':'application/json',
    'x-mmf-stage-probe':env.MMF_PRIVATE_BRIDGE_TEST_SECRET},
  body:JSON.stringify({probeId})
 });
 const response=await env.MMF_PRIVATE_FEEDBACK_INGRESS.fetch(request);
 if(!response?.ok)throw Error('STAGE_CROSS_WORKER_INGRESS_UNAVAILABLE');
 const outcome=await response.json();
 if(outcome?.status!=='PASS'||outcome.wrongRecipientRejected!==true||
    outcome.signedEventRecorded!==true||outcome.duplicateIdempotent!==true||
    outcome.providerWasSimulation!==true||outcome.realProviderEventReceived!==false||
    outcome.customerMailSent!==false||outcome.publicAccess!==false||
    outcome.distinctIngressSenderKeyCustody!==true)
    throw Error('STAGE_CROSS_WORKER_UNTRUSTED_INGRESS_REPORT');
 const {fabric,publicKey}=createSyntheticStageFabric(db,env,probeId);
 const independent=await fabric.getProviderEvidence(transaction.messageId,'stage-tenant');
 if(independent?.providerStatus!=='BOUNCED_REPORTED'||independent.events?.length!==1||
    !verifyProof(independent.proof,{trustedPublicKey:publicKey.export({format:'pem',type:'spki'}).toString()}))
  throw Error('STAGE_CROSS_WORKER_OWNER_EVIDENCE_NOT_VERIFIED');
 const suppressed=await db.prepare('SELECT COUNT(*) AS n FROM mail_suppressions WHERE tenant_id=? AND recipient_hmac=?')
   .bind('stage-tenant',fabric.ledger.opaqueRecipient(syntheticStageRecipient(probeId))).first();
 if(Number(suppressed?.n)!==1)throw Error('STAGE_CROSS_WORKER_SUPPRESSION_NOT_DURABLE');
 let newMessageBlocked=false;
 try{await fabric.enqueue({tenantId:'stage-tenant',from:'synthetic@example.org',
  to:syntheticStageRecipient(probeId),subject:'Synthetic only',
  text:'Must never send',kind:'SERVICE_ALERT',idempotencyKey:probeId+'-second'});}
 catch(e){if(e?.code==='RECIPIENT_SUPPRESSED')newMessageBlocked=true;else throw e;}
 if(!newMessageBlocked)throw Error('STAGE_CROSS_WORKER_SUPPRESSION_NOT_APPLIED');
 return Object.freeze({status:'PASS',probeSha256:createHash('sha256').update(probeId).digest('hex'),
  crossWorkerServiceBinding:true,signedEventRecorded:true,wrongRecipientRejected:true,
  proofSignerIsOwner:true,recipientSuppressed:true,
  providerWasSimulation:true,realResendWebhookReceived:false,customerMailSent:false,publicAccess:false});
}
