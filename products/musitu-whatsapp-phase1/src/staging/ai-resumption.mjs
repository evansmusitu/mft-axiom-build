/** Owner-confirmed return to review-only AI assistance; no dispatch or retry. */
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const actor=/^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,191}$/;
export function createAiResumptionService({scoped}={}){
 if(typeof scoped!=='function')throw Error('AI_RESUMPTION_CONFIGURATION_REQUIRED');
 return async function resume({tenantId,actorId,conversationId,confirmReviewOnly,recheckSession}={}){
  if(confirmReviewOnly!==true)throw Error('AI_RESUMPTION_CONFIRMATION_REQUIRED');
  if(typeof tenantId!=='string'||tenantId.length!==36||!uuid.test(tenantId)||typeof conversationId!=='string'||conversationId.length!==36||!uuid.test(conversationId)||typeof actorId!=='string'||actorId!==actorId.trim()||!actor.test(actorId)||typeof recheckSession!=='function')throw Error('AI_RESUMPTION_INPUT_REJECTED');
  await recheckSession();
  return scoped(tenantId,actorId,['OWNER'],async client=>{
   const {rows}=await client.query('SELECT musitu.resume_ai_assistance($1,$2,$3) AS result',[actorId,conversationId,true]);
   const value=rows?.[0]?.result;
   if(rows?.length!==1||typeof value?.conversationId!=='string'||value.conversationId.toLowerCase()!==conversationId.toLowerCase()||value.mode!=='BOT'||typeof value.changed!=='boolean'||value.reviewOnly!==true||value.providerDelivery!=='NEVER_SUBMITTED')throw Error('AI_RESUMPTION_RESULT_REJECTED');
   await recheckSession();
   return{conversationId:value.conversationId,mode:'BOT',changed:value.changed,reviewOnly:true,providerDelivery:'NEVER_SUBMITTED'};
  });
 };
}
const failures=Object.freeze({
 ACCESS_DENIED:[403,'Only an active business owner can return this conversation to AI draft assistance.'],
 AI_RESUMPTION_CONFIRMATION_REQUIRED:[400,'Confirm that you want this conversation to use AI draft assistance with human review.'],
 AI_RESUMPTION_INPUT_REJECTED:[400,'Select a valid business conversation and confirm the return to AI draft assistance.'],
 AI_ASSISTANCE_DISABLED:[409,'Enable AI draft assistance in Configuration before returning this conversation.'],
 CUSTOMER_OPT_OUT:[409,'This conversation is opted out and cannot return to AI draft assistance.'],
 AI_UNCERTAIN_REQUEST:[409,'An earlier AI request needs investigation. Do not request another suggestion.'],
 CONVERSATION_NOT_FOUND:[404,'This conversation is not available in the selected business.']
});
export function publicAiResumptionFailure(error){
 const message=typeof error?.message==='string'?error.message:'';
 const code=/^(SESSION|TOKEN|JWKS)/.test(message)?'ACCESS_DENIED':message;
 if(Object.hasOwn(failures,code)){const [status,text]=failures[code];return{status,body:{error:code,message:text}};}
 return{status:503,body:{error:'AI_RESUMPTION_UNAVAILABLE',message:'AI draft assistance could not be resumed. Refresh the conversation before taking another action.'}};
}
