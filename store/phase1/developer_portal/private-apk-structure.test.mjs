import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,chmod,writeFile,rm,readFile,lstat,link,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createQuarantinedApkPreflight} from './private-apk-structure.mjs';
import {runPrivateStructuralPreflight} from './private-structure-review.mjs';

const ROOT='private/apk/';
const id='a'.repeat(48);
const C={
 manifest:{name:'AndroidManifest.xml',data:Buffer.from([3,0,8,0])},
 dex:{name:'classes.dex',data:Buffer.from('dex\n035\0')},
};
function zip(entries=[C.manifest,C.dex],opts={}){
 let at=0;const locals=[],central=[];
 for(const entry of entries){
  const name=Buffer.from(entry.name),data=entry.data??Buffer.from('x');
  const localExtra=entry.localExtra??Buffer.alloc(0);
  const flags=entry.flags??0,method=entry.method??0;
  const local=Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);
  local.writeUInt16LE(flags,6);local.writeUInt16LE(method,8);
  local.writeUInt32LE(data.length,18);local.writeUInt32LE(entry.expanded??data.length,22);
  local.writeUInt16LE(name.length,26);local.writeUInt16LE(localExtra.length,28);
  locals.push(local,name,localExtra,data);
  const c=Buffer.alloc(46);
  c.writeUInt32LE(0x02014b50,0);c.writeUInt16LE(entry.madeBy??(entry.unixMode?0x0314:20),4);
  c.writeUInt16LE(20,6);c.writeUInt16LE(flags,8);c.writeUInt16LE(method,10);
  c.writeUInt32LE(data.length,20);c.writeUInt32LE(entry.expanded??data.length,24);
  c.writeUInt16LE(name.length,28);c.writeUInt32LE((entry.unixMode??0)>>>0,38);
  c.writeUInt32LE(entry.localOffset??at,42);
  central.push(c,name);
  at+=local.length+name.length+localExtra.length+data.length;
 }
 const directory=Buffer.concat(central),local=Buffer.concat(locals),end=Buffer.alloc(22);
 end.writeUInt32LE(0x06054b50,0);
 end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);
 end.writeUInt32LE(directory.length,12);end.writeUInt32LE(local.length,16);
 if(opts.forceDisk)end.writeUInt16LE(1,4);
 return Buffer.concat([local,directory,end]);
}
async function withQuarantine(fn){
 const root=await mkdtemp(join(tmpdir(),'musitu-apk-preflight-'));
 await chmod(root,0o700);
 try{
  const target=join(root,id+'.apk');
  await writeFile(target,zip(),{mode:0o600});
  const raw=await createQuarantinedApkPreflight({root});
  const original=zip();
  const bound={expectedBytes:original.length,expectedSha256:createHash('sha256').update(original).digest('hex')};
  const inspector={inspect:async(key,override={})=>{
   const st=await lstat(target);
   const bytes=st.isSymbolicLink()?original:await readFile(target);
   const current={expectedBytes:bytes.length,expectedSha256:createHash('sha256').update(bytes).digest('hex')};
   return raw.inspect(key,{...current,...override});
  }};
  return await fn({inspector,root,target,key:ROOT+id,bound});
 }finally{await rm(root,{recursive:true,force:true});}
}
test('private valid APK structure gets evidence-only result with no approval, signature or scan assertions',()=>withQuarantine(async ({inspector,key})=>{
 const result=await inspector.inspect(key);
 assert.equal(result.status,'STRUCTURAL_PREFLIGHT_ONLY');
 assert.equal(result.entryCount,2);
 for(const k of ['signatureVerified','malwareCleared','publicationAuthorized','publisherApproved','paymentAuthorized','entitlementGranted'])
  assert.equal(result[k],false);
}));
test('missing Android manifest or classes.dex is rejected',()=>withQuarantine(async ({inspector,target,key})=>{
 for(const entries of [[C.dex],[C.manifest]]){
  await writeFile(target,zip(entries),{mode:0o600});
  await assert.rejects(inspector.inspect(key),/manifest|dex|APK/i);
 }
}));
test('reject ZIP path traversal, Windows paths, duplicate names and case collisions',()=>withQuarantine(async ({inspector,target,key})=>{
 for(const evil of ['../evil','a/../evil','/absolute','C:/windows','a\\b','a//b','a/./b','a/'] ){
  await writeFile(target,zip([C.manifest,C.dex,{name:evil}]),{mode:0o600});
  await assert.rejects(inspector.inspect(key),/unsafe|entry|path|ZIP/i,evil);
 }
 for(const extras of [
  [{name:'classes.dex',data:Buffer.from('collision')}],
  [{name:'CLASSES.DEX',data:Buffer.from('collision')}],
  [{name:'dir'},{name:'dir/file'}]
 ]){
  await writeFile(target,zip([C.manifest,C.dex,...extras]),{mode:0o600});
  await assert.rejects(inspector.inspect(key),/duplicate|collision|entry/i);
 }
}));
test('reject encrypted members, Unix symlinks and manipulated central local offsets',()=>withQuarantine(async ({inspector,target,key})=>{
 for(const entry of [{...C.dex,flags:1},{...C.dex,unixMode:0o120777<<16},{...C.dex,localOffset:999999}]){
  await writeFile(target,zip([C.manifest,entry]),{mode:0o600});
  await assert.rejects(inspector.inspect(key),/encrypted|symlink|offset|ZIP/i);
 }
}));
test('reject large expansion ratio, unsupported compression methods and excess entries',()=>withQuarantine(async ({root,target,key})=>{
 const raw=await createQuarantinedApkPreflight({root,maxEntries:3,maxExpansionRatio:20});
 const manifest=zip();const bind={expectedBytes:manifest.length,expectedSha256:createHash('sha256').update(manifest).digest('hex')};
 const inspector={inspect:async key=>{const bytes=await readFile(target);return raw.inspect(key,{expectedBytes:bytes.length,expectedSha256:createHash('sha256').update(bytes).digest('hex')});}};
 for(const entry of [
  {...C.dex,method:8,data:Buffer.from([3]),expanded:2500000},
  {...C.dex,method:99},
 ]){
  await writeFile(target,zip([C.manifest,entry]),{mode:0o600});
  await assert.rejects(inspector.inspect(key),/expansion|compression|ratio|unsupported/i);
 }
 await writeFile(target,zip([C.manifest,C.dex,{name:'x'},{name:'y'}]),{mode:0o600});
 await assert.rejects(inspector.inspect(key),/entries|limit/i);
}));
test('malformed EOCD, split disk, garbage suffix and truncated member fail closed',()=>withQuarantine(async ({inspector,target,key})=>{
 const valid=zip();
 for(const evil of [valid.subarray(0,valid.length-7),Buffer.concat([valid,Buffer.from('garbage')]),zip(undefined,{forceDisk:true})]){
  await writeFile(target,evil,{mode:0o600});
  await assert.rejects(inspector.inspect(key),/ZIP|archive|disk|central/i);
 }
}));
test('reject symlink keys, hardlinks, publicly readable files and unsafe object keys',()=>withQuarantine(async ({inspector,root,target,key})=>{
 await assert.rejects(inspector.inspect('private/apk/../../escape'),/invalid.*key/i);
 await chmod(target,0o644);
 await assert.rejects(inspector.inspect(key),/private|permission|unsafe/i);
 await chmod(target,0o600);
 const other=join(root,'other.apk');await link(target,other);
 await assert.rejects(inspector.inspect(key),/hardlink|private|link/i);
 await rm(other);
 await rm(target);
 await symlink('/etc/passwd',target);
 await assert.rejects(inspector.inspect(key),/symlink|private|unsafe|ELOOP/i);
}));
test('preflight never decomposes files, exports object bytes or accepts a caller-selected path',()=>withQuarantine(async ({inspector,key})=>{
 const result=await inspector.inspect(key);
 assert.ok(!('bytes' in result));assert.ok(!('path' in result));assert.ok(!('approved' in result));
 assert.equal(Object.isFrozen(result),true);
}));

