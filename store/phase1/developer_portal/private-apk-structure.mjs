/**
 * MUSITU Store V2 private APK archive structural preflight -- NOT A SCANNER.
 *
 * This read-only, no-extraction, bounded metadata pass can only inspect a sealed
 * file under a preprovisioned owner-only quarantine root with an opaque key.
 * It cannot assert APK signatures, Android installability, malware clearance,
 * legal rights, human approval, or distribution entitlement. Those require
 * separate independent evidence and private execution authorities.
 */
import {constants as fsConstants} from 'node:fs';
import {createHash,timingSafeEqual} from 'node:crypto';
import {lstat, realpath, open} from 'node:fs/promises';
import {join, resolve, isAbsolute} from 'node:path';

const KEY_RE=/^private\/apk\/[0-9a-f]{48}$/;
const ENTRY_MAX=4096;
const MAX_ZIP=512*1024*1024;
const MAX_CENTRAL=32*1024*1024;
const MAX_EXPANDED=2*1024*1024*1024;
const decoder=new TextDecoder('utf-8',{fatal:true});

function reject(message){throw Error('unsafe private APK structure: '+message);}
function safeInteger(n){return Number.isSafeInteger(n)&&n>=0;}
function checkRoot(root){
 if(typeof root!=='string'||!isAbsolute(root)||resolve(root)!==root||root.includes('\0'))
  reject('private quarantine root is not a canonical absolute path');
}
async function inspectRoot(root){
 const stat=await lstat(root);
 if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o077)!==0)
  reject('quarantine root must have private directory permissions');
 if(typeof process.getuid==='function'&&stat.uid!==process.getuid())
  reject('quarantine root ownership mismatch');
 if(await realpath(root)!==root)reject('quarantine root symlink');
}
async function readExact(fh,size,position){
 if(!safeInteger(size)||!safeInteger(position))reject('unsafe ZIP metadata bounds');
 const output=Buffer.alloc(size);let n=0;
 while(n<size){const result=await fh.read(output,n,size-n,position+n);
  if(result.bytesRead<1)reject('truncated ZIP metadata');n+=result.bytesRead;}
 return output;
}
function safeMemberName(bytes){
 let name;
 try{name=decoder.decode(bytes);}catch{reject('invalid UTF-8 ZIP entry');}
 if(!name||name.length>1024||name!==name.normalize('NFC')||
    name.startsWith('/')||name.endsWith('/')||name.includes('\\')||
    /[\u0000-\u001f\u007f:\u202a-\u202e\u2066-\u2069]/u.test(name))
  reject('unsafe ZIP entry path');
 const parts=name.split('/');
 if(parts.some(x=>!x||x==='.'||x==='..'))reject('unsafe ZIP entry path');
 return name;
}
function ensureNoZip64(extra){
 let pos=0;
 while(pos<extra.length){
  if(pos+4>extra.length){
   // Android zipalign may add up to three zero bytes after complete TLVs.
   // Do not accept arbitrary trailing metadata or nonzero padding.
   if(extra.length-pos<=3&&extra.subarray(pos).every(b=>b===0))return;
   reject('truncated ZIP extra field');
  }
  const id=extra.readUInt16LE(pos),n=extra.readUInt16LE(pos+2);
  pos+=4;
  if(pos+n>extra.length)reject('invalid ZIP extra field');
  if(id===1||id===0x9901)reject('unsupported ZIP64 or AES extra field');
  pos+=n;
 }
}
async function checkApkSigningBlock(fd,start,end){
 // Structure only: matching Android APK Signing Block v2/v3 framing is
 // NOT cryptographic verification of any signer, certificate or digest.
 const span=end-start;
 if(span<36||span>32*1024*1024)reject('untrusted ZIP gap / invalid signing block size');
 const footer=await readExact(fd,24,end-24);
 if(!footer.subarray(8).equals(Buffer.from('APK Sig Block 42')))
  reject('untrusted ZIP gap; no APK signing block');
 const size=footer.readBigUInt64LE(0);
 if(size!==BigInt(span-8))reject('APK signing block size mismatch');
 const head=await readExact(fd,8,start);
 if(head.readBigUInt64LE(0)!==size)reject('APK signing block header mismatch');
 let cursor=start+8,count=0;
 while(cursor<end-24){
  if(cursor+12>end-24)reject('APK signing block truncated pair');
  const pair=await readExact(fd,12,cursor);
  const pairSize=pair.readBigUInt64LE(0);
  if(pairSize<4n||pairSize>BigInt(end-24-cursor-8))
   reject('APK signing block invalid pair length');
  cursor+=8+Number(pairSize);
  if(++count>4096)reject('APK signing block excessive pairs');
 }
 if(cursor!==end-24||count===0)reject('APK signing block malformed pairs');
}
function structuralOutput(count,total){
 return Object.freeze({status:'STRUCTURAL_PREFLIGHT_ONLY',entryCount:count,
  declaredExpandedBytes:total,signatureVerified:false,malwareCleared:false,
  publicationAuthorized:false,publisherApproved:false,paymentAuthorized:false,
  entitlementGranted:false});
}
export async function createQuarantinedApkPreflight({root,maxEntries=ENTRY_MAX,
 maxExpandedBytes=MAX_EXPANDED,maxExpansionRatio=200}={}){
 checkRoot(root);
 if(!Number.isInteger(maxEntries)||maxEntries<2||maxEntries>ENTRY_MAX||
    !Number.isSafeInteger(maxExpandedBytes)||maxExpandedBytes<1024||maxExpandedBytes>MAX_EXPANDED||
    !Number.isSafeInteger(maxExpansionRatio)||maxExpansionRatio<1||maxExpansionRatio>1000)
  reject('invalid structural preflight limits');
 await inspectRoot(root);
 async function inspect(key,{expectedSha256,expectedBytes}={}){
  if(typeof key!=='string'||!KEY_RE.test(key))reject('invalid private object key');
  if(typeof expectedSha256!=='string'||!/^[a-f0-9]{64}$/.test(expectedSha256)||
     !Number.isSafeInteger(expectedBytes)||expectedBytes<22||expectedBytes>MAX_ZIP)
   reject('immutable APK manifest SHA-256 and byte count required');
  await inspectRoot(root);
  const path=join(root,key.slice('private/apk/'.length)+'.apk');
  const fd=await open(path,fsConstants.O_RDONLY|fsConstants.O_NOFOLLOW);
  try{
   const st=await fd.stat();
   if(!st.isFile()||st.nlink!==1||(st.mode&0o077)!==0||
     (typeof process.getuid==='function'&&st.uid!==process.getuid())||
     !safeInteger(st.size)||st.size<22||st.size>MAX_ZIP)
    reject('private object permissions, hardlink or size');
   if(st.size!==expectedBytes)reject('APK manifest size mismatch');
   const size=st.size,tailSize=Math.min(size,65557);
   const tail=await readExact(fd,tailSize,size-tailSize);
   let end=-1;
   for(let i=tailSize-22;i>=0;i--){
    if(tail.readUInt32LE(i)===0x06054b50&&i+22+tail.readUInt16LE(i+20)===tailSize){end=i;break;}
   }
   if(end<0)reject('missing or truncated ZIP end of central directory');
   const eocd=tail.subarray(end,end+22);
   if(eocd.readUInt16LE(4)!==0||eocd.readUInt16LE(6)!==0)
    reject('ZIP multi-disk archives forbidden');
   const onDisk=eocd.readUInt16LE(8),totalCount=eocd.readUInt16LE(10);
   if(totalCount<2||totalCount>maxEntries||onDisk!==totalCount||totalCount===0xffff)
    reject('ZIP entry count/limit or split archive');
   const cdLength=eocd.readUInt32LE(12),cdStart=eocd.readUInt32LE(16);
   const endStart=size-tailSize+end;
   if(cdLength<46||cdLength>MAX_CENTRAL||cdStart>size||cdStart+cdLength!==endStart||
      cdLength===0xffffffff||cdStart===0xffffffff)
    reject('invalid ZIP central directory bounds/ZIP64');
   const dir=await readExact(fd,cdLength,cdStart);
   let pos=0,totalExpanded=0;const seen=new Set();
   const members=[];let manifest=false,dex=false;
   for(let i=0;i<totalCount;i++){
    if(pos+46>dir.length||dir.readUInt32LE(pos)!==0x02014b50)
     reject('invalid ZIP central entry');
    const madeBy=dir.readUInt16LE(pos+4),needed=dir.readUInt16LE(pos+6);
    const flags=dir.readUInt16LE(pos+8),method=dir.readUInt16LE(pos+10);
    const crc=dir.readUInt32LE(pos+16);
    const compressed=dir.readUInt32LE(pos+20),expanded=dir.readUInt32LE(pos+24);
    const nName=dir.readUInt16LE(pos+28),nExtra=dir.readUInt16LE(pos+30),nComment=dir.readUInt16LE(pos+32);
    const disk=dir.readUInt16LE(pos+34),attrib=dir.readUInt32LE(pos+38);
    const offset=dir.readUInt32LE(pos+42);
    const endEntry=pos+46+nName+nExtra+nComment;
    if(needed>45||nName<1||nName>1024||endEntry>dir.length||disk!==0||
      [compressed,expanded,offset].includes(0xffffffff))
      reject('unsupported or malformed ZIP entry');
    if((flags&0x2041)!==0)reject('encrypted ZIP member forbidden');
    if(method!==0&&method!==8)reject('unsupported ZIP compression method');
    if(method===0&&compressed!==expanded)reject('invalid stored ZIP size');
    if(expanded>0&&(compressed===0||expanded>compressed*maxExpansionRatio))
      reject('ZIP expansion ratio limit');
    totalExpanded+=expanded;
    if(totalExpanded>maxExpandedBytes)reject('ZIP expanded bytes limit');
    const rawName=dir.subarray(pos+46,pos+46+nName);
    const name=safeMemberName(rawName);
    const unique=name.toLowerCase();
    if(seen.has(unique))reject('duplicate ZIP entry / case collision');
    seen.add(unique);
    // Attackers can forge the ZIP creator OS. Never trust `madeBy` when
    // deciding whether an entry encodes a symlink, device, FIFO or socket.
    const fileType=(attrib>>>16)&0o170000;
    if(fileType!==0&&fileType!==0o100000)
      reject('symlink or special ZIP entry forbidden');
    const extra=dir.subarray(pos+46+nName,pos+46+nName+nExtra);
    ensureNoZip64(extra);
    const local=await readExact(fd,30,offset);
    if(local.readUInt32LE(0)!==0x04034b50||
      local.readUInt16LE(6)!==flags||local.readUInt16LE(8)!==method)
      reject('ZIP local entry mismatch');
    const localNameLen=local.readUInt16LE(26),localExtraLen=local.readUInt16LE(28);
    if(localNameLen!==nName||offset+30+nName+localExtraLen>cdStart)
      reject('ZIP local entry offset or name mismatch');
    const localName=await readExact(fd,localNameLen,offset+30);
    if(!localName.equals(rawName))reject('ZIP local vs central filename mismatch');
    const localExtra=await readExact(fd,localExtraLen,offset+30+localNameLen);
    ensureNoZip64(localExtra);
    const localCrc=local.readUInt32LE(14),localCompressed=local.readUInt32LE(18),
      localExpanded=local.readUInt32LE(22);
    if(!(flags&8)?(localCrc!==crc||localCompressed!==compressed||localExpanded!==expanded):
      ((localCrc!==0&&localCrc!==crc)||
       (localCompressed!==0&&localCompressed!==compressed)||
       (localExpanded!==0&&localExpanded!==expanded)))
      reject('ZIP local size/CRC mismatch');
    const dataStart=offset+30+nName+localExtraLen, dataEnd=dataStart+compressed;
    if(dataEnd>cdStart||dataStart>dataEnd)
      reject('ZIP compressed member offset exceeds private object');
    let physicalEnd=dataEnd;
    if(flags&8){
      // Bit 3 requires a physical CRC/size data descriptor after the member.
      // A forged flag must never let attacker-controlled bytes escape bounds.
      if(dataEnd+12>cdStart)reject('ZIP data descriptor missing');
      const probe=await readExact(fd,4,dataEnd);
      const signed=probe.readUInt32LE(0)===0x08074b50;
      const descriptor=await readExact(fd,signed?16:12,dataEnd);
      const start=signed?4:0;
      if(descriptor.readUInt32LE(start)!==crc||
         descriptor.readUInt32LE(start+4)!==compressed||
         descriptor.readUInt32LE(start+8)!==expanded)
       reject('ZIP data descriptor mismatch');
      physicalEnd=dataEnd+descriptor.length;
    }
    members.push({name,start:offset,end:physicalEnd});
    if(name==='AndroidManifest.xml')manifest=true;
    if(name==='classes.dex')dex=true;
    pos=endEntry;
   }
   if(pos!==dir.length)reject('ZIP central directory surplus or count mismatch');
   members.sort((a,b)=>a.start-b.start);
   if(members[0].start!==0)reject('ZIP untrusted leading bytes');
   for(let i=1;i<members.length;i++){
    if(members[i].start<members[i-1].end)
      reject('ZIP overlapping local compressed ranges');
    if(members[i].start!==members[i-1].end)
      reject('untrusted ZIP gap between local members');
   }
   if(members[members.length-1].end<cdStart)
    await checkApkSigningBlock(fd,members[members.length-1].end,cdStart);
   for(const {name} of members){
    const pieces=name.toLowerCase().split('/');let parent='';
    for(let i=0;i<pieces.length-1;i++){
     parent=parent?parent+'/'+pieces[i]:pieces[i];
     if(seen.has(parent))reject('ZIP file-directory name collision');
    }
   }
   if(!manifest||!dex)reject('APK missing mandatory manifest or classes.dex');
   // Re-read the exact opened descriptor without allocating the complete APK.
   // A structure-only pass MUST still cryptographically bind to the immutable
   // receipt; otherwise a replaced private blob could inherit a trusted scan.
   const digest=createHash('sha256');
   const chunk=Buffer.allocUnsafe(Math.min(size,1024*1024));
   for(let pos=0;pos<size;){
    const {bytesRead}=await fd.read(chunk,0,Math.min(chunk.length,size-pos),pos);
    if(bytesRead<=0)reject('truncated private APK during digest');
    digest.update(chunk.subarray(0,bytesRead));pos+=bytesRead;
   }
   if(!timingSafeEqual(digest.digest(),Buffer.from(expectedSha256,'hex')))
    reject('APK immutable manifest digest mismatch');
   const after=await fd.stat();
   if(after.size!==size||after.mtimeMs!==st.mtimeMs||after.ino!==st.ino)
    reject('private APK mutated during preflight');
   await inspectRoot(root);
   return structuralOutput(totalCount,totalExpanded);
  }finally{await fd.close();}
 }
 return Object.freeze({inspect});
}
