import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {resolve,join} from 'node:path';
const dir=await mkdtemp(resolve(import.meta.dirname,'intake-tmp/customer-driver-'));
const root=resolve(import.meta.dirname,'../customer-hosted-batch/customer_frontier/qualification');
const sha=x=>createHash('sha256').update(x).digest('hex');
const original=await readFile(join(root,'run_customer_hosted_batch.mjs'),'utf8');
const fixed=original.replace('7e98510fc457a669c29dd85ab1d87cc758fe0ba74d0833c20863b53d599b5b36',sha('SYNTHETIC_DB_NAME'));
assert.equal(fixed.replace(sha('SYNTHETIC_DB_NAME'),'7e98510fc457a669c29dd85ab1d87cc758fe0ba74d0833c20863b53d599b5b36'),original);
await writeFile(join(dir,'driver.mjs'),fixed);
for(const name of ['customer-hosted-plan-20261106.json','customer_hosted_batch_worker.mjs'])await copyFile(join(root,name),join(dir,name));
async function run(scenario){
 const work=await mkdtemp(join(dir,'case-'));
 const result=spawnSync(process.execPath,['--import',resolve(import.meta.dirname,'backup-network-deny.mjs'),'--import',resolve(import.meta.dirname,'customer-batch-driver-preload.mjs'),join(dir,'driver.mjs')],{cwd:work,env:{PATH:process.env.PATH,AXIOM_CHECKOUT_SHA:'3d7fba395a051421e1ceacb06ee5c425830d9421',CLOUDFLARE_API_TOKEN:'PRIVATE_CONTROL_TOKEN',REVIEW_SCENARIO:scenario},timeout:30000,maxBuffer:1_000_000});
 assert.equal(result.signal,null);const out=JSON.parse(await readFile(join(work,'customer-hosted-batch-result.json')));const trace=JSON.parse(await readFile(join(work,'driver-trace.json')));
 assert(!result.stdout.toString().includes('PRIVATE_CONTROL_TOKEN'));assert(!result.stdout.toString().includes('PRIVATE_LOST_AFTER_COMMIT'));assert(!result.stdout.toString().includes('OWNERSHIP'));
 for(const flag of ['production_oauth_changed','release_authority','hosted_restore_qualified','customer_acceptance_qualified'])assert.equal(out[flag],false);
 for(const entry of trace.trace){if(entry.surface==='control'&&entry.path.startsWith('/d1/'))assert.equal(entry.method,'GET');assert(!entry.path.includes('504029cc'));assert(!entry.path.includes('a7384b8a'));}
 return {result,out,trace};
}
test('happy driver confines target, rotates, verifies and deletes its new Worker',async()=>{const {result,out,trace}=await run('happy');assert.equal(result.status,0);assert.equal(out.customer_schema_applied,true);assert.equal(out.temporary_operator_rotation_confirmed,true);assert.equal(out.schema_survived_redeployment,true);assert.equal(out.temporary_worker_removed,true);assert.equal(trace.putCount,2);assert.equal(trace.qualifyCount,1);assert.equal(trace.exists,false);});
test('metadata drift, existing Worker and invalid subdomain never create or migrate',async()=>{for(const scenario of ['metadata_drift','existing_worker','invalid_subdomain']){const {result,out,trace}=await run(scenario);assert.equal(result.status,1);assert.equal(trace.putCount,0);assert.equal(trace.qualifyCount,0);assert.equal(out.customer_schema_applied,false);assert(!trace.trace.some(x=>x.method==='DELETE'));}});
test('uncertain create cleans only matching owned Worker and denies foreign replacement',async()=>{for(const scenario of ['create_uncertain_owned','create_uncertain_foreign']){const {result,out,trace}=await run(scenario);assert.equal(result.status,1);assert.equal(trace.qualifyCount,0);if(scenario.endsWith('_owned')){assert.equal(out.temporary_worker_removed,true);assert.equal(trace.deleted,true);}else{assert(out.cleanup_error);assert.equal(trace.deleted,false);}}});
test('loss after commit and 503 remain explicit UNKNOWN states, never retried',async()=>{for(const scenario of ['qualify_lost_after_apply','qualify_503']){const {result,out,trace}=await run(scenario);assert.equal(result.status,1);assert.equal(out.migration_attempted,true);assert(out.error);assert.equal(trace.qualifyCount,1);assert.equal(out.temporary_worker_removed,true);assert.equal(out.customer_schema_applied,null);assert.equal(out.schema_application_outcome,'UNKNOWN');console.log(JSON.stringify({scenario,simulated_actual_applied:trace.applied,reported_customer_schema_applied:out.customer_schema_applied,schema_application_outcome:out.schema_application_outcome,error:out.error}));}});
test('rotation uncertainty, old-token acceptance and verify failure cannot report complete',async()=>{for(const scenario of ['rotation_lost','old_token_still_valid','verify_fails']){const {result,out}=await run(scenario);assert.equal(result.status,1);assert(out.error);assert.equal(out.customer_schema_applied,true);assert(!out.temporary_operator_rotation_confirmed);assert.equal(out.temporary_worker_removed,true);}});
test('cleanup failure or foreign replacement never becomes removed success',async()=>{for(const scenario of ['cleanup_delete_rejected','cleanup_foreign_replaced','cleanup_readback_still_exists']){const {result,out,trace}=await run(scenario);assert.equal(result.status,1);assert(out.cleanup_error);assert.equal(out.temporary_worker_removed,false);if(scenario==='cleanup_foreign_replaced')assert.equal(trace.deleted,false);}});
test('already absent cleanup is accepted only after readback',async()=>{const {result,out,trace}=await run('cleanup_disappeared');assert.equal(result.status,0);assert.equal(out.temporary_worker_removed,true);assert.equal(trace.deleted,false);});
test.after(async()=>{await rm(dir,{recursive:true,force:true});});
