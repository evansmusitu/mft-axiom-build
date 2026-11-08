import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,webcrypto} from 'node:crypto';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const text=await readFile(new URL('../qualification/ccc_synthetic_rollback_worker_20261108.mjs',import.meta.url),'utf8');
const driver=await readFile(new URL('../qualification/run_ccc_hosted_synthetic_rollback_20261108.mjs',import.meta.url),'utf8');
assert(text.includes('e0a8f47429b1479d7dd2037633e8ca309645fb65fe345335801fc8653b49b7a1'));
assert(driver.includes('e0a8f47429b1479d7dd2037633e8ca309645fb65fe345335801fc8653b49b7a1'));
assert(driver.includes('required(current.bindings.some(x=>x.name===\'OWNERSHIP\''));
assert(driver.includes('required(await cf(\'/workers/scripts/\'+RUN+\'/settings\',{allow404:true})===null'));
assert(driver.includes('report.temporary_worker_removed=true'));
assert(!driver.includes('DELETE FROM')&&!driver.includes('DROP TABLE'));
const rows=Array.from({length:78},(_,i)=>({type:'table',name:'synthetic_'+i,tbl_name:'synthetic_'+i,sql:'CREATE TABLE synthetic_'+i+'(val INTEGER)'}));
const canonical=v=>JSON.stringify(v.map(row=>Object.fromEntries(Object.keys(row).sort().map(k=>[k,row[k]])))).replace(/[\u0080-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
const digest=v=>createHash('sha256').update(v).digest('hex');
const generated=text.replace('e0a8f47429b1479d7dd2037633e8ca309645fb65fe345335801fc8653b49b7a1',digest(canonical(rows)));
const folder=await mkdtemp(join(tmpdir(),'axiom-ccc-probe-test-'));
const filepath=join(folder,'test_worker.mjs');
await writeFile(filepath,generated);
const mod=await import(pathToFileURL(filepath).href);
function harness(options={}){
 const trace=[];
 let catalogs=0;
 const db={
  prepare(sql){
   trace.push({op:'prepare',sql});
   if(sql===mod.SQL)return {all:async()=>{
    catalogs++;
    const v=options.catalogDrift&&catalogs===1?[...rows.slice(0,77),{...rows[77],sql:'DRIFT'}]:options.leaveProbe&&catalogs>=2?[...rows.slice(0,77),{...rows[77],name:mod.PROBE,tbl_name:mod.PROBE}]:rows;
    return {success:true,results:structuredClone(v)};
   }};
   if(sql==='SELECT foreign_keys AS n FROM pragma_foreign_keys')return {first:async()=>({n:options.foreignKeysDisabled?0:1})};
   if(sql==='SELECT count(*) AS n FROM pragma_foreign_key_check')return {first:async()=>({n:options.foreignKeyMismatch?1:0})};
   if(sql.includes('INSERT INTO '+mod.PROBE)||sql.includes('CREATE TABLE '+mod.PROBE))return {sql};
   throw Error('unexpected_prepare');
  },
  async batch(statements){
   trace.push({op:'batch',count:statements.length});
   assert.equal(statements.length,3);
   assert(statements[0].sql.includes('CREATE TABLE '+mod.PROBE));
   assert(statements[2].sql.includes('VALUES(2,0)'));
   if(options.batchSuccess)return [];
   if(options.badError)throw Error('UNKNOWN_DATABASE_FAILURE');
   throw Error('D1_ERROR: CHECK constraint failed: '+mod.CHECK);
  }
 };
 return {db,trace};
}
test('exact synthetic D1 batch failure proves catalog preserved',async()=>{
 const {db,trace}=harness();
 const answer=await mod.qualify(db);
 assert.equal(answer.rolled_back,true);
 assert.equal(answer.customer_rows_read,0);
 assert.equal(answer.hosted_full_restore_qualified,false);
 assert.equal(trace.filter(e=>e.op==='batch').length,1);
});
test('catalog mismatch blocks batch',async()=>{const h=harness({catalogDrift:true});await assert.rejects(()=>mod.qualify(h.db),/current_catalog_drift/);assert(!h.trace.some(x=>x.op==='batch'));});
test('successful batch fails closed rather than claiming rollback',async()=>{const h=harness({batchSuccess:true});await assert.rejects(()=>mod.qualify(h.db),/intentional_constraint_failure_not_observed/);});
test('unrelated provider failure fails closed',async()=>{const h=harness({badError:true});await assert.rejects(()=>mod.qualify(h.db),/intentional_constraint_failure_not_observed/);});
test('probe table residue blocks approval',async()=>{const h=harness({leaveProbe:true});await assert.rejects(()=>mod.qualify(h.db),/database_catalog_changed_after_batch|synthetic_table_persisted/);});
test('foreign key controls required pre and post',async()=>{for(const options of [{foreignKeysDisabled:true},{foreignKeyMismatch:true}])await assert.rejects(()=>mod.qualify(harness(options).db));});
test('all Worker entrypoints fail unauthorized browser origin/cookies',async()=>{
 const worker=mod.default;
 const env={TOKEN:'a'.repeat(64),RUN:mod.RUN,EXPIRES:String(Date.now()+20000),EPOCH:'test'};
 for(const headers of [{origin:'https://example.com',authorization:'Bearer '+env.TOKEN},{cookie:'a=1',authorization:'Bearer '+env.TOKEN},{authorization:'Bearer invalid'}]){
  const r=await worker.fetch(new Request('https://test.example/qualify',{method:'POST',headers}),env);
  assert([401,403].includes(r.status));
 }
});
test.after(async()=>{await rm(folder,{recursive:true,force:true});});
