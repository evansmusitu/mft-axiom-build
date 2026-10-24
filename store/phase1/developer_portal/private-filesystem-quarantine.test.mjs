import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,chmod,readFile,writeFile,symlink,readdir,lstat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {createDeveloperPortal} from './portal.mjs';
import {createPrivateFilesystemQuarantine} from './private-filesystem-quarantine.mjs';
import {intakeQuarantinedApk} from './quarantine-upload.mjs';
const apk=Buffer.concat([Buffer.from([80,75,3,4]),Buffer.alloc(64,11)]);
const hex=x=>createHash('sha256').update(x).digest('hex');
async function fixture(fn){
 const root=await mkdtemp(join(tmpdir(),'musitu-private-q-'));
 try{await chmod(root,0o700);return await fn(root);}
 finally{await rm(root,{recursive:true,force:true});}
}
test('verified private root enforces 0700 and rejects symlinks or public paths',async()=>fixture(async root=>{
 const q=await createPrivateFilesystemQuarantine({root});assert.ok(q);
 await chmod(root,0o755);
 await assert.rejects(createPrivateFilesystemQuarantine({root}),/private directory/);
 await chmod(root,0o700);
 const link=root+'-link';
 await symlink(root,link);
 try{await assert.rejects(createPrivateFilesystemQuarantine({root:link}),/private directory|symlink/);}
 finally{await rm(link,{force:true});}
 await assert.rejects(createPrivateFilesystemQuarantine({root:'relative/storage'}),/absolute root/);
}));
test('seal, mode 0600, private read, controlled revoke, replay denied',async()=>fixture(async root=>{
 const q=await createPrivateFilesystemQuarantine({root});const s=await q.begin({expectedBytes:apk.length});
 await s.write(apk.subarray(0,10));await s.write(apk.subarray(10));
 const key=await s.seal();assert.match(key,/^private\/apk\/[0-9a-f]{48}$/);
 const file=join(root,key.slice('private/apk/'.length)+'.apk');
 assert.equal((await lstat(file)).mode&0o077,0);
 assert.deepEqual(await q.inspectForPrivateTests(key),apk);
 await assert.rejects(s.seal(),/not open/);
 await assert.rejects(s.write(apk),/not open/);
 await assert.rejects(q.revoke('private/apk/../../etc/passwd'),/invalid private object key/);
 assert.equal(await q.revoke(key),true);
 assert.equal(await q.revoke(key),false);
 await assert.rejects(q.inspectForPrivateTests(key));
}));
test('short write, overflow and manual abort never leave quarantined bytes',async()=>fixture(async root=>{
 const q=await createPrivateFilesystemQuarantine({root,maxBytes:100});
 const a=await q.begin({expectedBytes:apk.length});
 await a.write(apk.subarray(0,10));
 await assert.rejects(a.seal(),/size mismatch/);
 await a.abort();assert.deepEqual(await readdir(root),[]);
 const b=await q.begin({expectedBytes:apk.length});
 await assert.rejects(b.write(Buffer.alloc(apk.length+1)),/exceeds manifest size/);
 await b.abort();assert.deepEqual(await readdir(root),[]);
}));
test('service intake writes only unscanned private object; conflicted receipt revoked',async()=>fixture(async root=>{
 const q=await createPrivateFilesystemQuarantine({root});
 const submission={id:'sub-'+('a'.repeat(32)),publisherId:'owner-tenant',apkSha256:hex(apk),apkBytes:apk.length};
 const actor={publisherId:'owner-tenant'};
 const req=()=>new Request('https://store-stage.example.org/developer/submissions/'+submission.id+'/apk',
  {method:'PUT',headers:{'content-type':'application/vnd.android.package-archive'},body:apk});
 let calls=0,storedKey=null;
 const repo={async recordUpload(x){calls++;assert.equal(x.publisherId,'owner-tenant');
   if(calls===1){storedKey=x.objectKey;return {kind:'created'};}
   return {kind:'conflict'};}};
 const good=await intakeQuarantinedApk({req:req(),submission,actor,quarantine:q,repository:repo});
 assert.equal(good.state,'QUARANTINED_UNSCANNED');
 assert.deepEqual(await q.inspectForPrivateTests(storedKey),apk);
 await assert.rejects(intakeQuarantinedApk({req:req(),submission,actor,quarantine:q,repository:repo}),e=>e.httpStatus===409);
 assert.equal((await readdir(root)).length,1,'concurrent loser must not leave an orphan');
 assert.equal(await q.revoke(storedKey),true);
 assert.deepEqual(await readdir(root),[]);
}));
test('reaper deletes only stale incomplete .part files, not sealed files',async()=>fixture(async root=>{
 const q=await createPrivateFilesystemQuarantine({root});
 const stream=await q.begin({expectedBytes:apk.length});
 await stream.write(apk);const key=await stream.seal();
 const prefix='a'.repeat(48);
 await writeFile(join(root,prefix+'.part'),Buffer.from('ab'));
 await writeFile(join(root,'operator-note.txt'),Buffer.from('keep'));
 const removed=await q.pruneAbandonedParts({olderThanMs:60_000,now:Date.now()+3600_000});
 assert.equal(removed,1);
 assert.deepEqual((await readdir(root)).sort(),[key.slice(12)+'.apk','operator-note.txt'].sort());
}));


