/**
 * MUSITU Store V2: private single-host staging/laboratory quarantine adapter.
 * NOT compatible with serverless ephemeral storage, multi-host production, a
 * public web root, or public access. Operator must supply a previously created
 * private root owned by this process with mode 0700; no implicit mkdir.
 *
 * A sealed object's presence is NOT approval, signature checking, malware
 * clearance, license validation, review completion or publication authority.
 */
import {randomBytes} from 'node:crypto';
import {constants as c} from 'node:fs';
import {open,opendir,realpath,lstat,unlink,link} from 'node:fs/promises';
import {isAbsolute,resolve,join} from 'node:path';

const PREFIX='private/apk/';
const TOKEN=/^[0-9a-f]{48}$/;
const DEFAULT_MAX=512*1024*1024;

function requireRootPath(root){
 if(typeof root!=='string'||!isAbsolute(root)||root.includes('\0')||resolve(root)!==root)
  throw Error('private quarantine requires canonical absolute root');
}
async function verifyRoot(root){
 const st=await lstat(root);
 if(!st.isDirectory()||st.isSymbolicLink()||(st.mode&0o077)!==0)
  throw Error('quarantine root must be a private directory (0700)');
 if(typeof process.getuid==='function'&&st.uid!==process.getuid())
  throw Error('quarantine root is not owned by current process');
 if(await realpath(root)!==root)
  throw Error('quarantine root or an ancestor is a symlink');
}
function tokenFromKey(key){
 if(typeof key!=='string'||!key.startsWith(PREFIX))throw Error('invalid private object key');
 const token=key.slice(PREFIX.length);
 if(!TOKEN.test(token))throw Error('invalid private object key');
 return token;
}

/**
 * Instantiate in a *trusted, isolated single-host* private worker only.
 * The root is pre-provisioned; an adapter instance cannot create a public
 * directory, grant access, or create signed URLs.
 */