test('immutable private manifest SHA-256 and exact byte count are required and never inferred',()=>withQuarantine(async ({inspector,key,bound,target})=>{
 await assert.rejects(inspector.inspect(key,{expectedSha256:undefined}),/manifest|sha|digest|hash/i);
 await assert.rejects(inspector.inspect(key,{expectedBytes:undefined}),/manifest|bytes|size/i);
 await assert.rejects(inspector.inspect(key,{expectedSha256:'0'.repeat(64)}),/digest|hash/i);
 await assert.rejects(inspector.inspect(key,{expectedBytes:bound.expectedBytes+1}),/manifest|bytes|size/i);
 const bytes=await readFile(target);bytes[30+'AndroidManifest.xml'.length]^=0x01; // sealed object tampered after manifest was signed
 await writeFile(target,bytes,{mode:0o600});
 await assert.rejects(inspector.inspect(key,bound),/digest|hash/i);
}));

test('real Android zipalign-style zero padding is accepted but malformed metadata is not',()=>withQuarantine(async ({inspector,target,key})=>{
 const valid=zip([C.manifest,C.dex,{name:'assets/trace.bin',data:Buffer.from('ready'),localExtra:Buffer.alloc(3)}]);
 await writeFile(target,valid,{mode:0o600});
 assert.equal((await inspector.inspect(key)).entryCount,3);
 const wrong=zip([C.manifest,C.dex,{name:'assets/trace.bin',localExtra:Buffer.from([0,1,2])}]);
 await writeFile(target,wrong,{mode:0o600});
 await assert.rejects(inspector.inspect(key),/truncated ZIP extra field/);
}));
test('local and central CRC, method and flags cannot disagree',()=>withQuarantine(async ({inspector,target,key})=>{
 let bytes=zip();
 bytes.writeUInt32LE(1,14);
 await writeFile(target,bytes,{mode:0o600});
 await assert.rejects(inspector.inspect(key),/CRC mismatch/);
 bytes=zip();bytes.writeUInt16LE(8,8);
 await writeFile(target,bytes,{mode:0o600});
 await assert.rejects(inspector.inspect(key),/local entry mismatch/);
 bytes=zip();bytes.writeUInt16LE(1,6);
 await writeFile(target,bytes,{mode:0o600});
 await assert.rejects(inspector.inspect(key),/local entry mismatch/);
}));
test('aggregate decompressed-size limit and non-reproducible manifest digest always deny',()=>withQuarantine(async ({root,target,key})=>{
 const raw=await createQuarantinedApkPreflight({root,maxExpandedBytes:1024});
 const bytes=zip([C.manifest,{...C.dex,method:8,data:Buffer.alloc(60,0x4a),expanded:1500}]);
 await writeFile(target,bytes,{mode:0o600});
 await assert.rejects(raw.inspect(key,{expectedBytes:bytes.length,expectedSha256:createHash('sha256').update(bytes).digest('hex')}),/expanded bytes limit/);
}));

