const knownStatuses=new Set(['RESERVED','UNKNOWN','ACCEPTED','DELIVERED','FAILED']);

/** The sender's database reservation remains authoritative. This readback only
 * unlocks the owner form after a complete, current status check. */
export function reviewDevelopmentReplyStatus(response,{tenant,conversationId,messageId}){
 if(response?.tenantId!==tenant||!Array.isArray(response.data)||response.data.length>=100||
    response.data.some(attempt=>!attempt||!knownStatuses.has(attempt.status)))
  return{allowed:false,notice:'Reply status is incomplete or unavailable. Do not submit a reply.'};
 if(response.data.some(attempt=>attempt.status==='RESERVED'||attempt.status==='UNKNOWN'))
  return{allowed:false,notice:'A reply outcome is uncertain. Do not send again; reconcile the original attempt.'};
 const prior=response.data.find(attempt=>attempt.conversationId===conversationId&&attempt.messageId===messageId);
 if(prior)return{allowed:false,notice:`Reply status: ${prior.status}. This incoming message already has a recorded attempt.`};
 return{allowed:true,notice:'No recorded attempt for this message. Review the text and consent before submitting.'};
}
