/** Synthetic-only, private Cloudflare stage rehearsal of the REAL operator HTTP route.
 * The stage Worker itself has no public routes; no customer sending or provider calls.
 */
import {createHmac,createHash} from 'node:crypto';
import {createSyntheticStageFabric,syntheticStageRecipient} from './synthetic-transaction.mjs';
import {createWorker} from './worker.mjs';

export async function runSyntheticOperatorSuppressionProbe(db,env,probeId){
 const {fabric}=createSyntheticStageFabric(db,env,probeId);
 const recipient=syntheticStageRecipient(probeId);
 const key=Buffer.from(env.MMF_STAGE_DATA_KEY_B64,'base64');
 const privacyKey=createHmac('sha256',key).update('MMF_SYNTHETIC_STAGE_PRIVACY_V1').digest();
 const operatorToken=createHmac('sha256',key).update('MMF_STAGE_OPERATOR_PROBE_ONLY_V1').digest('hex');
 const customerToken='stage-customer-token-must-not-authorize-1234567890';
 const local={
   MMF_DB:db,MMF_TENANT_ID:'stage-tenant',MMF_PRIVACY_KEY_B64:privacyKey.toString('base64'),
   MMF_OPERATOR_TOKEN:operatorToken,MMF_AUTH_TOKEN:customerToken,
   MMF_SUPPRESSION_API_ENABLED:'true',MMF_API_ENABLED:'false',MMF_REAL_SEND_ENABLED:'false'
 };
 const app=createWorker();
 const url='https://internal.invalid/v1/operator/suppressions';
 const request=token=>new Request(url,{method:'POST',
   headers:{authorization:'Bearer '+token,'content-type':'application/json'},
   body:JSON.stringify({recipient})});
 const blocked=await app.fetch(request(customerToken),local);
 if(blocked.status!==401)throw Error('STAGE_OPERATOR_CUSTOMER_TOKEN_ACCEPTED');
 const created=await app.fetch(request(operatorToken),local);
 if(created.status!==201||(await created.json()).created!==true)
   throw Error('STAGE_OPERATOR_SUPPRESSION_NOT_CREATED');
 const duplicate=await app.fetch(request(operatorToken),local);
 if(duplicate.status!==200||(await duplicate.json()).created!==false)
   throw Error('STAGE_OPERATOR_DUPLICATE_NOT_IDEMPOTENT');
 const opaque=createHmac('sha256',privacyKey).update(recipient).digest('hex');
 const row=await db.prepare('SELECT recipient_hmac FROM mail_suppressions WHERE tenant_id=? AND recipient_hmac=?')
   .bind('stage-tenant',opaque).first();
 if(row?.recipient_hmac!==opaque)throw Error('STAGE_OPERATOR_SUPPRESSION_NOT_PERSISTED');
 let suppressed=false;
 try{await fabric.enqueue({tenantId:'stage-tenant',from:'synthetic@example.org',to:recipient,
   subject:'Must be blocked',text:'No provider',kind:'SECURITY',idempotencyKey:probeId});}
 catch(e){if(e?.code==='RECIPIENT_SUPPRESSED')suppressed=true;else throw e;}
 if(!suppressed)throw Error('STAGE_OPERATOR_OUTBOUND_NOT_BLOCKED');
 const count=await db.prepare('SELECT COUNT(*) AS n FROM mail_suppressions WHERE tenant_id=? AND recipient_hmac=?')
   .bind('stage-tenant',opaque).first();
 if(Number(count?.n)!==1)throw Error('STAGE_OPERATOR_SUPPRESSION_DUPLICATED');
 return Object.freeze({status:'PASS',probeSha256:createHash('sha256').update(probeId).digest('hex'),
   customerTokenRejected:true,operatorTokenRequired:true,durableSuppressionPersisted:true,
   duplicateIdempotent:true,subsequentMessageBlocked:true,recipientPlaintextPersisted:false,
   privateQueueOnly:true,providerWasSimulation:true,customerMailSent:false,networkCalls:0});
}
