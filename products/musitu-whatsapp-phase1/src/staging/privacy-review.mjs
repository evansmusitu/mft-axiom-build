/** Private development owner review only. No subject-response delivery, erasure or permission grant. */
import {createHash} from 'node:crypto';
import {readBoundedJson} from '../security/bounded-request.mjs';
const TENANT='986eb904-7296-46a9-9e9b-94074db9b547';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEADER=Buffer.from('MUSITU_CONVERSATION_EXPORT_V1\0');
const failure=(status,error)=>Response.json({error},{status,headers:{'cache-control':'no-store'}});

export function createConversationPrivacyReviewHandler({enabled=false,appOrigin,authenticate,authorizeOwner,exportConversation}={}){
 return async function POST(req,{params}){
  let exportKey;
  try{
   if(enabled!==true)return failure(404,'NOT_FOUND');
   if(typeof authenticate!=='function'||typeof authorizeOwner!=='function'||typeof exportConversation!=='function')return failure(503,'PRIVACY_REVIEW_UNAVAILABLE');
   if(req.method!=='POST'||!appOrigin||req.headers.get('origin')!==appOrigin)return failure(403,'ACCESS_DENIED');
   const {tenant,conversation}=await params;
   if(tenant!==TENANT||typeof conversation!=='string'||!UUID.test(conversation))return failure(404,'NOT_FOUND');
   const actor=await authenticate(req);
   if(typeof actor?.subject!=='string'||!actor.subject)return failure(403,'ACCESS_DENIED');
   const input=await readBoundedJson(req);
   if(Object.keys(input).sort().join(',')!=='approveReview,exportKey,requestId'||input.approveReview!==true||
      typeof input.requestId!=='string'||!UUID.test(input.requestId)||typeof input.exportKey!=='string'||
      !/^[A-Za-z0-9+/]{43}=$/.test(input.exportKey))return failure(400,'REVIEW_INPUT_REJECTED');
   exportKey=Buffer.from(input.exportKey,'base64');
   if(exportKey.length!==32||exportKey.toString('base64')!==input.exportKey)return failure(400,'REVIEW_INPUT_REJECTED');
   const recheckSession=async()=>{if((await authenticate(req))?.subject!==actor.subject)throw Error('SESSION_SUBJECT_CHANGED');};
   const result=await exportConversation({tenantId:tenant,actorId:actor.subject,conversationId:conversation,requestId:input.requestId,exportKey,recheckSession});
   // The native exporter rechecks membership before encryption. Recheck again
   // afterward so a revocation during serialization/encryption prevents return.
   await authorizeOwner({tenantId:tenant,actorId:actor.subject});
   await recheckSession();
   const bytes=result?.encrypted;
   if(!Buffer.isBuffer(bytes)||bytes.length<=HEADER.length+28||bytes.length>2*1024*1024||!bytes.subarray(0,HEADER.length).equals(HEADER))throw Error('EXPORT_RESULT_REJECTED');
   const sha256=createHash('sha256').update(bytes).digest('hex');
   return new Response(bytes,{headers:{'content-type':'application/octet-stream','content-length':String(bytes.length),
    'content-disposition':`attachment; filename="MUSITU_PRIVACY_REVIEW_${input.requestId}.musituexport"`,
    'cache-control':'no-store','x-content-type-options':'nosniff','x-musitu-export-sha256':sha256,
    'x-musitu-export-scope':'SINGLE_CONVERSATION_OPERATOR_REVIEW'}});
  }catch(error){
   if(/^(ACCESS_DENIED|SESSION_|TOKEN_|OIDC_|JWKS_)/.test(error?.message??''))return failure(403,'ACCESS_DENIED');
   if(/^(BODY_|INVALID_JSON|INVALID_INPUT)/.test(error?.message??''))return failure(400,'REVIEW_INPUT_REJECTED');
   return failure(503,'PRIVACY_REVIEW_UNAVAILABLE');
  }finally{exportKey?.fill(0);}
 };
}
