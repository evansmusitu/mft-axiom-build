import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
const root=await mkdtemp(resolve(import.meta.dirname,'intake-tmp/customer-cleanup-'));
async function run(scenario,proof=true){
 const cwd=await mkdtemp(join(root,'case-'));if(proof)await writeFile(join(cwd,'customer-hosted-batch-result.json'),JSON.stringify({run_id:'axiom-customer-d1-20261106-01',database_id:'ccc473f1-fbb5-4b8d-8a24-45f3696ac10f',worker_ownership_sha256:createHash('sha256').update('PRIVATE_OWNERSHIP_SENTINEL').digest('hex')}));
 const result=spawnSync(process.execPath,['--import',resolve(import.meta.dirname,'backup-network-deny.mjs'),'--import',resolve(import.meta.dirname,'customer-batch-cleanup-preload.mjs'),resolve(import.meta.dirname,'../customer-hosted-batch/customer_frontier/qualification/cleanup_customer_hosted_batch.mjs')],{cwd,env:{PATH:process.env.PATH,CLOUDFLARE_API_TOKEN:'PRIVATE_CONTROL_TOKEN',REVIEW_SCENARIO:scenario},timeout:10000,maxBuffer:1_000_000});
 const out=JSON.parse(await readFile(join(cwd,'customer-hosted-batch-cleanup.json'))),trace=JSON.parse(await readFile(join(cwd,'cleanup-trace.json')));assert.equal(out.database_deleted,false);assert(!result.stdout.toString().includes('PRIVATE_'));assert(trace.calls.length<=3);return {result,out,trace};
}
test('cleanup requires owned target proof and confirms404 after deletion or priorabsence',async()=>{for(const scenario of ['happy','absent']){const {result,out,trace}=await run(scenario);assert.equal(result.status,0);assert.equal(out.temporary_worker_removed,true);assert.equal(trace.exists,false);assert.equal(trace.calls.filter(x=>x.method==='DELETE').length,scenario==='happy'?1:0);}});
test('wrong owner DB RUN and missing proof cannot delete any Worker',async()=>{for(const scenario of ['wrong_owner','wrong_db','wrong_run','missing_proof']){const {result,out,trace}=await run(scenario,scenario!=='missing_proof');assert.equal(result.status,1);assert.equal(out.temporary_worker_removed,false);assert(!trace.calls.some(x=>x.method==='DELETE'));if(scenario==='missing_proof')assert.equal(trace.calls.length,0);}});
test('permission delete and readback uncertainty remain unconfirmed without retrying deletion',async()=>{for(const scenario of ['denied','delete_denied','delete_lost','readback_not_absent']){const {result,out,trace}=await run(scenario);assert.equal(result.status,1);assert.equal(out.temporary_worker_removed,false);assert(out.error);assert(trace.calls.filter(x=>x.method==='DELETE').length<=1);}});
test.after(async()=>{await rm(root,{recursive:true,force:true});});
