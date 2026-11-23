// Isolated synthetic identity/executor; real candidate OAuth and two SQLite DBs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import published from './fixtures/gate4-published-gateway/gateway.mjs';
import {setupContinuity,startFlow,consent,exchange,customer,identity} from './oauth_continuity_fixture.mjs';

// Reproduce the original boundary defect without changing its deployed source.
const baseline=process.env.AXIOM_GATE4_BASELINE==='1';
const gateway=baseline?published:(await import('../../mcp/canonical_mcp_admission_candidate.mjs')).withCanonicalMCPAdmission(published);
const computation={jsonrpc:'2.0',id:73,method:'tools/call',params:{name:'musitu_axiom_execute',arguments:{operation:'arithmetic.evaluate',args:{expression:'40+2'}}}};
const request=(token,message=computation,extra={})=>new Request('https://mcp.mftintelligence.com/mcp',{
 method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{}),...extra},body:JSON.stringify(message)});

async function fixture(t){
 const f=setupContinuity();t.after(()=>f.close());
 const allowed=await consent(f.env,await startFlow(f.env));assert.equal(allowed.status,302);
 const token=await exchange(f.env,new URL(allowed.headers.get('location')).searchParams.get('code'));
 assert.equal(token.status,200);f.token=token.body.access_token;f.calls=[];
 f.env.MCP_CANONICAL_QUALIFIED='qualified_private_binding';
 f.env.MCP_CORE={fetch:async req=>{
  const m=await req.json();f.calls.push({method:m.method,authorization:req.headers.get('authorization'),body:m});
  if(m.method==='tools/list')return Response.json({jsonrpc:'2.0',id:m.id,result:{tools:[]}});
  return Response.json({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:'LOCAL_SYNTHETIC_EXECUTOR_RECEIPT'}],structuredContent:{synthetic:true},isError:false}});
 }};
 return f;
}
async function run(f,message=computation,extra={}){return gateway.fetch(request(f.token,message,extra),f.env);}
async function blocked(f,message=computation,extra={}){
 const r=await run(f,message,extra),body=await r.json();
 assert.equal(f.calls.length,0,'denied authorization must make zero executor calls');
 assert(body.error||body.result?.isError||body.result?.resultType==='error','request must return an explicit denial');
 assert(!JSON.stringify(body).includes(f.token),'never expose the bearer token');
 return body;
}

