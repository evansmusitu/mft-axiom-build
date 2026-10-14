import {readBoundedJson} from '../../../../../src/security/bounded-request.mjs';
import {decryptLedger} from '../../../../../src/security/ledger-encryption.mjs';
import {randomUUID} from 'node:crypto';
import {authenticate} from '../../../../../src/staging/identity.mjs';
import {database,scoped} from '../../../../../src/staging/database.mjs';
export const runtime='nodejs';export const dynamic='force-dynamic';
async function handle(req,{params}){
 try{
  const actor=await authenticate(req),{tenant,operation}=await params,{repo}=database();
  if(req.method==='GET'){
   const reads={metrics:()=>repo.snapshot(tenant,actor.subject),bookings:()=>repo.listBookings(tenant,actor.subject),conversations:()=>repo.listConversations(tenant,actor.subject),drafts:()=>repo.listReplyDrafts(tenant,actor.subject),staff:()=>repo.listStaff(tenant,actor.subject),audit:()=>repo.listActionAudit(tenant,actor.subject),knowledge:()=>scoped(tenant,actor.subject,['OWNER','ADMIN','AGENT'],async c=>(await c.query('SELECT faq_id,normalized_question,answer FROM musitu.faqs WHERE tenant_id=$1 ORDER BY normalized_question LIMIT 100',[tenant])).rows),configuration:()=>scoped(tenant,actor.subject,['OWNER','ADMIN'],async c=>(await c.query('SELECT timezone,business_description,workflow,revision FROM musitu.business_configuration WHERE tenant_id=$1',[tenant])).rows),resources:()=>scoped(tenant,actor.subject,['OWNER','ADMIN','AGENT','VIEWER'],async c=>(await c.query('SELECT resource_id,label FROM musitu.resources WHERE tenant_id=$1',[tenant])).rows),messages:()=>scoped(tenant,actor.subject,['OWNER','ADMIN','AGENT'],async c=>(await c.query('SELECT phone_number_id,provider_message_id,conversation_id,encrypted_body FROM musitu.messages WHERE tenant_id=$1 AND retained_until>now() LIMIT 250',[tenant])).rows.map(r=>({conversationId:r.conversation_id,messageId:r.provider_message_id,body:decryptLedger(r.encrypted_body,Buffer.from(process.env.CONTENT_ENCRYPTION_KEY||'', 'base64'),[tenant,r.phone_number_id,r.provider_message_id])}))),channels:()=>scoped(tenant,actor.subject,['OWNER','ADMIN'],async c=>(await c.query('SELECT phone_number_id,waba_id,status FROM musitu.whatsapp_channels WHERE tenant_id=$1',[tenant])).rows)};
   if(operation.length!==1||!reads[operation[0]])return Response.json({error:'NOT_FOUND'},{status:404});
   return Response.json({tenantId:tenant,data:await reads[operation[0]]()});
  }
  if(req.headers.get('origin')!==process.env.APP_ORIGIN)return Response.json({error:'ORIGIN_REJECTED'},{status:403});
  const input=await readBoundedJson(req),base={tenantId:tenant,actorId:actor.subject};
  let result;
  if(operation.join('/')==='configuration'&&Object.keys(input).sort().join(',')==='description,timezone')result=await scoped(tenant,actor.subject,['OWNER','ADMIN'],async c=>(await c.query('SELECT musitu.configure_business($1,$2,$3) AS revision',[actor.subject,input.timezone,input.description])).rows[0]);
  else if(operation.join('/')==='knowledge'&&Object.keys(input).sort().join(',')==='answer,approved,question'&&input.approved===true)result=await scoped(tenant,actor.subject,['OWNER','ADMIN'],async c=>(await c.query('SELECT musitu.approve_knowledge($1,$2,$3,$4,$5) AS source_id',[actor.subject,randomUUID(),input.question,input.answer,input.approved])).rows[0]);
  else if(operation.join('/')==='staff'&&Object.keys(input).sort().join(',')==='memberId,role')result=await scoped(tenant,actor.subject,['OWNER'],async c=>(await c.query('SELECT musitu.add_staff($1,$2,$3) AS member_id',[actor.subject,input.memberId,input.role])).rows[0]);
  else if(operation.join('/')==='resources'&&Object.keys(input).join(',')==='label')result=await scoped(tenant,actor.subject,['OWNER','ADMIN'],async c=>(await c.query('SELECT musitu.add_resource($1,$2,$3) AS resource_id',[actor.subject,randomUUID(),input.label])).rows[0]);
  else if(operation.join('/')==='bookings'&&Object.keys(input).sort().join(',')==='effectKey,endAt,resourceId,startAt')result=await repo.reserveBooking({...base,...input});
  else if(operation.length===3&&operation[0]==='conversations'&&operation[2]==='handover'&&Object.keys(input).length===0)result=await repo.handoverConversation({...base,conversationId:operation[1]});
  else if(operation.length===3&&operation[0]==='conversations'&&operation[2]==='suppress'&&Object.keys(input).join(',')==='reason')result=await repo.suppressConversation({...base,conversationId:operation[1],reason:input.reason});
  else if(operation.length===3&&operation[0]==='staff'&&operation[2]==='revoke'&&Object.keys(input).length===0)result=await repo.revokeMembership({...base,memberId:operation[1]});
  else if(operation.length===3&&operation[0]==='drafts'&&operation[2]==='approve'&&Object.keys(input).join(',')==='approvalKey')result=await repo.approveReplyDraft({...base,draftId:operation[1],approvalKey:input.approvalKey});
  else return Response.json({error:'ACTION_NOT_AVAILABLE'},{status:404});
  return Response.json({tenantId:tenant,data:result});
 }catch(e){const denied=/SESSION|TOKEN|ACCESS_DENIED|JWKS/.test(e.message);const conflict=/SLOT_UNAVAILABLE|CONFLICT/.test(e.message);return Response.json({error:denied?'ACCESS_DENIED':conflict?'CONFLICT':'SERVICE_UNAVAILABLE'},{status:denied?403:conflict?409:503});}
}
export {handle as GET,handle as POST};
