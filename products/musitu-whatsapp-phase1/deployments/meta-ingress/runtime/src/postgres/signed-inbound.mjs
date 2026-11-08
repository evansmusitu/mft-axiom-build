import {encryptLedger} from '../security/ledger-encryption.mjs';
import {createRuntimeRoleBoundPool} from './runtime-role-guard.mjs';
import {isMetaMessageId} from '../adapters/meta-message-id.mjs';
/**
 * CANDIDATE for a private signed-Meta -> PostgreSQL ingress boundary.
 * Does not send WhatsApp messages. No public HTTP listener is included here.
 * Operator provisions WABA+phone -> tenant bindings OUT OF BAND; never trust a
 * caller's tenant_id. A dedicated non-owner ingress SQL role is mandatory.
 * Requires migration 004 and native PostgreSQL 17 + real Meta qualification.
 */
import {createHmac,createHash,randomUUID} from 'node:crypto';
import {verifyMetaSignature} from '../core/channel.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VALID_ID=/^[A-Za-z0-9_.:-]{1,160}$/;
const REMOTE=/^[0-9]{6,20}$/;
const META_STATUS=new Set(['sent','delivered','read','failed']);
const STATUS_TO_OUTBOUND=Object.freeze({sent:'ACCEPTED',delivered:'DELIVERED',read:'DELIVERED',failed:'FAILED'});
const STATUS_RANK=Object.freeze({RESERVED:0,UNKNOWN:0,ACCEPTED:1,DELIVERED:2,FAILED:3});
const MAX_BYTES=256*1024,MAX_EVENTS=50;
const fail=code=>{throw new Error(code);};
function requiredText(value,re,max){return typeof value==='string'&&value.length<=max&&re.test(value);}
// Preserve existing generic ids used by offline fixtures; only message ids gain
// Meta's base64 alphabet. Channel, WABA and tenant validators are unchanged.
const messageId=value=>requiredText(value,VALID_ID,160)||isMetaMessageId(value);
function classifyPayload(raw,bindings,key){
 let payload;
 try{payload=JSON.parse(raw.toString('utf8'));}catch{fail('INVALID_META_JSON');}
 if(payload?.object!=='whatsapp_business_account'||!Array.isArray(payload.entry)||payload.entry.length>20)fail('INVALID_META_WEBHOOK');
 const events=[],uniques=new Map();let batchKind=null;
 for(const entry of payload.entry){
  if(!requiredText(entry?.id,VALID_ID,160)||!Array.isArray(entry.changes))fail('INVALID_META_WEBHOOK');
  for(const change of entry.changes){
   if(change.field!=='messages')fail('UNSUPPORTED_META_CHANGE');
   const value=change.value;
   const phoneId=value?.metadata?.phone_number_id;
   if(!requiredText(phoneId,VALID_ID,160))fail('UNAUTHORIZED_CHANNEL');
   const matches=bindings.filter(b=>b.wabaId===entry.id&&b.phoneNumberId===phoneId);
   if(matches.length!==1)fail('UNAUTHORIZED_CHANNEL');
   const statusKind=value.statuses!==undefined;
   const messageKind=value.messages!==undefined;
   if(statusKind&&messageKind)fail('MIXED_META_EVENT_TYPES');
   if(!statusKind&&!messageKind)fail('INVALID_META_WEBHOOK');
   const kind=statusKind?'status':'message';
   if(batchKind&&batchKind!==kind)fail('MIXED_META_EVENT_TYPES');
   batchKind=kind;
   const list=statusKind?value.statuses:value.messages;
   if(!Array.isArray(list))fail(statusKind?'INVALID_META_STATUS':'INVALID_META_WEBHOOK');
   for(const item of list){
    const tenantId=matches[0].tenantId;
    let event,eventKey;
    if(statusKind){
     if(!messageId(item?.id)||!META_STATUS.has(item?.status)||
         typeof item?.timestamp!=='string'||!/^\d{10}$/.test(item.timestamp)||
         !requiredText(item?.recipient_id,REMOTE,20))fail('INVALID_META_STATUS');
     const fingerprint=createHmac('sha256',key).update(JSON.stringify([tenantId,entry.id,phoneId,item])).digest('hex');
     const remoteId='hmac256:'+createHmac('sha256',key).update(JSON.stringify(['remote',tenantId,phoneId,item.recipient_id])).digest('hex');
     const providerTimestamp=new Date(Number(item.timestamp)*1000);
     if(!Number.isFinite(providerTimestamp.getTime()))fail('INVALID_META_STATUS');
     event={kind,tenantId,wabaId:entry.id,phoneNumberId:phoneId,messageId:item.id,status:item.status.toUpperCase(),
       providerTimestamp:providerTimestamp.toISOString(),fingerprint,remoteId,remoteRaw:item.recipient_id};
     eventKey=JSON.stringify([kind,tenantId,phoneId,item.id,item.status,item.timestamp]);
    }else{
     if(!messageId(item?.id)||!requiredText(item?.from,REMOTE,20)||typeof item.type!=='string')fail('INVALID_META_WEBHOOK');
     if(item.timestamp!==undefined&&(typeof item.timestamp!=='string'||!/^\d{10}$/.test(item.timestamp)))fail('INVALID_META_TIMESTAMP');
     const text=item.type==='text'&&typeof item.text?.body==='string'?item.text.body:'';
     const isText=item.type==='text'&&text.trim().length>0&&text.length<=1000;
     const normalized=isText?text.toLowerCase().replace(/\s+/g,' ').trim():null;
     const fingerprint=createHmac('sha256',key).update(JSON.stringify([tenantId,entry.id,phoneId,item])).digest('hex');
     const remoteId='hmac256:'+createHmac('sha256',key).update(JSON.stringify(['remote',tenantId,phoneId,item.from])).digest('hex');
     event={kind,tenantId,wabaId:entry.id,phoneNumberId:phoneId,messageId:item.id,fingerprint,remoteId,normalized,remoteRaw:item.from,textBody:isText?text:'[Unsupported message: human review required]',
       providerSentAt:item.timestamp===undefined?null:new Date(Number(item.timestamp)*1000).toISOString()};
     eventKey=JSON.stringify([kind,tenantId,phoneId,item.id]);
    }
    if(uniques.has(eventKey)){
     if(uniques.get(eventKey)!==event.fingerprint)fail(statusKind?'STATUS_REPLAY_CONFLICT':'CONFLICTING_DUPLICATE_MESSAGE');
     continue;
    }
    uniques.set(eventKey,event.fingerprint);events.push(event);
    if(events.length>MAX_EVENTS)fail('WEBHOOK_EVENT_LIMIT');
   }
  }
 }
 if(events.some(e=>e.tenantId!==events[0].tenantId))fail('MULTI_TENANT_BATCH_DENIED');
 return events;
}
export class PostgresSignedWebhookIngestor {
 #pool;#appSecret;#bindings;#privacyKey;#contentKey;#allowedRecipients;
 constructor({pool,appSecret,bindings,privacyKey,contentEncryptionKey,allowedDevelopmentRecipients}={}){
  if(typeof pool?.connect!=='function'||typeof appSecret!=='string'||!appSecret||
     !Buffer.isBuffer(privacyKey)||privacyKey.length!==32||!Array.isArray(bindings)||bindings.length===0||bindings.length>1000)
   fail('PG_INGRESS_CONFIG_REQUIRED');
  const seen=new Set();
  for(const binding of bindings){
   if(!UUID.test(binding?.tenantId)||!requiredText(binding.wabaId,VALID_ID,160)||!requiredText(binding.phoneNumberId,VALID_ID,160))fail('PG_BINDING_INVALID');
   const id=JSON.stringify([binding.wabaId,binding.phoneNumberId]);
   if(seen.has(id))fail('PG_BINDING_CONFLICT');seen.add(id);
  }
  if(contentEncryptionKey!==undefined&&(!Buffer.isBuffer(contentEncryptionKey)||contentEncryptionKey.length!==32))fail('CONTENT_KEY_REQUIRED');
  this.#contentKey=contentEncryptionKey===undefined?null:Buffer.from(contentEncryptionKey);
  if(allowedDevelopmentRecipients!==undefined&&(!Array.isArray(allowedDevelopmentRecipients)||allowedDevelopmentRecipients.length<1||allowedDevelopmentRecipients.length>5||allowedDevelopmentRecipients.some(x=>typeof x!=='string'||!REMOTE.test(x))))fail('DEVELOPMENT_RECIPIENT_CONFIG_REQUIRED');
  this.#allowedRecipients=allowedDevelopmentRecipients===undefined?null:new Set(allowedDevelopmentRecipients);
  this.#pool=pool;this.#appSecret=appSecret;
  this.#bindings=bindings.map(x=>Object.freeze({...x}));
  this.#privacyKey=Buffer.from(privacyKey);
 }
 async ingest({rawBody,signature}={}){
  if(!Buffer.isBuffer(rawBody)||rawBody.length===0||rawBody.length>MAX_BYTES)fail('WEBHOOK_BODY_LIMIT');
  if(!verifyMetaSignature(rawBody,signature,this.#appSecret))fail('INVALID_META_SIGNATURE');
  const events=classifyPayload(rawBody,this.#bindings,this.#privacyKey);
  if(events.length===0)return [];
  if(this.#allowedRecipients&&events.some(e=>!this.#allowedRecipients.has(e.remoteRaw)))fail('DEVELOPMENT_RECIPIENT_NOT_ALLOWED');
  const tenantId=events[0].tenantId;
  const client=await this.#pool.connect();
  if(typeof client?.query!=='function'||typeof client?.release!=='function'){
   if(typeof client?.release==='function')client.release(new Error('PG_CLIENT_REQUIRED'));
   fail('PG_CLIENT_REQUIRED');
  }
  let started=false,discarded=false;
  try{
   await client.query('BEGIN');started=true;
   await client.query("SELECT set_config('app.tenant_id', $1, true)",[tenantId]);
   const tenant=await client.query("SELECT id FROM musitu.tenants WHERE id=$1 AND status='ACTIVE'",[tenantId]);
   if(tenant.rows?.length!==1)fail('UNAUTHORIZED_TENANT');
   const receipts=[];
   for(const e of events){
    const authorized=await client.query(`SELECT phone_number_id FROM musitu.whatsapp_channels
     WHERE tenant_id=$1 AND waba_id=$2 AND phone_number_id=$3 AND status='VERIFIED'`,
     [tenantId,e.wabaId,e.phoneNumberId]);
    if(authorized.rows?.length!==1)fail('UNAUTHORIZED_CHANNEL');
    if(e.kind==='status'){
     const attempt=await client.query(`SELECT status,recipient_hash FROM musitu.outbound_attempts
      WHERE tenant_id=$1 AND channel_phone_number_id=$2 AND provider_message_id=$3 FOR UPDATE`,
      [tenantId,e.phoneNumberId,e.messageId]);
     const prior=attempt.rows?.[0];
     if(attempt.rows?.length!==1||!prior.recipient_hash||prior.recipient_hash!==e.remoteId)fail('UNKNOWN_OR_UNBOUND_OUTBOUND');
     const priorRank=STATUS_RANK[prior.status];
     if(priorRank===undefined)fail('STATUS_STATE_CONFLICT');
     const next=STATUS_TO_OUTBOUND[e.status.toLowerCase()];
     if((prior.status==='FAILED'&&next!=='FAILED') || (prior.status==='DELIVERED'&&next==='FAILED'))fail('STATUS_STATE_CONFLICT');
     const inserted=await client.query(`INSERT INTO musitu.message_status_events
      (tenant_id,phone_number_id,provider_message_id,status,provider_timestamp,payload_fingerprint)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (tenant_id,phone_number_id,provider_message_id,status,provider_timestamp) DO NOTHING
      RETURNING provider_message_id`,
      [tenantId,e.phoneNumberId,e.messageId,e.status,e.providerTimestamp,e.fingerprint]);
     let result='RECORDED';
     if(!inserted.rows?.length){
      const original=await client.query(`SELECT payload_fingerprint FROM musitu.message_status_events
       WHERE tenant_id=$1 AND phone_number_id=$2 AND provider_message_id=$3 AND status=$4 AND provider_timestamp=$5`,
       [tenantId,e.phoneNumberId,e.messageId,e.status,e.providerTimestamp]);
      if(original.rows?.length!==1||original.rows[0].payload_fingerprint!==e.fingerprint)fail('STATUS_REPLAY_CONFLICT');
      result='DUPLICATE';
     } else if(STATUS_RANK[next]>priorRank){
      const changed=await client.query(`UPDATE musitu.outbound_attempts SET status=$4
       WHERE tenant_id=$1 AND channel_phone_number_id=$2 AND provider_message_id=$3`,
       [tenantId,e.phoneNumberId,e.messageId,next]);
      if(changed.rowCount!==1)fail('STATUS_UPDATE_CONFLICT');
     }
     receipts.push({tenantId,phoneNumberId:e.phoneNumberId,providerMessageId:e.messageId,status:e.status,result});
     continue;
    }
    const conversationId=randomUUID();
    await client.query(`INSERT INTO musitu.conversations
     (tenant_id,conversation_id,phone_number_id,remote_wa_id,handling_mode)
     VALUES ($1,$2,$3,$4,'BOT')
     ON CONFLICT (tenant_id,phone_number_id,remote_wa_id) DO NOTHING`,
     [tenantId,conversationId,e.phoneNumberId,e.remoteId]);
    const convo=await client.query(`SELECT conversation_id, handling_mode FROM musitu.conversations
     WHERE tenant_id=$1 AND phone_number_id=$2 AND remote_wa_id=$3 FOR UPDATE`,[tenantId,e.phoneNumberId,e.remoteId]);
    if(convo.rows?.length!==1)fail('CONVERSATION_SCOPE_FAILURE');
    const actualConversation=convo.rows[0].conversation_id;
    const inserted=await client.query(`INSERT INTO musitu.inbound_events
     (tenant_id,phone_number_id,provider_message_id,conversation_id,payload_fingerprint,provider_sent_at)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (tenant_id,phone_number_id,provider_message_id) DO NOTHING
     RETURNING provider_message_id`,[tenantId,e.phoneNumberId,e.messageId,actualConversation,e.fingerprint,e.providerSentAt]);
    if(!inserted.rows?.length){
     const original=await client.query(`SELECT conversation_id,payload_fingerprint FROM musitu.inbound_events
      WHERE tenant_id=$1 AND phone_number_id=$2 AND provider_message_id=$3`,[tenantId,e.phoneNumberId,e.messageId]);
     const prior=original.rows?.[0];
     if(!prior||prior.conversation_id!==actualConversation||prior.payload_fingerprint!==e.fingerprint)
       fail('MESSAGE_SENDER_OR_CONTENT_CONFLICT');
     receipts.push({tenantId,phoneNumberId:e.phoneNumberId,providerMessageId:e.messageId,
       conversationId:actualConversation,status:'DUPLICATE',draftStatus:'UNCHANGED'});
     continue;
    }
    if(this.#contentKey){
     await client.query(`INSERT INTO musitu.contacts(tenant_id,phone_number_id,remote_hash,encrypted_recipient)
      VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,[tenantId,e.phoneNumberId,e.remoteId,
      encryptLedger(e.remoteRaw,this.#contentKey,[tenantId,e.phoneNumberId,'contact:'+e.remoteId])]);
     await client.query(`INSERT INTO musitu.messages(tenant_id,phone_number_id,provider_message_id,conversation_id,encrypted_body)
      VALUES($1,$2,$3,$4,$5)`,[tenantId,e.phoneNumberId,e.messageId,actualConversation,
      encryptLedger(e.textBody,this.#contentKey,[tenantId,e.phoneNumberId,e.messageId])]);
    }
    let draftStatus='HANDOVER_REQUIRED';
    const isOptOut=e.normalized==='stop'||e.normalized==='unsubscribe';
    if(isOptOut){
     await client.query(`INSERT INTO musitu.customer_suppressions
      (tenant_id,conversation_id,phone_number_id,remote_wa_id,source_provider_message_id)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT (tenant_id,conversation_id) DO NOTHING`,
      [tenantId,actualConversation,e.phoneNumberId,e.remoteId,e.messageId]);
    }
    const revoked=await client.query(`SELECT conversation_id FROM musitu.customer_suppressions
      WHERE tenant_id=$1 AND conversation_id=$2`,[tenantId,actualConversation]);
    if(isOptOut||revoked.rows?.length){
      draftStatus='SUPPRESSED';
    }else if(convo.rows[0].handling_mode==='BOT'&&e.normalized){
     const found=await client.query(`SELECT faq_id,answer FROM musitu.faqs
      WHERE tenant_id=$1 AND normalized_question=$2`,[tenantId,e.normalized]);
     if(found.rows?.length===1){
      const effectKey='inbound:'+createHash('sha256').update(JSON.stringify([tenantId,e.phoneNumberId,e.messageId])).digest('hex');
      const draftId=randomUUID();
      const created=await client.query(`INSERT INTO musitu.reply_drafts
       (tenant_id,draft_id,conversation_id,effect_key,normalized_question,source_faq_id,body,status)
       VALUES($1,$2,$3,$4,$5,$6,$7,'DRAFT')
       ON CONFLICT (tenant_id,effect_key) DO NOTHING RETURNING draft_id`,
       [tenantId,draftId,actualConversation,effectKey,e.normalized,found.rows[0].faq_id,found.rows[0].answer]);
      if(created.rows?.length!==1)fail('DRAFT_EFFECT_CONFLICT');
      draftStatus='DRAFT';
     }
    }
    if(draftStatus==='HANDOVER_REQUIRED'&&convo.rows[0].handling_mode!=='HUMAN')
     await client.query("UPDATE musitu.conversations SET handling_mode='HUMAN' WHERE tenant_id=$1 AND conversation_id=$2",[tenantId,actualConversation]);
    receipts.push({tenantId,phoneNumberId:e.phoneNumberId,providerMessageId:e.messageId,
      conversationId:actualConversation,status:'ACCEPTED',draftStatus});
   }
   await client.query('COMMIT');started=false;
   return receipts;
  }catch(e){
   if(started)try{await client.query('ROLLBACK');}catch(failure){discarded=true;client.release(failure);}
   throw e;
  }finally{if(!discarded)client.release();}
 }
}

/**
 * Explicit runtime role-fenced ingress boundary. Every signed batch leases its
 * own connection and verifies the effective role is non-superuser/non-BYPASSRLS
 * before BEGIN or any scoped SQL. Native ingress grants, policies and consent
 * still require independent qualification; this is NOT live Meta authorization.
 */
export function createRoleBoundSignedWebhookIngestor({pool,expectedRole,...config}={}) {
 return new PostgresSignedWebhookIngestor({
  ...config,pool:createRuntimeRoleBoundPool({pool,expectedRole})
 });
}
