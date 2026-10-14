/** Human-review client for the private console. It has no external transport.
 * Idempotency keys remain in one in-memory session and are reused on retries.
 */
const DRAFT_ID=/^[0-9a-fA-F-]{36}$/;
const TENANT=/^[A-Za-z0-9_-]{1,80}$/;
export function createDraftReviewClient({getSession,makeKey=()=>globalThis.crypto.randomUUID(),fetchImpl=globalThis.fetch}={}){
 if(typeof getSession!=='function'||typeof makeKey!=='function'||typeof fetchImpl!=='function')throw new Error('INVALID_REVIEW_CLIENT');
 const sessionKeys=new WeakMap();
 async function submit(kind,draftId){
  const session=getSession();
  if(!session||typeof session!=='object'||!TENANT.test(session.tenant)||typeof session.token!=='string'||!session.token.trim())throw new Error('SESSION_REQUIRED');
  if(typeof draftId!=='string'||!DRAFT_ID.test(draftId))throw new Error('INVALID_DRAFT_ID');
  let keys=sessionKeys.get(session);if(!keys){keys=new Map();sessionKeys.set(session,keys);}
  const cacheKey=kind+':'+draftId;
  if(!keys.has(cacheKey)){
   const key=makeKey();if(typeof key!=='string'||!key.trim()||key.length>180)throw new Error('INVALID_IDEMPOTENCY_KEY');
   keys.set(cacheKey,key);
  }
  const isStage=kind==='stage';
  const path=`/v1/tenants/${encodeURIComponent(session.tenant)}/drafts/${encodeURIComponent(draftId)}/${isStage?'stage-offline':'approve'}`;
  const response=await fetchImpl(path,{method:'POST',credentials:'omit',redirect:'error',cache:'no-store',
   headers:{authorization:`Bearer ${session.token}`,'content-type':'application/json'},
   body:JSON.stringify(isStage?{reservationKey:keys.get(cacheKey)}:{approvalKey:keys.get(cacheKey)})});
  if(!response?.ok||![200,201].includes(response.status))throw new Error(`REVIEW_HTTP_${response?.status||0}`);
  const result=await response.json();
  if(!result||result.tenantId!==session.tenant||result.draftId!==draftId||
     result.status!==(isStage?'STAGED_OFFLINE':'APPROVED_OFFLINE')||result.providerDelivery!=='NEVER_SUBMITTED'||
     (isStage&&result.transport!=='DISABLED'))throw new Error('REVIEW_RESPONSE_UNTRUSTED');
  return result;
 }
 return Object.freeze({approve:draftId=>submit('approve',draftId),stageOffline:draftId=>submit('stage',draftId)});
}
