/** Operator-only authenticated export envelope. No database or network actions. */
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {deflateRawSync,inflateRawSync} from 'node:zlib';
const HEADER=Buffer.from('MUSITU_PG_BACKUP_V1\0'),LIMIT=8*1024*1024;
function key(k){if(!Buffer.isBuffer(k)||k.length!==32)throw Error('BACKUP_KEY_REQUIRED');return k;}
function payload(p){
 if(!p||p.version!==1||p.source?.project!=='jolly-scene-02112141'||p.source?.branch!=='br-jolly-fire-b4klddds'||p.source?.database!=='musitu_whatsapp_phase1'||!Array.isArray(p.migrations)||p.migrations.length!==14||!p.data||typeof p.data!=='object'||Object.keys(p.data).length!==22||!Object.entries(p.data).every(([n,rows])=>/^(musitu\.[a-z_]+|musitu_identity\.sessions)$/.test(n)&&Array.isArray(rows))||!p.applicationKeys||!['contentEncryptionKey','sessionEncryptionKey'].every(n=>typeof p.applicationKeys[n]==='string'&&/^[A-Za-z0-9+/]{43}=$/.test(p.applicationKeys[n])&&Buffer.from(p.applicationKeys[n],'base64').length===32))throw Error('BACKUP_PAYLOAD_REJECTED');
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
