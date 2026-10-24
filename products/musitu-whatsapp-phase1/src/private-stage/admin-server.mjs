/**
 * Loopback-only private qualification surface. Read operations plus explicit
 * offline review approval; no provider sending, enrollment or payment routes.
 * All operations validate an issuer-pinned JWT and recheck membership in the
 * store's transaction. This is not an internet-facing or production API.
 */
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {verifyPinnedOidcJwt} from '../security/oidc.mjs';
import {createOidcJwksVerifier} from '../security/oidc-jwks.mjs';
const READ_ROUTE=/^\/v1\/tenants\/([A-Za-z0-9_-]{1,80})\/(metrics|drafts)$/;
const AUDIT_ROUTE=/^\/v1\/tenants\/([A-Za-z0-9_-]{1,80})\/audit$/;
const CAPABILITY_ROUTE=/^\/v1\/tenants\/([A-Za-z0-9_-]{1,80})\/capabilities$/;
const BOOKING_ROUTE=/^\/v1\/tenants\/([A-Za-z0-9_-]{1,80})\/bookings$/;
const CONVERSATIONS_ROUTE=/^\/v1\/tenants\/([A-Za-z0-9_-]{1,80})\/conversations$/;
const HANDOVER_ROUTE=/^\/v1\/tenants\/([A-Za-z0-9_-]{1,80})\/conversations\/((?:[0-9a-fA-F]{64}|[0-9a-fA-F-]{36}))\/handover$/;
const STAFF_ROUTE=/^\/v1\/tenants\/([A-Za-z0-9_-]{1,80})\/staff$/;
const STAFF_REVOKE_ROUTE=/^\/v1\/tenants\/([A-Za-z0-9_-]{1,80})\/staff\/([A-Za-z0-9_.@-]{1,255})\/revoke$/;
const SUPPRESS_ROUTE=/^\/v1\/tenants\/([A-Za-z0-9_-]{1,80})\/conversations\/((?:[0-9a-fA-F]{64}|[0-9a-fA-F-]{36}))\/suppress$/;
const REVIEW_ROUTE=/^\/v1\/tenants\/([A-Za-z0-9_-]{1,80})\/drafts\/([0-9a-fA-F-]{36})\/approve$/;
const STAGE_ROUTE=/^\/v1\/tenants\/([A-Za-z0-9_-]{1,80})\/drafts\/([0-9a-fA-F-]{36})\/stage-offline$/;
const MAX_REVIEW_BYTES=4096;
const ASSET_ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../dashboard');
const ASSETS=Object.freeze({
 '/app':['index.html','text/html; charset=utf-8'],
 '/app.js':['app.js','text/javascript; charset=utf-8'],
 '/review-actions.js':['review-actions.js','text/javascript; charset=utf-8'],
 '/app.css':['app.css','text/css; charset=utf-8']
});
export function createPrivateAdminServer({store,identityConfig,maxBodyReadMs=3000}){
 if(!Number.isSafeInteger(maxBodyReadMs)||maxBodyReadMs<100||maxBodyReadMs>30000)
  throw new Error('ADMIN_BODY_DEADLINE_CONFIG');
 if(!store||typeof store.snapshot!=='function'||!identityConfig||(!identityConfig.jwks&&!identityConfig.jwksUri))
  throw new Error('PRIVATE_IDENTITY_CONFIG_REQUIRED');
 const verifier=identityConfig.jwksUri?createOidcJwksVerifier(identityConfig):null;
 const server=createServer(async(req,res)=>{
  const reply=(status,data)=>{
   res.writeHead(status,{'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'});
   res.end(JSON.stringify(data));
  };
  // Distinguish a running private process from genuine infrastructure
  // qualification. NEVER report production-ready in this local harness.
  if(req.method==='GET'&&req.url==='/health/live')return reply(200,{status:'ALIVE_PRIVATE_STAGE'});
  if(req.method==='GET'&&req.url==='/health/ready')return reply(503,{
   status:'NOT_READY',reason:'PRODUCTION_INTEGRATION_GATES_UNQUALIFIED'
  });
  const asset=req.method==='GET'?ASSETS[req.url||'']:undefined;
  if(asset){
   res.writeHead(200,{'content-type':asset[1],'cache-control':'no-store',
    'x-content-type-options':'nosniff','referrer-policy':'no-referrer',
    'content-security-policy':"default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self'; connect-src 'self'"});
   return res.end(readFileSync(resolve(ASSET_ROOT,asset[0])));
  }
  const readRoute=req.method==='GET'?READ_ROUTE.exec(req.url||''):null;
  const capabilityRoute=req.method==='GET'?CAPABILITY_ROUTE.exec(req.url||''):null;
  const auditRoute=req.method==='GET'&&typeof store.listActionAudit==='function'?AUDIT_ROUTE.exec(req.url||''):null;
  const reviewRoute=req.method==='POST'&&typeof store.approveReplyDraft==='function'
   ?REVIEW_ROUTE.exec(req.url||''):null;
  const stageRoute=req.method==='POST'&&typeof store.stageApprovedReply==='function'
   ?STAGE_ROUTE.exec(req.url||''):null;
  const bookingReadRoute=req.method==='GET'&&typeof store.listBookings==='function'?BOOKING_ROUTE.exec(req.url||''):null;
  const convoReadRoute=req.method==='GET'&&typeof store.listConversations==='function'?CONVERSATIONS_ROUTE.exec(req.url||''):null;
  const bookingWriteRoute=req.method==='POST'&&typeof store.reserveBooking==='function'?BOOKING_ROUTE.exec(req.url||''):null;
  const handoverRoute=req.method==='POST'&&typeof store.handoverConversation==='function'?HANDOVER_ROUTE.exec(req.url||''):null;
  const suppressRoute=req.method==='POST'&&typeof store.suppressConversation==='function'?SUPPRESS_ROUTE.exec(req.url||''):null;
  const staffReadRoute=req.method==='GET'&&typeof store.listStaff==='function'?STAFF_ROUTE.exec(req.url||''):null;
  const staffRevokeRoute=req.method==='POST'&&typeof store.revokeMembership==='function'?STAFF_REVOKE_ROUTE.exec(req.url||''):null;
  const writeRoute=reviewRoute||stageRoute||bookingWriteRoute||handoverRoute||suppressRoute||staffRevokeRoute;
  const listRoute=bookingReadRoute||convoReadRoute||staffReadRoute;
  if(!readRoute&&!writeRoute&&!listRoute&&!capabilityRoute&&!auditRoute)return reply(404,{error:'NOT_FOUND'});
  const auth=req.headers.authorization;
  const bearer=typeof auth==='string'&&/^Bearer [A-Za-z0-9_.-]{30,12288}$/.test(auth)?auth.slice(7):null;
  if(!bearer)return reply(401,{error:'UNAUTHORIZED'});
  let verified;
  try{verified=verifier?await verifier.verify(bearer):verifyPinnedOidcJwt(bearer,identityConfig);}
  catch{return reply(401,{error:'UNAUTHORIZED'});}
  const tenantId=(readRoute||writeRoute||listRoute||capabilityRoute||auditRoute)[1];
  try{
   if(auditRoute)return reply(200,{tenantId,events:await store.listActionAudit(tenantId,verified.subject)});
   if(capabilityRoute){
    await store.snapshot(tenantId,verified.subject); // membership is authoritative, not the URL or JWT tenant claim
    return reply(200,{tenantId,review:typeof store.approveReplyDraft==='function',
     stageOffline:typeof store.stageApprovedReply==='function',sendWhatsApp:false,collectPayments:false});
   }
   if(readRoute){
    if(readRoute[2]==='metrics')return reply(200,await store.snapshot(tenantId,verified.subject));
    return reply(200,{tenantId,drafts:await store.listReplyDrafts(tenantId,verified.subject)});
   }
   if(staffReadRoute)return reply(200,{tenantId,members:await store.listStaff(tenantId,verified.subject)});
   if(bookingReadRoute)return reply(200,{tenantId,bookings:await store.listBookings(tenantId,verified.subject)});
   if(convoReadRoute)return reply(200,{tenantId,conversations:await store.listConversations(tenantId,verified.subject)});
   if(req.headers['content-type']!=='application/json')return reply(415,{error:'UNSUPPORTED_MEDIA_TYPE'});
   // Never leave a partially uploaded authenticated JSON request open
   // indefinitely. Reject declared oversize before consuming any bytes.
   const declared=req.headers['content-length'];
   if(declared!==undefined&&(!/^\d+$/.test(declared)||Number(declared)>MAX_REVIEW_BYTES)){
    res.once('finish',()=>req.destroy());
    return reply(413,{error:'BODY_TOO_LARGE'});
   }
   let count=0;const parts=[];let bodyExpired=false;
   const timer=setTimeout(()=>{
    bodyExpired=true;
    res.once('finish',()=>req.destroy());
    reply(408,{error:'BODY_TIMEOUT'});
   },maxBodyReadMs);
   try{
    for await(const chunk of req){
     if(bodyExpired)return;
     count+=chunk.length;
     if(count>MAX_REVIEW_BYTES){res.once('finish',()=>req.destroy());return reply(413,{error:'BODY_TOO_LARGE'});}
     parts.push(chunk);
    }
   }catch{
    if(!bodyExpired)return reply(400,{error:'INVALID_REQUEST_BODY'});
    return;
   }finally{clearTimeout(timer);}
   if(bodyExpired)return;
   let input;
   try{input=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{return reply(400,{error:'INVALID_JSON'});}
   if(staffRevokeRoute){
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==0)
     return reply(400,{error:'INVALID_REVOKE_REQUEST'});
    const result=await store.revokeMembership({tenantId,actorId:verified.subject,memberId:staffRevokeRoute[2]});
    return reply(result.idempotent?200:201,result);
   }
   if(suppressRoute){
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==1||
       input.reason!=='CUSTOMER_REQUEST')return reply(400,{error:'INVALID_REASON'});
    const result=await store.suppressConversation({tenantId,actorId:verified.subject,
      conversationId:suppressRoute[2],reason:input.reason});
    return reply(result.idempotent?200:201,result);
   }
   if(handoverRoute){
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==0)return reply(400,{error:'INVALID_HANDOVER'});
    const result=await store.handoverConversation({tenantId,actorId:verified.subject,conversationId:handoverRoute[2]});
    return reply(200,result);
   }
   if(bookingWriteRoute){
    if(!input||typeof input!=='object'||Array.isArray(input)||
       Object.keys(input).sort().join(',')!=='effectKey,endAt,resourceId,startAt'||
       !['effectKey','endAt','resourceId','startAt'].every(k=>typeof input[k]==='string'))
     return reply(400,{error:'INVALID_BOOKING'});
    const before=await store.lookupBookingByEffectKey(tenantId,verified.subject,input.effectKey);
    const result=await store.reserveBooking({tenantId,actorId:verified.subject,...input});
    return reply(before?200:201,result);
   }
   const key=stageRoute?'reservationKey':'approvalKey';
   if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==1||
       typeof input[key]!=='string'||!input[key].trim()||input[key].length>180)
    return reply(400,{error:stageRoute?'INVALID_RESERVATION':'INVALID_APPROVAL'});
   const result=stageRoute?
    await store.stageApprovedReply({tenantId,actorId:verified.subject,draftId:stageRoute[2],reservationKey:input[key]}):
    await store.approveReplyDraft({tenantId,actorId:verified.subject,draftId:reviewRoute[2],approvalKey:input[key]});
   return reply(result.idempotent?200:201,result);
  }catch(error){
   if(error.message==='SLOT_UNAVAILABLE'||error.message==='IDEMPOTENCY_CONFLICT')return reply(409,{error:error.message});
   if(error.message==='OWNER_SELF_REVOCATION_DENIED'||error.message==='OWNER_REVOCATION_DENIED')return reply(409,{error:error.message});
   if(error.message==='MEMBER_NOT_FOUND')return reply(404,{error:'MEMBER_NOT_FOUND'});
   if(error.message==='CONVERSATION_NOT_FOUND')return reply(404,{error:'CONVERSATION_NOT_FOUND'});
   if(error.message==='RESOURCE_NOT_FOUND')return reply(404,{error:'RESOURCE_NOT_FOUND'});
   if(error.message?.startsWith('INVALID_BOOKING')||error.message?.startsWith('INVALID_EFFECT')||error.message?.startsWith('INVALID_RESOURCE')||error.message?.startsWith('INVALID_START')||error.message?.startsWith('INVALID_END'))return reply(400,{error:'INVALID_BOOKING'});
   if(error.message==='ACCESS_DENIED')return reply(403,{error:'FORBIDDEN'});
   if(error.message==='DRAFT_REVIEW_REQUIRED')return reply(404,{error:'DRAFT_NOT_APPROVABLE'});
   if(error.message==='DRAFT_NOT_STAGEABLE')return reply(404,{error:'DRAFT_NOT_STAGEABLE'});
   if(error.message==='SESSION_WINDOW_CLOSED'||error.message==='CONSENT_REQUIRED'||error.message==='CUSTOMER_OPT_OUT')return reply(422,{error:error.message});
   if(error.message==='STAGE_CONFLICT')return reply(409,{error:'STAGE_CONFLICT'});
   if(error.message==='APPROVAL_CONFLICT')return reply(409,{error:'APPROVAL_CONFLICT'});
   if(error.message?.startsWith('INVALID_'))return reply(400,{error:'INVALID_APPROVAL'});
   return reply(500,{error:'STAGE_ERROR'});
  }
 });
 return {
  async start(){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});return `http://127.0.0.1:${server.address().port}`;},
  async stop(){await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
 };
}
