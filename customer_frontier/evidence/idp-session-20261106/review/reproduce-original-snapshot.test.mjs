// Synthetic provider + real local SQLite only; not hosted acceptance.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto,createHash,randomBytes} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {handleIdentityBrowser,handleIdentityBinding} from '/workspace/scratch/cf664c251767/session-review/original-source/customer_frontier/customer_control_plane/zitadel_session_broker_candidate.mjs';
import {exchangeZitadelAuthorizationCode,ZITADEL_STAGING} from '/workspace/scratch/cf664c251767/session-review/original-source/customer_frontier/customer_control_plane/zitadel_provider_tokens_candidate.mjs';
import {openTestDB} from '/workspace/scratch/cf664c251767/session-review/original-source/customer_frontier/customer_control_plane/sqlite_d1_test_adapter.mjs';
import {seedCanonicalFixture} from '/workspace/scratch/cf664c251767/session-review/original-source/customer_frontier/tests/identity_fixture.mjs';
import {verifyCustomerSession} from '/workspace/scratch/cf664c251767/session-review/original-source/customer_frontier/customer_control_plane/identity_session.mjs';
const origin=new URL(ZITADEL_STAGING.redirect_uri).origin,subject='synthetic-browser-subject';
const schema=new URL('/workspace/scratch/cf664c251767/session-review/original-source/customer_frontier/customer_control_plane/zitadel_session_broker_candidate.sql',import.meta.url);
const customerSchema=new URL('/workspace/scratch/cf664c251767/session-review/original-source/customer_frontier/customer_control_plane/schema.sql',import.meta.url);
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


const TTL=300000;
test('review: session expires while final active SELECT is awaiting',async t=>{
 const f=fixture(t),r=await f.login();f.seed();
 let reads=0;
 f.env.IDP_SESSION_DB={batch:f.db.batch,prepare(sql){
  const statement=f.db.prepare(sql);
  if(!sql.startsWith('SELECT s.*'))return statement;
  const original=statement.first;
  statement.first=async()=>{const value=await original();if(++reads===2)f.time+=TTL;return value;};return statement;
 }};
 const result=await f.proof(sessionCookie(r));const proof=result.status===200?await result.json():null;
 console.log(JSON.stringify({case:'expiry-after-final-active-select',status:result.status,expiredAtReturn:!!proof&&proof.expires_at_ms<=f.time,verifiedAtReturn:proof?.verified_at_ms,actualReturnTime:f.time}));
 assert.equal(result.status,200);assert.ok(proof.expires_at_ms<=f.time);
});

test('review: D1 sequential replica may miss completed concurrent revocation',async t=>{
 const f=fixture(t),r=await f.login();f.seed();
 let sessionReads=0,sessionStarts=0;
 f.env.IDP_SESSION_DB={prepare:f.db.prepare,batch:f.db.batch,withSession(mode){
  assert.equal(mode,'first-primary');sessionStarts++;let firstRow;
  return {batch:f.db.batch,prepare(sql){
   const statement=f.db.prepare(sql);if(!sql.startsWith('SELECT s.*'))return statement;
   const original=statement.first;
   statement.first=async()=>{sessionReads++;if(firstRow)return {...firstRow};firstRow=await original();return firstRow;};return statement;
  }};
 }};
 f.env.CUSTOMER_DB={prepare(sql){const statement=f.customers.prepare(sql),original=statement.all;
  if(sql.includes('canonical_customer_links'))statement.all=async()=>{
   f.db._sqlite.exec("UPDATE customer_idp_sessions_v1 SET status='revoked',session_version=session_version+1 WHERE status='active'");
   return original();
  };return statement;
 }};
 const result=await f.proof(sessionCookie(r)),proof=result.status===200?await result.json():null;
 const durable=f.db._sqlite.prepare('SELECT status,session_version FROM customer_idp_sessions_v1').get();
 console.log(JSON.stringify({case:'revocation-missed-by-sequential-replica',status:result.status,sessionStarts,sessionReads,durable,assertedRevoked:proof?.revoked,assertedVersion:proof?.session_version}));
 assert.equal(result.status,200);assert.equal(durable.status,'revoked');assert.equal(proof.revoked,false);
});

test('review: callback storage delay can expose an already expired session cookie',async t=>{
 const f=fixture(t),start=await f.start();
 f.env.IDP_SESSION_DB={prepare:f.db.prepare,batch:async statements=>{const result=await f.db.batch(statements);f.time+=300000;return result;}};
 const result=await f.browser(f.callback(start)),c=sessionCookie(result);
 const stored=f.db._sqlite.prepare('SELECT * FROM customer_idp_sessions_v1').get();
 console.log(JSON.stringify({case:'expiry-during-mint-batch',status:result.status,cookieIssued:!!c,expiredAtReturn:stored.expires_at_ms<=f.time,durableStatus:stored.status}));
 assert.equal(result.status,303);assert.ok(c);assert.ok(stored.expires_at_ms<=f.time);assert.equal(stored.status,'active');
});
