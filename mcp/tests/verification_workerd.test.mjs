// Real local Cloudflare workerd + D1; no production credentials or network.
// Local workerd supports July semantics; the existing production date is preserved
// and checked separately by guarded provider upload/readback.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const {Miniflare}=await import(process.env.AXIOM_TEST_MINIFLARE_MODULE?pathToFileURL(process.env.AXIOM_TEST_MINIFLARE_MODULE).href:'miniflare');
const fixtures=JSON.parse(readFileSync(new URL('./fixtures/verification-live-before.json',import.meta.url))).cases;
const registry=JSON.parse(readFileSync(new URL('./fixtures/public-registry-before-2.0.5.json',import.meta.url))).result.tools.map(t=>t.name==='ewma_smoothing'?{...t,name:'ewma_forecast'}:t);
const source=readFileSync(new URL('../musitu_axiom_plugin_gate_v4.mjs',import.meta.url),'utf8');
test('workerd verifies live numerical fixtures, enforces OAuth and preserves contracts',{timeout:60000},async()=>{
 let fault=null,calls=0;
 const core=async req=>{
  if(new URL(req.url).pathname==='/health')return Response.json({ok:true,build_id:'MFT-AXIOM-V3-FULL-SELF-CONTAINED-20260904'});
  const m=await req.json();if(m.method==='tools/list')return Response.json({result:{tools:registry}});
  calls++;assert.equal(req.headers.get('authorization'),'Bearer isolated-verification-token');
  const p=m.params.arguments,f=fixtures.find(f=>f.operation===p.operation&&JSON.stringify(f.args)===JSON.stringify(p.args));assert.ok(f,'core fixture selected from exact request');
  const result=structuredClone(f.response.structuredContent);
  if(fault==='wrong_result'){result.result.result=123;result.result.verified=true;result.result.verification={status:'verified',method:'forged'};}
  if(fault==='wrong_operation')result.operation='arithmetic.evaluate';
  return Response.json({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:'Completed fixture.'}],structuredContent:result}});
 };
 const mf=new Miniflare({modules:true,compatibilityDate:'2026-07-01',cf:false,script:source,bindings:{AUTH_ISSUER:'https://auth.mftintelligence.com',MCP_PUBLIC_BASE:'https://mcp.mftintelligence.com'},d1Databases:{AXIOM_DB:'isolated-verification-test'},serviceBindings:{MCP_CORE:core}});
 try{
  const db=await mf.getD1Database('AXIOM_DB');
  await db.exec("CREATE TABLE api_keys (id TEXT PRIMARY KEY,status TEXT,expires_at TEXT,revoked_at TEXT); CREATE TABLE oauth_access_tokens (token_hash TEXT PRIMARY KEY,customer_id TEXT,issuer TEXT,resource TEXT,scope TEXT,expires_at TEXT,revoked_at TEXT,api_key_id TEXT);");
  await db.prepare("INSERT INTO api_keys VALUES ('key-a','active',NULL,NULL)").run();
  const tokenHash=createHash('sha256').update('isolated-verification-token').digest('hex');
  await db.prepare("INSERT INTO oauth_access_tokens VALUES (?,'tenant-a','https://auth.mftintelligence.com','https://mcp.mftintelligence.com','axiom.execute','2099-01-01',NULL,'key-a')").bind(tokenHash).run();
  async function request(method,params={},auth=true){return (await mf.dispatchFetch('https://mcp.mftintelligence.com/mcp',{method:'POST',headers:{'content-type':'application/json',...(auth?{authorization:'Bearer isolated-verification-token'}:{})},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})})).json();}
  const listed=await request('tools/list'),tools=listed.result.tools;assert.equal(tools.length,108);
  if(process.env.AXIOM_BASE_GATEWAY_FILE){
   const old=new Miniflare({modules:true,compatibilityDate:'2026-07-01',cf:false,script:readFileSync(process.env.AXIOM_BASE_GATEWAY_FILE,'utf8'),d1Databases:{AXIOM_DB:'baseline-no-records'},serviceBindings:{MCP_CORE:core}});
   try{const before=await (await old.dispatchFetch('https://mcp.mftintelligence.com/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})})).json();assert.deepEqual(tools,before.result.tools,'all 108 tool definitions are unchanged');}finally{await old.dispose();}
  }
  for(const f of fixtures){const x=await request('tools/call',{name:'musitu_axiom_execute',arguments:{operation:f.operation,args:f.args}});assert.notEqual(x.result.isError,true);const out=x.result.structuredContent.result;assert.equal(out.verified,true,f.id);assert.equal(out.verification.status,'verified');assert.match(out.verification.checker_source_sha256,/^[0-9a-f]{64}$/);assert.match(out.verification.evidence_digest,/^[0-9a-f]{64}$/);assert.equal(out.axiom,undefined);assert.equal(JSON.stringify(out).includes('tenant-a'),false);}
  const f=fixtures[0],params={name:'investment_npv',arguments:{args:f.args}},before=calls;
  assert.equal((await request('tools/call',params,false)).result.isError,true);assert.equal(calls,before);
  const forged=await request('tools/call',{...params,arguments:{args:{...f.args,verified:true}}});assert.equal(forged.result.isError,true);assert.equal(calls,before);
  for(const mode of ['wrong_result','wrong_operation']){fault=mode;const x=await request('tools/call',{name:'musitu_axiom_execute',arguments:{operation:f.operation,args:f.args}});assert.equal(x.result.isError,true);assert.equal(x.result.structuredContent.result.verified,false);assert.equal(x.result.structuredContent.result.result,null);}
  fault=null;await db.prepare("UPDATE api_keys SET status='revoked' WHERE id='key-a'").run();const count=calls;assert.equal((await request('tools/call',params)).result.isError,true);assert.equal(calls,count);
  const health=await (await mf.dispatchFetch('https://mcp.mftintelligence.com/health')).json();assert.equal(health.server_version,'4.0.3');assert.match(health.independent_verification.source_sha256,/^[0-9a-f]{64}$/);
 }finally{await mf.dispose();}
});
