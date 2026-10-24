/**
 * PRIVATE LOOPBACK QUALIFICATION ONLY. SQLite provides restart persistence
 * for local tests; it does NOT validate PostgreSQL RLS, OIDC, Meta access,
 * production concurrency, consent or external service delivery.
 *
 * All state changes are confined to local storage, with no network egress.
 */
import {DatabaseSync} from 'node:sqlite';
import {createHash, createHmac, randomUUID, timingSafeEqual} from 'node:crypto';
import {verifyMetaSignature, resolveWebhookEvents} from '../core/channel.mjs';

function required(x,label,max=255) {
  if(typeof x!=='string'||!x.trim()||x.length>max)throw new Error(`INVALID_${label}`);
  return x;
}
const isoTime=(value,label)=>{
  if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value))throw new Error(`INVALID_${label}`);
  const epoch=Date.parse(value);
  if(!Number.isFinite(epoch)||new Date(epoch).toISOString()!==value)throw new Error(`INVALID_${label}`);
  return epoch;
};
const normalizeQuestion=(q)=>required(q,'QUESTION',1000).toLowerCase().replace(/\s+/g,' ').trim();
const MAX_WEBHOOK_BYTES=256*1024,MAX_WEBHOOK_EVENTS=50;

export class PrivateStageStore {
  #db; #key;
  constructor(path,{identityKey}={}){
    if(!Buffer.isBuffer(identityKey)||identityKey.length!==32)throw new Error('REQUIRES_32_BYTE_PRIVATE_IDENTITY_KEY');
    this.#key=Buffer.from(identityKey);
    this.#db=new DatabaseSync(path,{timeout:5000});
    this.#db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS stage_identity (id INTEGER PRIMARY KEY CHECK(id=1), key_fingerprint TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tenants (tenant_id TEXT PRIMARY KEY,legal_name TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('ACTIVE','SUSPENDED')));
      CREATE TABLE IF NOT EXISTS memberships (tenant_id TEXT NOT NULL,actor_id TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('OWNER','ADMIN','AGENT','VIEWER')),status TEXT NOT NULL CHECK(status IN ('ACTIVE','REVOKED')), PRIMARY KEY(tenant_id,actor_id),FOREIGN KEY(tenant_id) REFERENCES tenants(tenant_id));
      CREATE TABLE IF NOT EXISTS channels (tenant_id TEXT NOT NULL,waba_id TEXT NOT NULL,phone_number_id TEXT NOT NULL PRIMARY KEY,status TEXT NOT NULL CHECK(status IN ('VERIFIED','REVOKED')),UNIQUE(tenant_id,phone_number_id),UNIQUE(waba_id,phone_number_id),FOREIGN KEY(tenant_id) REFERENCES tenants(tenant_id));
      CREATE TABLE IF NOT EXISTS conversations (tenant_id TEXT NOT NULL,conversation_id TEXT NOT NULL,phone_number_id TEXT NOT NULL,mode TEXT NOT NULL CHECK(mode IN ('BOT','HUMAN')),PRIMARY KEY(tenant_id,conversation_id),UNIQUE(conversation_id),FOREIGN KEY(tenant_id,phone_number_id) REFERENCES channels(tenant_id,phone_number_id));
      CREATE TABLE IF NOT EXISTS customer_suppressions (
        tenant_id TEXT NOT NULL, phone_number_id TEXT NOT NULL, conversation_id TEXT NOT NULL,
        source_message_id TEXT NOT NULL, recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(tenant_id,conversation_id),
        FOREIGN KEY(tenant_id,conversation_id) REFERENCES conversations(tenant_id,conversation_id),
        FOREIGN KEY(tenant_id,phone_number_id) REFERENCES channels(tenant_id,phone_number_id));
      CREATE TABLE IF NOT EXISTS inbound_events (tenant_id TEXT NOT NULL,phone_number_id TEXT NOT NULL,provider_message_id TEXT NOT NULL,conversation_id TEXT NOT NULL,received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(tenant_id,phone_number_id,provider_message_id),FOREIGN KEY(tenant_id,phone_number_id) REFERENCES channels(tenant_id,phone_number_id));
      CREATE TABLE IF NOT EXISTS inbound_fingerprints (
        tenant_id TEXT NOT NULL,phone_number_id TEXT NOT NULL,provider_message_id TEXT NOT NULL,
        payload_fingerprint TEXT NOT NULL,
        PRIMARY KEY(tenant_id,phone_number_id,provider_message_id),
        FOREIGN KEY(tenant_id,phone_number_id,provider_message_id) REFERENCES inbound_events(tenant_id,phone_number_id,provider_message_id));
      CREATE TABLE IF NOT EXISTS stage_action_audit (
        audit_id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,actor_id TEXT NOT NULL,
        action TEXT NOT NULL,reference_id TEXT NOT NULL,recorded_at TEXT NOT NULL,
        prev_digest TEXT NOT NULL,digest TEXT NOT NULL,
        FOREIGN KEY(tenant_id) REFERENCES tenants(tenant_id));
      CREATE TRIGGER IF NOT EXISTS prevent_audit_update BEFORE UPDATE ON stage_action_audit
        BEGIN SELECT RAISE(ABORT,'AUDIT_APPEND_ONLY'); END;
      CREATE TRIGGER IF NOT EXISTS prevent_audit_delete BEFORE DELETE ON stage_action_audit
        BEGIN SELECT RAISE(ABORT,'AUDIT_APPEND_ONLY'); END;
      CREATE TABLE IF NOT EXISTS resources (tenant_id TEXT NOT NULL,resource_id TEXT NOT NULL,label TEXT NOT NULL,PRIMARY KEY(tenant_id,resource_id),FOREIGN KEY(tenant_id) REFERENCES tenants(tenant_id));
      CREATE TABLE IF NOT EXISTS bookings (tenant_id TEXT NOT NULL,booking_id TEXT NOT NULL,resource_id TEXT NOT NULL,start_epoch INTEGER NOT NULL,end_epoch INTEGER NOT NULL,effect_key TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('CONFIRMED','CANCELLED')),CHECK(end_epoch>start_epoch),PRIMARY KEY(tenant_id,booking_id),UNIQUE(tenant_id,effect_key),FOREIGN KEY(tenant_id,resource_id) REFERENCES resources(tenant_id,resource_id));
      CREATE INDEX IF NOT EXISTS idx_bookings_overlap ON bookings(tenant_id,resource_id,status,start_epoch,end_epoch);
      CREATE TRIGGER IF NOT EXISTS prevent_overlapping_booking_insert BEFORE INSERT ON bookings
      WHEN NEW.status='CONFIRMED' AND EXISTS (SELECT 1 FROM bookings b
        WHERE b.tenant_id=NEW.tenant_id AND b.resource_id=NEW.resource_id AND b.status='CONFIRMED'
        AND b.start_epoch<NEW.end_epoch AND b.end_epoch>NEW.start_epoch)
      BEGIN SELECT RAISE(ABORT,'SLOT_UNAVAILABLE'); END;
      CREATE TRIGGER IF NOT EXISTS prevent_overlapping_booking_update BEFORE UPDATE ON bookings
      WHEN NEW.status='CONFIRMED' AND EXISTS (SELECT 1 FROM bookings b
        WHERE b.tenant_id=NEW.tenant_id AND b.resource_id=NEW.resource_id AND b.status='CONFIRMED'
        AND b.booking_id<>NEW.booking_id AND b.start_epoch<NEW.end_epoch AND b.end_epoch>NEW.start_epoch)
      BEGIN SELECT RAISE(ABORT,'SLOT_UNAVAILABLE'); END;
      CREATE TABLE IF NOT EXISTS faqs (tenant_id TEXT NOT NULL,faq_id TEXT NOT NULL,normalized_question TEXT NOT NULL,answer TEXT NOT NULL,PRIMARY KEY(tenant_id,faq_id),UNIQUE(tenant_id,normalized_question),FOREIGN KEY(tenant_id) REFERENCES tenants(tenant_id));
      CREATE TABLE IF NOT EXISTS reply_drafts (
        tenant_id TEXT NOT NULL, draft_id TEXT NOT NULL, conversation_id TEXT NOT NULL,
        effect_key TEXT NOT NULL, normalized_question TEXT NOT NULL, source_id TEXT NOT NULL,
        body TEXT NOT NULL, status TEXT NOT NULL CHECK(status='DRAFT'),
        PRIMARY KEY(tenant_id,draft_id), UNIQUE(tenant_id,effect_key),
        FOREIGN KEY(tenant_id,conversation_id) REFERENCES conversations(tenant_id,conversation_id));
      CREATE TABLE IF NOT EXISTS synthetic_outbound_attempts (
        tenant_id TEXT NOT NULL, phone_number_id TEXT NOT NULL, provider_message_id TEXT NOT NULL,
        effect_key TEXT NOT NULL, origin TEXT NOT NULL CHECK(origin='OFFLINE_SYNTHETIC_ONLY'),
        PRIMARY KEY(tenant_id,phone_number_id,provider_message_id), UNIQUE(tenant_id,effect_key),
        FOREIGN KEY(tenant_id,phone_number_id) REFERENCES channels(tenant_id,phone_number_id));
      CREATE TABLE IF NOT EXISTS synthetic_delivery_events (
        tenant_id TEXT NOT NULL,phone_number_id TEXT NOT NULL,provider_message_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('SENT','DELIVERED','READ','FAILED')),
        provider_epoch INTEGER NOT NULL CHECK(provider_epoch>=0),
        PRIMARY KEY(tenant_id,phone_number_id,provider_message_id,status,provider_epoch),
        FOREIGN KEY(tenant_id,phone_number_id,provider_message_id)
          REFERENCES synthetic_outbound_attempts(tenant_id,phone_number_id,provider_message_id));
    `);
    const fingerprint=createHash('sha256').update(this.#key).digest('hex');
    const prior=this.#db.prepare('SELECT key_fingerprint FROM stage_identity WHERE id=1').get();
    if(prior && prior.key_fingerprint!==fingerprint){this.#db.close();throw new Error('STAGE_IDENTITY_KEY_CHANGED');}
    this.#db.prepare('INSERT OR IGNORE INTO stage_identity(id,key_fingerprint) VALUES (1,?)').run(fingerprint);
  }
  close(){this.#db.close();}
  #transaction(fn){
    this.#db.exec('BEGIN IMMEDIATE');
    try{const r=fn();this.#db.exec('COMMIT');return r;}
    catch(err){this.#db.exec('ROLLBACK');throw err;}
  }
  #recordAudit(tenantId,actorId,action,referenceId){
    const last=this.#db.prepare('SELECT digest FROM stage_action_audit WHERE tenant_id=? ORDER BY rowid DESC LIMIT 1').get(tenantId);
    const prevDigest=last?.digest||'GENESIS';
    const auditId=randomUUID(),recordedAt=new Date().toISOString();
    const digest=createHmac('sha256',this.#key).update(JSON.stringify([auditId,tenantId,actorId,action,referenceId,recordedAt,prevDigest])).digest('hex');
    this.#db.prepare(`INSERT INTO stage_action_audit VALUES(?,?,?,?,?,?,?,?)`)
      .run(auditId,tenantId,actorId,action,referenceId,recordedAt,prevDigest,digest);
  }
  listActionAudit(tenantId,actorId){
    this.#actor(tenantId,actorId,['OWNER','ADMIN']);
    const rows=this.#db.prepare('SELECT * FROM stage_action_audit WHERE tenant_id=? ORDER BY rowid').all(tenantId);
    let prevDigest='GENESIS';
    for(const e of rows){
      const actual=createHmac('sha256',this.#key).update(JSON.stringify([e.audit_id,e.tenant_id,e.actor_id,e.action,e.reference_id,e.recorded_at,e.prev_digest])).digest('hex');
      if(e.prev_digest!==prevDigest||e.digest!==actual)throw new Error('STAGE_AUDIT_INTEGRITY_FAILURE');
      prevDigest=actual;
    }
    return rows.map(e=>({auditId:e.audit_id,tenantId:e.tenant_id,actorId:e.actor_id,action:e.action,referenceId:e.reference_id,recordedAt:e.recorded_at}));
  }
  #actor(tenantId,actorId,roles){
    required(tenantId,'TENANT');required(actorId,'ACTOR');
    const row=this.#db.prepare(`SELECT m.role FROM memberships m JOIN tenants t ON t.tenant_id=m.tenant_id
      WHERE m.tenant_id=? AND m.actor_id=? AND m.status='ACTIVE' AND t.status='ACTIVE'`).get(tenantId,actorId);
    if(!row||!roles.includes(row.role))throw new Error('ACCESS_DENIED');
  }
  /** SEEDING IS A PRIVATE TEST HARNESS ONLY. Never expose over an HTTP endpoint. */
  seedTenant({tenantId,legalName,ownerId,wabaId,phoneNumberId}){
    for(const [x,k] of [[tenantId,'TENANT'],[legalName,'NAME'],[ownerId,'ACTOR'],[wabaId,'WABA'],[phoneNumberId,'PHONE']])required(x,k);
    return this.#transaction(()=>{
      this.#db.prepare("INSERT INTO tenants VALUES (?,?,'ACTIVE')").run(tenantId,legalName);
      this.#db.prepare("INSERT INTO memberships VALUES (?,?,'OWNER','ACTIVE')").run(tenantId,ownerId);
      this.#db.prepare("INSERT INTO channels VALUES (?,?,?,'VERIFIED')").run(tenantId,wabaId,phoneNumberId);
    });
  }
  /** Private operator role lifecycle. Identity subjects are assigned by an
   * external identity provider; this method cannot create or elevate members.
   * Never revoke an owner in this stage, to avoid last-owner lockout.
   */
  listStaff(tenantId,actorId){
    this.#actor(tenantId,actorId,['OWNER']);
    return this.#db.prepare(`SELECT actor_id AS memberId,role,status FROM memberships
      WHERE tenant_id=? ORDER BY actor_id`).all(tenantId);
  }
  revokeMembership({tenantId,actorId,memberId}={}){
    this.#actor(tenantId,actorId,['OWNER']);
    required(memberId,'MEMBER',255);
    if(memberId===actorId)throw new Error('OWNER_SELF_REVOCATION_DENIED');
    return this.#transaction(()=>{
      const m=this.#db.prepare('SELECT role,status FROM memberships WHERE tenant_id=? AND actor_id=?')
        .get(tenantId,memberId);
      if(!m)throw new Error('MEMBER_NOT_FOUND');
      if(m.role==='OWNER')throw new Error('OWNER_REVOCATION_DENIED');
      if(m.status==='REVOKED')return {tenantId,memberId,revoked:true,idempotent:true};
      this.#db.prepare("UPDATE memberships SET status='REVOKED' WHERE tenant_id=? AND actor_id=? AND status='ACTIVE'")
        .run(tenantId,memberId);
      this.#recordAudit(tenantId,actorId,'MEMBER_REVOKED',memberId);
      return {tenantId,memberId,revoked:true,idempotent:false};
    });
  }
  revokeChannel(tenantId,actorId,phoneNumberId){
    this.#actor(tenantId,actorId,['OWNER']);
    return this.#transaction(()=>{
      const c=this.#db.prepare('SELECT status FROM channels WHERE tenant_id=? AND phone_number_id=?').get(tenantId,phoneNumberId);
      if(!c)throw new Error('CHANNEL_NOT_FOUND');
      if(c.status==='REVOKED')return;
      this.#db.prepare("UPDATE channels SET status='REVOKED' WHERE tenant_id=? AND phone_number_id=?").run(tenantId,phoneNumberId);
      this.#recordAudit(tenantId,actorId,'CHANNEL_REVOKED',phoneNumberId);
    });
  }
  /** Preflight automation role before recording an inbound event. */
  preflightOfflineActors({rawBody,signature,appSecret,actorForTenant}){
    if(!Buffer.isBuffer(rawBody)||rawBody.length===0||rawBody.length>MAX_WEBHOOK_BYTES)throw new Error('WEBHOOK_BODY_LIMIT');
    if(!verifyMetaSignature(rawBody,signature,appSecret))throw new Error('INVALID_META_SIGNATURE');
    let payload;try{payload=JSON.parse(rawBody.toString('utf8'));}catch{throw new Error('INVALID_META_JSON');}
    const bindings=this.#db.prepare(`SELECT c.tenant_id as tenantId,c.waba_id as wabaId,c.phone_number_id as phoneNumberId
      FROM channels c JOIN tenants t ON t.tenant_id=c.tenant_id WHERE c.status='VERIFIED' AND t.status='ACTIVE'`).all();
    const receipts=resolveWebhookEvents(payload,bindings);
    if(receipts.length>MAX_WEBHOOK_EVENTS)throw new Error('WEBHOOK_EVENT_LIMIT');
    for(const tenantId of new Set(receipts.map(x=>x.tenantId))){
      const actorId=actorForTenant?.[tenantId];
      this.#actor(tenantId,actorId,['OWNER','ADMIN','AGENT']);
    }
    return receipts;
  }
  /** Only signed Meta envelopes may produce simulated inbound admissions. */
  ingestSignedWebhook({rawBody,signature,appSecret}){
    if(!Buffer.isBuffer(rawBody)||rawBody.length===0||rawBody.length>MAX_WEBHOOK_BYTES)throw new Error('WEBHOOK_BODY_LIMIT');
    if(!verifyMetaSignature(rawBody,signature,appSecret))throw new Error('INVALID_META_SIGNATURE');
    let payload;try{payload=JSON.parse(rawBody.toString('utf8'));}catch{throw new Error('INVALID_META_JSON');}
    const bindings=this.#db.prepare(`SELECT c.tenant_id as tenantId,c.waba_id as wabaId,c.phone_number_id as phoneNumberId
      FROM channels c JOIN tenants t ON t.tenant_id=c.tenant_id WHERE c.status='VERIFIED' AND t.status='ACTIVE'`).all();
    const canonical=resolveWebhookEvents(payload,bindings);
    const sources=new Map();
    const optouts=new Set();
    const fingerprints=new Map();
    const statuses=[];
    for(const entry of payload.entry){
      for(const change of entry.changes){
        if(change.field!=='messages')continue;
        const phoneNumberId=change.value?.metadata?.phone_number_id;
        const binding=bindings.find(b=>b.phoneNumberId===phoneNumberId && b.wabaId===entry.id);
        // resolveWebhookEvents also validates this binding, but status-only events
        // must be checked against the same authorized channel.
        if(!binding)throw new Error('UNAUTHORIZED_CHANNEL');
        for(const msg of change.value?.messages??[]){
          if(typeof msg.from!=='string'|| !/^\d{6,20}$/.test(msg.from))throw new Error('INVALID_CUSTOMER_ID');
          const key=JSON.stringify([entry.id,phoneNumberId,msg.id]);
          if(sources.has(key)&&sources.get(key)!==msg.from)throw new Error('CONFLICTING_CUSTOMER_ID');
          const fingerprint=createHmac('sha256',this.#key).update(JSON.stringify([binding.tenantId,entry.id,phoneNumberId,msg])).digest('hex');
          if(fingerprints.has(key)&&fingerprints.get(key)!==fingerprint)throw new Error('MESSAGE_PAYLOAD_CONFLICT');
          sources.set(key,msg.from);
          if(msg.type==='text'&&typeof msg.text?.body==='string'&&
             /^(?:STOP|UNSUBSCRIBE)$/i.test(msg.text.body.trim()))optouts.add(key);
          fingerprints.set(key,fingerprint);
        }
        if(change.value?.statuses!==undefined && !Array.isArray(change.value.statuses))throw new Error('INVALID_META_STATUS');
        for(const item of change.value?.statuses??[]){
          if(typeof item?.id!=='string'||!/^stage\.wamid\.[A-Za-z0-9._-]{1,180}$/.test(item.id) ||
              typeof item.status!=='string'||!['sent','delivered','read','failed'].includes(item.status) ||
              typeof item.timestamp!=='string'|| !/^\d{1,10}$/.test(item.timestamp))throw new Error('INVALID_META_STATUS');
          statuses.push({tenantId:binding.tenantId,phoneNumberId,providerMessageId:item.id,
            status:item.status.toUpperCase(),providerEpoch:Number(item.timestamp)});
        }
      }
    }
    if(canonical.length+statuses.length>MAX_WEBHOOK_EVENTS)throw new Error('WEBHOOK_EVENT_LIMIT');
    if(canonical.length===0 && statuses.length===0)return [];
    // All writes (message ingestion AND synthetic status reconciliation) are
    // atomic. A bad status must never partially acknowledge a valid message.
    return this.#transaction(()=>{
      const received=canonical.map(event=>{
        const sender=sources.get(JSON.stringify([event.wabaId,event.phoneNumberId,event.providerMessageId]));
        if(!sender)throw new Error('INVALID_CUSTOMER_ID');
        const conversationId=createHmac('sha256',this.#key).update(JSON.stringify([event.tenantId,event.phoneNumberId,sender])).digest('hex');
        const prior=this.#db.prepare(`SELECT conversation_id FROM inbound_events
          WHERE tenant_id=? AND phone_number_id=? AND provider_message_id=?`)
          .get(event.tenantId,event.phoneNumberId,event.providerMessageId);
        if(prior && prior.conversation_id!==conversationId)throw new Error('MESSAGE_SENDER_CONFLICT');
        const fingerprint=fingerprints.get(JSON.stringify([event.wabaId,event.phoneNumberId,event.providerMessageId]));
        if(prior){
          const recorded=this.#db.prepare(`SELECT payload_fingerprint FROM inbound_fingerprints
            WHERE tenant_id=? AND phone_number_id=? AND provider_message_id=?`)
            .get(event.tenantId,event.phoneNumberId,event.providerMessageId);
          if(!recorded||recorded.payload_fingerprint!==fingerprint)throw new Error('MESSAGE_PAYLOAD_CONFLICT');
        }
        if(!prior){
          this.#db.prepare("INSERT OR IGNORE INTO conversations(tenant_id,conversation_id,phone_number_id,mode) VALUES (?,?,?,'BOT')")
            .run(event.tenantId,conversationId,event.phoneNumberId);
          this.#db.prepare(`INSERT INTO inbound_events(tenant_id,phone_number_id,provider_message_id,conversation_id)
            VALUES (?,?,?,?)`).run(event.tenantId,event.phoneNumberId,event.providerMessageId,conversationId);
          this.#db.prepare(`INSERT INTO inbound_fingerprints(tenant_id,phone_number_id,provider_message_id,payload_fingerprint)
            VALUES (?,?,?,?)`).run(event.tenantId,event.phoneNumberId,event.providerMessageId,fingerprint);
        }
        if(optouts.has(JSON.stringify([event.wabaId,event.phoneNumberId,event.providerMessageId]))){
          const effect=this.#db.prepare(`INSERT OR IGNORE INTO customer_suppressions
            (tenant_id,phone_number_id,conversation_id,source_message_id) VALUES (?,?,?,?)`)
            .run(event.tenantId,event.phoneNumberId,conversationId,event.providerMessageId);
          if(effect.changes)this.#recordAudit(event.tenantId,'SIGNED_META_CUSTOMER','CUSTOMER_OPT_OUT',conversationId);
        }
        return {tenantId:event.tenantId,phoneNumberId:event.phoneNumberId,providerMessageId:event.providerMessageId,conversationId,status:prior?'DUPLICATE':'ACCEPTED'};
      });
      const statusReceipts=statuses.map(event=>{
        const known=this.#db.prepare(`SELECT 1 FROM synthetic_outbound_attempts
          WHERE tenant_id=? AND phone_number_id=? AND provider_message_id=?`)
          .get(event.tenantId,event.phoneNumberId,event.providerMessageId);
        if(!known)throw new Error('UNKNOWN_OUTBOUND_ATTEMPT');
        const inserted=this.#db.prepare(`INSERT OR IGNORE INTO synthetic_delivery_events
          (tenant_id,phone_number_id,provider_message_id,status,provider_epoch)
          VALUES (?,?,?,?,?)`).run(event.tenantId,event.phoneNumberId,event.providerMessageId,event.status,event.providerEpoch);
        return {...event,status:inserted.changes?event.status:'DUPLICATE_STATUS',origin:'OFFLINE_SYNTHETIC_ONLY'};
      });
      return [...received,...statusReceipts];
    });
  }

  addResource(tenantId,actorId,resourceId,label){
    this.#actor(tenantId,actorId,['OWNER','ADMIN']);required(resourceId,'RESOURCE');required(label,'LABEL');
    this.#db.prepare('INSERT INTO resources VALUES (?,?,?)').run(tenantId,resourceId,label);
  }
  reserveBooking({tenantId,actorId,resourceId,startAt,endAt,effectKey}){
    this.#actor(tenantId,actorId,['OWNER','ADMIN','AGENT']);
    required(resourceId,'RESOURCE');required(effectKey,'EFFECT_KEY');
    const start=isoTime(startAt,'START_TIME'),end=isoTime(endAt,'END_TIME');
    if(end<=start||end-start>12*3600*1000)throw new Error('INVALID_BOOKING_INTERVAL');
    return this.#transaction(()=>{
      const existing=this.#db.prepare('SELECT * FROM bookings WHERE tenant_id=? AND effect_key=?').get(tenantId,effectKey);
      if(existing){
        if(existing.resource_id!==resourceId||existing.start_epoch!==start||existing.end_epoch!==end)throw new Error('IDEMPOTENCY_CONFLICT');
        return {bookingId:existing.booking_id,tenantId,status:existing.status,startAt,endAt,resourceId,effectKey};
      }
      if(!this.#db.prepare('SELECT 1 FROM resources WHERE tenant_id=? AND resource_id=?').get(tenantId,resourceId))throw new Error('RESOURCE_NOT_FOUND');
      const overlap=this.#db.prepare(`SELECT 1 FROM bookings WHERE tenant_id=? AND resource_id=? AND status='CONFIRMED'
        AND start_epoch<? AND end_epoch>? LIMIT 1`).get(tenantId,resourceId,end,start);
      if(overlap)throw new Error('SLOT_UNAVAILABLE');
      const bookingId=randomUUID();
      this.#db.prepare("INSERT INTO bookings VALUES (?,?,?,?,?,?,'CONFIRMED')").run(tenantId,bookingId,resourceId,start,end,effectKey);
      this.#recordAudit(tenantId,actorId,'BOOKING_CREATED',bookingId);
      return {bookingId,tenantId,status:'CONFIRMED',startAt,endAt,resourceId,effectKey};
    });
  }
  handover(tenantId,actorId,conversationId){
    const {mode}=this.handoverConversation({tenantId,actorId,conversationId});
    return {tenantId,conversationId,mode};
  }
  /** This is an internal decision seam, not a public authorization function. */
  canBotReply(tenantId,conversationId){
    const r=this.#db.prepare('SELECT mode FROM conversations WHERE tenant_id=? AND conversation_id=?').get(tenantId,conversationId);
    if(!r)throw new Error('CONVERSATION_NOT_FOUND');
    if(this.#db.prepare('SELECT 1 FROM customer_suppressions WHERE tenant_id=? AND conversation_id=?').get(tenantId,conversationId))return false;
    return r.mode==='BOT';
  }
  putFaq(tenantId,actorId,faqId,question,answer){
    this.#actor(tenantId,actorId,['OWNER','ADMIN']);required(faqId,'FAQ_ID');required(answer,'ANSWER',4000);
    const normalized=normalizeQuestion(question);
    return this.#transaction(()=>{
      this.#db.prepare(`INSERT INTO faqs VALUES (?,?,?,?) ON CONFLICT(tenant_id,faq_id)
        DO UPDATE SET normalized_question=excluded.normalized_question,answer=excluded.answer`).run(tenantId,faqId,normalized,answer);
      this.#recordAudit(tenantId,actorId,'FAQ_SOURCE_UPDATED',faqId);
    });
  }
  answerFaq(tenantId,question){
    required(tenantId,'TENANT');
    const tenant=this.#db.prepare("SELECT 1 FROM tenants WHERE tenant_id=? AND status='ACTIVE'").get(tenantId);
    if(!tenant)throw new Error('TENANT_NOT_FOUND');
    const r=this.#db.prepare('SELECT faq_id,answer FROM faqs WHERE tenant_id=? AND normalized_question=?').get(tenantId,normalizeQuestion(question));
    return r?{status:'ANSWER',sourceId:r.faq_id,answer:r.answer}:{status:'HANDOVER_REQUIRED',reason:'NO_APPROVED_SOURCE'};
  }
  /** Source-grounded draft preparation. Never calls WhatsApp/AI providers. */
  draftApprovedFaqReply({tenantId,actorId,conversationId,question,effectKey}){
    this.#actor(tenantId,actorId,['OWNER','ADMIN','AGENT']);
    required(conversationId,'CONVERSATION');required(effectKey,'EFFECT_KEY',180);
    const normalized=normalizeQuestion(question);
    return this.#transaction(()=>{
      const convo=this.#db.prepare('SELECT mode FROM conversations WHERE tenant_id=? AND conversation_id=?')
        .get(tenantId,conversationId);
      if(!convo)throw new Error('CONVERSATION_NOT_FOUND');
      if(this.#db.prepare('SELECT 1 FROM customer_suppressions WHERE tenant_id=? AND conversation_id=?')
        .get(tenantId,conversationId))return {status:'SUPPRESSED',reason:'CUSTOMER_OPT_OUT'};
      if(convo.mode==='HUMAN')return {status:'HANDOVER_REQUIRED',reason:'HUMAN_HANDOVER'};
      const prior=this.#db.prepare('SELECT * FROM reply_drafts WHERE tenant_id=? AND effect_key=?').get(tenantId,effectKey);
      if(prior){
        if(prior.conversation_id!==conversationId||prior.normalized_question!==normalized)throw new Error('IDEMPOTENCY_CONFLICT');
        return {tenantId,draftId:prior.draft_id,conversationId,sourceId:prior.source_id,body:prior.body,status:'DRAFT',providerDelivery:'NEVER_SUBMITTED'};
      }
      const faq=this.#db.prepare('SELECT faq_id,answer FROM faqs WHERE tenant_id=? AND normalized_question=?')
        .get(tenantId,normalized);
      if(!faq){
        this.#db.prepare("UPDATE conversations SET mode='HUMAN' WHERE tenant_id=? AND conversation_id=?").run(tenantId,conversationId);
        this.#recordAudit(tenantId,actorId,'HUMAN_HANDOVER',conversationId);
        return {status:'HANDOVER_REQUIRED',reason:'NO_APPROVED_SOURCE'};
      }
      const draftId=randomUUID();
      this.#db.prepare(`INSERT INTO reply_drafts (tenant_id,draft_id,conversation_id,effect_key,normalized_question,source_id,body,status)
        VALUES (?,?,?,?,?,?,?,'DRAFT')`).run(tenantId,draftId,conversationId,effectKey,normalized,faq.faq_id,faq.answer);
      this.#recordAudit(tenantId,actorId,'DRAFT_CREATED',draftId);
      return {tenantId,draftId,conversationId,sourceId:faq.faq_id,body:faq.answer,status:'DRAFT',providerDelivery:'NEVER_SUBMITTED'};
    });
  }
  listReplyDrafts(tenantId,actorId){
    this.#actor(tenantId,actorId,['OWNER','ADMIN','AGENT']);
    return this.#db.prepare(`SELECT d.draft_id,d.conversation_id,d.source_id,d.body,d.status,
      EXISTS(SELECT 1 FROM customer_suppressions s WHERE s.tenant_id=d.tenant_id
        AND s.conversation_id=d.conversation_id) AS suppressed
      FROM reply_drafts d WHERE d.tenant_id=? ORDER BY d.rowid`)
      .all(tenantId).map(x=>({tenantId,draftId:x.draft_id,conversationId:x.conversation_id,
        sourceId:x.source_id,body:x.body,status:x.suppressed?'SUPPRESSED':x.status,providerDelivery:'NEVER_SUBMITTED'}));
  }
  /** Harness-only. Fabricated ids cannot be promoted to live provider evidence. */
  recordSyntheticOutboundAttempt({tenantId,actorId,phoneNumberId,providerMessageId,effectKey}){
    this.#actor(tenantId,actorId,['OWNER']);
    required(phoneNumberId,'PHONE');required(effectKey,'EFFECT_KEY',180);
    if(typeof providerMessageId!=='string'|| !/^stage\.wamid\.[A-Za-z0-9._-]{1,180}$/.test(providerMessageId))throw new Error('SYNTHETIC_ONLY');
    const c=this.#db.prepare("SELECT 1 FROM channels WHERE tenant_id=? AND phone_number_id=? AND status='VERIFIED'")
      .get(tenantId,phoneNumberId);
    if(!c)throw new Error('UNAUTHORIZED_CHANNEL');
    return this.#transaction(()=>{
      const byId=this.#db.prepare(`SELECT effect_key FROM synthetic_outbound_attempts
        WHERE tenant_id=? AND phone_number_id=? AND provider_message_id=?`).get(tenantId,phoneNumberId,providerMessageId);
      if(byId){if(byId.effect_key!==effectKey)throw new Error('OUTBOUND_PROVIDER_CONFLICT');return {status:'REGISTERED_SYNTHETIC'};}
      const byEffect=this.#db.prepare('SELECT provider_message_id FROM synthetic_outbound_attempts WHERE tenant_id=? AND effect_key=?').get(tenantId,effectKey);
      if(byEffect)throw new Error('OUTBOUND_EFFECT_CONFLICT');
      this.#db.prepare("INSERT INTO synthetic_outbound_attempts VALUES (?,?,?,?,'OFFLINE_SYNTHETIC_ONLY')")
        .run(tenantId,phoneNumberId,providerMessageId,effectKey);
      return {status:'REGISTERED_SYNTHETIC'};
    });
  }
  listSyntheticDeliveryEvents(tenantId,actorId){
    this.#actor(tenantId,actorId,['OWNER','ADMIN','AGENT','VIEWER']);
    return this.#db.prepare(`SELECT phone_number_id,provider_message_id,status,provider_epoch
      FROM synthetic_delivery_events WHERE tenant_id=? ORDER BY rowid`).all(tenantId);
  }
  getSyntheticDeliveryState(tenantId,actorId,providerMessageId){
    this.#actor(tenantId,actorId,['OWNER','ADMIN','AGENT','VIEWER']);
    const attempt=this.#db.prepare('SELECT 1 FROM synthetic_outbound_attempts WHERE tenant_id=? AND provider_message_id=?')
      .get(tenantId,providerMessageId);
    if(!attempt)throw new Error('UNKNOWN_OUTBOUND_ATTEMPT');
    const statuses=this.#db.prepare('SELECT DISTINCT status FROM synthetic_delivery_events WHERE tenant_id=? AND provider_message_id=?')
      .all(tenantId,providerMessageId).map(x=>x.status);
    return ['READ','DELIVERED','FAILED','SENT'].find(x=>statuses.includes(x))||'SYNTHETIC_REGISTERED';
  }
  /** Owner/agent attests an off-WhatsApp customer request. No automatic resubscription. */
  suppressConversation({tenantId,actorId,conversationId,reason}={}){
    this.#actor(tenantId,actorId,['OWNER','ADMIN','AGENT']);
    required(conversationId,'CONVERSATION');
    if(reason!=='CUSTOMER_REQUEST')throw Error('INVALID_REASON');
    return this.#transaction(()=>{
      const c=this.#db.prepare('SELECT phone_number_id FROM conversations WHERE tenant_id=? AND conversation_id=?')
        .get(tenantId,conversationId);
      if(!c)throw Error('CONVERSATION_NOT_FOUND');
      const effect=this.#db.prepare(`INSERT OR IGNORE INTO customer_suppressions
        (tenant_id,phone_number_id,conversation_id,source_message_id) VALUES(?,?,?,?)`)
        .run(tenantId,c.phone_number_id,conversationId,'staff:'+randomUUID());
      if(effect.changes)this.#recordAudit(tenantId,actorId,'CUSTOMER_OPT_OUT_RECORDED',conversationId);
      return {tenantId,conversationId,suppressed:true,idempotent:!effect.changes,transport:'DISABLED'};
    });
  }
  handoverConversation({tenantId,actorId,conversationId}={}){
    this.#actor(tenantId,actorId,['OWNER','ADMIN','AGENT']);required(conversationId,'CONVERSATION');
    return this.#transaction(()=>{
      const current=this.#db.prepare('SELECT mode FROM conversations WHERE tenant_id=? AND conversation_id=?').get(tenantId,conversationId);
      if(!current)throw new Error('CONVERSATION_NOT_FOUND');
      if(current.mode!=='HUMAN'){
        this.#db.prepare("UPDATE conversations SET mode='HUMAN' WHERE tenant_id=? AND conversation_id=?").run(tenantId,conversationId);
        this.#recordAudit(tenantId,actorId,'HUMAN_HANDOVER',conversationId);
      }
      return {tenantId,conversationId,mode:'HUMAN',idempotent:current.mode==='HUMAN'};
    });
  }
  listBookings(tenantId,actorId){
    this.#actor(tenantId,actorId,['OWNER','ADMIN','AGENT','VIEWER']);
    return this.#db.prepare(`SELECT booking_id,resource_id,start_epoch,end_epoch,effect_key,status
      FROM bookings WHERE tenant_id=? ORDER BY start_epoch,booking_id LIMIT 250`).all(tenantId)
      .map(r=>({tenantId,bookingId:r.booking_id,resourceId:r.resource_id,
        startAt:new Date(r.start_epoch).toISOString(),endAt:new Date(r.end_epoch).toISOString(),
        effectKey:r.effect_key,status:r.status}));
  }
  listConversations(tenantId,actorId){
    this.#actor(tenantId,actorId,['OWNER','ADMIN','AGENT','VIEWER']);
    return this.#db.prepare(`SELECT c.conversation_id,c.phone_number_id,c.mode,
      EXISTS(SELECT 1 FROM customer_suppressions s WHERE s.tenant_id=c.tenant_id
      AND s.conversation_id=c.conversation_id) AS suppressed
      FROM conversations c WHERE c.tenant_id=? ORDER BY c.conversation_id LIMIT 250`).all(tenantId)
      .map(r=>({tenantId,conversationId:r.conversation_id,channelId:r.phone_number_id,mode:r.mode,suppressed:!!r.suppressed}));
  }
  lookupBookingByEffectKey(tenantId,actorId,effectKey){
    this.#actor(tenantId,actorId,['OWNER','ADMIN','AGENT']);required(effectKey,'EFFECT_KEY',180);
    return this.#db.prepare('SELECT booking_id FROM bookings WHERE tenant_id=? AND effect_key=?').get(tenantId,effectKey)?.booking_id||null;
  }
  snapshot(tenantId,actorId){
    this.#actor(tenantId,actorId,['OWNER','ADMIN','AGENT','VIEWER']);
    const inquiries=this.#db.prepare('SELECT count(*) as n FROM inbound_events WHERE tenant_id=?').get(tenantId).n;
    const bookings=this.#db.prepare("SELECT count(*) as n FROM bookings WHERE tenant_id=? AND status='CONFIRMED'").get(tenantId).n;
    const humanConversations=this.#db.prepare("SELECT count(*) as n FROM conversations WHERE tenant_id=? AND mode='HUMAN'").get(tenantId).n;
    return {tenantId,inquiries,bookings,humanConversations,verifiedRevenue:null,revenueStatus:'NO_VERIFIED_PAYMENTS'};
  }
}
