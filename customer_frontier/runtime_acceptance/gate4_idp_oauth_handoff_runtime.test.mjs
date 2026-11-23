// Actual local workerd + four separate D1 namespaces. All external authority,
// ownership decisions, IdP responses and executor receipts remain synthetic.
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {MockAgent,setGlobalDispatcher} from 'undici';
import {fileURLToPath} from 'node:url';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {setupContinuity} from '../tests/oauth_continuity_fixture.mjs';
import {principal,customer,auth,portal,path,resource,redirect,verifier,cookie,input,ownershipSQL,providerResponse} from '../tests/oauth_handoff_fixture.mjs';
import {ZITADEL_STAGING} from '../customer_control_plane/zitadel_provider_tokens_candidate.mjs';
const network=new MockAgent();network.disableNetConnect();network.enableNetConnect(/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/);
setGlobalDispatcher(network);after(()=>network.close());
const root=fileURLToPath(new URL('../..',import.meta.url)),source=p=>join(root,p),quote=s=>'"'+s.replaceAll('"','""')+'"';
async function installFixture(target,source){
 const tables=source._sqlite.prepare("SELECT name,sql FROM sqlite_schema WHERE type='table' AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all();
 await target.batch(tables.map(x=>target.prepare(x.sql)));
 for(const {name} of tables){const rows=source._sqlite.prepare('SELECT * FROM '+quote(name)).all();if(!rows.length)continue;const columns=Object.keys(rows[0]);
  await target.batch(rows.map(row=>target.prepare('INSERT INTO '+quote(name)+' ('+columns.map(quote).join(',')+') VALUES ('+columns.map(()=>'?').join(',')+')').bind(...columns.map(c=>row[c]))));}
 const policies=source._sqlite.prepare("SELECT sql FROM sqlite_schema WHERE type IN ('trigger','index') AND sql IS NOT NULL ORDER BY rowid").all();
 if(policies.length)await target.batch(policies.map(x=>target.prepare(x.sql)));
}
async function install(db,file){
 const statements=JSON.parse(execFileSync('python3',['-c',`import sqlite3,json,sys
out=[];part=''
for line in open(sys.argv[1]):
 part+=line
 if sqlite3.complete_statement(part):out.append(part);part=''
assert not part.strip()
print(json.dumps(out))`,file],{encoding:'utf8'}));
 await db.batch(statements.map(s=>db.prepare(s)));
}
async function runtime(t,{owned=true}={}){
 const seed=setupContinuity({principal}),persist=mkdtempSync(join(tmpdir(),'axiom-handoff-workerd-'));
 const f={providerCalls:[],providerPatch:{},exchanges:0,coreCalls:0,key:randomBytes(32).toString('base64url')};
 const databases={AXIOM_DB:'handoff-local-oauth',CUSTOMER_DB:'handoff-local-customers',IDP_SESSION_DB:'handoff-local-idp',OAUTH_HANDOFF_DB:'handoff-local-grants'};
 const bindings={CUSTOMER_IDENTITY_ISSUER:principal.issuer,OAUTH_IDENTITY_ISSUER:principal.issuer,OAUTH_HANDOFF_QUALIFIED:'qualified_private_binding',
  OAUTH_OWNERSHIP_QUALIFIED:'qualified_private_binding',OAUTH_KEYLESS_QUALIFIED:'qualified_private_binding'};
 const noNetwork=()=>{throw Error('EXTERNAL_NETWORK_NOT_ADMITTED');};
 f.boot=async()=>{
  const worker=(name,script,extra)=>({name,modules:true,modulesRoot:root,scriptPath:source(script),compatibilityDate:'2026-07-01',outboundService:noNetwork,...extra});
  f.mf=new Miniflare({cf:false,host:'127.0.0.1',d1Persist:persist,workers:[
   worker('identity','customer_frontier/customer_control_plane/zitadel_session_worker_candidate.mjs',{
    d1Databases:{IDP_SESSION_DB:databases.IDP_SESSION_DB,CUSTOMER_DB:databases.CUSTOMER_DB},
    bindings:{CUSTOMER_IDP_STAGING_ADMITTED:'qualified_staging',CUSTOMER_IDP_BINDING_ADMITTED:'qualified_private_binding',CUSTOMER_IDP_FLOW_KEY:f.key,OAUTH_HANDOFF_QUALIFIED:'qualified_private_binding'},
    serviceBindings:{OAUTH_HANDOFF_INSPECTOR:{name:'handoff',entrypoint:'OAuthHandoffInspector'}},outboundService:r=>providerResponse(r,f)}),
   worker('handoff','auth/oauth_session_handoff_worker_candidate.mjs',{d1Databases:databases,bindings}),
   worker('oauth','auth/axiom_keyless_oauth_worker_candidate.mjs',{d1Databases:{AXIOM_DB:databases.AXIOM_DB,CUSTOMER_DB:databases.CUSTOMER_DB},bindings,
    serviceBindings:{OAUTH_SESSION_VERIFIER:{name:'handoff',entrypoint:'OAuthSessionHandoffService'}}}),
   worker('portal','customer_frontier/customer_control_plane/worker.mjs',{d1Databases:{CUSTOMER_DB:databases.CUSTOMER_DB},
    bindings:{...bindings,CUSTOMER_IDP_STAGING_ADMITTED:'qualified_staging',CUSTOMER_IDP_ROUTE_ADMITTED:'qualified_private_binding',
     CUSTOMER_OAUTH_HANDOFF_ROUTE_ADMITTED:'qualified_private_binding',IDENTITY_VERIFIER_QUALIFIED:'qualified_private_binding'},
    serviceBindings:{CUSTOMER_IDP_BROWSER:'identity',CUSTOMER_OAUTH_HANDOFF_BROWSER:{name:'handoff',entrypoint:'OAuthHandoffBrowserService'},IDENTITY_VERIFIER:{name:'identity',entrypoint:'CustomerIdentityService'}}}),
   worker('mcp','customer_frontier/runtime_acceptance/fixtures/gate4_mcp_gateway.mjs',{
    d1Databases:{AXIOM_DB:databases.AXIOM_DB,CUSTOMER_DB:databases.CUSTOMER_DB},bindings:{...bindings,MCP_CANONICAL_QUALIFIED:'qualified_private_binding'},
    serviceBindings:{MCP_CORE:async()=>{f.coreCalls++;return Response.json({jsonrpc:'2.0',id:1,result:{content:[{type:'text',text:'LOCAL_SYNTHETIC_EXECUTOR'}],isError:false}});}}}),
   worker('ingress','customer_frontier/runtime_acceptance/fixtures/gate4_handoff_ingress.mjs',{
    serviceBindings:{OAUTH:'oauth',PORTAL:'portal',IDP:'identity',HANDOFF:'handoff',MCP:'mcp'}})
  ]});await f.mf.ready;
  const ingress=await f.mf.getWorker('ingress');
  f.request=(target,url,options={})=>{
   const headers=new Headers(options.headers);headers.set('x-local-test-target',target);
   if(headers.has('origin')){headers.set('x-local-test-origin',headers.get('origin'));headers.delete('origin');}
   return ingress.fetch(url,{...options,headers,redirect:'manual'});
  };
  f.oauth=await f.mf.getD1Database('AXIOM_DB','handoff');f.canonical=await f.mf.getD1Database('CUSTOMER_DB','handoff');
  f.idp=await f.mf.getD1Database('IDP_SESSION_DB','handoff');f.handoffs=await f.mf.getD1Database('OAUTH_HANDOFF_DB','handoff');
 };
 t.after(async()=>{await f.mf?.dispose();seed.close();rmSync(persist,{recursive:true,force:true});});
 await f.boot();await installFixture(f.oauth,seed.db);await installFixture(f.canonical,seed.portal);
 await install(f.idp,source('customer_frontier/customer_control_plane/zitadel_session_broker_candidate.sql'));
 await install(f.handoffs,source('auth/oauth_session_handoff_candidate.sql'));if(owned)await ownershipSQL(f.handoffs).run();
 f.start=async()=>{
  const q=new URLSearchParams({response_type:'code',client_id:'chatgpt-client',redirect_uri:redirect,resource,scope:'openid email axiom.execute',
   state:'S'.repeat(32),code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
  const r=await f.request('oauth',auth+'/oauth/authorize?'+q);assert.equal(r.status,200,JSON.stringify({response:await r.clone().text(),now:Date.now(),flows:(await f.oauth.prepare('SELECT created_at,expires_at FROM oauth_authorization_flows').all()).results,handoffs:(await f.handoffs.prepare('SELECT created_at_ms,expires_at_ms,status FROM oauth_session_handoffs_v1').all()).results}));
  const html=await r.text(),href=/href="([^"]+)"/.exec(html)[1];return {href,oauthCookie:cookie(r,'__Host-axiom_oauth_flow')};
 };
 f.login=async h=>{
  const route=await f.request('portal',h.href);assert.equal(route.status,303);const start=await f.request('portal',route.headers.get('location'));
  assert.equal(start.status,303,await start.clone().text());f.authorize=new URL(start.headers.get('location'));
  const r=await f.request('portal',ZITADEL_STAGING.redirect_uri+'?state='+f.authorize.searchParams.get('state')+'&code=synthetic-code',
   {headers:{cookie:cookie(start,'__Host-axiom_login')}});assert.equal(r.status,303,await r.clone().text());assert.equal(r.headers.get('location'),h.href);
  return cookie(r,'__Host-axiom_customer');
 };
 f.consent=async(h,session)=>{
  const r=await f.request('portal',h.href,{headers:{cookie:session}});assert.equal(r.status,200,await r.clone().text());return {csrf:input(await r.text(),'csrf'),consentCookie:cookie(r,'__Host-axiom_oauth_consent')};
 };
 f.approve=(h,session,c)=>f.request('portal',h.href,{method:'POST',headers:{cookie:session+'; '+c.consentCookie,origin:portal,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({csrf:c.csrf,consent:'approve'})});
 f.complete=(h,html,patch={})=>f.request('oauth',auth+'/oauth/authorize',{method:'POST',headers:{cookie:h.oauthCookie,origin:portal,'content-type':'application/x-www-form-urlencoded',...patch},
  body:new URLSearchParams({auth_mode:'verified_handoff',flow_id:input(html,'flow_id'),handoff_id:input(html,'handoff_id'),handoff_grant:input(html,'handoff_grant')})});
 f.approved=async()=>{const h=await f.start(),session=await f.login(h),c=await f.consent(h,session),r=await f.approve(h,session,c);
  assert.equal(r.status,200,await r.clone().text());return {h,session,c,html:await r.text()};};
 f.exchange=code=>f.request('oauth',auth+'/oauth/token',{method:'POST',body:new URLSearchParams({grant_type:'authorization_code',client_id:'chatgpt-client',resource,code,
  redirect_uri:redirect,code_verifier:verifier})});
 return f;
}

test('workerd: signed IdP callback -> private handoff -> real OAuth code -> same canonical MCP customer',{timeout:30000},async t=>{
 const f=await runtime(t),a=await f.approved(),r=await f.complete(a.h,a.html);assert.equal(r.status,302,await r.clone().text());
 assert.equal(f.exchanges,1);const code=new URL(r.headers.get('location')).searchParams.get('code'),tokenResponse=await f.exchange(code);
 assert.equal(tokenResponse.status,200,await tokenResponse.clone().text());const tokens=await tokenResponse.json();
 const link=await f.oauth.prepare('SELECT * FROM oauth_identity_token_links').first();assert.equal(link.customer_id,customer);assert.equal(link.tenant_id,principal.tenant_id);
 const me=await f.request('portal',portal+'/v1/customer/me',{headers:{cookie:a.session}});assert.equal(me.status,200,await me.clone().text());assert.equal((await me.json()).tenant_id,principal.tenant_id);
 const execute=()=>f.request('mcp',resource+'/mcp',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+tokens.access_token},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'musitu_axiom_execute',arguments:{operation:'arithmetic.evaluate',args:{expression:'40+2'}}}})});
 const success=await execute();assert.equal((await success.json()).result.isError,false);assert.equal(f.coreCalls,1);
 await f.canonical.prepare("UPDATE memberships SET status='revoked'").run();const denied=await execute(),body=await denied.json();assert(body.error||body.result?.isError);assert.equal(f.coreCalls,1);
 assert.equal((await f.exchange(code)).status,400);
});
test('workerd: missing real ownership admission is denied despite signed IdP and existing mappings',{timeout:30000},async t=>{
 const f=await runtime(t,{owned:false}),h=await f.start(),session=await f.login(h),r=await f.request('portal',h.href,{headers:{cookie:session}});
 assert.equal(r.status,401);assert.equal((await f.oauth.prepare('SELECT count(*) n FROM oauth_authorization_codes').first()).n,0);assert.equal(f.coreCalls,0);
});
test('workerd: racing handoff redemptions have one winner; private paths stay unavailable publicly',{timeout:30000},async t=>{
 const f=await runtime(t),a=await f.approved(),r=await Promise.all([f.complete(a.h,a.html),f.complete(a.h,a.html),f.complete(a.h,a.html)]);
 assert.equal(r.filter(x=>x.status===302).length,1);assert.equal((await f.oauth.prepare('SELECT count(*) n FROM oauth_authorization_codes').first()).n,1);
 assert.equal((await f.request('handoff','https://axiom-internal/identity/verify-oauth-session',{method:'POST'})).status,404);
 assert.equal((await f.request('portal',portal+'/identity/verify-oauth-session',{method:'POST'})).status,404);
});
test('workerd: wrong browser, foreign Origin and cookie duplication cannot consume a grant',{timeout:30000},async t=>{
 const f=await runtime(t),a=await f.approved();
 for(const patch of [{cookie:'__Host-axiom_oauth_flow='+'X'.repeat(43)},{origin:'https://foreign.invalid'},{cookie:a.h.oauthCookie+'; '+a.h.oauthCookie}]){
  const r=await f.complete(a.h,a.html,patch);assert([400,401].includes(r.status));assert.equal((await f.handoffs.prepare('SELECT status FROM oauth_session_handoffs_v1').first()).status,'approved');}
 assert.equal((await f.complete(a.h,a.html)).status,302);
});
test('workerd: granted handoff persists across restart, remains single-use after a second restart',{timeout:30000},async t=>{
 const f=await runtime(t),a=await f.approved();await f.mf.dispose();await f.boot();assert.equal((await f.complete(a.h,a.html)).status,302);
 await f.mf.dispose();await f.boot();assert.equal((await f.complete(a.h,a.html)).status,400);assert.equal((await f.oauth.prepare('SELECT count(*) n FROM oauth_authorization_codes').first()).n,1);
});
for(const [label,db,sql] of [
 ['portal logout','idp',"UPDATE customer_idp_sessions_v1 SET status='revoked',session_version=session_version+1"],
 ['canonical membership','canonical',"UPDATE memberships SET status='revoked'"],
 ['ownership decision','handoffs',"UPDATE oauth_handoff_ownership_v1 SET status='revoked'"]
])test('workerd: '+label+' revocation before redemption survives restart',{timeout:30000},async t=>{
 const f=await runtime(t),a=await f.approved();await f[db].prepare(sql).run();await f.mf.dispose();await f.boot();
 assert.equal((await f.complete(a.h,a.html)).status,401);assert.equal((await f.oauth.prepare('SELECT count(*) n FROM oauth_authorization_codes').first()).n,0);assert.equal(f.coreCalls,0);
});
test('workerd: new-namespace transaction failure rolls back approval without losing customer rows',{timeout:30000},async t=>{
 const f=await runtime(t),h=await f.start(),session=await f.login(h),c=await f.consent(h,session),id=new URL(h.href).searchParams.get('handoff');
 await assert.rejects(f.handoffs.batch([
  f.handoffs.prepare("UPDATE oauth_session_handoffs_v1 SET status='approved',grant_sha256=?,approved_at_ms=? WHERE id=?").bind('c'.repeat(64),Date.now(),id),
  f.handoffs.prepare('DELETE FROM oauth_handoff_ownership_v1')
 ]));
 assert.equal((await f.handoffs.prepare('SELECT status FROM oauth_session_handoffs_v1').first()).status,'consent');
 assert.equal((await f.oauth.prepare('SELECT id FROM customers').first()).id,customer);assert.equal((await f.approve(h,session,c)).status,200);
});
