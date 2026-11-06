// Real local workerd/D1. No Cloudflare account bindings or external egress.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const hash=x=>createHash('sha256').update(x).digest('hex');
const planRaw=await readFile(new URL('../qualification/customer-hosted-plan-20261106.json',import.meta.url)),plan=JSON.parse(planRaw);
const worker=await readFile(new URL('../qualification/customer_hosted_batch_worker.mjs',import.meta.url),'utf8');
const catalog="SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type IN ('table','index','trigger','view') AND name NOT GLOB 'sqlite_*' ORDER BY type,name";
test('real workerd rolls back complete customer DDL then preserves schema through isolate restart and token rotation',async()=>{
 const diagnosed=worker.replace('const before=await catalog(db);',"globalThis.__diag='base_catalog';const before=await catalog(db);").replace("assert((await db.prepare('PRAGMA foreign_keys')","globalThis.__diag='foreign_key_setting';assert((await db.prepare('PRAGMA foreign_keys')").replace('let rolledBack=false;',"globalThis.__diag='rollback_batch';let rolledBack=false;").replace(' await db.batch([...plan.statements'," globalThis.__diag='forward_batch';await db.batch([...plan.statements").replace("assert((await db.prepare('SELECT count(*) AS n FROM pragma_foreign_key_check')","globalThis.__diag='foreign_key_check';assert((await db.prepare('SELECT count(*) AS n FROM pragma_foreign_key_check')").replace('}catch{return json(503','}catch(error){return json(500,{stage:globalThis.__diag,diagnostic:error.message,cause:error.cause?.message});return json(503');
 const persist=await mkdtemp(join(tmpdir(),'axiom-local-customer-batch-'));let mf,script=diagnosed,epoch='first',token='a'.repeat(64);
 const boot=()=>new Miniflare({cf:false,host:'127.0.0.1',modules:true,script:'globalThis.__AXIOM_CUSTOMER_PLAN='+JSON.stringify(plan)+';\n'+script,compatibilityDate:'2026-07-01',d1Persist:persist,d1Databases:{DB:'local-only-customer-batch'},bindings:{TOKEN:token,RUN:'axiom-customer-d1-20261106-01',EXPIRES:String(Date.now()+180000),EPOCH:epoch,PLAN_HASH:hash(planRaw)},outboundService:()=>{throw Error('external_egress_denied');}});
 try{
  mf=boot();let db=await mf.getD1Database('DB');await db.batch(['CREATE TABLE old_a(id TEXT)','CREATE TABLE old_b(id TEXT)','CREATE TABLE old_c(id TEXT)','CREATE INDEX old_index ON old_c(id)'].map(s=>db.prepare(s)));
  const original=(await db.prepare(catalog).all()).results;
  const canonical=JSON.stringify(original.map(row=>Object.fromEntries(Object.keys(row).sort().map(k=>[k,row[k]]))));
  script=diagnosed.replace('b2ee9c1eb6c0ed8c0cf8fc1c9d02e5b7ae713c0c2dd292f946bd7d737d764737',hash(canonical));await mf.dispose();mf=boot();
  let r=await mf.dispatchFetch('https://stage.test/qualify',{method:'POST',headers:{authorization:'Bearer '+token}});assert.equal(r.status,200,await r.clone().text());const outcome=await r.json();assert.equal(outcome.atomic_customer_ddl_rollback,true);assert.equal(outcome.customer_schema_applied,true);assert.equal(outcome.customer_tables,20);assert.equal(outcome.release_authority,false);
  db=await mf.getD1Database('DB');for(const table of plan.tables)assert.equal((await db.prepare('SELECT count(*) AS n FROM '+table).first()).n,0);
  assert.deepEqual((await db.prepare(catalog).all()).results.filter(r=>original.some(o=>o.name===r.name)),original);
  await mf.dispose();token='b'.repeat(64);epoch='second';mf=boot();
  r=await mf.dispatchFetch('https://stage.test/health',{headers:{authorization:'Bearer '+'a'.repeat(64)}});assert.equal(r.status,401);
  r=await mf.dispatchFetch('https://stage.test/verify',{headers:{authorization:'Bearer '+token}});assert.equal(r.status,200);const readback=await r.json();assert.equal(readback.epoch,'second');assert.equal(readback.schema_survived_redeployment,true);assert.equal(readback.release_authority,false);
 }finally{if(mf)await mf.dispose();await rm(persist,{recursive:true,force:true});}
});
