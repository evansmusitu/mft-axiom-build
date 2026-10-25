import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifyStudioR2ObjectBytes} from '../r2_content_reconcile.mjs';

const project='a1111111-1111-4111-8111-111111111111';
const job='b2222222-2222-4222-8222-222222222222';
const key=Buffer.alloc(32,7);
const files=['scene.blend','scene.glb','preview.png'];
const payload=Object.fromEntries(files.map((f,i)=>[f,Buffer.alloc(1024+i*31,i+7)]));
const sha=b=>createHash('sha256').update(b).digest('hex');
function fixture(){return {complete:true,freeze_id:'r2-content-synthetic-freeze',
  projects:[{id:project,title:'test',owner_sub:'owner-test',created_at:'2026-10-24T00:00:00Z'}],
  memberships:[{project_id:project,member_sub:'owner-test',role:'owner',created_at:'2026-10-24T00:00:00Z'}],
  jobs:[{id:job,project_id:project,submission_key:'synthetic-submission',payload_json:'{}',payload_sha256:'a'.repeat(64),render_device:'CPU',state:'COMPLETED',created_by_sub:'owner-test',approved_by_sub:'owner-test',dispatched_by_sub:'owner-test',call_id:'call-synthetic',error_code:null,created_at:'2026-10-24T00:00:00Z',approved_at:'2026-10-24T00:01:00Z',dispatched_at:'2026-10-24T00:02:00Z',finished_at:'2026-10-24T00:03:00Z'}],
  assets:files.map(filename=>({job_id:job,filename,object_key:`studio-v03/jobs/${job}/${filename}`,sha256:sha(payload[filename]),bytes:payload[filename].length})),
  audit_events:[{id:'c3333333-3333-4333-8333-333333333333',project_id:project,job_id:job,action:'JOB_APPROVED_SINGLE_ADMIN',actor_sub:'owner-test',at:'2026-10-24T00:01:00Z',details:'{"single_admin":true}'}]};}
const read=async(a)=> (async function*(){const b=payload[a.filename];yield b.subarray(0,101);yield b.subarray(101);})();
const options=(extra={})=>({integrityKey:key,readObject:read,...extra});
test('stream-verifies all R2 bytes against frozen asset table and returns privacy-safe keyed receipt',async()=>{
 const source=fixture();const receipt=await verifyStudioR2ObjectBytes(source,options());
 assert.equal(receipt.complete,true);assert.equal(receipt.objects_verified,3);
 assert.equal(receipt.bytes_verified,files.reduce((n,f)=>n+payload[f].length,0));
 assert.match(receipt.assets_table_hmac,/^[0-9a-f]{64}$/);
 assert.match(receipt.content_hmac,/^[0-9a-f]{64}$/);
 assert.equal(receipt.provider_verified,false);
 assert.doesNotMatch(JSON.stringify(receipt),/owner-test|studio-v03\/jobs|scene\.glb|synthetic-submission/);
 const other=await verifyStudioR2ObjectBytes(source,options({readObject:async a=>[payload[a.filename]]}));
 assert.equal(receipt.content_hmac,other.content_hmac);
});
test('fails closed on equal-sized corrupted bytes, missing objects and bad stream chunks',async()=>{
 await assert.rejects(()=>verifyStudioR2ObjectBytes(fixture(),options({readObject:async a=>{
  let b=Buffer.from(payload[a.filename]);b[0]^=1;return [b];}})),/STUDIO_R2_CONTENT_HASH_MISMATCH/);
 await assert.rejects(()=>verifyStudioR2ObjectBytes(fixture(),options({readObject:async()=>null})),/STUDIO_R2_OBJECT_UNAVAILABLE/);
 await assert.rejects(()=>verifyStudioR2ObjectBytes(fixture(),options({readObject:async()=>['forged-text']})),/STUDIO_R2_INVALID_CHUNK/);
});
test('detects truncated bytes, extra bytes and excess caller-authorized budget',async()=>{
 await assert.rejects(()=>verifyStudioR2ObjectBytes(fixture(),options({readObject:async a=>[payload[a.filename].subarray(1)]})),/STUDIO_R2_CONTENT_SIZE_MISMATCH/);
 await assert.rejects(()=>verifyStudioR2ObjectBytes(fixture(),options({readObject:async a=>[payload[a.filename],Buffer.alloc(1)]})),/STUDIO_R2_CONTENT_SIZE_MISMATCH/);
 await assert.rejects(()=>verifyStudioR2ObjectBytes(fixture(),options({maxTotalBytes:1024})),/STUDIO_R2_BYTE_BUDGET_EXCEEDED/);
});
test('invalid ledger or missing key refuses to call any provider reader',async()=>{
 let calls=0;const reader=async a=>{calls++;return [payload[a.filename]]};
 const source=fixture();source.assets[0].object_key='studio-v02/fault';
 await assert.rejects(()=>verifyStudioR2ObjectBytes(source,options({readObject:reader})),/LEDGER_ASSET_OBJECT_KEY_MISMATCH/);
 assert.equal(calls,0);
 await assert.rejects(()=>verifyStudioR2ObjectBytes(fixture(),options({readObject:reader,integrityKey:Buffer.alloc(4)})),/STUDIO_R2_INTEGRITY_KEY_REQUIRED/);
 assert.equal(calls,0);
});
test('rejects excessive declared total before invoking any reader',async()=>{
 let calls=0;
 await assert.rejects(()=>verifyStudioR2ObjectBytes(fixture(),options({maxTotalBytes:2000,readObject:async()=>{calls++;return[];}})),/STUDIO_R2_BYTE_BUDGET_EXCEEDED/);
 assert.equal(calls,0);
});
test('reader failures are masked without leaking provider errors',async()=>{
 await assert.rejects(()=>verifyStudioR2ObjectBytes(fixture(),options({
  readObject:async()=>{throw Error('secret-public-url-token')}})),/STUDIO_R2_READ_FAILED/);
 await assert.rejects(()=>verifyStudioR2ObjectBytes(fixture(),options({
  readObject:async()=>async function*(){yield Buffer.alloc(5);throw Error('secret-api-key')}()})),/STUDIO_R2_READ_FAILED/);
});
test('provider errors that imitate STUDIO_R2 codes never leak credentials',async()=>{
 const forged='STUDIO_R2_PRIVATE_PROVIDER_TOKEN_DONOTLEAK';
 await assert.rejects(()=>verifyStudioR2ObjectBytes(fixture(),options({
  readObject:async()=> (async function*(){throw Error(forged)})()
 })),error=>{
  assert.equal(error.message,'STUDIO_R2_READ_FAILED');
  assert.ok(!error.message.includes('PRIVATE_PROVIDER_TOKEN'));
  return true;
 });
});
test('adversarial iterable getters are masked as read failures',async()=>{
 await assert.rejects(()=>verifyStudioR2ObjectBytes(fixture(),options({
  readObject:async()=> ({
   get [Symbol.iterator](){throw Error('private_key_do_not_log')},
   get [Symbol.asyncIterator](){throw Error('private_key_do_not_log')}
  })
 })),error=>{
  assert.equal(error.message,'STUDIO_R2_READ_FAILED');
  return true;
 });
});
test('HMAC is freeze-bound even for identical R2 bytes',async()=>{
 const a=fixture(),b=fixture();b.freeze_id='different-synthetic-freeze';
 const x=await verifyStudioR2ObjectBytes(a,options());
 const y=await verifyStudioR2ObjectBytes(b,options());
 assert.notEqual(x.content_hmac,y.content_hmac);
});
test('empty pending-job inventory verifies zero referenced objects only, not an empty bucket',async()=>{
 const s=fixture();s.jobs[0].state='APPROVED';s.assets=[];
 let calls=0;const receipt=await verifyStudioR2ObjectBytes(s,options({readObject:async()=>{calls++;throw Error('never-called')}}));
 assert.equal(calls,0);assert.equal(receipt.objects_verified,0);assert.equal(receipt.provider_verified,false);
});

