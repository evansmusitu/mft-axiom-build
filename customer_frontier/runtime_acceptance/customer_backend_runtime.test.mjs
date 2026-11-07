// Actual local workerd/D1 + actual product modules. Controlled fixture authority only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const entry='customer_frontier/qualification/customer_backend_acceptance_worker.mjs';
const plan=JSON.parse(await readFile(join(root,'customer_frontier/qualification/customer-hosted-plan-20261106.json')));
const catalog="SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type IN ('table','index','trigger','view') AND name NOT GLOB 'sqlite_*' ORDER BY type,name";
const hash=s=>createHash('sha256').update(s).digest('hex');
async function modules(p,override,seen=new Map()){
 if(seen.has(p))return seen;
 const text=p===entry?override:await readFile(join(root,p),'utf8');seen.set(p,text);
 for(const match of text.matchAll(/from\s+['"]([^'"]+)['"]/g)){
  assert(match[1].startsWith('.'),'nonrelative module');
  const next=relative(root,resolve(root,dirname(p),match[1]));assert(!next.startsWith('..'));
  await modules(next,override,seen);
 }return seen;
}
test('actual API tenant and budget enforcement survives restart; customer logout and membership revocation deny reuse',async()=>{
 const persist=await mkdtemp(join(tmpdir(),'axiom-customer-backend-'));let mf,token='a'.repeat(64),epoch='first';
 const original=await readFile(join(root,entry),'utf8');let script=original;
 const boot=async()=>new Miniflare({cf:false,host:'127.0.0.1',modulesRoot:root,modules:[...[...await modules(entry,'globalThis.__AXIOM_CUSTOMER_PLAN='+JSON.stringify(plan)+';\n'+script)].map(([path,contents])=>({type:'ESModule',path:join(root,path),contents}))],compatibilityDate:'2026-07-01',d1Persist:persist,d1Databases:{DB:'local-only-backend'},bindings:{TOKEN:token,RUN:'axiom-customer-acceptance-20261107-01',OWNERSHIP:'local-ownership-fixture-0123456789',EXPIRES:String(Date.now()+180000),EPOCH:epoch,FIXTURE_A:'A'.repeat(43),FIXTURE_B:'B'.repeat(43)},outboundService:()=>{throw Error('external_egress_denied');}});
 const request=(path,method='POST',credential=token,headers={})=>mf.dispatchFetch('https://stage.test'+path,{method,headers:{authorization:'Bearer '+credential,...headers}});
 try{
  mf=await boot();let db=await mf.getD1Database('DB');
  await db.batch(['CREATE TABLE old_a(id TEXT)','CREATE TABLE old_b(id TEXT)','CREATE TABLE old_c(id TEXT)','CREATE INDEX old_index ON old_c(id)'].map(s=>db.prepare(s)));
  const foreign=(await db.prepare(catalog).all()).results;
  const expected=hash(JSON.stringify(foreign.map(r=>Object.fromEntries(Object.keys(r).sort().map(k=>[k,r[k]])))));
  await db.batch([...plan.statements.map(s=>db.prepare(s)),db.prepare('CREATE TABLE axiom_cq01_customer_schema_receipt(run_id TEXT PRIMARY KEY NOT NULL,plan_sha256 TEXT NOT NULL)'),db.prepare('INSERT INTO axiom_cq01_customer_schema_receipt VALUES(?,?)').bind('axiom-customer-d1-20261106-01','06cfe6adfed21dc718ce0f0cdd53521a05e8bee8d1f0e95fccd7e823575ed80c')]);
  await mf.dispose();script=original.replace('b2ee9c1eb6c0ed8c0cf8fc1c9d02e5b7ae713c0c2dd292f946bd7d737d764737',expected);mf=await boot();
  assert.equal((await request('/qualify','POST',token,{origin:'https://evil.invalid'})).status,403);
  assert.equal((await request('/v1/customer/me','GET')).status,404);
  let r=await request('/qualify');assert.equal(r.status,200,await r.clone().text());const start=await r.json();assert.equal(start.phase,'SEEDED');assert(start.d1_prepared_statements<=48);
  for(const path of ['/projects','/isolation','/budget','/finish/0','/finish/1','/finish/2','/finish/3']){const step=await request(path);assert.equal(step.status,200,await step.clone().text());const result=await step.json();assert(result.d1_prepared_statements<=48);console.log(JSON.stringify({path,prepared:result.d1_prepared_statements,phase:result.phase}));}
  assert.equal(start.real_identity_qualified,false);assert.equal(start.release_authority,false);
  assert.equal((await request('/qualify')).status,503,'do not reseed or repeat a run');
  await mf.dispose();token='b'.repeat(64);epoch='second';mf=await boot();
  assert.equal((await request('/health','GET','a'.repeat(64))).status,401);
  r=await request('/verify');assert.equal(r.status,200,await r.clone().text());const readback=await r.json();assert.equal(readback.epoch,'second');assert.equal(readback.session_budget_restart,true);assert(readback.d1_prepared_statements<=48);
  r=await request('/revoke');assert.equal(r.status,200,await r.clone().text());const revoked=await r.json();assert.equal(revoked.customer_logout_revocation,true);assert.equal(revoked.membership_revocation,true);assert.equal(revoked.fixture_authority_disabled,true);assert.equal(revoked.customer_acceptance_qualified,false);assert(revoked.d1_prepared_statements<=48);
  db=await mf.getD1Database('DB');assert.equal((await db.prepare("SELECT count(*) AS n FROM tenants WHERE status='active'").first()).n,0);assert.equal((await db.prepare("SELECT count(*) AS n FROM holds WHERE state='open'").first()).n,0);
  assert.deepEqual((await db.prepare(catalog).all()).results.filter(r=>foreign.some(f=>f.name===r.name)),foreign);
  assert.equal((await request('/disable')).status,200);
 }finally{if(mf)await mf.dispose();await rm(persist,{recursive:true,force:true});}
});
