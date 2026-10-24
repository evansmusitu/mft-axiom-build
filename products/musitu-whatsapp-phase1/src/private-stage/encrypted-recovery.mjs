/**
 * ISOLATED LOCAL SQLITE QUALIFICATION ONLY. NOT a deployed backup service.
 * Online SQLite snapshots are encrypted at rest with a caller-provided random
 * 256-bit secret, and restores are atomic/no-overwrite. No network egress.
 *
 * Limitations: an on-disk plaintext snapshot exists briefly inside a 0700
 * temporary folder while SQLite's native backup operation completes. That
 * workspace MUST reside on an operator-controlled encrypted filesystem.
 * Key escrow, offsite retention, recovery drills and PITR are NOT provided.
 */
import {DatabaseSync,backup} from 'node:sqlite';
import {createCipheriv,createDecipheriv,createHash,hkdfSync,randomBytes} from 'node:crypto';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,existsSync,linkSync} from 'node:fs';
import {join,dirname,isAbsolute} from 'node:path';

const MAGIC=Buffer.from('MFTWA15\0','ascii');
const MAX_DB_BYTES=16*1024*1024; // explicit limit for private qualification
const SALT_BYTES=16,IV_BYTES=12,TAG_BYTES=16;
const HEADER_LEN=MAGIC.length+SALT_BYTES+IV_BYTES+TAG_BYTES;
const SQLITE_HEADER=Buffer.from('SQLite format 3\0','ascii');
function validKey(key){if(!Buffer.isBuffer(key)||key.length!==32)throw Error('BACKUP_KEY_REQUIRED');}
function validPath(path){if(typeof path!=='string'||!isAbsolute(path)||path.length>4096)throw Error('INVALID_BACKUP_PATH');}
function derive(key,salt){return Buffer.from(hkdfSync('sha256',key,salt,Buffer.from('musitu-stage-sqlite-backup-v15'),32));}
function encrypt(raw,key){
 const salt=randomBytes(SALT_BYTES),iv=randomBytes(IV_BYTES);
 const cipher=createCipheriv('aes-256-gcm',derive(key,salt),iv);cipher.setAAD(MAGIC);
 const ciphertext=Buffer.concat([cipher.update(raw),cipher.final()]);
 return Buffer.concat([MAGIC,salt,iv,cipher.getAuthTag(),ciphertext]);
}
function decrypt(blob,key){
 if(blob.length<=HEADER_LEN||blob.length>HEADER_LEN+MAX_DB_BYTES||!blob.subarray(0,MAGIC.length).equals(MAGIC))
  throw Error('INVALID_BACKUP_FORMAT');
 const salt=blob.subarray(8,24),iv=blob.subarray(24,36),tag=blob.subarray(36,52);
 try{
  const decipher=createDecipheriv('aes-256-gcm',derive(key,salt),iv);decipher.setAAD(MAGIC);decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(blob.subarray(HEADER_LEN)),decipher.final()]);
 }catch{throw Error('BACKUP_INTEGRITY_FAILURE');}
}
export async function backupEncryptedPrivateStage({databasePath,encryptedPath,backupKey}={}){
 validKey(backupKey);validPath(databasePath);validPath(encryptedPath);
 if(!existsSync(databasePath))throw Error('BACKUP_SOURCE_MISSING');
 if(existsSync(encryptedPath))throw Error('BACKUP_TARGET_EXISTS');
 const tempDir=mkdtempSync(join(dirname(databasePath),'.musitu-wa-stage-backup-'));
 let db;
 try{
  const snapshotPath=join(tempDir,'snapshot.sqlite');
  db=new DatabaseSync(databasePath,{readOnly:true});
  await backup(db,snapshotPath);
  db.close();db=null;
  const raw=readFileSync(snapshotPath);
  if(raw.length>MAX_DB_BYTES||!raw.subarray(0,SQLITE_HEADER.length).equals(SQLITE_HEADER))
   throw Error('INVALID_SNAPSHOT_FORMAT_OR_SIZE');
  const encoded=encrypt(raw,backupKey);
  try{writeFileSync(encryptedPath,encoded,{flag:'wx',mode:0o600});}
  catch(error){if(error?.code==='EEXIST')throw Error('BACKUP_TARGET_EXISTS');throw error;}
  return {encrypted:true,format:'MFTWA15',archiveSha256:createHash('sha256').update(encoded).digest('hex'),bytes:encoded.length};
 }finally{db?.close();rmSync(tempDir,{recursive:true,force:true});}
}
export async function restoreEncryptedPrivateStage({encryptedPath,databasePath,backupKey}={}){
 validKey(backupKey);validPath(databasePath);validPath(encryptedPath);
 if(existsSync(databasePath))throw Error('RESTORE_TARGET_EXISTS');
 const decrypted=decrypt(readFileSync(encryptedPath),backupKey);
 if(!decrypted.subarray(0,SQLITE_HEADER.length).equals(SQLITE_HEADER))throw Error('INVALID_BACKUP_FORMAT');
 const stagedDir=mkdtempSync(join(dirname(databasePath),'.musitu-wa-recovery-'));
 try{
  const staged=join(stagedDir,'recovered.sqlite');
  writeFileSync(staged,decrypted,{flag:'wx',mode:0o600});
  // link() is atomic and refuses to replace an existing destination, unlike rename().
  try{linkSync(staged,databasePath);}catch(error){if(error?.code==='EEXIST')throw Error('RESTORE_TARGET_EXISTS');throw error;}
  return {restored:true,format:'MFTWA15'};
 }finally{rmSync(stagedDir,{recursive:true,force:true});}
}
