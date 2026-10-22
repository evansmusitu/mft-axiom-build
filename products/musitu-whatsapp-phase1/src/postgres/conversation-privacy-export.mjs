/** Operator-review export only. No HTTP route, delivery, data erasure or permission
 * grant. The caller must supply a verified session recheck, approved request scope,
 * and a fresh export key. A bundle is not a completed subject-access request.
 */
import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import {createRuntimeRoleBoundPool} from './runtime-role-guard.mjs';
import {decryptLedger} from '../security/ledger-encryption.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTOR=/^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,191}$/;
const REQUEST=/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const HEADER=Buffer.from('MUSITU_CONVERSATION_EXPORT_V1\0');
const BYTE_LIMIT=2*1024*1024,ROW_LIMIT=1000;
const keyOK=k=>Buffer.isBuffer(k)&&k.length===32;
const matches=(pattern,value)=>typeof value==='string'&&pattern.test(value);
const binding=({tenantId,conversationId,requestId})=>Buffer.from(JSON.stringify([tenantId,conversationId,requestId]));
const digest=value=>createHash('sha256').update(value).digest('hex');
const membership=`SELECT m.role FROM musitu.memberships m JOIN musitu.tenants t ON t.id=m.tenant_id
 WHERE m.tenant_id=$1 AND m.actor_id=$2 AND m.role='OWNER' AND m.status='ACTIVE' AND t.status='ACTIVE'`;
// All statements are fixed; only bound values come from the caller. Limits fail
// the entire export rather than silently producing a truncated request response.
const queries=Object.freeze({
 inbound:`SELECT provider_message_id,provider_sent_at,received_at FROM musitu.inbound_events WHERE tenant_id=$1 AND conversation_id=$2 ORDER BY received_at,provider_message_id LIMIT 1001`,
 messages:`SELECT phone_number_id,provider_message_id,retained_until,
 CASE WHEN retained_until>transaction_timestamp() THEN encrypted_body ELSE NULL END AS content
 FROM musitu.messages WHERE tenant_id=$1 AND conversation_id=$2 ORDER BY provider_message_id LIMIT 1001`,
 drafts:`SELECT draft_id,body,status,created_at FROM musitu.reply_drafts WHERE tenant_id=$1 AND conversation_id=$2 ORDER BY created_at,draft_id LIMIT 1001`,
 approvals:`SELECT a.draft_id,a.approved_at FROM musitu.draft_approvals a JOIN musitu.reply_drafts d ON d.tenant_id=a.tenant_id AND d.draft_id=a.draft_id WHERE d.tenant_id=$1 AND d.conversation_id=$2 ORDER BY a.approved_at,a.draft_id LIMIT 1001`,
 preparations:`SELECT preparation_id,draft_id,status,created_at FROM musitu.outbound_preparations WHERE tenant_id=$1 AND conversation_id=$2 ORDER BY created_at,preparation_id LIMIT 1001`,
 attempts:`SELECT a.attempt_id,a.status,a.provider_message_id,a.channel_phone_number_id,a.dev_reviewed_at,a.dev_retained_until,
 CASE WHEN a.dev_retained_until>transaction_timestamp() THEN a.dev_encrypted_body ELSE NULL END AS content
 FROM musitu.outbound_attempts a JOIN musitu.conversations c ON c.tenant_id=a.tenant_id AND c.phone_number_id=a.channel_phone_number_id AND c.remote_wa_id=a.recipient_hash
 WHERE c.tenant_id=$1 AND c.conversation_id=$2 ORDER BY a.attempt_id LIMIT 1001`,
 receipts:`SELECT s.provider_message_id,s.status,s.provider_timestamp,s.received_at FROM musitu.message_status_events s
 JOIN musitu.outbound_attempts a ON a.tenant_id=s.tenant_id AND a.channel_phone_number_id=s.phone_number_id AND a.provider_message_id=s.provider_message_id
 JOIN musitu.conversations c ON c.tenant_id=a.tenant_id AND c.phone_number_id=a.channel_phone_number_id AND c.remote_wa_id=a.recipient_hash
 WHERE c.tenant_id=$1 AND c.conversation_id=$2 ORDER BY s.provider_timestamp,s.provider_message_id,s.status LIMIT 1001`,
 consent:`SELECT e.scope,e.status,e.confirmed_at,e.expires_at FROM musitu.channel_consent_evidence e JOIN musitu.conversations c ON c.tenant_id=e.tenant_id AND c.phone_number_id=e.phone_number_id AND c.remote_wa_id=e.recipient_hash WHERE c.tenant_id=$1 AND c.conversation_id=$2 LIMIT 1001`,
 suppression:`SELECT source_kind,recorded_at FROM musitu.customer_suppressions WHERE tenant_id=$1 AND conversation_id=$2 LIMIT 1001`,
 aiRequests:`SELECT request_id,provider_message_id,state,created_at,completed_at FROM musitu.ai_requests WHERE tenant_id=$1 AND conversation_id=$2 ORDER BY created_at,request_id LIMIT 1001`
});

export function openConversationPrivacyExport({encrypted,exportKey,tenantId,conversationId,requestId}={}){
 try{
  if(!keyOK(exportKey)||!matches(UUID,tenantId)||!matches(UUID,conversationId)||!matches(REQUEST,requestId)||
   !Buffer.isBuffer(encrypted)||encrypted.length<=HEADER.length+28||encrypted.length>BYTE_LIMIT||!encrypted.subarray(0,HEADER.length).equals(HEADER))throw Error();
  const d=createDecipheriv('aes-256-gcm',exportKey,encrypted.subarray(HEADER.length,HEADER.length+12));
  d.setAAD(Buffer.concat([HEADER,binding({tenantId,conversationId,requestId})]));
  d.setAuthTag(encrypted.subarray(HEADER.length+12,HEADER.length+28));
  const payload=JSON.parse(Buffer.concat([d.update(encrypted.subarray(HEADER.length+28)),d.final()]).toString('utf8'));
  if(payload.version!==1||payload.tenantId!==tenantId||payload.conversationId!==conversationId||payload.requestId!==requestId)throw Error();
  return payload;
 }catch{throw Error('PRIVACY_EXPORT_OPEN_REJECTED');}
}

