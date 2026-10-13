import test from 'node:test';
import assert from 'node:assert/strict';
import {qualifyPrivateSyntheticSeedClear} from '../src/staging/mmf-private-remote-seed-clear-qualification.mjs';
const digest=n=>(n%256).toString(16).padStart(2,'0').repeat(32);
const reply=(status,data)=>({status,async json(){return data}});
function fixture(responses){const calls=[];let n=0;return {calls,fetchImpl:async(u,x)=>{
  calls.push({path:new URL(u).pathname,body:JSON.parse(x.body)});
  const next=responses.shift();if(next instanceof Error)throw next;return reply(next.status??200,next.data);
 },makeDigest:()=>digest(++n)};}
const empty={status:200,data:{present:false}};
const filled={status:200,data:{present:true,tenantCount:2,domainPendingCount:2,subscriptionPendingCount:2,usageCount:0,revokedCount:0,entitlementsActive:0}};
test('real seam stages and removes only two disposable synthetic records; final readback empty',async()=>{
 const f=fixture([empty,{data:{stored:true,tenantCount:2}},filled,{data:{cleared:true}},empty]);
 const result=await qualifyPrivateSyntheticSeedClear(f);
 assert.equal(result.gate,'MMF_PRIVATE_REMOTE_SYNTHETIC_SEED_READ_CLEAR_PROVEN');
 assert.deepEqual(f.calls.map(x=>x.path),['/control/read','/control/seed','/control/read','/control/clear','/control/read']);
 assert.equal(f.calls[3].body.run,f.calls[0].body.run);
 assert.equal(f.calls[1].body.records.length,2);
 assert.ok(f.calls[1].body.records[0].tenantDigest!==f.calls[1].body.records[1].tenantDigest);
});
test('seed failure still attempts bounded cleanup and confirms empty before returning a sanitized denial',async()=>{
 const f=fixture([empty,{status:503,data:{category:'CONTROL_SEED_FIRST_INSERT'}},{status:503,data:{}},empty]);
 await assert.rejects(()=>qualifyPrivateSyntheticSeedClear(f),/^Error: MMF_PRIVATE_SEED_CLEAR_REMOTE_DENIED$/);
 assert.deepEqual(f.calls.map(x=>x.path),['/control/read','/control/seed','/control/clear','/control/read']);
});
test('partial or unknown residue is never declared clear; no seed on dirty start',async()=>{
 const f=fixture([filled]);
 await assert.rejects(()=>qualifyPrivateSyntheticSeedClear(f),/MMF_PRIVATE_SEED_CLEAR_DIRTY_START/);
 assert.deepEqual(f.calls.map(x=>x.path),['/control/read']);
});
test('post-seed cleanup uncertainty overrides any apparent success and never leaks remote failure content',async()=>{
 const secret='NOT_FOR_LOGS';
 const f=fixture([empty,{data:{stored:true,tenantCount:2}},filled,new Error(secret),new Error(secret)]);
 await assert.rejects(()=>qualifyPrivateSyntheticSeedClear(f),e=>e.message==='MMF_PRIVATE_SEED_CLEAR_CLEANUP_UNCONFIRMED'&&!e.message.includes(secret));
 assert.deepEqual(f.calls.map(x=>x.path),['/control/read','/control/seed','/control/read','/control/clear','/control/read']);
});
