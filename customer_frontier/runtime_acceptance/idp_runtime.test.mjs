// Local workerd/D1 ONLY. Synthetic IdP/ownership fixtures; never hosted acceptance.
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {MockAgent,setGlobalDispatcher} from 'undici';
import {fileURLToPath} from 'node:url';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,webcrypto,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {ZITADEL_STAGING} from '../customer_control_plane/zitadel_provider_tokens_candidate.mjs';
import {EXPECTED_PLANS} from '../customer_control_plane/live_billing_truth.mjs';
const origin=new URL(ZITADEL_STAGING.redirect_uri).origin;
// Node-side test clients must never follow redirects onto the real provider.
// All runtime outbound fetches separately use the synthetic-only service below.
const network=new MockAgent();network.disableNetConnect();
network.enableNetConnect(/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/);
setGlobalDispatcher(network);
after(()=>network.close());
const source=p=>fileURLToPath(new URL('../customer_control_plane/'+p,import.meta.url));
const keys=await webcrypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const jwk={...await webcrypto.subtle.exportKey('jwk',keys.publicKey),kid:'local-workerd-synthetic-key',use:'sig',alg:'RS256'};
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
const subject='synthetic-workerd-person',tenant='synthetic-workerd-tenant',identity='synthetic-workerd-identity';
const cookie=(r,name)=>r.headers.getSetCookie().find(c=>c.startsWith(name+'='))?.split(';')[0];
function statements(path){
 // SQLite's own completeness parser preserves trigger bodies. Never split SQL
 // by semicolons or rewrite the reviewed schema for the test runtime.
 return JSON.parse(execFileSync('python3',['-c',`import sqlite3,json,sys
parts=[];part=''
for line in open(sys.argv[1]):
 part+=line
 if sqlite3.complete_statement(part):parts.append(part);part=''
assert not part.strip(), 'incomplete SQL'
print(json.dumps(parts))`,path],{encoding:'utf8'}));
}
async function install(db,path){const sql=statements(path);await db.batch(sql.map(s=>db.prepare(s)));}
async function runtime(t){
 const persist=mkdtempSync(join(tmpdir(),'axiom-workerd-idp-'));
 const f={persist,flowKey:randomBytes(32).toString('base64url'),authorize:null,exchanges:0,requests:[],providerFailure:false,providerRedirect:false,serviceRedirect:false,privateCalls:[]};
 f.outbound=async req=>{
  f.requests.push({method:req.method,url:req.url});
  if(req.url===ZITADEL_STAGING.issuer+'/oauth/v2/token'){
   f.exchanges++;
   if(f.providerRedirect)return new Response(null,{status:302,headers:{location:'https://forbidden.invalid/redirect'}});
   if(f.providerFailure)return Response.json({error:'temporarily_unavailable'},{status:503});
   const form=new URLSearchParams(await req.text());
   assert.equal(req.method,'POST');assert.equal(form.get('grant_type'),'authorization_code');
   assert.equal(form.get('client_id'),ZITADEL_STAGING.client_id);assert.equal(form.get('redirect_uri'),ZITADEL_STAGING.redirect_uri);
   assert.equal(form.has('client_secret'),false);assert.equal(form.get('code'),'synthetic-code');
   assert.equal(createHash('sha256').update(form.get('code_verifier')).digest('base64url'),f.authorize.searchParams.get('code_challenge'));
   const now=Math.floor(Date.now()/1000),body={iss:ZITADEL_STAGING.issuer,sub:subject,aud:ZITADEL_STAGING.client_id,
    nonce:f.authorize.searchParams.get('nonce'),iat:now,exp:now+3600,auth_time:now-10,amr:['pwd','mfa']};
   const input=b64({alg:'RS256',kid:jwk.kid})+'.'+b64(body),sig=await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,Buffer.from(input));
   return Response.json({id_token:input+'.'+Buffer.from(sig).toString('base64url'),access_token:'local-synthetic-access',token_type:'Bearer'});
  }
  if(req.url===ZITADEL_STAGING.jwks_uri)return Response.json({keys:[jwk]});
  if(req.url===ZITADEL_STAGING.userinfo_endpoint)return Response.json({sub:subject,email:'synthetic@offline.test',email_verified:true});
  throw Error('external_egress_not_admitted');
 };
 const privateService=async req=>{
  // Redirect mode is caller-side metadata, not an HTTP field preserved at the
  // Node service fixture. Negative tests assert no redirect destination is used.
  f.privateCalls.push({url:req.url,method:req.method});
  if(f.serviceRedirect)return new Response(null,{status:302,headers:{location:'https://forbidden.invalid/redirect'}});
  if(req.url==='https://axiom-internal/identity/start-login'){
   const u=new URL('https://auth.mftintelligence.com/oauth/authorize');
   u.search=new URLSearchParams({client_id:'synthetic-client-id',redirect_uri:origin+'/oauth/callback',response_type:'code',state:'S'.repeat(43),nonce:'N'.repeat(43),code_challenge:'C'.repeat(43),code_challenge_method:'S256',scope:'openid email'});
   return Response.json({authorization_url:u.href});
  }
  if(req.url.endsWith('/billing/healthz'))return Response.json({ok:true,service:'MUSITU Axiom Billing Ingress',provider:'paynow',d1:true,catalog_configured:true,authority_reachable:true,transport_bound:true,live_money_certified:false});
  if(req.url.endsWith('/billing/catalog'))return Response.json({ok:true,currency:'USD',billing_period:'30_days',live_money_certified:false,plans:EXPECTED_PLANS});
  if(req.url==='https://axiom-internal/payments/create')return Response.json({checkout_url:'https://payments.mftintelligence.com/local-synthetic-checkout'},{status:201});
  if(req.url==='https://axiom-internal/verify-settlement')return Response.json({verified:true,production_qualified:true,source:'provider_verifier',evidence:{synthetic:true,live_payment:false}});
  throw Error('unadmitted_private_fixture_path');
 };
 f.boot=async()=>{
  f.mf=new Miniflare({cf:false,host:'127.0.0.1',d1Persist:persist,workers:[
   {name:'identity',modules:true,modulesRoot:source('.'),scriptPath:source('zitadel_session_worker_candidate.mjs'),compatibilityDate:'2026-07-01',
    d1Databases:{IDP_SESSION_DB:'local-only-idp-sessions',CUSTOMER_DB:'local-only-customers'},
    bindings:{CUSTOMER_IDP_STAGING_ADMITTED:'qualified_staging',CUSTOMER_IDP_BINDING_ADMITTED:'qualified_private_binding',CUSTOMER_IDP_FLOW_KEY:f.flowKey},
    outboundService:f.outbound},
   {name:'customer',modules:true,modulesRoot:source('.'),scriptPath:source('worker.mjs'),compatibilityDate:'2026-07-01',
    d1Databases:{CUSTOMER_DB:'local-only-customers'},
    bindings:{CUSTOMER_IDENTITY_ISSUER:ZITADEL_STAGING.issuer,IDENTITY_VERIFIER_QUALIFIED:'qualified_private_binding',PAYMENT_CHECKOUT_QUALIFIED:'true'},
    serviceBindings:{IDENTITY_VERIFIER:{name:'identity',entrypoint:'CustomerIdentityService'},CHECKOUT_SERVICE:privateService},outboundService:()=>{throw Error('external_egress_not_admitted');}},
   {name:'transports',modules:true,modulesRoot:fileURLToPath(new URL('..',import.meta.url)),scriptPath:fileURLToPath(new URL('fixtures/server_transports.mjs',import.meta.url)),compatibilityDate:'2026-07-01',
    bindings:{CUSTOMER_OAUTH_CLIENT_ID:'synthetic-client-id',CUSTOMER_LOGIN_REDIRECT_URI:origin+'/oauth/callback',IDENTITY_LOGIN_QUALIFIED:'qualified_private_binding',READONLY_BILLING_BRIDGE:'qualified_readonly',ALLOW_INTERNAL_RECONCILIATION:'qualified_private_binding'},
    serviceBindings:{IDENTITY_LOGIN_SERVICE:privateService,LIVE_AXIOM_BILLING:privateService,PROVIDER_VERIFIER:privateService},outboundService:()=>{throw Error('external_egress_not_admitted');}},
   {name:'test-ingress',modules:true,scriptPath:fileURLToPath(new URL('fixtures/local_ingress.mjs',import.meta.url)),modulesRoot:fileURLToPath(new URL('..',import.meta.url)),compatibilityDate:'2026-07-01',
    serviceBindings:{IDP:'identity',CUSTOMER:'customer',TRANSPORTS:'transports'},outboundService:()=>{throw Error('external_egress_not_admitted');}}
  ]});
  await f.mf.ready;const ingress=await f.mf.getWorker('test-ingress');
  const client=target=>({fetch:(url,options={})=>{
   const headers=new Headers(options.headers);headers.set('x-local-test-target',target);
   if(headers.has('origin')){headers.set('x-local-test-origin',headers.get('origin'));headers.delete('origin');}
   return ingress.fetch(url,{...options,headers,redirect:'manual'});
  }});
  f.browser=client('identity');f.api=client('customer');f.transports=client('transports');
  f.db=await f.mf.getD1Database('IDP_SESSION_DB','identity');f.customers=await f.mf.getD1Database('CUSTOMER_DB','customer');
 };
 t.after(async()=>{await f.mf?.dispose();rmSync(persist,{recursive:true,force:true});});
 await f.boot();
 f.install=async()=>{await install(f.db,source('zitadel_session_broker_candidate.sql'));await install(f.customers,source('schema.sql'));};
 f.start=async()=>{const r=await f.browser.fetch(origin+'/auth/start');assert.equal(r.status,303);f.authorize=new URL(r.headers.get('location'));return r;};
 f.callback=start=>({url:ZITADEL_STAGING.redirect_uri+'?state='+f.authorize.searchParams.get('state')+'&code=synthetic-code',headers:{cookie:cookie(start,'__Host-axiom_login')}});
 f.login=async()=>{const start=await f.start(),req=f.callback(start),r=await f.browser.fetch(req.url,{headers:req.headers});
  assert.equal(r.status,303,JSON.stringify({requests:f.requests,flows:(await f.db.prepare('SELECT status FROM customer_idp_flows_v1').all()).results,
   sessions:(await f.db.prepare('SELECT status FROM customer_idp_sessions_v1').all()).results}));return r;};
 f.seed=async()=>{await f.customers.batch([
  f.customers.prepare('INSERT INTO tenants(id,name) VALUES(?,?)').bind(tenant,'Local runtime synthetic tenant'),
  f.customers.prepare('INSERT INTO identities(id,issuer,external_sub) VALUES(?,?,?)').bind(identity,ZITADEL_STAGING.issuer,subject),
  f.customers.prepare("INSERT INTO memberships(tenant_id,identity_id,role) VALUES(?,?,'viewer')").bind(tenant,identity),
  f.customers.prepare("INSERT INTO canonical_customer_links(identity_id,tenant_id,customer_id,link_kind,proof_id,proof_sha256,consent_id,authority_subject) VALUES(?,?,?,'legacy',?,?,?,?)")
   .bind(identity,tenant,'11111111-1111-4111-8111-111111111111','local-synthetic-proof','a'.repeat(64),'local-synthetic-consent','local-synthetic-authority')
 ]);};
 f.me=c=>f.api.fetch(origin+'/v1/customer/me',{headers:{cookie:c}});
 return f;
}

