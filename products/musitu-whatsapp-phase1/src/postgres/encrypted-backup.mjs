/** Operator-only authenticated export envelope. No database or network actions. */
import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import {deflateRawSync,inflateRawSync} from 'node:zlib';
const HEADER=Buffer.from('MUSITU_PG_BACKUP_V1\0'),LIMIT=8*1024*1024;
const TABLES=['action_audit','ai_policy','ai_requests','bookings','business_configuration','channel_consent_evidence','contacts','conversations','customer_suppressions','draft_approvals','faqs','inbound_events','memberships','message_status_events','messages','outbound_attempts','outbound_preparations','reply_drafts','resources','tenants','whatsapp_channels'].map(n=>'musitu.'+n).concat('musitu_identity.sessions');
const MIGRATIONS=['private_tenant_core','faq_draft_rls_candidate','runtime_role_permissions','signed_ingress_role','verified_status_reconciliation','offline_draft_approvals','offline_outbound_preparations','signed_customer_suppression','private_business_commands','private_identity_sessions','locked_review_context','business_configuration','private_contact_message_ledger','governed_ai_drafts','development_reply_sender','meta_message_id_compatibility','owner_ai_resumption'].map((n,i)=>String(i+1).padStart(3,'0')+'_'+n+'.sql');
function schema(p){
 if(p.version===1)return p.migrations.length===14; // Preserve the tested 18 October archive.
 // Version 2 records the current schema explicitly. Digests establish internal
 // consistency only; a restore must still compare SQL with reviewed source.
 return p.version===2&&[15,16,17].includes(p.schemaVersion)&&p.migrations.length===p.schemaVersion&&
  TABLES.every(n=>Object.hasOwn(p.data,n))&&p.migrations.every((m,i)=>
   m?.name===MIGRATIONS[i]&&typeof m.sql==='string'&&m.sql.length>0&&
   typeof m.sha256==='string'&&m.sha256===createHash('sha256').update(m.sql).digest('hex'));
}
function key(k){if(!Buffer.isBuffer(k)||k.length!==32)throw Error('BACKUP_KEY_REQUIRED');return k;}
function payload(p){
 if(!p||p.source?.project!=='jolly-scene-02112141'||p.source?.branch!=='br-jolly-fire-b4klddds'||p.source?.database!=='musitu_whatsapp_phase1'||!Array.isArray(p.migrations)||!p.data||typeof p.data!=='object'||Object.keys(p.data).length!==22||!Object.entries(p.data).every(([n,rows])=>/^(musitu\.[a-z_]+|musitu_identity\.sessions)$/.test(n)&&Array.isArray(rows))||!schema(p)||!p.applicationKeys||!['contentEncryptionKey','sessionEncryptionKey'].every(n=>typeof p.applicationKeys[n]==='string'&&/^[A-Za-z0-9+/]{43}=$/.test(p.applicationKeys[n])&&Buffer.from(p.applicationKeys[n],'base64').length===32))throw Error('BACKUP_PAYLOAD_REJECTED');
 return p;
}
export function sealPostgresBackup({data,backupKey}){
 key(backupKey);payload(data);
 const raw=Buffer.from(JSON.stringify(data));if(raw.length>LIMIT)throw Error('BACKUP_TOO_LARGE');
 const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',backupKey,iv);c.setAAD(HEADER);
 const encrypted=Buffer.concat([c.update(deflateRawSync(raw,{level:9})),c.final()]);
 return Buffer.concat([HEADER,iv,c.getAuthTag(),encrypted]);
}
export function openPostgresBackup({encrypted,backupKey}){
 key(backupKey);
 try{
  if(!Buffer.isBuffer(encrypted)||encrypted.length<=HEADER.length+28||encrypted.length>LIMIT||!encrypted.subarray(0,HEADER.length).equals(HEADER))throw Error();
  const d=createDecipheriv('aes-256-gcm',backupKey,encrypted.subarray(HEADER.length,HEADER.length+12));d.setAAD(HEADER);d.setAuthTag(encrypted.subarray(HEADER.length+12,HEADER.length+28));
  const compressed=Buffer.concat([d.update(encrypted.subarray(HEADER.length+28)),d.final()]);
  return payload(JSON.parse(inflateRawSync(compressed,{maxOutputLength:LIMIT}).toString('utf8')));
 }catch{throw Error('BACKUP_OPEN_REJECTED');}
}
