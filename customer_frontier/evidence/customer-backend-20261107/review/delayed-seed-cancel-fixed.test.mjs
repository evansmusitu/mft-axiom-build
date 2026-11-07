import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {resolve,join,dirname,relative} from 'node:path';
import {createHash} from 'node:crypto';
const require=createRequire(new URL('../customer-hosted-acceptance-20261107/customer_frontier/runtime_acceptance/package.json',import.meta.url));
const {Miniflare}=require('miniflare');
const root=resolve(import.meta.dirname,'../customer-hosted-acceptance-20261107');
const entry='customer_frontier/qualification/customer_backend_acceptance_worker.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const source=new Map();
async function collect(path){if(source.has(path))return;const text=await readFile(join(root,path),'utf8');source.set(path,text);for(const m of text.matchAll(/from\s+['"]([^'"]+)['"]/g)){assert(m[1].startsWith('.'));await collect(relative(root,resolve(root,dirname(path),m[1])));}}
await collect(entry);await writeFile(new URL('./cancel-fixed-source-snapshot.json',import.meta.url),JSON.stringify([...source].map(([path,content])=>({path,sha256:sha(content),content})),null,2)+'\n');
const plan=JSON.parse(await readFile(join(root,'customer_frontier/qualification/customer-hosted-plan-20261106.json')));
const catalog="SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type IN ('table','index','trigger','view') AND name NOT GLOB 'sqlite_*' ORDER BY type,name";
test('atomic cancellation fences delayed initial seed after absent-marker cleanup',async()=>{
 const persist=await mkdtemp(resolve(import.meta.dirname,'delayed-seed-'));let mf,override=source.get(entry);
 const wrapper=`import worker from './${entry}';let held=false;let first=true;export default{async fetch(req,env){const path=new URL(req.url).pathname;if(path==='/progress')return Response.json({held});if(path==='/resume'){return Response.json({resumed:true});}const db={prepare:s=>env.DB.prepare(s),batch:async rows=>{if(first){first=false;held=true;await new Promise(r=>setTimeout(r,1000));}return env.DB.batch(rows);}};return worker.fetch(req,{...env,DB:db});}};`;
 const boot=()=>new Miniflare({cf:false,host:'127.0.0.1',modulesRoot:root,modules:[{type:'ESModule',path:join(root,'independent-delay-wrapper.mjs'),contents:'globalThis.__AXIOM_CUSTOMER_PLAN='+JSON.stringify(plan)+';\n'+wrapper},...[...source].map(([path,contents])=>({type:'ESModule',path:join(root,path),contents:path===entry?override:contents}))],compatibilityDate:'2026-07-01',d1Persist:persist,d1Databases:{DB:'only-local-delayed-seed'},bindings:{TOKEN:'a'.repeat(64),RUN:'axiom-customer-acceptance-20261107-01',EXPIRES:String(Date.now()+180000),EPOCH:'fixture',OWNERSHIP:'o'.repeat(48),FIXTURE_A:'A'.repeat(43),FIXTURE_B:'B'.repeat(43)},outboundService:()=>{throw Error('external_egress_denied');}});
 const request=(path,method='POST')=>mf.dispatchFetch('https://fixture.test'+path,{method,headers:{authorization:'Bearer '+'a'.repeat(64)}});
 try{
  mf=boot();let db=await mf.getD1Database('DB');await db.batch(['CREATE TABLE old_a(id TEXT)','CREATE TABLE old_b(id TEXT)','CREATE TABLE old_c(id TEXT)','CREATE INDEX old_index ON old_c(id)'].map(s=>db.prepare(s)));
  const foreign=(await db.prepare(catalog).all()).results,base=sha(JSON.stringify(foreign.map(row=>Object.fromEntries(Object.keys(row).sort().map(k=>[k,row[k]])))));
  await db.batch([...plan.statements.map(s=>db.prepare(s)),db.prepare('CREATE TABLE axiom_cq01_customer_schema_receipt(run_id TEXT PRIMARY KEY NOT NULL,plan_sha256 TEXT NOT NULL)'),db.prepare('INSERT INTO axiom_cq01_customer_schema_receipt VALUES(?,?)').bind('axiom-customer-d1-20261106-01','06cfe6adfed21dc718ce0f0cdd53521a05e8bee8d1f0e95fccd7e823575ed80c')]);
  await mf.dispose();override=override.replace('b2ee9c1eb6c0ed8c0cf8fc1c9d02e5b7ae713c0c2dd292f946bd7d737d764737',base);mf=boot();
  const pending=request('/qualify');let held=false;
  for(let n=0;n<100;n++){held=(await(await request('/progress','GET')).json()).held;if(held)break;await new Promise(r=>setTimeout(r,5));}
  assert(held,'initial seed did not reach controlled barrier');
  const disabled=await request('/disable'),claim=await disabled.json();assert.equal(disabled.status,200);assert.equal(claim.fixture_authority_disabled,true);assert.equal(claim.fixtures_created,false);
  await request('/resume');const late=await pending;assert.equal(late.status,503,await late.clone().text());
  db=await mf.getD1Database('DB');const active=(await db.prepare("SELECT count(*) AS n FROM tenants WHERE status='active'").first()).n;
  console.log(JSON.stringify({cleanup_claim:claim,late_seed_status:late.status,active_tenants_after_cleanup_claim:active}));assert.equal(active,0);assert.equal((await db.prepare("SELECT phase FROM axiom_cq02_backend_fixture_receipt").first()).phase,'CANCELLED');
  assert.equal((await request('/disable')).status,200);
 }finally{if(mf)await mf.dispose();await rm(persist,{recursive:true,force:true});}
});