// An attacker-controlled streaming reader may emit infinite empty chunks, or
// millions of tiny chunks without exceeding the nominal byte quota.
test('rejects empty chunks and bounded per-object / total streaming chunk exhaustion',async()=>{
 await assert.rejects(()=>verifyStudioR2ObjectBytes(fixture(),options({
  readObject:async a=>(async function*(){yield new Uint8Array(0);yield payload[a.filename]})()
 })),/STUDIO_R2_EMPTY_CHUNK/);
 await assert.rejects(()=>verifyStudioR2ObjectBytes(fixture(),options({
  maxChunksPerObject:20,readObject:async a=>(async function*(){
   for(const byte of payload[a.filename])yield Uint8Array.of(byte);
  })()
 })),/STUDIO_R2_CHUNK_LIMIT_EXCEEDED/);
 await assert.rejects(()=>verifyStudioR2ObjectBytes(fixture(),options({
  maxTotalChunks:3,readObject:async a=>(async function*(){
   const b=payload[a.filename];yield b.subarray(0,512);yield b.subarray(512)
  })()
 })),/STUDIO_R2_TOTAL_CHUNK_LIMIT_EXCEEDED/);
});
test('invalid streaming budgets reject before reading protected objects',async()=>{
 let attempts=0;
 for(const bad of [-1,0,NaN,Infinity,1.4,'20',1_000_001]){
  await assert.rejects(()=>verifyStudioR2ObjectBytes(fixture(),options({
   maxChunksPerObject:bad,readObject:async()=>{attempts++;return[]}
  })),/STUDIO_R2_INVALID_CHUNK_BUDGET/);
 }
 assert.equal(attempts,0);
});
test('impossible aggregate chunk quota rejects before any protected provider read',async()=>{
 let calls=0;
 await assert.rejects(()=>verifyStudioR2ObjectBytes(fixture(),options({
  maxTotalChunks:2,readObject:async a=>{calls++;return[payload[a.filename]]}
 })),/STUDIO_R2_TOTAL_CHUNK_LIMIT_EXCEEDED/);
 assert.equal(calls,0);
});
