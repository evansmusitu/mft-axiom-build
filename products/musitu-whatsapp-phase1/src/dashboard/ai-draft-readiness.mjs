/** Treat missing or partial request history as a reason to stop before a model call. */
export function assessAiDraftReadiness(state,{phoneNumberId,messageId}={}){
 if(!state||typeof state!=='object'||typeof state.blocked!=='boolean'||typeof state.incomplete!=='boolean'||!Array.isArray(state.blockerStates)||!Array.isArray(state.requests))return 'UNAVAILABLE';
 if(state.blockerStates.some(s=>s!=='RESERVED'&&s!=='UNKNOWN')||state.blocked!==(state.blockerStates.length>0))return 'UNAVAILABLE';
 if(state.requests.some(r=>!r||typeof r.phoneNumberId!=='string'||typeof r.messageId!=='string'||!['RESERVED','COMPLETED','UNKNOWN'].includes(r.state)))return 'UNAVAILABLE';
 if(state.blocked||state.requests.some(r=>r?.state==='RESERVED'||r?.state==='UNKNOWN'))return 'UNCERTAIN';
 if(state.incomplete)return 'INCOMPLETE';
 if(typeof phoneNumberId!=='string'||!phoneNumberId||typeof messageId!=='string'||!messageId)return 'UNAVAILABLE';
 if(state.requests.some(r=>r?.phoneNumberId===phoneNumberId&&r?.messageId===messageId))return 'ALREADY_REQUESTED';
 return 'READY';
}