export async function createPrivateFilesystemQuarantine({root,maxBytes=DEFAULT_MAX,maxOpenWriters=2}={}){
 requireRootPath(root);
 if(!Number.isSafeInteger(maxBytes)||maxBytes<4||maxBytes>DEFAULT_MAX)
  throw Error('invalid quarantine maximum byte limit');
 if(!Number.isSafeInteger(maxOpenWriters)||maxOpenWriters<1||maxOpenWriters>32)
  throw Error('invalid private uploader concurrency limit');
 await verifyRoot(root);
 let openWriters=0;
 const activeParts=new Set();
 async function begin({expectedBytes}={}){
  await verifyRoot(root);
  if(!Number.isSafeInteger(expectedBytes)||expectedBytes<4||expectedBytes>maxBytes)
   throw Error('invalid expected object size');
  const token=randomBytes(24).toString('hex');
  const pending=join(root,token+'.part');
  const sealedPath=join(root,token+'.apk');
  const key=PREFIX+token;
  if(openWriters>=maxOpenWriters)throw Error('private uploader at capacity');
  openWriters++;activeParts.add(token);
  let h;
  try{h=await open(pending,c.O_WRONLY|c.O_CREAT|c.O_EXCL|c.O_NOFOLLOW,0o600);}
  catch(e){activeParts.delete(token);openWriters--;throw e;}
  let released=false;
  const release=()=>{if(!released){released=true;activeParts.delete(token);openWriters--;}};
  let bytes=0,state='open',ownsSealed=false;
  return {
   async write(chunk){
    if(state!=='open')throw Error('object writer is not open');
    if(!(chunk instanceof Uint8Array)||chunk.byteLength===0)
     throw Error('invalid upload byte chunk');
    if(bytes+chunk.byteLength>expectedBytes)throw Error('private object exceeds manifest size');
    const buf=Buffer.from(chunk);
    let offset=0;
    while(offset<buf.length){
     const {bytesWritten}=await h.write(buf,offset,buf.length-offset);
     if(!Number.isInteger(bytesWritten)||bytesWritten<=0)throw Error('private storage short write');
     offset+=bytesWritten;
    }
    bytes+=buf.length;
   },
   async seal(){
    if(state!=='open')throw Error('object writer is not open');
    if(bytes!==expectedBytes)throw Error('private object size mismatch');
    // A privileged sibling process can replace the pending pathname even
    // though our open writer still points to its original inode. Never record
    // that substituted path as a sealed trusted object.
    const original=await h.stat();
    if(!original.isFile()||original.nlink!==1||original.size!==expectedBytes||
       (original.mode&0o077)!==0||
       (typeof process.getuid==='function'&&original.uid!==process.getuid()))
     throw Error('unsafe pending private quarantine inode');
    await h.sync();await h.close();state='pending-rename';
    try{
     await verifyRoot(root);
     const current=await lstat(pending);
     if(!current.isFile()||current.isSymbolicLink()||current.nlink!==1||
        current.dev!==original.dev||current.ino!==original.ino||
        current.size!==original.size||(current.mode&0o077)!==0||
        (typeof process.getuid==='function'&&current.uid!==process.getuid()))
      throw Error('unsafe pending private quarantine pathname');
     // link is atomic NO-REPLACE unlike rename(2): existing destination
     // objects are NEVER overwritten. Preserve an ownership flag so abort
     // cannot delete an object belonging to a prior writer on EEXIST.
     await link(pending,sealedPath);ownsSealed=true;
     const sealed=await lstat(sealedPath);
     if(!sealed.isFile()||sealed.isSymbolicLink()||sealed.dev!==original.dev||
        sealed.ino!==original.ino||sealed.size!==original.size||sealed.nlink!==2)
      throw Error('unsafe linked private quarantine inode');
     await unlink(pending);
     state='sealed';
     const dir=await open(root,c.O_RDONLY|c.O_DIRECTORY|c.O_NOFOLLOW);
     try{await dir.sync();}finally{await dir.close();}
     release();return key;
    }catch(e){
     // Caller must abort on failure; do not produce any DB receipt.
     throw e;
    }
   },
   async abort(){
    if(state==='aborted')return;
    if(state==='open')try{await h.close();}catch{}
    state='aborted';
    // Only this adapter's own random paths can be removed.
    try{for(const file of [pending,...(ownsSealed?[sealedPath]:[])]){
     try{await unlink(file);}catch(e){if(e.code!=='ENOENT')throw e;}
    }}finally{release();}
   }
  };
 }
 async function revoke(key){
  await verifyRoot(root);
  const token=tokenFromKey(key);
  try{await unlink(join(root,token+'.apk'));return true;}
  catch(e){if(e.code==='ENOENT')return false;throw e;}
 }
 // Strictly PRIVATE scanner hook. Caller must not serve bytes to publishers or
 // the public, and must independently validate any scanned APK before approval.
 async function inspectForPrivateTests(key){
  await verifyRoot(root);
  const token=tokenFromKey(key);
  const file=join(root,token+'.apk');
  // Open the inode itself with O_NOFOLLOW before checking its metadata.
  // A pathname lstat followed by readFile can follow a swapped symlink;
  // linked inodes are also not admissible as isolated private objects.
  const h=await open(file,c.O_RDONLY|c.O_NOFOLLOW);
  try{
   const st=await h.stat();
   if(!st.isFile()||st.nlink!==1||(st.mode&0o077)!==0||
      (typeof process.getuid==='function'&&st.uid!==process.getuid())||
      st.size>Math.min(maxBytes,16*1024*1024))
    throw Error('unsafe private quarantine object');
   return await h.readFile();
  }finally{await h.close();}
 }
 // Operator-only single-host abandoned-part cleanup; not a cron/web route.
 // Bound each cleanup invocation and walk via a directory iterator rather than
 // loading an attacker-inflated directory into process memory.
 async function pruneAbandonedParts({olderThanMs=24*60*60*1000,now=Date.now(),maxDeletes=100}={}){
  await verifyRoot(root);
  if(!Number.isSafeInteger(olderThanMs)||olderThanMs<60_000||
     !Number.isSafeInteger(now)||now<0||
     !Number.isSafeInteger(maxDeletes)||maxDeletes<1||maxDeletes>100)
   throw Error('unsafe private cleanup batch or threshold');
  let deleted=0;
  const dir=await opendir(root);
  try{
   for await(const entry of dir){
    if(deleted>=maxDeletes)break;
    const name=entry.name;
    if(!/^[0-9a-f]{48}\.part$/.test(name)||!entry.isFile())continue;
    // In-process leases protect live uploads. This adapter is not a
    // cross-host/multi-worker shared storage lease manager.
    if(activeParts.has(name.slice(0,48)))continue;
    const full=join(root,name);
    let first;
    try{first=await lstat(full);}catch(e){if(e.code==='ENOENT')continue;throw e;}
    if(!first.isFile()||first.isSymbolicLink()||first.nlink!==1||
       (first.mode&0o077)!==0||
       (typeof process.getuid==='function'&&first.uid!==process.getuid())||
       now-first.mtimeMs<olderThanMs)continue;
    let h;
    try{h=await open(full,c.O_RDONLY|c.O_NOFOLLOW|c.O_NONBLOCK);}
    catch(e){if(e.code==='ENOENT'||e.code==='ELOOP')continue;throw e;}
    try{
     const st=await h.stat();
     if(!st.isFile()||st.nlink!==1||st.dev!==first.dev||st.ino!==first.ino||
        (st.mode&0o077)!==0||
        (typeof process.getuid==='function'&&st.uid!==process.getuid())||
        now-st.mtimeMs<olderThanMs)continue;
    }finally{await h.close();}
    // Reconfirm the path and private root before removal; a privileged
    // concurrent local writer still requires a separate OS lease for safety.
    await verifyRoot(root);
    let last;
    try{last=await lstat(full);}catch(e){if(e.code==='ENOENT')continue;throw e;}
    if(!last.isFile()||last.isSymbolicLink()||last.nlink!==1||
       last.dev!==first.dev||last.ino!==first.ino||last.mtimeMs!==first.mtimeMs||
       (last.mode&0o077)!==0||activeParts.has(name.slice(0,48)))continue;
    try{await unlink(full);deleted++;}catch(e){if(e.code!=='ENOENT')throw e;}
   }
  }finally{await dir.close().catch(e=>{if(e.code!=='ERR_DIR_CLOSED')throw e;});}
  return deleted;
 }
 return Object.freeze({begin,revoke,inspectForPrivateTests,pruneAbandonedParts});
}
