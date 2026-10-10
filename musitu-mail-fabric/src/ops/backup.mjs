/** Offline-only, tenant-scoped, encrypted and authenticated SQLite disaster-recovery bundle.
 * No cloud database mutation, provider call, private key serialization or public API.
 * IMPORTANT: retain all original message-encryption and opaque-identity keys separately.
 */
import {randomBytes,randomUUID,createHash,createCipheriv,createDecipheriv,sign,verify,createPublicKey} from 'node:crypto';
const FORMAT='MUSITU_MAIL_FABRIC_OFFLINE_BACKUP_V1';
const TABLES=Object.freeze({
 mail_messages:['message_id','tenant_id','idempotency_key','request_hash','recipient_hmac','state','sealed_envelope','events_json','claim_token','lease_deadline','provider_id','created_ms','updated_ms'],
 mail_suppressions:['tenant_id','recipient_hmac','created_ms'],
 mail_sender_domains:['tenant_id','domain','challenge_sha256','challenge_expires_ms','verified_until_ms','status','updated_ms'],
 mail_provider_events:['tenant_id','svix_id','message_id','provider_id','kind','raw_sha256','created_ms']
});
const MAX_BACKUP_BYTES=8*1024*1024;
const MAX_ROWS=20000;
const sha=x=>createHash('sha256').update(x).digest('hex');
const TENANT=/^[a-z][a-z0-9_-]{2,63}$/;
const b64=x=>Buffer.from(x).toString('base64url');
function fromB64(x,min=1,max=MAX_BACKUP_BYTES){
 if(typeof x!=='string'||x.length>max*2||!/^[A-Za-z0-9_-]+$/.test(x))throw Error('BACKUP_INVALID_ENCODING');
 const bytes=Buffer.from(x,'base64url');
 if(bytes.length<min||bytes.length>max||b64(bytes)!==x)throw Error('BACKUP_INVALID_ENCODING');
 return bytes;
}
function secret(x,code){
 if(!Buffer.isBuffer(x)||x.length!==32)throw Error(code);
 return x;
}
function publicDer(pub){
 if(!pub||pub.asymmetricKeyType!=='ed25519')throw Error('ED25519_TRUST_ANCHOR_REQUIRED');
 return pub.export({format:'der',type:'spki'});
}
function checkDb(db){
 if(typeof db?.prepare!=='function'||typeof db?.exec!=='function')throw Error('OFFLINE_TRANSACTIONAL_SQLITE_REQUIRED');
}
function transaction(db,operation){
 db.exec('BEGIN IMMEDIATE');
 try{const out=operation();db.exec('COMMIT');return out;}
 catch(e){try{db.exec('ROLLBACK');}catch{}throw e;}
}
function manifest(archive){
 if(!archive||typeof archive!=='object'||Array.isArray(archive))throw Error('INVALID_BACKUP');
 const {signature,...data}=archive;
 const names=['format','tenantId','backupId','createdAt','envelopeKeySha256','privacyKeySha256','signingKeySha256','iv','ciphertext','tag'];
 if(Object.keys(data).length!==names.length||names.some(k=>!Object.hasOwn(data,k)))throw Error('INVALID_BACKUP_FIELDS');
 if(data.format!==FORMAT||!TENANT.test(data.tenantId)||typeof data.backupId!=='string'||!/^[0-9a-f-]{36}$/i.test(data.backupId)||typeof data.createdAt!=='string'||!Number.isFinite(Date.parse(data.createdAt)))throw Error('INVALID_BACKUP_METADATA');
 for(const k of ['envelopeKeySha256','privacyKeySha256','signingKeySha256'])if(!/^[a-f0-9]{64}$/.test(data[k]||''))throw Error('INVALID_KEY_FINGERPRINT');
 if(fromB64(data.iv,12,12).length!==12||fromB64(data.tag,16,16).length!==16)throw Error('INVALID_BACKUP_CIPHER');
 fromB64(data.ciphertext,1,MAX_BACKUP_BYTES);
 if(typeof signature!=='string')throw Error('BACKUP_SIGNATURE_MISSING');
 fromB64(signature,64,64);
 return data;
}
function decrypt(archive,{backupKey,trustedPublicKey}){
 secret(backupKey,'BACKUP_DECRYPTION_KEY_REQUIRED');
 const data=manifest(archive);
 if(sha(publicDer(trustedPublicKey))!==data.signingKeySha256)throw Error('UNTRUSTED_BACKUP_SIGNER');
 const bytes=Buffer.from(JSON.stringify(data));
 if(!verify(null,bytes,trustedPublicKey,fromB64(archive.signature,64,64)))throw Error('INVALID_BACKUP_SIGNATURE');
 let clear;
 try{
  const cipher=createDecipheriv('aes-256-gcm',backupKey,fromB64(data.iv,12,12));
  cipher.setAAD(Buffer.from(FORMAT+':'+data.tenantId+':'+data.backupId));
  cipher.setAuthTag(fromB64(data.tag,16,16));
  clear=Buffer.concat([cipher.update(fromB64(data.ciphertext)),cipher.final()]);
 }catch{throw Error('BACKUP_AUTHENTICATION_FAILED');}
 if(clear.length>MAX_BACKUP_BYTES)throw Error('BACKUP_TOO_LARGE');
 let decoded;
 try{decoded=JSON.parse(clear.toString('utf8'));}catch{throw Error('INVALID_BACKUP_PAYLOAD');}
 if(!decoded||typeof decoded!=='object'||decoded.format!==FORMAT||decoded.tenantId!==data.tenantId)throw Error('BACKUP_SCOPE_MISMATCH');
 const tableNames=Object.keys(TABLES);
 if(!decoded.tables||Object.keys(decoded.tables).length!==tableNames.length)throw Error('INVALID_BACKUP_TABLE_SET');
 for(const table of tableNames){
  const rows=decoded.tables[table],columns=TABLES[table];
  if(!Array.isArray(rows)||rows.length>MAX_ROWS)throw Error('BACKUP_ROW_LIMIT');
  for(const row of rows){
   if(!row||typeof row!=='object'||Array.isArray(row)||row.tenant_id!==data.tenantId||
      Object.keys(row).length!==columns.length||columns.some(k=>!Object.hasOwn(row,k)||
        !(['string','number'].includes(typeof row[k])||row[k]===null)))throw Error('INVALID_BACKUP_ROW');
   for(const value of Object.values(row))if(typeof value==='string'&&value.length>500000)throw Error('OVERSIZED_BACKUP_FIELD');
  }
 }
 if(JSON.stringify(decoded).length>MAX_BACKUP_BYTES)throw Error('BACKUP_TOO_LARGE');
 return {data,decoded};
}
export function createEncryptedBackup(db,{tenantId,backupKey,envelopeKey,privacyKey,privateKey,publicKey,now=()=>new Date().toISOString()}={}){
 checkDb(db);if(!TENANT.test(String(tenantId||'')))throw Error('INVALID_BACKUP_TENANT');
 secret(backupKey,'BACKUP_ENCRYPTION_KEY_REQUIRED');
 secret(envelopeKey,'MESSAGE_ENCRYPTION_KEY_REQUIRED');
 secret(privacyKey,'OPAQUE_IDENTITY_KEY_REQUIRED');
 if(!privateKey||privateKey.asymmetricKeyType!=='ed25519')throw Error('BACKUP_SIGNING_KEY_REQUIRED');
 const signer=publicKey||createPublicKey(privateKey),signerHash=sha(publicDer(signer));
 const payload=transaction(db,()=>{
  const tables={};
  for(const [table,columns] of Object.entries(TABLES)){
   const sql='SELECT '+columns.join(',')+' FROM '+table+' WHERE tenant_id=? ORDER BY '+(table==='mail_messages'?'message_id':table==='mail_provider_events'?'svix_id':table==='mail_suppressions'?'recipient_hmac':'domain');
   tables[table]=db.prepare(sql).all(tenantId);
   if(tables[table].length>MAX_ROWS)throw Error('BACKUP_ROW_LIMIT');
  }
  return {format:FORMAT,tenantId,tables};
 });
 const clear=Buffer.from(JSON.stringify(payload));
 if(clear.length>MAX_BACKUP_BYTES)throw Error('BACKUP_TOO_LARGE');
 const backupId=randomUUID(),iv=randomBytes(12);
 const aes=createCipheriv('aes-256-gcm',backupKey,iv);
 aes.setAAD(Buffer.from(FORMAT+':'+tenantId+':'+backupId));
 const encrypted=Buffer.concat([aes.update(clear),aes.final()]);
 const data={
  format:FORMAT,tenantId,backupId,createdAt:now(),
  envelopeKeySha256:sha(envelopeKey),privacyKeySha256:sha(privacyKey),signingKeySha256:signerHash,
  iv:b64(iv),ciphertext:b64(encrypted),tag:b64(aes.getAuthTag())
 };
 const signature=b64(sign(null,Buffer.from(JSON.stringify(data)),privateKey));
 const archive={...data,signature};
 if(!verifyEncryptedBackup(archive,{backupKey,trustedPublicKey:signer}))throw Error('BACKUP_SIGNING_SELF_CHECK_FAILED');
 return archive;
}
export function verifyEncryptedBackup(archive,keys={}){
 try{decrypt(archive,keys);return true;}catch{return false;}
}
/** Offline restore to completely EMPTY new SQLite database. No provider sending. */
export function restoreEncryptedBackup(db,archive,{expectedTenantId,backupKey,envelopeKey,privacyKey,trustedPublicKey}={}){
 checkDb(db);
 secret(envelopeKey,'MESSAGE_ENCRYPTION_KEY_REQUIRED');
 secret(privacyKey,'OPAQUE_IDENTITY_KEY_REQUIRED');
 const {data,decoded}=decrypt(archive,{backupKey,trustedPublicKey});
 if(data.tenantId!==expectedTenantId)throw Error('RESTORE_TENANT_MISMATCH');
 if(sha(envelopeKey)!==data.envelopeKeySha256||sha(privacyKey)!==data.privacyKeySha256)throw Error('RESTORE_OPERATIONAL_KEY_MISMATCH');
 // SQLite enforces foreign-key checks only outside an already active transaction.
 db.exec('PRAGMA foreign_keys=ON');
 return transaction(db,()=>{
  for(const table of Object.keys(TABLES)){
   const row=db.prepare('SELECT COUNT(*) AS n FROM '+table).get();
   if(row?.n!==0)throw Error('TARGET_NOT_EMPTY');
  }
  const counts={};
  for(const [table,columns] of Object.entries(TABLES)){
   const placeholders=columns.map(()=>'?').join(',');
   const insert=db.prepare('INSERT INTO '+table+'('+columns.join(',')+') VALUES('+placeholders+')');
   const rows=decoded.tables[table];let count=0;
   for(const row of rows){insert.run(...columns.map(c=>row[c]));count++;}
   counts[table]=count;
  }
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('BACKUP_RELATIONAL_INTEGRITY_FAILED');
  return Object.freeze({messages:counts.mail_messages,suppressions:counts.mail_suppressions,
   domains:counts.mail_sender_domains,events:counts.mail_provider_events,
   inFlight:decoded.tables.mail_messages.filter(r=>r.state==='SENDING').length,
   note:'Restored SENDING outcomes require manual reconciliation. Never auto-resend.'});
 });
}