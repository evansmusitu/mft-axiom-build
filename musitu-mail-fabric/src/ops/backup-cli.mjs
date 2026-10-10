#!/usr/bin/env node
/** Local-file-only disaster-recovery command. Does not access Cloudflare, Resend, or GitHub.
 * Requires externally pinned Ed25519 trust and explicit operator acknowledgement.
 */
import {readFileSync,writeFileSync,lstatSync,openSync,closeSync,unlinkSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createPrivateKey,createPublicKey} from 'node:crypto';
import {createEncryptedBackup,verifyEncryptedBackup,restoreEncryptedBackup} from './backup.mjs';

const ACK='I_ACKNOWLEDGE_OFFLINE_RECOVERY';
const B64=/^[A-Za-z0-9+/]{43}=$/;
const MAX_ARCHIVE=16*1024*1024;
function recoveryKey(env,name){
 const value=env[name];
 if(typeof value!=='string'||!B64.test(value))throw Error('OFFLINE_RECOVERY_KEY_UNAVAILABLE');
 const key=Buffer.from(value,'base64');
 if(key.length!==32||key.toString('base64')!==value)throw Error('OFFLINE_RECOVERY_KEY_UNAVAILABLE');
 return key;
}
function ordinaryFile(path,maxBytes=MAX_ARCHIVE){
 if(typeof path!=='string'||!path.trim())throw Error('INVALID_FILE_PATH');
 const stat=lstatSync(path);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size>maxBytes||stat.size<=0)throw Error('UNSAFE_SOURCE_FILE');
 return path;
}
function readArchive(path){
 const raw=readFileSync(ordinaryFile(path),'utf8');
 try{return JSON.parse(raw);}catch{throw Error('INVALID_BACKUP_JSON');}
}
function trustedKey(path){return createPublicKey(readFileSync(ordinaryFile(path,10000),'utf8'));}
function run(argv,env){
 if(env.MMF_BACKUP_OFFLINE_ACK!==ACK)throw Error('OFFLINE_OPERATOR_ACK_REQUIRED');
 const mode=argv[0],backupKey=recoveryKey(env,'MMF_BACKUP_KEY_B64');
 if(mode==='export'&&argv.length===6){
  const [,path,tenantId,output,privatePath,publicPath]=argv;
  const envelopeKey=recoveryKey(env,'MMF_ENCRYPTION_KEY_B64');
  const privacyKey=recoveryKey(env,'MMF_PRIVACY_KEY_B64');
  const privateKey=createPrivateKey(readFileSync(ordinaryFile(privatePath,10000),'utf8'));
  const publicKey=trustedKey(publicPath);
  const db=new DatabaseSync(ordinaryFile(path,2**31));
  let archive;
  try{archive=createEncryptedBackup(db,{tenantId,backupKey,envelopeKey,privacyKey,privateKey,publicKey});}
  finally{db.close();}
  // Do not overwrite old backups. Restrictive mode protects contents on shared hosts.
  writeFileSync(output,JSON.stringify(archive)+'\n',{flag:'wx',mode:0o600});
  return {status:'ENCRYPTED_BACKUP_WRITTEN',backupId:archive.backupId,tenantId:archive.tenantId,
    note:'Preserve keys securely and independently. No cloud state was changed.'};
 }
 if(mode==='verify'&&argv.length===3){
  const [,input,pinFile]=argv,archive=readArchive(input);
  if(!verifyEncryptedBackup(archive,{backupKey,trustedPublicKey:trustedKey(pinFile)}))throw Error('BACKUP_VERIFICATION_FAILED');
  return {status:'BACKUP_VERIFIED',backupId:archive.backupId,tenantId:archive.tenantId};
 }
 if(mode==='restore'&&argv.length===5){
  const [,input,tenantId,destination,pinFile]=argv;
  const archive=readArchive(input),trustedPublicKey=trustedKey(pinFile);
  const envelopeKey=recoveryKey(env,'MMF_ENCRYPTION_KEY_B64'),privacyKey=recoveryKey(env,'MMF_PRIVACY_KEY_B64');
  if(!verifyEncryptedBackup(archive,{backupKey,trustedPublicKey}))throw Error('BACKUP_VERIFICATION_FAILED');
  // O_EXCL must succeed before ANY schema creation. Never overwrite an existing DB.
  const handle=openSync(destination,'wx',0o600);closeSync(handle);
  let db=null;
  try{
   db=new DatabaseSync(destination);
   db.exec(readFileSync(new URL('../durable/schema.sql',import.meta.url),'utf8'));
   const outcome=restoreEncryptedBackup(db,archive,{expectedTenantId:tenantId,backupKey,envelopeKey,privacyKey,trustedPublicKey});
   const integrity=db.prepare('PRAGMA integrity_check').get();
   if(Object.values(integrity)[0]!=='ok')throw Error('RESTORED_SQLITE_INTEGRITY_FAILED');
   db.close();db=null;
   return {status:'OFFLINE_RESTORE_VERIFIED',tenantId,...outcome};
  }catch(e){
   try{db?.close()}catch{}
   try{unlinkSync(destination)}catch{}
   throw e;
  }
 }
 throw Error('OFFLINE_BACKUP_USAGE_INVALID');
}
export function runOfflineBackupCLI(argv,env=process.env){return run(argv,env);}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 try{console.log(JSON.stringify(run(process.argv.slice(2),process.env)));}
 catch(error){
  const approved=new Set(['OFFLINE_OPERATOR_ACK_REQUIRED','OFFLINE_RECOVERY_KEY_UNAVAILABLE',
  'OFFLINE_BACKUP_USAGE_INVALID','BACKUP_VERIFICATION_FAILED','BACKUP_AUTHENTICATION_FAILED',
  'BACKUP_SCOPE_MISMATCH','TARGET_NOT_EMPTY','RESTORE_TENANT_MISMATCH',
  'RESTORE_OPERATIONAL_KEY_MISMATCH','UNSAFE_SOURCE_FILE','RESTORED_SQLITE_INTEGRITY_FAILED',
  'BACKUP_SIGNING_SELF_CHECK_FAILED','OFFLINE_TRANSACTIONAL_SQLITE_REQUIRED']);
  const code=approved.has(error?.message)?error.message:'OFFLINE_BACKUP_OPERATION_FAILED';
  console.error(JSON.stringify({status:'REJECTED',error:code}));
  process.exitCode=1;
 }
}