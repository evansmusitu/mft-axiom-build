// Real local workerd + separate D1s; synthetic identity, token and executor ONLY.
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {MockAgent,setGlobalDispatcher} from 'undici';
import {fileURLToPath} from 'node:url';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setupContinuity,startFlow,consent,exchange} from '../tests/oauth_continuity_fixture.mjs';

const network=new MockAgent();network.disableNetConnect();
network.enableNetConnect(/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/);
setGlobalDispatcher(network);after(()=>network.close());
const root=fileURLToPath(new URL('../..',import.meta.url));
const quote=s=>'"'+s.replaceAll('"','""')+'"';

// Copy only the source-owned synthetic fixture's exact SQLite schema/rows into
// actual local D1. No hosted database, production snapshot or credential is read.
async function installFixture(target,source){
 const definitions=source._sqlite.prepare("SELECT name,sql FROM sqlite_schema WHERE type='table' AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all();
 await target.batch(definitions.map(x=>target.prepare(x.sql)));
 for(const {name} of definitions){
  const rows=source._sqlite.prepare('SELECT * FROM '+quote(name)).all();
  if(!rows.length)continue;
  const columns=Object.keys(rows[0]);
  const sql='INSERT INTO '+quote(name)+' ('+columns.map(quote).join(',')+') VALUES ('+columns.map(()=>'?').join(',')+')';
  await target.batch(rows.map(row=>target.prepare(sql).bind(...columns.map(c=>row[c]))));
 }
 const policies=source._sqlite.prepare("SELECT sql FROM sqlite_schema WHERE type IN ('index','trigger') AND sql IS NOT NULL ORDER BY rowid").all();
 if(policies.length)await target.batch(policies.map(x=>target.prepare(x.sql)));
}

async function runtime(t,{qualified=true}={}){
 const seed=setupContinuity();
 const authorization=await consent(seed.env,await startFlow(seed.env));assert.equal(authorization.status,302);
 const minted=await exchange(seed.env,new URL(authorization.headers.get('location')).searchParams.get('code'));
 assert.equal(minted.status,200);
 const f={persist:mkdtempSync(join(tmpdir(),'axiom-gate4-mcp-')),token:minted.body.access_token,calls:[]};
 const bindings={CUSTOMER_IDENTITY_ISSUER:seed.env.CUSTOMER_IDENTITY_ISSUER,
  OAUTH_IDENTITY_ISSUER:seed.env.OAUTH_IDENTITY_ISSUER,OAUTH_KEYLESS_QUALIFIED:'qualified_private_binding',
  MCP_CANONICAL_QUALIFIED:qualified?'qualified_private_binding':'not_admitted'};
 const core=async req=>{
  const m=await req.json();f.calls.push({method:m.method,body:m});
  if(m.method==='tools/list')return Response.json({jsonrpc:'2.0',id:m.id,result:{tools:[]}});
  return Response.json({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:'LOCAL_SYNTHETIC_EXECUTOR_RECEIPT'}],structuredContent:{synthetic:true},isError:false}});
 };
 f.boot=async()=>{
  f.mf=new Miniflare({cf:false,host:'127.0.0.1',d1Persist:f.persist,modules:true,modulesRoot:root,
   scriptPath:fileURLToPath(new URL('fixtures/gate4_mcp_gateway.mjs',import.meta.url)),compatibilityDate:'2026-07-01',
   bindings,d1Databases:{AXIOM_DB:'local-only-gate4-oauth',CUSTOMER_DB:'local-only-gate4-canonical'},
   serviceBindings:{MCP_CORE:core},outboundService:()=>{throw Error('EXTERNAL_EGRESS_NOT_ADMITTED');}});
  await f.mf.ready;f.worker=await f.mf.getWorker();
  f.oauth=await f.mf.getD1Database('AXIOM_DB');f.canonical=await f.mf.getD1Database('CUSTOMER_DB');
 };
 t.after(async()=>{await f.mf?.dispose();seed.close();rmSync(f.persist,{recursive:true,force:true});});
 await f.boot();await installFixture(f.oauth,seed.db);await installFixture(f.canonical,seed.portal);
 f.call=(message={jsonrpc:'2.0',id:73,method:'tools/call',params:{name:'musitu_axiom_execute',arguments:{operation:'arithmetic.evaluate',args:{expression:'40+2'}}}},headers={})=>
  f.worker.fetch('https://mcp.mftintelligence.com/mcp',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+f.token,...headers},body:JSON.stringify(message),redirect:'manual'});
 return f;
}
async function denied(f,message){
 const r=await f.call(message),body=await r.json();assert.equal(f.calls.length,0,'no execution after denial');
 assert(body.error||body.result?.isError||body.result?.resultType==='error');
 assert(!JSON.stringify(body).includes(f.token));
}

test('workerd: current published gateway dispatches the active canonical fixture',{timeout:30000},async t=>{
 const f=await runtime(t),r=await f.call(),b=await r.json();
 assert.equal(b.result.isError,false);assert.equal(b.result.structuredContent.synthetic,true);assert.equal(f.calls.length,1);
});
for(const [name,sql] of [
 ['membership',"UPDATE memberships SET status='revoked'"],
 ['canonical link',"UPDATE canonical_customer_links SET status='revoked'"],
 ['tenant',"UPDATE tenants SET status='suspended'"]
])test('workerd: canonical '+name+' revocation blocks a still-active OAuth token',{timeout:30000},async t=>{
 const f=await runtime(t);await f.canonical.prepare(sql).run();
 assert.equal((await f.oauth.prepare('SELECT revoked_at FROM oauth_access_tokens').first()).revoked_at,null);
 await denied(f);
 assert.equal((await f.oauth.prepare('SELECT count(*) n FROM oauth_identity_token_links').first()).n,1);
});
test('workerd: qualification denial survives an otherwise valid token and mapping',{timeout:30000},async t=>{
 const f=await runtime(t,{qualified:false});await denied(f);
});
test('workerd: canonical revocation remains effective after a real runtime restart',{timeout:30000},async t=>{
 const f=await runtime(t);assert.equal((await f.call()).status,200);assert.equal(f.calls.length,1);
 await f.canonical.prepare("UPDATE memberships SET status='revoked'").run();f.calls=[];
 await f.mf.dispose();await f.boot();await denied(f);
});
test('workerd: private RPC forwarding and batch requests cannot bypass admission',{timeout:30000},async t=>{
 const f=await runtime(t);await f.canonical.prepare("UPDATE memberships SET status='revoked'").run();
 await denied(f,{jsonrpc:'2.0',id:7,method:'resources/read',params:{uri:'synthetic-private-artifact'}});
 await denied(f,[{jsonrpc:'2.0',id:8,method:'tools/call',params:{name:'musitu_axiom_execute',arguments:{operation:'arithmetic.evaluate',args:{expression:'40+2'}}}}]);
});
test('workerd: public discovery is preserved while canonical admission is disabled',{timeout:30000},async t=>{
 const f=await runtime(t,{qualified:false});
 const r=await f.call({jsonrpc:'2.0',id:9,method:'tools/list'},{authorization:''});
 assert.deepEqual((await r.json()).result.tools,[]);assert.equal(f.calls.length,1);assert.equal(f.calls[0].method,'tools/list');
});