export function createConversationPrivacyExporter({pool,contentKey}={}){
 if(!keyOK(contentKey))throw Error('CONTENT_KEY_REQUIRED');
 const guarded=createRuntimeRoleBoundPool({pool,expectedRole:'musitu_runtime'});
 return async function exportConversation({tenantId,actorId,conversationId,requestId,exportKey,recheckSession}={}){
  if(typeof recheckSession!=='function')throw Error('PRIVACY_SESSION_RECHECK_REQUIRED');
  if(!matches(UUID,tenantId)||!matches(UUID,conversationId)||!matches(ACTOR,actorId)||!matches(REQUEST,requestId)||!keyOK(exportKey))throw Error('PRIVACY_INPUT_REJECTED');
  await recheckSession();
  const client=await guarded.connect();let active=false,discard;
  try{
   await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');active=true;
   await client.query("SELECT set_config('app.tenant_id',$1,true),set_config('statement_timeout','4000',true)",[tenantId]);
   if((await client.query(membership,[tenantId,actorId])).rows.length!==1)throw Error('ACCESS_DENIED');
   const found=await client.query(`SELECT c.phone_number_id,c.remote_wa_id,c.handling_mode,k.encrypted_recipient,transaction_timestamp() AS captured_at
    FROM musitu.conversations c LEFT JOIN musitu.contacts k ON k.tenant_id=c.tenant_id AND k.phone_number_id=c.phone_number_id AND k.remote_hash=c.remote_wa_id
    WHERE c.tenant_id=$1 AND c.conversation_id=$2`,[tenantId,conversationId]);
   if(found.rows.length!==1)throw Error('PRIVACY_CONVERSATION_UNAVAILABLE');
   const c=found.rows[0],data={};
   for(const [name,sql] of Object.entries(queries)){
    const {rows}=await client.query(sql,[tenantId,conversationId]);
    if(rows.length>ROW_LIMIT)throw Error('PRIVACY_EXPORT_TOO_LARGE');
    data[name]=rows;
   }
   await client.query('COMMIT');active=false;
   // A fresh transaction observes revocation/suspension committed while the
   // repeatable-read export was running; the session is independently rechecked.
   await recheckSession();
   await client.query('BEGIN READ ONLY');active=true;
   await client.query("SELECT set_config('app.tenant_id',$1,true),set_config('statement_timeout','4000',true)",[tenantId]);
   if((await client.query(membership,[tenantId,actorId])).rows.length!==1)throw Error('ACCESS_DENIED');
   await client.query('COMMIT');active=false;
   for(const row of data.messages){
    row.body=row.content===null?null:decryptLedger(row.content,contentKey,[tenantId,row.phone_number_id,row.provider_message_id]);
    row.contentAvailable=row.content!==null;delete row.content;delete row.phone_number_id;
   }
   for(const row of data.attempts){
    row.body=row.content===null?null:decryptLedger(row.content,contentKey,[tenantId,c.phone_number_id,row.attempt_id]);
    row.contentAvailable=row.content!==null;delete row.content;delete row.channel_phone_number_id;
   }
   const recipient=c.encrypted_recipient?decryptLedger(c.encrypted_recipient,contentKey,[tenantId,c.phone_number_id,'contact:'+c.remote_wa_id]):null;
   const payload={version:1,scope:'SINGLE_CONVERSATION_OPERATOR_REVIEW',tenantId,conversationId,requestId,capturedAt:c.captured_at,
    recipient,channelId:c.phone_number_id,handlingMode:c.handling_mode,data,
    limitations:['Identity/ownership and disclosure approval require operator review.','Other channels, bookings without subject links, staff/identity records, unscoped audit, processor copies and backups are not included.','Expired encrypted message content is excluded; this export does not erase it.','No statutory completeness, deadline, delivery or deletion claim.']};
   const plain=Buffer.from(JSON.stringify(payload));
   let encrypted;try{
    if(plain.length+HEADER.length+28>BYTE_LIMIT)throw Error('PRIVACY_EXPORT_TOO_LARGE');
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',exportKey,iv);
    cipher.setAAD(Buffer.concat([HEADER,binding({tenantId,conversationId,requestId})]));
    const body=Buffer.concat([cipher.update(plain),cipher.final()]);encrypted=Buffer.concat([HEADER,iv,cipher.getAuthTag(),body]);
   }finally{plain.fill(0);}
   return{encrypted,receipt:{requestId,tenantId,conversationId,sha256:digest(encrypted),bytes:encrypted.length,counts:Object.fromEntries(Object.entries(data).map(([name,rows])=>[name,rows.length])),scope:'SINGLE_CONVERSATION_OPERATOR_REVIEW',delivered:false,erased:false}};
  }catch(error){
   if(active){try{await client.query('ROLLBACK');}catch(rollback){discard=rollback;}}
   if(['ACCESS_DENIED','PRIVACY_CONVERSATION_UNAVAILABLE','PRIVACY_EXPORT_TOO_LARGE'].includes(error.message))throw error;
   throw Error('PRIVACY_EXPORT_FAILED');
  }finally{client.release(discard);}
 };
}