test('published test dependency is byte-exact and is not a replacement gateway',()=>{
 const dir=new URL('./fixtures/gate4-published-gateway/',import.meta.url),m=JSON.parse(readFileSync(new URL('SOURCE.json',dir)));
 const b=readFileSync(new URL('gateway.mjs',dir));
 assert.equal(createHash('sha256').update(b).digest('hex'),m.sha256);
 assert.equal(m.source_commit,'6ab9961906329722d19fbb1f614ca14f89e8e224');
 assert.equal(m.sha256,'cf3e999deab721532ef584715fbdccc3699849ba40365bedccd961982779ece9');
});
test('active canonical OAuth customer reaches the supplied published gateway executor',async t=>{
 const f=await fixture(t),r=await run(f),body=await r.json();
 assert.equal(body.result.isError,false);assert.equal(body.result.structuredContent.synthetic,true);
 assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0].body,computation);
 assert.equal(f.calls[0].authorization,'Bearer '+f.token);
 assert.equal(f.portal._sqlite.prepare('SELECT role FROM memberships').get().role,'viewer');
});
for(const [name,sql] of [
 ['membership',"UPDATE memberships SET status='revoked'"],
 ['canonical link',"UPDATE canonical_customer_links SET status='revoked'"],
 ['tenant',"UPDATE tenants SET status='suspended'"]
])test('revoked '+name+' denies direct MCP while OAuth token is still active',async t=>{
 const f=await fixture(t);f.portal._sqlite.exec(sql);
 assert.equal(f.db._sqlite.prepare('SELECT revoked_at FROM oauth_access_tokens').get().revoked_at,null);
 await blocked(f);
 assert.equal(f.db._sqlite.prepare('SELECT count(*) n FROM oauth_identity_token_links').get().n,1);
});
test('a previously successful dispatch is never a cached authorization after canonical revocation',async t=>{
 const f=await fixture(t);assert.equal((await run(f)).status,200);assert.equal(f.calls.length,1);f.calls=[];
 f.portal._sqlite.exec("UPDATE memberships SET status='revoked'");await blocked(f);
});
test('canonical database absent or unavailable cannot fall back to OAuth-only access',async t=>{
 for(const replacement of [undefined,{prepare(){throw Error('PRIVATE_DATABASE_DETAIL_SHOULD_NOT_LEAK');}}]){
  const f=await fixture(t);f.env.CUSTOMER_DB=replacement;const b=await blocked(f);
  assert(!JSON.stringify(b).includes('PRIVATE_DATABASE_DETAIL'));
 }
});
test('unqualified staging admission cannot execute even with a valid token and mapping',async t=>{
 for(const q of [undefined,'true','qualified','unqualified']){
  const f=await fixture(t);f.env.MCP_CANONICAL_QUALIFIED=q;await blocked(f);
 }
});
test('a different canonical customer database cannot authenticate the OAuth customer',async t=>{
 const f=await fixture(t),other=setupContinuity({portalCustomer:'ee7e91e7-7283-49f8-b086-d677f2dfe563'});t.after(()=>other.close());
 f.env.CUSTOMER_DB=other.portal;await blocked(f);
});
test('unqualified identity issuer drift denies even if both database rows are active',async t=>{
 const f=await fixture(t);f.env.CUSTOMER_IDENTITY_ISSUER='https://different-issuer.invalid';await blocked(f);
});
test('an OAuth token with no identity-token linkage cannot become canonical by browser headers',async t=>{
 const f=await fixture(t),now=new Date().toISOString(),expires=new Date(Date.now()+60000).toISOString();
 f.db._sqlite.prepare('INSERT INTO api_keys(id,customer_id,key_hash,status,expires_at) VALUES(?,?,?,?,?)').run('synthetic-unlinked-key',customer,'f'.repeat(64),'active',expires);
 f.db._sqlite.prepare('INSERT INTO oauth_access_tokens(token_hash,api_key_id,customer_id,issuer,resource,scope,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)')
 .run(createHash('sha256').update('synthetic-unlinked-token-0000001').digest('hex'),'synthetic-unlinked-key',customer,'https://auth.mftintelligence.com','https://mcp.mftintelligence.com','axiom.execute',now,expires);
 f.token='synthetic-unlinked-token-0000001';
 await blocked(f,computation,{'x-axiom-customer-id':customer,'x-axiom-tenant-id':identity.tenant_id,'x-axiom-verified':'true'});
});
test('cross-customer OAuth access-token and key pairing denies at MCP dispatch',async t=>{
 const f=await fixture(t),other='ee7e91e7-7283-49f8-b086-d677f2dfe563';
 f.db._sqlite.prepare('INSERT INTO customers(id,status) VALUES(?,?)').run(other,'active');
 f.db._sqlite.prepare('UPDATE oauth_access_tokens SET customer_id=?').run(other);await blocked(f);
});
test('canonical revocation during the gateway OAuth read is observed before executor dispatch',async t=>{
 const f=await fixture(t),prepare=f.db.prepare;let revoked=false;
 f.db.prepare=sql=>{
  const p=prepare(sql);
  if(sql.startsWith('SELECT a.customer_id,a.issuer,a.resource')){
   const first=p.first;p.first=async()=>{const value=await first();if(!revoked){revoked=true;f.portal._sqlite.exec("UPDATE memberships SET status='revoked'");}return value;};
  }
  return p;
 };
 await blocked(f);assert(revoked,'the initial OAuth read must succeed before injected canonical revocation');
});
test('OAuth revocation committed during the canonical read is checked again before dispatch',async t=>{
 const f=await fixture(t),prepare=f.portal.prepare;let revoked=false;
 f.portal.prepare=sql=>{
  const p=prepare(sql);
  if(sql==='SELECT * FROM canonical_customer_links WHERE identity_id=?'){
   const first=p.first;p.first=async()=>{const value=await first();if(!revoked){revoked=true;f.db._sqlite.exec("UPDATE oauth_access_tokens SET revoked_at=CURRENT_TIMESTAMP");}return value;};
  }
  return p;
 };
 await blocked(f);assert(revoked,'revocation is injected while canonical eligibility is being read');
});
test('MCP qualification does not substitute for missing keyless identity admission',async t=>{
 const f=await fixture(t);f.env.OAUTH_KEYLESS_QUALIFIED=undefined;await blocked(f);
});
test('modern MCP canonical denial preserves OAuth challenge metadata',async t=>{
 const f=await fixture(t);f.portal._sqlite.exec("UPDATE memberships SET status='revoked'");
 const b=await blocked(f,computation,{'mcp-protocol-version':'2026-07-28'});
 assert(JSON.stringify(b).includes('mcp/www_authenticate'));
 assert(!JSON.stringify(b).includes(customer),'denial must not disclose the customer UUID');
});
test('private non-tool RPC forwarding also requires canonical admission',async t=>{
 const f=await fixture(t);f.portal._sqlite.exec("UPDATE memberships SET status='revoked'");
 await blocked(f,{jsonrpc:'2.0',id:74,method:'resources/read',params:{uri:'private-synthetic-artifact'}});
});
test('malformed batch forwarding cannot bypass canonical admission',async t=>{
 const f=await fixture(t);await blocked(f,[computation]);
});
test('public discovery remains available without customer qualification or bearer credentials',async t=>{
 const f=await fixture(t);f.token=null;f.env.MCP_CANONICAL_QUALIFIED=undefined;f.env.CUSTOMER_DB=undefined;
 const r=await run(f,{jsonrpc:'2.0',id:9,method:'tools/list'}),b=await r.json();
 assert.deepEqual(b.result.tools,[]);assert.equal(f.calls.length,1);assert.equal(f.calls[0].method,'tools/list');
});
