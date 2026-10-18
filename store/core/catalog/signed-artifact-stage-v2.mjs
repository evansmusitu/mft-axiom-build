/**
 * V2 offline isolated artifact staging: verifies exact bytes from an operator-
 * supplied local file against a root-signed catalog. No network, install,
 * publish or release authority. Caller supplies trusted root and watermark.
 */
import {createHash,randomBytes} from 'node:crypto';
import {constants as C,openSync,closeSync,fstatSync,lstatSync,readSync,
  writeSync,fsyncSync,linkSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {verifySignedRegistryV2} from './signed-registry-v2.mjs';

const NOFOLLOW=C.O_NOFOLLOW??0;
const STAGE_LIMIT=512*1024*1024;
function deny(msg){throw new Error('private Store V2 artifact staging: '+msg);}
function ownerPrivateFile(fd,description){
  const info=fstatSync(fd);
  if(!info.isFile()||info.nlink!==1||(info.mode&0o077)!==0||
    typeof process.getuid!=='function'||info.uid!==process.getuid())
    deny('unsafe '+description+' file ownership, links or permissions');
  return info;
}
function checkCacheDirectory(path){
  if(typeof path!=='string'||!path.startsWith('/')||path.length>1024)
    deny('private absolute cache directory required');
  let info;
  try{info=lstatSync(path);}catch{deny('private cache directory unavailable');}
  if(!info.isDirectory()||(info.mode&0o077)!==0||
     typeof process.getuid!=='function'||info.uid!==process.getuid())
    deny('private owner-only cache directory required');
}
function hashFile(fd,expectedSize){
  const hash=createHash('sha256'),chunk=Buffer.allocUnsafe(64*1024);
  let n=0;
  while(true){
    const got=readSync(fd,chunk,0,chunk.length,null);
    if(got===0)break;
    n+=got;
    if(n>expectedSize||n>STAGE_LIMIT)deny('artifact length exceeds signed size');
    hash.update(chunk.subarray(0,got));
  }
  if(n!==expectedSize)deny('artifact size does not match signed catalog');
  return hash.digest('hex');
}
function verifyExisting(path,sha,size){
  let fd;
  try{fd=openSync(path,C.O_RDONLY|NOFOLLOW);}catch{deny('unsafe or missing existing cached artifact');}
  try{
    const info=ownerPrivateFile(fd,'existing cache');
    if(info.size!==size||hashFile(fd,size)!==sha)deny('existing cached artifact checksum mismatch');
  }finally{closeSync(fd);}
}
function fsyncDir(dir){
  const fd=openSync(dir,C.O_RDONLY|C.O_DIRECTORY|NOFOLLOW);
  try{fsyncSync(fd);}finally{closeSync(fd);}
}
/**
 * Stage only one root-authorized artifact for an app/platform. This function
 * makes no OS-install decision and does not persist a trusted catalog watermark.
 * No untrusted publisher request may supply the root trust pin or watermark.
 */
export function stageSignedLocalArtifactV2({verificationOptions,appId,platform,
  sourceFile,cacheDirectory}={}){
  checkCacheDirectory(cacheDirectory);
  if(!verificationOptions||typeof verificationOptions!=='object')deny('signed catalog verification inputs required');
  if(typeof appId!=='string'||typeof platform!=='string'||
      !['android','windows','web'].includes(platform))deny('authorized app and platform required');
  const verified=verifySignedRegistryV2(verificationOptions);
  const matching=verified.registry.apps.filter(a=>a.id===appId);
  if(matching.length!==1)deny('unknown signed application identity');
  const selected=matching[0].releases.filter(r=>r.platform===platform);
  if(selected.length!==1)deny('ambiguous signed release: explicit channel selection required');
  const release=selected[0];
  if(!Number.isSafeInteger(release.bytes)||release.bytes<1||release.bytes>STAGE_LIMIT)
    deny('artifact exceeds the private staging size limit');
  if(typeof sourceFile!=='string'||!sourceFile.startsWith('/')||sourceFile.length>2048)
    deny('trusted absolute local source file required');
  const finalPath=join(cacheDirectory,release.sha256+'.artifact');
  let sourceFd;
  try{sourceFd=openSync(sourceFile,C.O_RDONLY|NOFOLLOW);}
  catch{deny('unsafe or missing source file');}
  let tempPath=null,tempFd=null;
  try{
    const sourceInfo=ownerPrivateFile(sourceFd,'source');
    if(sourceInfo.size!==release.bytes)deny('source artifact size does not match signed catalog');
    tempPath=join(cacheDirectory,release.sha256+'.pending-'+randomBytes(16).toString('hex'));
    tempFd=openSync(tempPath,C.O_WRONLY|C.O_CREAT|C.O_EXCL|NOFOLLOW,0o600);
    ownerPrivateFile(tempFd,'pending');
    const digest=createHash('sha256'),buf=Buffer.allocUnsafe(64*1024);
    let copied=0;
    while(true){
      const got=readSync(sourceFd,buf,0,buf.length,null);
      if(!got)break;
      copied+=got;
      if(copied>release.bytes||copied>STAGE_LIMIT)deny('source artifact exceeds signed length');
      digest.update(buf.subarray(0,got));
      let offset=0;
      while(offset<got){
        const written=writeSync(tempFd,buf,offset,got-offset,null);
        if(!written)deny('incomplete private artifact write');
        offset+=written;
      }
    }
    if(copied!==release.bytes||digest.digest('hex')!==release.sha256)
      deny('source artifact SHA-256 or length does not match signed catalog');
    fsyncSync(tempFd);closeSync(tempFd);tempFd=null;
    let reused=false;
    try{linkSync(tempPath,finalPath);fsyncDir(cacheDirectory);}
    catch(err){
      if(err.code!=='EEXIST')throw err;
      verifyExisting(finalPath,release.sha256,release.bytes);
      reused=true;
    }
    return Object.freeze({status:'STAGED_PRIVATE_REVIEW_ONLY',appId,platform,
      packageId:release.packageId,catalogRevision:verified.registry.revision,
      sha256:release.sha256,privatePath:finalPath,reused});
  }finally{
    if(tempFd!==null)closeSync(tempFd);
    if(sourceFd!==undefined)closeSync(sourceFd);
    if(tempPath!==null){try{unlinkSync(tempPath);}catch(err){if(err.code!=='ENOENT')throw err;}}
  }
}
