// Synthetic provider + real local SQLite only; not hosted acceptance.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto,createHash,randomBytes} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {handleIdentityBrowser,handleIdentityBinding} from '../customer_control_plane/zitadel_session_broker_candidate.mjs';
import {exchangeZitadelAuthorizationCode,ZITADEL_STAGING} from '../customer_control_plane/zitadel_provider_tokens_candidate.mjs';
import {openTestDB} from '../customer_control_plane/sqlite_d1_test_adapter.mjs';
import {seedCanonicalFixture} from './identity_fixture.mjs';
import {verifyCustomerSession} from '../customer_control_plane/identity_session.mjs';
const origin=new URL(ZITADEL_STAGING.redirect_uri).origin,subject='synthetic-browser-subject';
const schema=new URL('../customer_control_plane/zitadel_session_broker_candidate.sql',import.meta.url);
const customerSchema=new URL('../customer_control_plane/schema.sql',import.meta.url);
const hash=x=>createHash('sha256').update(x).digest('hex');
const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
const keys=await webcrypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const jwk={...await webcrypto.subtle.exportKey('jwk',keys.publicKey),kid:'synthetic-browser-key',use:'sig',alg:'RS256'};
const cookieValue=(r,name)=>r.headers.getSetCookie().find(c=>c.startsWith(name+'='))?.split(';')[0];
const flowCookie=r=>cookieValue(r,'__Host-axiom_login');
const sessionCookie=r=>cookieValue(r,'__Host-axiom_customer');
function fixture(t,options={}){
 const db=openTestDB(schema,options),customers=openTestDB(customerSchema);
 const f={time:1793898732000,db,customers,requests:[],patch:{},status:200,afterToken:null};
 t.after(()=>{if(!f.closed)db.close();customers.close();});
 f.env={IDP_SESSION_DB:db,CUSTOMER_DB:customers,CUSTOMER_IDP_STAGING_ADMITTED:'qualified_staging',
  CUSTOMER_IDP_BINDING_ADMITTED:'qualified_private_binding',CUSTOMER_IDP_FLOW_KEY:randomBytes(32).toString('base64url')};
 f.fetcher=async req=>{
  f.requests.push(req);
  if(req.url===ZITADEL_STAGING.issuer+'/oauth/v2/token'){
   const body=new URLSearchParams(await req.text());
   assert.equal(req.method,'POST');assert.equal(req.redirect,'error');assert.equal(req.credentials,'omit');
   assert.equal(req.headers.has('authorization'),false);assert.equal(body.has('client_secret'),false);
   assert.equal(body.get('client_id'),ZITADEL_STAGING.client_id);assert.equal(body.get('redirect_uri'),ZITADEL_STAGING.redirect_uri);
   assert.equal(body.get('grant_type'),'authorization_code');assert.equal(body.get('code'),'synthetic-code');
   assert.equal(createHash('sha256').update(body.get('code_verifier')).digest('base64url'),f.authorize.searchParams.get('code_challenge'));
   const n=Math.floor(f.time/1000),p={iss:ZITADEL_STAGING.issuer,sub:subject,aud:ZITADEL_STAGING.client_id,
    nonce:f.authorize.searchParams.get('nonce'),iat:n,auth_time:n-10,exp:n+3600,amr:['pwd','mfa'],...f.patch};
   const input=encode({alg:'RS256',kid:jwk.kid})+'.'+encode(p);
   const sig=await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,Buffer.from(input));
   await f.afterToken?.();
   return Response.json({id_token:input+'.'+Buffer.from(sig).toString('base64url'),access_token:'synthetic-access',token_type:'Bearer'},{status:f.status});
  }
  if(req.url===ZITADEL_STAGING.jwks_uri)return Response.json({keys:[jwk]});
  if(req.url===ZITADEL_STAGING.userinfo_endpoint)return Response.json({sub:subject,email:'synthetic@example.test',email_verified:true});
  throw Error('unexpected_provider_destination');
 };
 f.browser=req=>handleIdentityBrowser(req,f.env,{clock:()=>f.time,fetcher:f.fetcher});
 f.start=async()=>{const r=await f.browser(new Request(origin+'/auth/start'));assert.equal(r.status,303);f.authorize=new URL(r.headers.get('location'));return r;};
 f.callback=(start,query='')=>new Request(ZITADEL_STAGING.redirect_uri+'?state='+f.authorize.searchParams.get('state')+'&code=synthetic-code'+query,
  {headers:{cookie:flowCookie(start)}});
 f.login=async()=>{const start=await f.start();const r=await f.browser(f.callback(start));assert.equal(r.status,303);return r;};
 f.seed=()=>seedCanonicalFixture(customers,{issuer:ZITADEL_STAGING.issuer,subject,tenant:'synthetic-tenant',customer:'11111111-1111-4111-8111-111111111111'});
 f.proofRequest=(cookie,patch={})=>new Request('https://axiom-internal/session/verify',{method:'POST',headers:{cookie,'content-type':'application/json','x-axiom-audience':'customer-control-plane'},
  body:JSON.stringify({audience:'customer-control-plane',purpose:'customer-session',challenge:'a'.repeat(64),request_sha256:'b'.repeat(64),...patch})});
 f.proof=(cookie,patch={})=>handleIdentityBinding(f.proofRequest(cookie,patch),f.env,{clock:()=>f.time});
 return f;
}

