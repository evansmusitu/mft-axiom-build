import {decryptLedger} from '../security/ledger-encryption.mjs';
import {createGroqQualificationGateway} from '../ai/groq-gateway.mjs';

/** Staff-initiated draft assistance. Database admission commits BEFORE any model
 * call. A crashed/uncertain reservation stays closed until operator review.
 * No sending, tools, background retries or cross-conversation context exist.
 */
export function createAiDraftService({scoped,token,freePlanVerified,contentKey,request=fetch}={}){
 if(typeof scoped!=='function'||!Buffer.isBuffer(contentKey)||contentKey.length!==32)throw Error('AI_CONFIGURATION_REQUIRED');
 return async function draft({tenantId,actorId,conversationId,phoneNumberId,messageId,recheckSession}){
  if(typeof recheckSession!=='function'||![tenantId,actorId,conversationId,phoneNumberId,messageId].every(x=>typeof x==='string'&&x.length>0&&x.length<=192))throw Error('AI_INPUT_REJECTED');
  const gateway=createGroqQualificationGateway({token,freePlanVerified,fetchImpl:request,maxRequests:1});
  await recheckSession();
  const admitted=await scoped(tenantId,actorId,['OWNER','ADMIN','AGENT'],async c=>(await c.query('SELECT musitu.reserve_ai_draft($1,$2,$3,$4) AS result',[actorId,conversationId,phoneNumberId,messageId])).rows[0].result);
  if(admitted.admitted!==true)return admitted;
  const {requestId,faqs,encryptedBody}=admitted;
  const question=decryptLedger(encryptedBody,contentKey,[tenantId,phoneNumberId,messageId]);
  const selection=await gateway.select({tenantId,question,approvedFaqs:faqs.map(f=>({...f,tenantId,approved:true}))});
  const usage=gateway.getUsage(),event=usage.events.at(-1);
  // A fresh online identity/session check and database membership lock prevent
  // a result returning to an employee revoked while the model was running.
  await recheckSession();
  const telemetry={attempts:usage.admittedRequests,inputTokens:event?.inputTokens??(usage.admittedRequests===0?0:null),outputTokens:event?.outputTokens??(usage.admittedRequests===0?0:null),totalTokens:event?.totalTokens??(usage.admittedRequests===0?0:null),outcome:event?.outcome??'PRECHECK_HANDOVER',httpStatus:event?.httpStatus??null};
  return scoped(tenantId,actorId,['OWNER','ADMIN','AGENT'],async c=>(await c.query('SELECT musitu.complete_ai_draft($1,$2,$3,$4) AS result',[actorId,requestId,selection.sourceFaqId,telemetry])).rows[0].result);
 };
}