test('actual WorkerEntrypoint wrapper starts with isolated D1 and refuses public private paths',{timeout:30000},async t=>{
 const f=await runtime(t);
 const response=await f.browser.fetch(origin+'/session/verify',{method:'POST'});
 assert.equal(response.status,404);assert.equal(f.requests.length,0);
});
test('server login and Paynow catalog read work, but synthetic PSP settlement is denied',{timeout:30000},async t=>{
 const f=await runtime(t);
 const login=await f.transports.fetch(origin+'/login');assert.equal(login.status,200,await login.clone().text());
 assert.equal(new URL((await login.json()).authorization_url).origin,'https://auth.mftintelligence.com');
 const billing=await f.transports.fetch(origin+'/billing');assert.equal(billing.status,200,await billing.clone().text());
 assert.equal((await billing.json()).real_settlement_verified,false);
 const verified=await f.transports.fetch(origin+'/reconcile',{method:'POST',body:'{}'});assert.equal(verified.status,503,await verified.clone().text());
 assert.equal((await verified.json()).error,'provider_test_mode_denied');assert.equal(f.requests.length,0);
});
test('test process denies external network even if a client accidentally follows a redirect',async()=>{
 await assert.rejects(fetch(ZITADEL_STAGING.issuer+'/'),/fetch failed/);
});
test('unmodified schemas, real D1 claim RETURNING, RSA callback and named binding reach customer API',{timeout:30000},async t=>{
 const f=await runtime(t);await f.install();const r=await f.login(),c=cookie(r,'__Host-axiom_customer');assert.ok(c);
 const missing=await f.me(c);assert.equal(missing.status,401,await missing.text());await f.seed();const me=await f.me(c);assert.equal(me.status,200,await me.clone().text());
 const p=await me.json();assert.equal(p.identity_id,identity);assert.equal(p.tenant_id,tenant);assert.equal(p.role,'viewer');
 assert.equal(p.payment_live,false);assert.equal(f.exchanges,1);
 assert.equal((await f.db.prepare('SELECT status FROM customer_idp_flows_v1').first()).status,'complete');
 const session=await f.db.prepare('SELECT * FROM customer_idp_sessions_v1').first();
 assert.equal(session.session_hash,createHash('sha256').update(c.split('=')[1]).digest('hex'));
 assert.equal(JSON.stringify(session).includes('local-synthetic-access'),false);
});
test('real D1 racing callbacks have one winner and one provider exchange',{timeout:30000},async t=>{
 const f=await runtime(t);await f.install();const start=await f.start(),req=f.callback(start);
 const r=await Promise.all(Array.from({length:3},()=>f.browser.fetch(req.url,{headers:req.headers})));
 assert.deepEqual(r.map(x=>x.status).sort(),[303,400,400]);assert.equal(f.exchanges,1);
 assert.equal((await f.db.prepare('SELECT count(*) n FROM customer_idp_sessions_v1').first()).n,1);
});
test('wrong browser and provider redirect are denied without redeeming a flow twice',{timeout:30000},async t=>{
 const f=await runtime(t);await f.install();const start=await f.start(),req=f.callback(start);
 assert.equal((await f.browser.fetch(req.url,{headers:{cookie:'__Host-axiom_login='+'X'.repeat(43)}})).status,400);assert.equal(f.requests.length,0);
 assert.equal((await f.db.prepare('SELECT status FROM customer_idp_flows_v1').first()).status,'pending');
 f.providerRedirect=true;assert.equal((await f.browser.fetch(req.url,{headers:req.headers})).status,400);
 assert.equal(f.exchanges,1);assert.equal((await f.browser.fetch(req.url,{headers:req.headers})).status,400);assert.equal(f.exchanges,1);
 assert.equal(f.requests.some(r=>r.url.includes('forbidden.invalid')),false);
 assert.equal((await f.db.prepare('SELECT count(*) n FROM customer_idp_sessions_v1').first()).n,0);
});
test('D1 batch failure rolls back session mint and prior-session rotation together',{timeout:30000},async t=>{
 const f=await runtime(t);await f.install();const previous=await f.login();await f.seed();const c=cookie(previous,'__Host-axiom_customer');
 const start=await f.start(),req=f.callback(start);req.headers.cookie+='; '+c;
 await f.db.prepare("CREATE TRIGGER synthetic_failure BEFORE UPDATE OF status ON customer_idp_flows_v1 WHEN NEW.status='complete' BEGIN SELECT RAISE(ABORT,'synthetic_failure'); END").run();
 const r=await f.browser.fetch(req.url,{headers:req.headers});assert.equal(r.status,400);
 assert.equal((await f.me(c)).status,200);assert.equal((await f.db.prepare('SELECT count(*) n FROM customer_idp_sessions_v1').first()).n,1);
 assert.equal((await f.db.prepare("SELECT count(*) n FROM customer_idp_flows_v1 WHERE status='failed'").first()).n,1);
});
test('persisted D1 session and replay denial survive complete workerd restart',{timeout:30000},async t=>{
 const f=await runtime(t);await f.install();const start=await f.start(),req=f.callback(start),r=await f.browser.fetch(req.url,{headers:req.headers});assert.equal(r.status,303);await f.seed();
 const c=cookie(r,'__Host-axiom_customer');assert.equal((await f.me(c)).status,200);
 await f.mf.dispose();await f.boot();assert.equal((await f.me(c)).status,200);
 assert.equal((await f.browser.fetch(req.url,{headers:req.headers})).status,400);assert.equal(f.exchanges,1);
});
test('local logout is terminal across workerd restart and private binding reads',{timeout:30000},async t=>{
 const f=await runtime(t);await f.install();const r=await f.login();await f.seed();const c=cookie(r,'__Host-axiom_customer');
 assert.equal((await f.browser.fetch(origin+'/auth/logout',{method:'POST',headers:{cookie:c,origin:'https://foreign.invalid'}})).status,400);
 assert.equal((await f.me(c)).status,200);
 assert.equal((await f.browser.fetch(origin+'/auth/logout',{method:'POST',headers:{cookie:c,origin}})).status,303);
 assert.equal((await f.me(c)).status,401);await f.mf.dispose();await f.boot();assert.equal((await f.me(c)).status,401);
 await assert.rejects(f.db.prepare("UPDATE customer_idp_sessions_v1 SET status='active'").run(),/idp_session_revocation_terminal/);
});
test('canonical revocation and cross-tenant requests cannot use an otherwise active session',{timeout:30000},async t=>{
 const f=await runtime(t);await f.install();const r=await f.login();await f.seed();const c=cookie(r,'__Host-axiom_customer');
 await f.customers.batch([
  f.customers.prepare("INSERT INTO tenants(id,name) VALUES('other-tenant','Other')"),
  f.customers.prepare("INSERT INTO identities(id,issuer,external_sub) VALUES('other-identity','https://synthetic.invalid','other')"),
  f.customers.prepare("INSERT INTO memberships(tenant_id,identity_id,role) VALUES('other-tenant','other-identity','owner')"),
  f.customers.prepare("INSERT INTO projects(id,tenant_id,name,objective,created_by) VALUES('other-project','other-tenant','Other','Private','other-identity')")
 ]);
 const projects=await f.api.fetch(origin+'/v1/customer/projects?tenant_id=other-tenant',{headers:{cookie:c}});assert.equal(projects.status,200);assert.deepEqual((await projects.json()).projects,[]);
 assert.equal((await f.api.fetch(origin+'/v1/customer/work?project=other-project',{headers:{cookie:c}})).status,404);
 await f.customers.prepare("UPDATE canonical_customer_links SET status='revoked' WHERE identity_id=?").bind(identity).run();
 assert.equal((await f.me(c)).status,401);
});
test('private verifier rejects production OAuth audience and public headers cannot create a private route',{timeout:30000},async t=>{
 const f=await runtime(t);await f.install();const r=await f.login();await f.seed();const c=cookie(r,'__Host-axiom_customer');
 const binding=(await f.mf.getBindings('customer')).IDENTITY_VERIFIER;
 const req={method:'POST',headers:{cookie:c,'content-type':'application/json','x-axiom-audience':'axiom-chatgpt-oauth'},
  body:JSON.stringify({audience:'axiom-chatgpt-oauth',purpose:'customer-session',challenge:'a'.repeat(64),request_sha256:'b'.repeat(64)}),redirect:'manual'};
 assert.equal((await binding.fetch('https://axiom-internal/session/verify',req)).status,401);
 assert.equal((await f.browser.fetch(origin+'/session/verify',req)).status,404);
});
test('all server private transports reject redirect responses before parsing or forwarding',{timeout:30000},async t=>{
 const f=await runtime(t);f.serviceRedirect=true;
 for(const path of ['/login','/billing','/reconcile']){
  const r=await f.transports.fetch(origin+path,{method:path==='/reconcile'?'POST':'GET',...(path==='/reconcile'?{body:'{}'}:{})});
  assert.equal(r.status,503);assert.equal(f.privateCalls.some(c=>c.url.includes('forbidden.invalid')),false);
 }
 assert.equal(f.requests.length,0);
});
test('checkout transport only returns an authorized fixture destination and never settles synthetic orders',{timeout:30000},async t=>{
 const f=await runtime(t);await f.install();const r=await f.login();await f.seed();const c=cookie(r,'__Host-axiom_customer');
 await f.customers.prepare("UPDATE memberships SET role='owner' WHERE identity_id=?").bind(identity).run();
 await f.customers.prepare("INSERT INTO price_catalog(id,name,currency,amount_minor,grant_units,enabled) VALUES('fixture-price','Fixture','USD',1900,1000,1)").run();
 const request=key=>({method:'POST',headers:{cookie:c,origin,'x-axiom-intent':'customer-action','idempotency-key':key,'content-type':'application/json'},body:JSON.stringify({price_id:'fixture-price'})});
 const accepted=await f.api.fetch(origin+'/v1/customer/orders',request('fixture-order-one'));assert.equal(accepted.status,202,await accepted.clone().text());
 assert.equal((await accepted.json()).checkout.url,'https://payments.mftintelligence.com/local-synthetic-checkout');
 f.serviceRedirect=true;assert.equal((await f.api.fetch(origin+'/v1/customer/orders',request('fixture-order-two'))).status,503);
 assert.equal((await f.customers.prepare('SELECT count(*) n FROM credit_ledger').first()).n,0);
 assert.equal((await f.customers.prepare('SELECT count(*) n FROM provider_events').first()).n,0);
 assert.equal((await f.customers.prepare("SELECT count(*) n FROM orders WHERE state='settled'").first()).n,0);
});
