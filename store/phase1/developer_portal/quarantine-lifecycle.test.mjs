import test from 'node:test';
import assert from 'node:assert/strict';
import {intakeQuarantinedApk} from './quarantine-upload.mjs';
import {createPrivateFilesystemQuarantine} from './private-filesystem-quarantine.mjs';
import {mkdtemp,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const manifest={id:'sub-'+ 'f'.repeat(32),publisherId:'publisher-test',
 apkSha256:'a'.repeat(64),apkBytes:128};
const identity={publisherId:'publisher-test',subject:'developer-identity',tokenId:'some-current-token-000000',
 role:'developer',issuer:'https://idp.example.org',audience:'store-v2-internal',expiresAt:1792680000};
function fixture({getReader,beginResult}={}){
 let begun=0,aborted=0,read=0,dbWritten=0;
 const writer=beginResult??{write:async()=>{},seal:async()=> 'private/apk/'+'a'.repeat(48),abort:async()=>{aborted++;}};
 const req={headers:new Headers({'content-type':'application/vnd.android.package-archive'}),
  body:{getReader:getReader??(()=>{throw Error('request body already locked');})},signal:{aborted:false}};
 const quarantine={begin:async()=>{begun++;return writer;},revoke:async()=>{}};
 const repository={recordUpload:async()=>{dbWritten++;return {kind:'created'};}};
 return {req,quarantine,repository,get stats(){return {begun,aborted,read,dbWritten};}};
}
async function intake(f){return intakeQuarantinedApk({req:f.req,submission:manifest,actor:identity,
 quarantine:f.quarantine,repository:f.repository,revalidateSession:async()=>true});}

test('body reader allocation failure aborts an already-open private writer before any receipt',async()=>{
 const f=fixture();
 await assert.rejects(intake(f),/request body already locked/);
 assert.deepEqual(f.stats,{begun:1,aborted:1,read:0,dbWritten:0});
});

test('incomplete trusted writer aborts when abort exists, rather than retaining partial object',async()=>{
 let aborted=0;
 const f=fixture({beginResult:{write:async()=>{},abort:async()=>{aborted++;}}});
 await assert.rejects(intake(f),/quarantine_denied/);
 assert.equal(aborted,1);
 assert.equal(f.stats.dbWritten,0);
});

test('already-aborted upload never allocates private object storage',async()=>{
 const f=fixture({getReader:()=>({read:async()=>({done:true}),cancel:async()=>{},releaseLock(){}})});
 f.req.signal.aborted=true;
 await assert.rejects(intake(f),e=>e.httpStatus===408);
 assert.equal(f.stats.begun,0);assert.equal(f.stats.dbWritten,0);
});

test('abort between streamed chunks aborts the writer before persisting later bytes',async()=>{
 let writes=0,aborts=0,dbWritten=0,reads=0;
 const controller={aborted:false};
 const req={headers:new Headers({'content-type':'application/vnd.android.package-archive'}),signal:controller,
  body:{getReader:()=>({async read(){reads++;if(reads===1)return {done:false,value:Buffer.from([80,75,3,4])};
    if(reads===2){controller.aborted=true;return {done:false,value:Buffer.alloc(124)};}
    return {done:true};},async cancel(){},releaseLock(){}})}};
 const quarantine={async begin(){return {async write(){writes++;},async seal(){throw Error('must_not_seal');},async abort(){aborts++;}};},async revoke(){}};
 const repository={async recordUpload(){dbWritten++;return {kind:'created'};}};
 await assert.rejects(intakeQuarantinedApk({req,submission:manifest,actor:identity,
  quarantine,repository,revalidateSession:async()=>true}),e=>e.httpStatus===408);
 assert.equal(writes,1,'no write after the cancellation signal');
 assert.equal(aborts,1);assert.equal(dbWritten,0);
});


test('actual 0700 quarantine root has zero orphaned private files when body reader is locked',async()=>{
 const root=await mkdtemp(join(tmpdir(),'musitu-upload-recovery-'));
 try{
  const quarantine=await createPrivateFilesystemQuarantine({root});
  const f=fixture({getReader:()=>{throw Error('locked real upload body');}});
  f.quarantine=quarantine;
  await assert.rejects(intake(f),/locked real upload body/);
  assert.deepEqual(await readdir(root),[],'no .part, .apk or orphan object retained');
  assert.equal(f.stats.dbWritten,0);
 }finally{await rm(root,{recursive:true,force:true});}
});
