/**
 * PostgreSQL-only candidate. Expects an injected node-postgres-compatible Pool;
 * does not create credentials, contact a database, bypass RLS or send messages.
 *
 * Security: tenant scope is set transaction-locally on the same leased client
 * BEFORE any data or membership query. Every request verifies its current
 * active membership. The app role must be a non-owner, non-BYPASSRLS role.
 * Native PostgreSQL qualification and issuer integration are separate gates.
 */
import {randomUUID,createHash} from 'node:crypto';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TEXT=/^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,191}$/;
const ROLES=Object.freeze({snapshot:['OWNER','ADMIN','AGENT','VIEWER'],drafts:['OWNER','ADMIN','AGENT'],stage:['OWNER','ADMIN','AGENT'],bookings:['OWNER','ADMIN','AGENT']});

function requireId(value,kind){
 if(typeof value!=='string'||!(kind==='TENANT'||kind==='RESOURCE'?UUID:TEXT).test(value))throw new Error(`INVALID_${kind}`);
 return value;
}
function isoTime(value,label){
 if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value))throw new Error(`INVALID_${label}`);
 const millis=Date.parse(value);
 if(!Number.isFinite(millis)||new Date(millis).toISOString()!==value)throw new Error(`INVALID_${label}`);
 return millis;
}
function toIso(value){
 if(value instanceof Date)return value.toISOString();
 if(typeof value==='string')return new Date(value).toISOString();
 throw new Error('INVALID_DATABASE_TIMESTAMP');
}
function bookingResponse({tenantId,bookingId,resourceId,startAt,endAt,effectKey,status}){
 return {tenantId,bookingId,resourceId,startAt,endAt,effectKey,status};
}

