/**
 * EXPERIMENTAL PRIVATE OFFLINE CATALOG WORKER ONLY. NOT WEB, ANDROID, OR
 * RELEASE SERVICE. A pinned local filesystem directory is provisioned by the
 * trusted operator. Process/OS-protected directory custody is a prerequisite.
 * No attempt is made to defeat rollback of the entire filesystem snapshot.
 */
import {constants as F, closeSync, existsSync, fstatSync, fsyncSync, lstatSync,
        openSync, readFileSync, renameSync, unlinkSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {verifySignedRegistryV2} from './signed-registry-v2.mjs';

const SCHEMA='musitu.store.v2.watermark.v1';
const STATE='accepted-v2-catalog.json';
const LOCK='accepted-v2-catalog.lock';
const TEMP='accepted-v2-catalog.pending';
const DIGEST=/^[a-f0-9]{64}$/;
const NOFOLLOW=F.O_NOFOLLOW??0;

function fail(reason){throw new Error('private catalog watermark: '+reason);}
function privateFile(file,fd){
  const s=fstatSync(fd);
  if(!s.isFile()||s.nlink!==1||(s.mode&0o077)!==0||
    (typeof process.getuid==='function'&&s.uid!==process.getuid()))
    fail(file+' must be an owner-private regular file');
  return s;
}
function ownerDirectory(dir){
  if(typeof dir!=='string'||!dir.startsWith('/')||dir.length>1024)fail('trusted absolute directory required');
  const st=lstatSync(dir);
  if(!st.isDirectory()||(st.mode&0o077)!==0||
     typeof process.getuid!=='function'||st.uid!==process.getuid())
    fail('private owner-only directory required');
}
function readState(path){
  let fd;
  try {fd=openSync(path,F.O_RDONLY|NOFOLLOW);}
  catch(e){if(e.code==='ENOENT')return null;throw e;}
  try {
    const s=privateFile('watermark',fd);
    if(s.size<50||s.size>2048)fail('invalid watermark size');
    let value;
    let raw;
    try {raw=readFileSync(fd,{encoding:'utf8'});value=JSON.parse(raw);}
    catch{fail('invalid watermark JSON');}
    if(raw!==JSON.stringify(value)+'\n')fail('invalid noncanonical watermark serialization');
    if(!value||typeof value!=='object'||Array.isArray(value)||
       Object.keys(value).sort().join(',')!==
       'catalogSha256,revision,rootPemSha256,schema' ||value.schema!==SCHEMA||
       !Number.isSafeInteger(value.revision)||value.revision<1||
       !DIGEST.test(value.catalogSha256)||!DIGEST.test(value.rootPemSha256))
      fail('invalid watermark fields');
    return value;
  } finally {closeSync(fd);}
}
function writeState(directory,value){
  const temp=join(directory,TEMP),name=join(directory,STATE);
  let fd;
  // A pending write from a crashed transaction must be operator-reviewed.
  try {fd=openSync(temp,F.O_WRONLY|F.O_CREAT|F.O_EXCL|NOFOLLOW,0o600);}
  catch(e){if(e.code==='EEXIST')fail('pending transaction requires operator recovery');throw e;}
  let advanced=false;
  try {
    privateFile('pending watermark',fd);
    writeFileSync(fd,JSON.stringify(value)+'\n',{encoding:'utf8'});
    fsyncSync(fd);
    closeSync(fd);fd=undefined;
    renameSync(temp,name);
    advanced=true;
    // Persist the directory entry, not merely the file body.
    const dirfd=openSync(directory,F.O_RDONLY|F.O_DIRECTORY|NOFOLLOW);
    try {fsyncSync(dirfd);}finally{closeSync(dirfd);}
  } finally {
    if(fd!==undefined)closeSync(fd);
    // Preserve a stranded pending file on failure for operator inspection.
    // Its presence prevents silent re-bootstrap; no automatic recovery.
  }
  return advanced;
}

/**
 * Atomic monotonic watermark update serialized by an exclusive private lock.
 * Fail closed on missing trusted state except on an explicitly authorized
 * first-run bootstrap. Does not write or sign catalog payloads, perform network
 * requests, or grant production/publisher approval.
 */
export function verifyAndCommitSignedRegistryV2({storeDirectory,verificationOptions,bootstrapAuthorized=false,beforeCommit}={}){
  ownerDirectory(storeDirectory);
  if(!verificationOptions||typeof verificationOptions!=='object')fail('verification inputs required');
  if('highestAcceptedRevision' in verificationOptions ||
     'highestAcceptedDigest' in verificationOptions)
    fail('caller must not override durable trusted watermark');
  if(bootstrapAuthorized!==true&&bootstrapAuthorized!==false)fail('explicit bootstrap flag required');
  const stateFile=join(storeDirectory,STATE), lockFile=join(storeDirectory,LOCK);
  let lockFd;
  try {lockFd=openSync(lockFile,F.O_WRONLY|F.O_CREAT|F.O_EXCL|NOFOLLOW,0o600);}
  catch(e){if(e.code==='EEXIST')fail('concurrent transaction lock present; operator recovery required');throw e;}
  try {
    const lockInfo=privateFile('transaction lock',lockFd);
    // Treat any abandoned pending file as an unresolved integrity event.
    if(existsSync(join(storeDirectory,TEMP)))fail('pending transaction requires operator recovery');
    const old=readState(stateFile);
    if(!old&&!bootstrapAuthorized)fail('trusted watermark missing; first-install bootstrap not authorized');
    if(old&&old.rootPemSha256!==verificationOptions.expectedRootPemSha256)
      fail('pinned root trust anchor changed');
    const validated=verifySignedRegistryV2({
      ...verificationOptions,highestAcceptedRevision:old?.revision??0,
      highestAcceptedDigest:old?.catalogSha256??null
    });
    // Require all synchronous offline verification/staging before advancing
    // the revision. Hold the same durable transaction lock throughout.
    if(beforeCommit!==undefined){
      if(typeof beforeCommit!=='function')fail('beforeCommit must be a synchronous callback');
      const result=beforeCommit(validated);
      if(result!==null&&(typeof result==='object'||typeof result==='function')&&
          typeof result.then==='function')fail('asynchronous beforeCommit is forbidden');
    }
    if(!old||validated.registry.revision>old.revision){
      writeState(storeDirectory,{
        schema:SCHEMA,revision:validated.registry.revision,
        catalogSha256:validated.catalogSha256,
        rootPemSha256:validated.verifiedRootPemSha256
      });
    }
    return validated;
  } finally {
    if(lockFd!==undefined){
      const owned=fstatSync(lockFd);
      closeSync(lockFd);
      // Never unlink a lock that has been swapped by another actor.
      try {const live=lstatSync(lockFile);
        if(live.dev===owned.dev&&live.ino===owned.ino)unlinkSync(lockFile);
      } catch(e){if(e.code!=='ENOENT')throw e;}
    }
  }
}
