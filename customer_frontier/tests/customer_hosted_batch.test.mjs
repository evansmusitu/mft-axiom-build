import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash,webcrypto} from 'node:crypto';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const plan=JSON.parse(await readFile(new URL('../qualification/customer-hosted-plan-20261106.json',import.meta.url)));
const source=await readFile(new URL('../qualification/customer_hosted_batch_worker.mjs',import.meta.url),'utf8');
const sha=x=>createHash('sha256').update(x).digest('hex');
const cat="SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type IN ('table','index','trigger','view') AND name NOT GLOB 'sqlite_*' ORDER BY type,name";
function setup(){const raw=new DatabaseSync(':memory:');raw.exec('PRAGMA foreign_keys=ON; CREATE TABLE _cf_KV(k TEXT); CREATE TABLE old_a(id TEXT); CREATE TABLE old_b(id TEXT); CREATE TABLE old_c(id TEXT); CREATE INDEX old_index ON old_c(id);');const db={raw,prepare(sql){const p={sql,params:[],bind(...params){return {...p,params};},async all(){return {results:raw.prepare(sql).all(...this.params)};},async first(){return raw.prepare(sql).get(...this.params);},async run(){return raw.prepare(sql).run(...this.params);}};return p;},async batch(rows){raw.exec('BEGIN');try{for(const p of rows)raw.prepare(p.sql).run(...p.params);raw.exec('COMMIT');return rows.map(()=>({success:true}));}catch(e){raw.exec('ROLLBACK');throw e;}}};return db;}
const tmp=await mkdtemp(join(tmpdir(),'axiom-customer-batch-'));const first=setup();const before=first.raw.prepare(cat).all();const hash=sha(JSON.stringify(before.map(row=>Object.fromEntries(Object.keys(row).sort().map(k=>[k,row[k]])))));first.raw.close();
// Only the known foreign-catalog proof literal changes in this disposable fixture.
const file=join(tmp,'worker.mjs');await writeFile(file,source.replace('b2ee9c1eb6c0ed8c0cf8fc1c9d02e5b7ae713c0c2dd292f946bd7d737d764737',hash));const worker=await import(pathToFileURL(file));
globalThis.crypto??=webcrypto;
test('complete real customer schema rolls back then applies atomically preserving foreign objects',async()=>{const db=setup();try{const r=await worker.qualify(db,plan,'a'.repeat(64));assert(r.atomic_customer_ddl_rollback);assert(r.customer_schema_applied);assert.equal(r.customer_tables,20);for(const name of plan.tables)assert.equal(db.raw.prepare('SELECT count(*) AS n FROM '+name).get().n,0);assert.deepEqual(db.raw.prepare(cat).all().filter(r=>before.some(b=>b.name===r.name)),before);assert.equal(r.release_authority,false);await assert.rejects(()=>worker.qualify(db,plan,'a'.repeat(64)),/catalog_drift/);}finally{db.raw.close();}});
test('dirty foreign rows and catalog drift reject before schema changes',async()=>{for(const dirty of [true,false]){const db=setup();try{db.raw.exec(dirty?"INSERT INTO old_a VALUES('existing')":'CREATE TABLE unrelated(x)');await assert.rejects(()=>worker.qualify(db,plan,'a'.repeat(64)));assert.equal(db.raw.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='tenants'").get().n,0);}finally{db.raw.close();}}});
test('auth expiry and browser requests cannot trigger migrations',async()=>{const env={TOKEN:'a'.repeat(64),RUN:'axiom-customer-d1-20261106-01',EXPIRES:String(Date.now()+60000),EPOCH:'test'};for(const [headers,patch,expected] of [[{}, {},401],[{authorization:'Bearer '+env.TOKEN},{EXPIRES:'0'},403],[{authorization:'Bearer '+env.TOKEN,origin:'https://evil.example'},{},403]]){const r=await worker.default.fetch(new Request('https://example.test/qualify',{method:'POST',headers}),{...env,...patch});assert.equal(r.status,expected);}});
test.after(async()=>{await rm(tmp,{recursive:true,force:true});});