test('full MFA-signed portal -> real private adapter -> receipt denies replay and cross-tenant',async()=>fixture(async root=>{
 const q=await createPrivateFilesystemQuarantine({root});
 const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'P-256'});
 const t=1792670400,b64=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
 function jwt(publisherId='owner-tenant'){
  const h=b64({alg:'ES256',kid:'pinned',typ:'JWT'});
  const p=b64({iss:'https://issuer.example.org',aud:'store-v2-internal',
   sub:'developer-actor-01',role:'developer',publisherId,amr:['mfa'],
   auth_time:t-10,iat:t-20,nbf:t-20,exp:t+300,verified:true,
   jti:'private-test-token-2222'});
  const signed=h+'.'+p;
  return signed+'.'+sign('sha256',Buffer.from(signed),
   {key:privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');
 }
 const submission={id:'sub-'+('a'.repeat(32)),publisherId:'owner-tenant',
  actorId:'developer-actor-01',apkSha256:hex(apk),apkBytes:apk.length,reviews:[]};
 let storedKey=null,receiptCount=0,active=true;
 const repository={async read(id){return id===submission.id?submission:null;},
  async create(){throw Error('unexpected create');},
  async addReview(){throw Error('unexpected review');},
  async recordUpload(args){receiptCount++;if(receiptCount!==1)return {kind:'conflict'};
   storedKey=args.objectKey;return {kind:'created'};}};
 const portal=createDeveloperPortal({issuer:'https://issuer.example.org',
  audience:'store-v2-internal',publicKeys:{pinned:publicKey.export({format:'pem',type:'spki'})},
  origin:'https://store-stage.example.org',repository,quarantine:q,now:()=>t*1000,
  isTokenActive:async()=>active});
 function call(publisherId='owner-tenant'){
  return portal(new Request('https://store-stage.example.org/developer/submissions/'+submission.id+'/apk',{
   method:'PUT',headers:{authorization:'Bearer '+jwt(publisherId),
    'content-type':'application/vnd.android.package-archive'},body:apk}));
 }
 let r=await call('wrong-tenant');assert.equal(r.status,404);
 assert.deepEqual(await readdir(root),[]);
 active=false;r=await call();assert.equal(r.status,401);
 assert.deepEqual(await readdir(root),[]);
 active=true;r=await call();assert.equal(r.status,202);
 const out=await r.json();assert.equal(out.state,'QUARANTINED_UNSCANNED');
 for(const forbidden of ['publicationAuthorized','paymentAuthorized','payoutAuthorized','entitlementGranted'])
  assert.equal(out[forbidden],false);
 assert.deepEqual(await q.inspectForPrivateTests(storedKey),apk);
 r=await call();assert.equal(r.status,409);
 assert.equal((await readdir(root)).length,1);
 assert.equal(receiptCount,2);
}));


test('single-host bounded active writers reject parallel capacity exhaustion',async()=>fixture(async root=>{
 const q=await createPrivateFilesystemQuarantine({root,maxOpenWriters:1});
 const stream=await q.begin({expectedBytes:apk.length});
 await assert.rejects(q.begin({expectedBytes:apk.length}),/at capacity/);
 await stream.abort();
 const retry=await q.begin({expectedBytes:apk.length});
 await retry.abort();
 assert.deepEqual(await readdir(root),[]);
}));
