/** Explicit operator checkpoint sealing only. No database, network or identity action. */
import {createHash} from 'node:crypto';
import {sealPostgresBackup,openPostgresBackup} from './encrypted-backup.mjs';
export const HOSTED_CHECKPOINT_TABLES=Object.freeze(['action_audit','ai_policy','ai_requests','bookings','business_configuration','channel_consent_evidence','contacts','conversations','customer_suppressions','draft_approvals','faqs','inbound_events','memberships','message_status_events','messages','outbound_attempts','outbound_preparations','reply_drafts','resources','tenants','whatsapp_channels'].map(n=>'musitu.'+n).concat('musitu_identity.sessions'));
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export const checkpointDigest=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const keyOK=k=>Buffer.isBuffer(k)&&k.length===32;
export function sealHostedCheckpoint({snapshot,migrations,backupKey,contentEncryptionKey,sessionEncryptionKey}={}){
 const s=snapshot,now=Date.now();
 if(!s||s.source?.project!=='jolly-scene-02112141'||s.source?.branch!=='br-jolly-fire-b4klddds'||s.source?.database!=='musitu_whatsapp_phase1'||
 !Number.isFinite(Date.parse(s.capturedAt))||Date.parse(s.capturedAt)>now+30000||
 !s.data||Object.keys(s.data).length!==22||!HOSTED_CHECKPOINT_TABLES.every(n=>Array.isArray(s.data[n]))||
 !Array.isArray(s.relationInventory)||s.relationInventory.map(x=>x.name).sort().join(',')!==HOSTED_CHECKPOINT_TABLES.slice().sort().join(',')||
 !Array.isArray(s.catalog)||s.catalog.length!==6||!Array.isArray(s.roles)||!Array.isArray(s.dependencies)||
 !s.data['musitu.tenants'].some(t=>t.id==='986eb904-7296-46a9-9e9b-94074db9b547')||
 s.data['musitu_identity.sessions'].some(r=>typeof r.revoked!=='boolean'||!Number.isFinite(Date.parse(r.expires_at))||(!r.revoked&&Date.parse(r.expires_at)>now)))throw Error('HOSTED_CHECKPOINT_REJECTED');
 if(![backupKey,contentEncryptionKey,sessionEncryptionKey].every(keyOK))throw Error('HOSTED_CHECKPOINT_KEYS_REQUIRED');
 const data={version:2,schemaVersion:15,qualificationOnly:false,source:s.source,capturedAt:s.capturedAt,sourcePostgresVersion:s.postgresVersion,
 migrations,data:s.data,sourceCatalog:s.catalog,sourceDependencies:s.dependencies,sourceRoles:s.roles,excludedActiveSessionRows:s.excludedActiveSessionRows??0,
 applicationKeys:{contentEncryptionKey:contentEncryptionKey.toString('base64'),sessionEncryptionKey:sessionEncryptionKey.toString('base64')}};
 const encrypted=sealPostgresBackup({data,backupKey});
 const reopened=openPostgresBackup({encrypted,backupKey});
 if(checkpointDigest(reopened)!==checkpointDigest(data))throw Error('HOSTED_CHECKPOINT_ROUNDTRIP_FAILED');
 return{encrypted,receipt:{kind:'MUSITU_ENCRYPTED_CHECKPOINT_META',version:2,schemaVersion:15,sha256:createHash('sha256').update(encrypted).digest('hex'),bytes:encrypted.length,
 tables:22,rows:Object.values(s.data).reduce((n,rows)=>n+rows.length,0),sourceCapturedAt:s.capturedAt,
 rowCounts:Object.fromEntries(HOSTED_CHECKPOINT_TABLES.map(n=>[n,s.data[n].length])),catalogSha256:checkpointDigest(s.catalog),
 excludedActiveSessionRows:s.excludedActiveSessionRows??0,activeSessionsCopied:false,providerCredentialsIncluded:false,keyMaterialPrinted:false,offsiteRetrievalQualified:false,restoreQualified:false}};
}