export class PostgresTenantRepository {
 #pool;
 constructor({pool}={}) {
  if(typeof pool?.connect!=='function')throw new Error('PG_POOL_REQUIRED');
  this.#pool=pool;
 }
 async #authorized(tenantId,actorId,roles,work){
  requireId(tenantId,'TENANT');requireId(actorId,'ACTOR');
  const client=await this.#pool.connect();
  if(typeof client?.query!=='function'||typeof client?.release!=='function'){
   if(typeof client?.release==='function')client.release(new Error('PG_CLIENT_REQUIRED'));
   throw new Error('PG_CLIENT_REQUIRED');
  }
  let started=false, released=false;
  try{
   await client.query('BEGIN');started=true;
   // The true flag means transaction-local. Never issue SET SESSION.
   await client.query("SELECT set_config('app.tenant_id', $1, true)",[tenantId]);
   const membership=await client.query(`SELECT m.role FROM musitu.memberships AS m
    JOIN musitu.tenants AS t ON t.id=m.tenant_id
    WHERE m.tenant_id=$1 AND m.actor_id=$2
      AND m.status='ACTIVE' AND t.status='ACTIVE'`,[tenantId,actorId]);
   if(!membership.rows?.[0]||!roles.includes(membership.rows[0].role))throw new Error('ACCESS_DENIED');
   const value=await work(client);
   await client.query('COMMIT');started=false;
   return value;
  }catch(error){
   if(started){
    try{await client.query('ROLLBACK');}
    catch(rollbackError){
     // A dirty connection MUST NOT be reused in a pool if rollback failed.
     released=true;client.release(rollbackError);throw error;
    }
   }
   throw error;
  }finally{
   // release() on an already-discarded client must not run twice.
   if(!released)client.release();
  }
 }
 async snapshot(tenantId,actorId){
  return this.#authorized(tenantId,actorId,ROLES.snapshot,async client=>{
   const {rows}=await client.query(`SELECT
    (SELECT count(*) FROM musitu.inbound_events WHERE tenant_id=$1)::int AS inquiries,
    (SELECT count(*) FROM musitu.bookings WHERE tenant_id=$1 AND status='CONFIRMED')::int AS bookings,
    (SELECT count(*) FROM musitu.conversations WHERE tenant_id=$1 AND handling_mode='HUMAN')::int AS human_conversations`,[tenantId]);
   const r=rows[0];
   if(!r)throw new Error('NO_METRICS_RESULT');
   return {tenantId,inquiries:Number(r.inquiries),bookings:Number(r.bookings),humanConversations:Number(r.human_conversations),verifiedRevenue:null,revenueStatus:'NO_VERIFIED_PAYMENTS'};
  });
 }
 async listReplyDrafts(tenantId,actorId){
  return this.#authorized(tenantId,actorId,ROLES.drafts,async client=>{
   const {rows}=await client.query(`SELECT d.draft_id,d.conversation_id,d.source_faq_id,d.body,d.status,
      CASE WHEN EXISTS (SELECT 1 FROM musitu.customer_suppressions AS sup
             WHERE sup.tenant_id=d.tenant_id AND sup.conversation_id=d.conversation_id)
           THEN 'SUPPRESSED'
           WHEN d.body<>f.answer OR d.normalized_question<>f.normalized_question OR c.handling_mode<>'BOT'
           THEN 'REVIEW_EXPIRED'
           WHEN a.draft_id IS NULL THEN 'DRAFT' ELSE 'APPROVED_OFFLINE' END AS review_status
    FROM musitu.reply_drafts AS d
    LEFT JOIN musitu.draft_approvals AS a ON a.tenant_id=d.tenant_id AND a.draft_id=d.draft_id
    JOIN musitu.faqs AS f ON f.tenant_id=d.tenant_id AND f.faq_id=d.source_faq_id
    JOIN musitu.conversations AS c ON c.tenant_id=d.tenant_id AND c.conversation_id=d.conversation_id
    WHERE d.tenant_id=$1 ORDER BY d.created_at,d.draft_id`,[tenantId]);
   return rows.map(r=>({tenantId,draftId:r.draft_id,conversationId:r.conversation_id,
    sourceId:r.source_faq_id,body:r.body,status:r.review_status||r.status,providerDelivery:'NEVER_SUBMITTED'}));
  });
 }
 /**
  * A separate immutable review record; does NOT modify the draft, reserve an
  * outbound attempt, resolve the raw WhatsApp recipient or contact Meta.
  * The pinned membership and source are rechecked inside a single RLS-scoped
  * transaction, even for a duplicate approval request.
  */
 async approveReplyDraft({tenantId,actorId,draftId,approvalKey}={}){
  requireId(tenantId,'TENANT');requireId(actorId,'ACTOR');requireId(draftId,'RESOURCE');
  if(typeof approvalKey!=='string'||!approvalKey.trim()||approvalKey.length>180)throw new Error('INVALID_APPROVAL_KEY');
  return this.#authorized(tenantId,actorId,ROLES.drafts,async client=>{
   const {rows}=await client.query('SELECT * FROM musitu.draft_review_context($1,$2)',[actorId,draftId]);
   if(rows?.length!==1||rows[0].draft_status!=='DRAFT'||rows[0].handling_mode!=='BOT'||
      rows[0].body!==rows[0].source_answer||rows[0].normalized_question!==rows[0].source_question)
    throw new Error('DRAFT_REVIEW_REQUIRED');
   if(rows[0].customer_suppressed===true)throw new Error('CUSTOMER_OPT_OUT');
   const row=rows[0];
   const sourceDigest=createHash('sha256')
    .update(JSON.stringify([tenantId,draftId,row.source_faq_id,row.normalized_question,row.body])).digest('hex');
   let inserted;
   try{
    inserted=await client.query(`INSERT INTO musitu.draft_approvals
      (tenant_id,draft_id,actor_id,approval_key,source_digest)
      VALUES($1,$2,$3,$4,$5)
      ON CONFLICT (tenant_id,draft_id) DO NOTHING
      RETURNING tenant_id,draft_id,actor_id,approval_key,source_digest`,
      [tenantId,draftId,actorId,approvalKey,sourceDigest]);
   }catch(error){
    // A reused tenant-scoped approval_key can violate a second unique index;
    // treat that as a reviewer conflict, never as permission to overwrite.
    if(error.code==='23505')throw new Error('APPROVAL_CONFLICT',{cause:error});
    throw error;
   }
   let idempotent=false;
   if(inserted.rows?.length!==1){
    const existing=await client.query(`SELECT actor_id,approval_key,source_digest
     FROM musitu.draft_approvals WHERE tenant_id=$1 AND draft_id=$2`,[tenantId,draftId]);
    const record=existing.rows?.[0];
    if(existing.rows?.length!==1||record.actor_id!==actorId||record.approval_key!==approvalKey||record.source_digest!==sourceDigest)
     throw new Error('APPROVAL_CONFLICT');
    idempotent=true;
   }
   return {tenantId,draftId,reviewedBy:actorId,status:'APPROVED_OFFLINE',idempotent,providerDelivery:'NEVER_SUBMITTED'};
  });
 }
 /**
  * Offline-only outbound preparation. NO Meta send, send token, raw recipient,
  * provider attempt, queue, or message-template authorization is created.
  * Precondition evidence is rechecked for EVERY call, including replays.
  * A future sender must independently requalify Meta sessions and consent.
  */
 async stageApprovedReply({tenantId,actorId,draftId,reservationKey}={}){
  requireId(tenantId,'TENANT');requireId(actorId,'ACTOR');requireId(draftId,'RESOURCE');
  if(typeof reservationKey!=='string'||!reservationKey.trim()||reservationKey.length>180)
   throw new Error('INVALID_RESERVATION_KEY');
  return this.#authorized(tenantId,actorId,ROLES.stage,async client=>{
   // The customer-service window is measured using provider-signed MESSAGE
   // timestamp rather than server receipt time. A missing timestamp fails.
   // Five minutes' safety margin; the real Meta send is not authorized here.
   const {rows}=await client.query('SELECT * FROM musitu.staging_context($1,$2)',[actorId,draftId]);
   const d=rows?.[0];
   if(rows?.length!==1||d.reviewer_active!==true||d.draft_status!=='DRAFT'||d.handling_mode!=='BOT'||
     d.channel_status!=='VERIFIED'||d.body!==d.source_answer||
     d.normalized_question!==d.source_question||
     d.source_digest!==createHash('sha256')
      .update(JSON.stringify([tenantId,draftId,d.source_faq_id,d.normalized_question,d.body])).digest('hex'))
    throw new Error('DRAFT_NOT_STAGEABLE');
   if(d.customer_suppressed===true)throw new Error('CUSTOMER_OPT_OUT');
   if(d.session_active!==true)throw new Error('SESSION_WINDOW_CLOSED');
   const grant=await client.query('SELECT * FROM musitu.consent_context($1,$2,$3)',[actorId,d.phone_number_id,d.remote_wa_id]);
   const c=grant.rows?.[0];
   if(grant.rows?.length!==1||c.status!=='GRANTED'||c.scope!=='CUSTOMER_SERVICE'||
      c.valid!==true||typeof c.evidence_ref!=='string'||!c.evidence_ref)
    throw new Error('CONSENT_REQUIRED');
   const preparationId=randomUUID();
   const bodyDigest=createHash('sha256').update(d.body).digest('hex');
   let inserted;
   try{
    inserted=await client.query(`INSERT INTO musitu.outbound_preparations
      (tenant_id,preparation_id,draft_id,conversation_id,reservation_key,
       channel_phone_number_id,recipient_hash,source_digest,body_digest,status)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'STAGED_OFFLINE')
      ON CONFLICT DO NOTHING RETURNING preparation_id`,
      [tenantId,preparationId,draftId,d.conversation_id,reservationKey,d.phone_number_id,
       d.remote_wa_id,d.source_digest,bodyDigest]);
   }catch(error){if(error.code==='23505')throw new Error('STAGE_CONFLICT',{cause:error});throw error;}
   let stored=inserted.rows?.[0]?.preparation_id;
   let idempotent=false;
   if(!stored){
    const existing=await client.query(`SELECT preparation_id,draft_id,conversation_id,
      reservation_key,channel_phone_number_id,recipient_hash,source_digest,body_digest
      FROM musitu.outbound_preparations
      WHERE tenant_id=$1 AND (draft_id=$2 OR reservation_key=$3)`,[tenantId,draftId,reservationKey]);
    const x=existing.rows?.[0];
    if(existing.rows?.length!==1||x.draft_id!==draftId||x.conversation_id!==d.conversation_id||
       x.reservation_key!==reservationKey||x.channel_phone_number_id!==d.phone_number_id||
       x.recipient_hash!==d.remote_wa_id||x.source_digest!==d.source_digest||
       x.body_digest!==bodyDigest)throw new Error('STAGE_CONFLICT');
    stored=x.preparation_id;idempotent=true;
   }
   return {tenantId,draftId,preparationId:stored,status:'STAGED_OFFLINE',idempotent,
    providerDelivery:'NEVER_SUBMITTED',transport:'DISABLED'};
  });
 }
 /** Record a customer opt-out reported by an authenticated human employee.
  * Offline-only; no outbound channel or provider credentials are granted.
  */
 async suppressConversation({tenantId,actorId,conversationId,reason}={}){
  requireId(tenantId,'TENANT');requireId(actorId,'ACTOR');requireId(conversationId,'RESOURCE');
  if(reason!=='CUSTOMER_REQUEST')throw Error('INVALID_REASON');
  return this.#authorized(tenantId,actorId,ROLES.stage,async client=>{
   const {rows}=await client.query('SELECT * FROM musitu.suppression_context($1,$2)',[actorId,conversationId]);
   if(rows?.length!==1)throw Error('CONVERSATION_NOT_FOUND');
   const inserted=await client.query(`INSERT INTO musitu.customer_suppressions
    (tenant_id,conversation_id,phone_number_id,remote_wa_id,
     source_provider_message_id,source_kind,staff_actor_id)
    VALUES($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (tenant_id,conversation_id) DO NOTHING RETURNING conversation_id`,
    [tenantId,conversationId,rows[0].phone_number_id,rows[0].remote_wa_id,
     'staff:'+randomUUID(),'STAFF_ATTESTATION',actorId]);
   return {tenantId,conversationId,suppressed:true,idempotent:inserted.rows?.length!==1,
    transport:'DISABLED'};
  });
 }
 async handoverConversation({tenantId,actorId,conversationId}={}){
  requireId(tenantId,'TENANT');requireId(actorId,'ACTOR');requireId(conversationId,'RESOURCE');
  return this.#authorized(tenantId,actorId,ROLES.stage,async client=>{
   const {rows}=await client.query('SELECT musitu.handover($1,$2) AS changed',[actorId,conversationId]);
   if(rows.length!==1||typeof rows[0].changed!=='boolean')throw Error('COMMAND_RECEIPT_INVALID');
   return {tenantId,conversationId,mode:'HUMAN',idempotent:!rows[0].changed};
  });
 }
 async listStaff(tenantId,actorId){
  return this.#authorized(tenantId,actorId,['OWNER'],async client=>{
   const {rows}=await client.query('SELECT actor_id,role,status FROM musitu.memberships WHERE tenant_id=$1 ORDER BY actor_id',[tenantId]);
   return rows.map(r=>({memberId:r.actor_id,role:r.role,status:r.status}));
  });
 }
 async revokeMembership({tenantId,actorId,memberId}={}){
  requireId(memberId,'ACTOR');
  return this.#authorized(tenantId,actorId,['OWNER'],async client=>{
   const {rows}=await client.query('SELECT musitu.revoke_member($1,$2) AS changed',[actorId,memberId]);
   if(rows.length!==1||typeof rows[0].changed!=='boolean')throw Error('COMMAND_RECEIPT_INVALID');
   return {tenantId,memberId,revoked:true,idempotent:!rows[0].changed};
  });
 }
 async listActionAudit(tenantId,actorId){
  return this.#authorized(tenantId,actorId,['OWNER','ADMIN'],async client=>{
   const {rows}=await client.query('SELECT audit_id,actor_id,action,reference_id,recorded_at FROM musitu.action_audit WHERE tenant_id=$1 ORDER BY recorded_at,audit_id LIMIT 250',[tenantId]);
   return rows.map(r=>({tenantId,auditId:r.audit_id,actorId:r.actor_id,action:r.action,referenceId:r.reference_id,recordedAt:toIso(r.recorded_at)}));
  });
 }
 async listBookings(tenantId,actorId){
  return this.#authorized(tenantId,actorId,ROLES.snapshot,async client=>{
   const {rows}=await client.query(`SELECT booking_id,resource_id,start_at,end_at,source_idempotency_key,status
      FROM musitu.bookings WHERE tenant_id=$1 ORDER BY start_at,booking_id LIMIT 250`,[tenantId]);
   return rows.map(r=>({tenantId,bookingId:r.booking_id,resourceId:r.resource_id,
     startAt:toIso(r.start_at),endAt:toIso(r.end_at),effectKey:r.source_idempotency_key,status:r.status}));
  });
 }
 async listConversations(tenantId,actorId){
  return this.#authorized(tenantId,actorId,ROLES.snapshot,async client=>{
   const {rows}=await client.query(`SELECT c.conversation_id,c.phone_number_id,c.handling_mode,
      EXISTS (SELECT 1 FROM musitu.customer_suppressions AS sup
       WHERE sup.tenant_id=c.tenant_id AND sup.conversation_id=c.conversation_id) AS suppressed
      FROM musitu.conversations AS c WHERE c.tenant_id=$1 ORDER BY c.conversation_id LIMIT 250`,[tenantId]);
   return rows.map(r=>({tenantId,conversationId:r.conversation_id,channelId:r.phone_number_id,
     mode:r.handling_mode,suppressed:r.suppressed===true}));
  });
 }
 async lookupBookingByEffectKey(tenantId,actorId,effectKey){
  return this.#authorized(tenantId,actorId,ROLES.bookings,async client=>{
   if(typeof effectKey!=='string'||!effectKey.trim()||effectKey.length>180)throw Error('INVALID_EFFECT_KEY');
   const {rows}=await client.query('SELECT booking_id FROM musitu.bookings WHERE tenant_id=$1 AND source_idempotency_key=$2',[tenantId,effectKey]);
   return rows[0]?.booking_id||null;
  });
 }
 async reserveBooking({tenantId,actorId,resourceId,startAt,endAt,effectKey}={}){
  requireId(tenantId,'TENANT');requireId(actorId,'ACTOR');requireId(resourceId,'RESOURCE');
  if(typeof effectKey!=='string'||!effectKey.trim()||effectKey.length>180)throw new Error('INVALID_EFFECT_KEY');
  const start=isoTime(startAt,'START_TIME'),end=isoTime(endAt,'END_TIME');
  if(end<=start||end-start>12*60*60*1000)throw new Error('INVALID_BOOKING_INTERVAL');
  return this.#authorized(tenantId,actorId,ROLES.bookings,async client=>{
   const previous=await client.query(`SELECT booking_id,resource_id,start_at,end_at,status
    FROM musitu.bookings WHERE tenant_id=$1 AND source_idempotency_key=$2`,[tenantId,effectKey]);
   if(previous.rows.length){
    const r=previous.rows[0];
    if(r.resource_id!==resourceId||toIso(r.start_at)!==startAt||toIso(r.end_at)!==endAt)throw new Error('IDEMPOTENCY_CONFLICT');
    return bookingResponse({tenantId,bookingId:r.booking_id,resourceId,startAt,endAt,effectKey,status:r.status});
   }
   const resource=await client.query('SELECT resource_id FROM musitu.resources WHERE tenant_id=$1 AND resource_id=$2',[tenantId,resourceId]);
   if(!resource.rows.length)throw new Error('RESOURCE_NOT_FOUND');
   const bookingId=randomUUID();
   let inserted;
   try{
    inserted=await client.query(`INSERT INTO musitu.bookings
      (tenant_id,booking_id,resource_id,start_at,end_at,status,source_idempotency_key)
      VALUES ($1,$2,$3,$4,$5,'CONFIRMED',$6)
      ON CONFLICT (tenant_id,source_idempotency_key) DO NOTHING RETURNING booking_id`,
    [tenantId,bookingId,resourceId,startAt,endAt,effectKey]);
   }catch(error){
    if(error.code==='23P01')throw new Error('SLOT_UNAVAILABLE',{cause:error});
    throw error;
   }
   if(!inserted.rows?.length){
    // Concurrent equal idempotency request committed while we inserted.
    const after=await client.query(`SELECT booking_id,resource_id,start_at,end_at,status
      FROM musitu.bookings WHERE tenant_id=$1 AND source_idempotency_key=$2`,[tenantId,effectKey]);
    if(!after.rows?.length)throw new Error('IDEMPOTENCY_RACE_UNRESOLVED');
    const r=after.rows[0];
    if(r.resource_id!==resourceId||toIso(r.start_at)!==startAt||toIso(r.end_at)!==endAt)throw new Error('IDEMPOTENCY_CONFLICT');
    return bookingResponse({tenantId,bookingId:r.booking_id,resourceId,startAt,endAt,effectKey,status:r.status});
   }
   return bookingResponse({tenantId,bookingId:inserted.rows[0].booking_id,resourceId,startAt,endAt,effectKey,status:'CONFIRMED'});
  });
 }
}