test('actual private file -> manifest-bound structural review coordinator emits receipt, no release',()=>withQuarantine(async ({root,target,key})=>{
 const raw=await createQuarantinedApkPreflight({root});
 const payload=await readFile(target),sha=createHash('sha256').update(payload).digest('hex');
 const submissionId='sub-'+('e'.repeat(32));
 const actor={subject:'independent-reviewer-01',role:'review_security',tokenId:'reviewer-token-session-0001'};
 let count=0, evidence;
 const repository={async readQuarantineReceipt(id){assert.equal(id,submissionId);return {submissionId,
  publisherId:'first-party-test',actorId:'different-developer-01',
  apkSha256:sha,apkBytes:payload.length,storageKey:key};},
  async recordStructuralCheck(input){count++;evidence=input;return {kind:'created'};}};
 const r=await runPrivateStructuralPreflight({repository,inspector:raw,isAuthorized:async()=>true,
  submissionId,actor});
 assert.equal(r.status,'STRUCTURAL_PREFLIGHT_ONLY');assert.equal(r.entryCount,2);
 assert.equal(count,1);assert.equal(evidence.apkSha256,sha);
 assert.equal(evidence.inspectorTokenId,actor.tokenId);
 assert.equal(r.publicationAuthorized,false);assert.equal(r.malwareCleared,false);
 const tampered=Buffer.from(payload);tampered[30+'AndroidManifest.xml'.length]^=1;
 await writeFile(target,tampered,{mode:0o600});
 await assert.rejects(runPrivateStructuralPreflight({repository,inspector:raw,isAuthorized:async()=>true,
  submissionId,actor}),/manifest digest mismatch/);
 assert.equal(count,1,'mismatched object must not be accepted into audit');
}));

test('UNIX special files cannot evade rejection by forging the ZIP creator platform',()=>withQuarantine(async ({inspector,target,key})=>{
 for(const mode of [0o120777,0o060666,0o020666,0o010666]){
  const bytes=zip([C.manifest,C.dex,{name:'assets/forged',unixMode:(mode<<16)>>>0,madeBy:20}]);
  await writeFile(target,bytes,{mode:0o600});
  await assert.rejects(inspector.inspect(key),/symlink|special|unsafe/i);
 }
}));
