import {authenticate} from '../../../../../src/staging/identity.mjs';
import {database,scoped} from '../../../../../src/staging/database.mjs';
export const runtime='nodejs';export const dynamic='force-dynamic';
async function handle(req,{params}){
 try{
  const actor=await authenticate(req),{tenant,operation}=await params,{repo}=database();
  if(req.method==='GET'){
   const reads={metrics:()=>repo.snapshot(tenant,actor.subject),bookings:()=>repo.listBookings(tenant,actor.subject),conversations:()=>repo.listConversations(tenant,actor.subject),drafts:()=>repo.listReplyDrafts(tenant,actor.subject),staff:()=>repo.listStaff(tenant,actor.subject),audit:()=>repo.listActionAudit(tenant,actor.subject),knowledge:()=>scoped(tenant,actor.subject,['OWNER','ADMIN','AGENT'],async c=>(await c.query('SELECT faq_id,normalized_question,answer FROM musitu.faqs WHERE tenant_id=$1 ORDER BY normalized_question LIMIT 100',[tenant])).rows),channels:()=>scoped(tenant,actor.subject,['OWNER','ADMIN'],async c=>(await c.query('SELECT phone_number_id,waba_id,status FROM musitu.whatsapp_channels WHERE tenant_id=$1',[tenant])).rows)};
   if(operation.length!==1||!reads[operation[0]])return Response.json({error:'NOT_FOUND'},{status:404});
   return Response.json({tenantId:tenant,data:await reads[operation[0]]()});
  }
  if(req.headers.get('origin')!==process.env.APP_ORIGIN)return Response.json({error:'ORIGIN_REJECTED'},{status:403});
  if(req.headers.get('content-type')!=='application/json'||Number(req.headers.get('content-length')||0)>4096)return Response.json({error:'INVALID_BODY'},{status:400});
  const text=await req.text();if(Buffer.byteLength(text)>4096)return Response.json({error:'BODY_TOO_LARGE'},{status:413});
  const input=JSON.parse(text),base={tenantId:tenant,actorId:actor.subject};
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('INVALID_INPUT');
  let result;
  if(operation.join('/')==='bookings'&&Object.keys(input).sort().join(',')==='effectKey,endAt,resourceId,startAt')result=await repo.reserveBooking({...base,...input});
  else if(operation.length===3&&operation[0]==='conversations'&&operation[2]==='handover'&&Object.keys(input).length===0)result=await repo.handoverConversation({...base,conversationId:operation[1]});
  else if(operation.length===3&&operation[0]==='conversations'&&operation[2]==='suppress'&&Object.keys(input).join(',')==='reason')result=await repo.suppressConversation({...base,conversationId:operation[1],reason:input.reason});
  else if(operation.length===3&&operation[0]==='staff'&&operation[2]==='revoke'&&Object.keys(input).length===0)result=await repo.revokeMembership({...base,memberId:operation[1]});
  else if(operation.length===3&&operation[0]==='drafts'&&operation[2]==='approve'&&Object.keys(input).join(',')==='approvalKey')result=await repo.approveReplyDraft({...base,draftId:operation[1],approvalKey:input.approvalKey});
  else return Response.json({error:'ACTION_NOT_AVAILABLE'},{status:404});
  return Response.json({tenantId:tenant,data:result});
 }catch(e){const denied=/SESSION|TOKEN|ACCESS_DENIED|JWKS/.test(e.message);const conflict=/SLOT_UNAVAILABLE|CONFLICT/.test(e.message);return Response.json({error:denied?'ACCESS_DENIED':conflict?'CONFLICT':'SERVICE_UNAVAILABLE'},{status:denied?403:conflict?409:503});}
}
export {handle as GET,handle as POST};