test('unadmitted staging ingress fails closed',async()=>{
 const r=await handleIdentityBrowser(new Request('https://axiom-customer-staging.mftintelligence.com/auth/start'),{});
 assert.equal(r.status,503);
});
test('S256 authorization uses only fixed staging destinations and opaque encrypted flow storage',async t=>{
 const f=fixture(t),r=await f.start(),u=f.authorize;
 assert.equal(u.origin,ZITADEL_STAGING.issuer);assert.equal(u.pathname,'/oauth/v2/authorize');
 assert.equal(u.searchParams.get('redirect_uri'),ZITADEL_STAGING.redirect_uri);assert.equal(u.searchParams.get('code_challenge_method'),'S256');
 assert.equal(u.searchParams.get('scope'),'openid email');assert.equal(u.searchParams.has('client_secret'),false);
 assert.match(r.headers.get('set-cookie'),/Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=300/);assert.doesNotMatch(r.headers.get('set-cookie'),/Domain=/i);
 const row=f.db._sqlite.prepare('SELECT * FROM customer_idp_flows_v1').get();assert.equal(row.status,'pending');
 for(const secret of [u.searchParams.get('state'),u.searchParams.get('nonce'),flowCookie(r).split('=')[1]])assert.equal(JSON.stringify(row).includes(secret),false);
 assert.equal(r.headers.get('referrer-policy'),'no-referrer');assert.equal(r.headers.get('cache-control'),'no-store');
});
test('callback exchanges actual synthetic signed tokens, mints one hashed session and consumes flow',async t=>{
 const f=fixture(t),r=await f.login();assert.equal(r.headers.get('location'),origin+'/');assert.ok(sessionCookie(r));
 const row=f.db._sqlite.prepare('SELECT * FROM customer_idp_sessions_v1').get();
 assert.equal(row.session_hash,hash(sessionCookie(r).split('=')[1]));assert.equal(row.subject,subject);assert.equal(row.expires_at_ms,f.time+290000);
 const all=JSON.stringify(row);for(const value of ['synthetic-access','synthetic@example.test',sessionCookie(r).split('=')[1]])assert.equal(all.includes(value),false);
 assert.equal(f.db._sqlite.prepare('SELECT status FROM customer_idp_flows_v1').get().status,'complete');assert.equal(f.requests.length,3);
 for(const c of r.headers.getSetCookie()){assert.match(c,/Secure; HttpOnly; SameSite=Lax/);assert.doesNotMatch(c,/Domain=/i);}
});
test('racing callbacks and replay allow only one provider code exchange',async t=>{
 const f=fixture(t),start=await f.start();const req=f.callback(start);
 const results=await Promise.all([f.browser(req.clone()),f.browser(req.clone()),f.browser(req.clone())]);
 assert.deepEqual(results.map(r=>r.status).sort(),[303,400,400]);assert.equal(f.requests.filter(r=>r.method==='POST').length,1);
 assert.equal((await f.browser(req.clone())).status,400);assert.equal(f.db._sqlite.prepare('SELECT count(*) n FROM customer_idp_sessions_v1').get().n,1);
});
test('wrong browser cannot consume a legitimate pending flow',async t=>{
 const f=fixture(t),start=await f.start(),req=f.callback(start);
 const wrong=new Request(req,{headers:{cookie:'__Host-axiom_login='+'X'.repeat(43)}});
 assert.equal((await f.browser(wrong)).status,400);assert.equal(f.requests.length,0);
 assert.equal(f.db._sqlite.prepare('SELECT status FROM customer_idp_flows_v1').get().status,'pending');assert.equal((await f.browser(req)).status,303);
});
test('provider failure consumes the flow without retry or session',async t=>{
 const f=fixture(t),start=await f.start(),req=f.callback(start);f.status=503;
 assert.equal((await f.browser(req.clone())).status,400);assert.equal((await f.browser(req)).status,400);
 assert.equal(f.requests.length,1);assert.equal(f.db._sqlite.prepare('SELECT status FROM customer_idp_flows_v1').get().status,'failed');
 assert.equal(f.db._sqlite.prepare('SELECT count(*) n FROM customer_idp_sessions_v1').get().n,0);
});
test('signed nonce substitution fails without issuing a session',async t=>{
 const f=fixture(t),start=await f.start();f.patch={nonce:'X'.repeat(43)};
 assert.equal((await f.browser(f.callback(start))).status,400);assert.equal(f.db._sqlite.prepare('SELECT count(*) n FROM customer_idp_sessions_v1').get().n,0);
});
test('callback rejects duplicate parameters, cookies, issuer substitution and malformed code',async t=>{
 for(const [query,duplicateCookie] of [['&state='+ 'X'.repeat(43),false],['&iss=https://attacker.test',false],['&code=x',false],['',true]]){
  const f=fixture(t),start=await f.start(),req=f.callback(start,query);
  if(duplicateCookie)req.headers.set('cookie',flowCookie(start)+'; '+flowCookie(start));
  assert.equal((await f.browser(req)).status,400);assert.equal(f.requests.length,0);
 }
});
test('provider error consumes flow, but never reflects provider text or token',async t=>{
 const f=fixture(t),start=await f.start(),req=f.callback(start,'&error=access_denied&error_description=sensitive-value');
 const r=await f.browser(req);assert.equal(r.status,400);assert.doesNotMatch(await r.text(),/sensitive-value|synthetic-code/);assert.equal(f.requests.length,0);
 assert.equal(f.db._sqlite.prepare('SELECT status FROM customer_idp_flows_v1').get().status,'failed');
});
test('flow expiry before and during provider I/O cannot mint a session',async t=>{
 for(const during of [false,true]){
  const f=fixture(t),start=await f.start();if(during)f.afterToken=()=>{f.time+=TTL;};else f.time+=TTL;
  assert.equal((await f.browser(f.callback(start))).status,400);assert.equal(f.db._sqlite.prepare('SELECT count(*) n FROM customer_idp_sessions_v1').get().n,0);
 }
});
const TTL=300000;
test('wrong custody key prevents exchange and any session',async t=>{
 const f=fixture(t),start=await f.start();f.env.CUSTOMER_IDP_FLOW_KEY=randomBytes(32).toString('base64url');
 assert.equal((await f.browser(f.callback(start))).status,400);assert.equal(f.requests.length,0);
});
test('session mint and flow completion roll back together on storage failure',async t=>{
 const f=fixture(t),start=await f.start();
 f.db._sqlite.exec("CREATE TRIGGER synthetic_abort BEFORE UPDATE OF status ON customer_idp_flows_v1 WHEN NEW.status='complete' BEGIN SELECT RAISE(ABORT,'synthetic_storage_failure'); END;");
 assert.equal((await f.browser(f.callback(start))).status,400);assert.equal(f.db._sqlite.prepare('SELECT count(*) n FROM customer_idp_sessions_v1').get().n,0);
 assert.equal(f.db._sqlite.prepare('SELECT status FROM customer_idp_flows_v1').get().status,'failed');
});
test('private assertion uses durable session and independent canonical mapping; never enrollment or OAuth',async t=>{
 const f=fixture(t),r=await f.login(),cookie=sessionCookie(r);
 assert.equal((await f.proof(cookie)).status,401);f.seed();const proof=await f.proof(cookie);assert.equal(proof.status,200);
 const p=await proof.json();assert.equal(p.tenant_id,'synthetic-tenant');assert.equal(p.challenge,'a'.repeat(64));
 for(const key of ['production_qualified','customer_id','email','roles','access_token','id_token'])assert.equal(key in p,false);
 assert.equal((await f.proof(cookie,{audience:'axiom-chatgpt-oauth'})).status,401);
 assert.equal((await handleIdentityBinding(new Request('https://axiom-internal/identity/enrollment-proof'),f.env)).status,404);
});
test('real caller contract accepts assertion; forwarded production-origin request cannot be admitted as OAuth',async t=>{
 const f=fixture(t);f.time=Date.now();const r=await f.login();f.seed();
 const env={CUSTOMER_IDENTITY_ISSUER:ZITADEL_STAGING.issuer,IDENTITY_VERIFIER_QUALIFIED:'qualified_private_binding',
  IDENTITY_VERIFIER:{fetch:req=>handleIdentityBinding(req,f.env,{clock:()=>f.time})}};
 const principal=await verifyCustomerSession(new Request(origin+'/api/me',{headers:{cookie:sessionCookie(r)}}),env);
 assert.equal(principal.subject,subject);assert.equal(principal.tenant_id,'synthetic-tenant');
 await assert.rejects(verifyCustomerSession(new Request('https://axiom.mftintelligence.com/authorize',{headers:{cookie:sessionCookie(r)}}),env,{audience:'axiom-chatgpt-oauth'}),/authentication_required/);
});
test('canonical link, membership and tenant revocation each deny current sessions',async t=>{
 for(const sql of ["UPDATE canonical_customer_links SET status='revoked'","UPDATE memberships SET status='revoked'","UPDATE tenants SET status='suspended'"]){
  const f=fixture(t),r=await f.login();f.seed();assert.equal((await f.proof(sessionCookie(r))).status,200);f.customers._sqlite.exec(sql);
  assert.equal((await f.proof(sessionCookie(r))).status,401);
 }
});
test('logout requires exact Origin, durably revokes, and is terminal under replay',async t=>{
 const f=fixture(t),r=await f.login();f.seed();const cookie=sessionCookie(r);
 const req=originHeader=>new Request(origin+'/auth/logout',{method:'POST',headers:{cookie,...(originHeader?{origin:originHeader}:{})}});
 for(const o of [undefined,'https://attacker.test'])assert.equal((await f.browser(req(o))).status,400);
 assert.equal((await f.proof(cookie)).status,200);assert.equal((await f.browser(req(origin))).status,303);
 assert.equal((await f.proof(cookie)).status,401);assert.equal((await f.browser(req(origin))).status,303);
 const row=f.db._sqlite.prepare('SELECT * FROM customer_idp_sessions_v1').get();assert.equal(row.status,'revoked');assert.equal(row.session_version,2);
 assert.throws(()=>f.db._sqlite.exec("UPDATE customer_idp_sessions_v1 SET status='active'"),/idp_session_revocation_terminal/);
});
test('successful reauthentication rotates prior session in the mint transaction',async t=>{
 const f=fixture(t),old=await f.login();f.seed();const start=await f.start(),req=f.callback(start);
 req.headers.set('cookie',flowCookie(start)+'; '+sessionCookie(old));const current=await f.browser(req);assert.equal(current.status,303);
 assert.equal((await f.proof(sessionCookie(old))).status,401);assert.equal((await f.proof(sessionCookie(current))).status,200);
});
test('new session and consumed flow survive database close/reopen and a separate connection',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'axiom-idp-session-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const f=fixture(t,{filename:join(directory,'session.sqlite')}),start=await f.start(),req=f.callback(start);const r=await f.browser(req.clone());assert.equal(r.status,303);f.seed();
 f.db.close();f.closed=true;
 const reopened=openTestDB(schema,{filename:join(directory,'session.sqlite'),initialize:false});t.after(()=>reopened.close());
 f.env.IDP_SESSION_DB=reopened;assert.equal((await f.proof(sessionCookie(r))).status,200);assert.equal((await f.browser(req)).status,400);
 assert.equal(reopened._sqlite.prepare('SELECT count(*) n FROM customer_idp_sessions_v1').get().n,1);
});
test('crashed processing flow survives restart and cannot repeat code exchange',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'axiom-idp-crash-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const f=fixture(t,{filename:join(directory,'session.sqlite')}),start=await f.start(),req=f.callback(start);
 f.db._sqlite.prepare("UPDATE customer_idp_flows_v1 SET status='processing',used_at_ms=? WHERE status='pending'").run(f.time);
 f.db.close();f.closed=true;
 const reopened=openTestDB(schema,{filename:join(directory,'session.sqlite'),initialize:false});t.after(()=>reopened.close());f.env.IDP_SESSION_DB=reopened;
 assert.equal((await f.browser(req)).status,400);assert.equal(f.requests.length,0);
 assert.equal(reopened._sqlite.prepare('SELECT status FROM customer_idp_flows_v1').get().status,'processing');
});
test('SQL prevents flow replay, REPLACE, identity edits and evidence deletion',async t=>{
 const f=fixture(t),r=await f.login();f.seed();const db=f.db._sqlite;
 assert.throws(()=>db.exec("UPDATE customer_idp_flows_v1 SET status='pending',used_at_ms=NULL"),/idp_flow_transition_denied/);
 assert.throws(()=>db.exec('DELETE FROM customer_idp_flows_v1'),/idp_flow_delete_denied/);
 assert.throws(()=>db.exec('DELETE FROM customer_idp_sessions_v1'),/idp_session_delete_denied/);
 assert.throws(()=>db.exec("UPDATE customer_idp_sessions_v1 SET subject='attacker'"),/idp_session_immutable/);
 const session=db.prepare('SELECT * FROM customer_idp_sessions_v1').get(),cols=Object.keys(session),values=cols.map(k=>session[k]);
 assert.throws(()=>db.prepare(`INSERT OR REPLACE INTO customer_idp_sessions_v1(${cols.join(',')}) VALUES(${cols.map(()=>'?').join(',')})`).run(...values),/idp_session_replace_denied|idp_flow_not_claimed/);
 assert.equal((await f.proof(sessionCookie(r))).status,200);
});
test('public ingress cannot reach private verification; methods, missing keys and destinations stay closed',async t=>{
 const f=fixture(t);
 for(const url of [origin+'/session/verify','https://attacker.test/auth/start','https://axiom.mftintelligence.com/auth/start'])assert.equal((await f.browser(new Request(url))).status,404);
 assert.equal((await f.browser(new Request(origin+'/auth/start',{method:'POST'}))).status,405);
 assert.equal((await f.browser(new Request(origin+'/auth/start?redirect_uri=https://attacker.test'))).status,400);
 delete f.env.CUSTOMER_IDP_FLOW_KEY;assert.equal((await f.browser(new Request(origin+'/auth/start'))).status,400);assert.equal(f.requests.length,0);
 delete f.env.CUSTOMER_IDP_BINDING_ADMITTED;assert.equal((await f.proof('__Host-axiom_customer='+'X'.repeat(43))).status,503);
});
test('expired session and duplicate credential cannot receive an assertion',async t=>{
 const f=fixture(t),r=await f.login();f.seed();const c=sessionCookie(r);
 assert.equal((await f.proof(c+'; '+c)).status,401);f.time+=TTL;assert.equal((await f.proof(c)).status,401);
});
test('code exchange rejects malformed responses and does not accept secret or redirect overrides',async()=>{
 const calls=[],fetcher=async req=>{calls.push(req);return Response.json({id_token:'synthetic',access_token:'synthetic',token_type:'MAC'});};
 await assert.rejects(exchangeZitadelAuthorizationCode({code:'synthetic-code',code_verifier:'V'.repeat(43),redirect_uri:'https://attacker.test',client_secret:'ignore-me'},{fetcher}),/idp_token_response_invalid/);
 const body=new URLSearchParams(await calls[0].text());assert.equal(body.get('redirect_uri'),ZITADEL_STAGING.redirect_uri);assert.equal(body.has('client_secret'),false);
 await assert.rejects(exchangeZitadelAuthorizationCode({code:'bad&code',code_verifier:'V'.repeat(43)},{fetcher}),/idp_code_invalid/);
 assert.equal(calls.length,1);
});
