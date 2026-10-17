import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import { createMmfStageGate } from '../src/edge/mmf-access-stage-gateway.mjs';
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk=publicKey.export({format:'jwk'});jwk.kid='test-key';
const base='https://mail-stage.mftintelligence.com';
const audience='trusted-access-audience-0123456789';
const email='enrolled-administrator@example.com';
const hash=createHash('sha256').update(email).digest('hex');
const env={MMF_ACCESS_AUD:audience, MMF_APPROVED_ADMIN_SHA256:hash,
 MMF_REAL_SEND_ENABLED:'false',MMF_COMMERCE_ENABLED:'false',MMF_CUSTOMER_API_ENABLED:'false',
 MMF_PINNED_ACCESS_CERTS:{keys:[jwk],validUntil:Date.now()+600000}};
const jwt=(claims={})=>{const n=Math.floor(Date.now()/1000); const header={alg:'RS256',typ:'JWT',kid:jwk.kid};const body={iss:'https://musitu-axiom.cloudflareaccess.com',aud:[audience],email,iat:n,exp:n+600,...claims};const h=Buffer.from(JSON.stringify(header)).toString('base64url');const p=Buffer.from(JSON.stringify(body)).toString('base64url');const sig=sign('RSA-SHA256',Buffer.from(`${h}.${p}`),privateKey).toString('base64url');return `${h}.${p}.${sig}`};
const oldFetch=globalThis.fetch;
const cfFetch=async req=>new Response(JSON.stringify({keys:[jwk]}),{headers:{'content-type':'application/json'}});
const route=(tok,path='/private/gateway')=>new Request(base+path,{headers:tok?{'cf-access-jwt-assertion':tok}:{}});
test('fail closed before app is configured and no customer capability',()=>{
 assert.throws(()=>createMmfStageGate({...env,MMF_REAL_SEND_ENABLED:'true'}));
 assert.throws(()=>createMmfStageGate({...env,MMF_ACCESS_AUD:''}));
});
test('unsigned guest, forged JWT, wrong audience and wrong admin denied',async()=>{
 globalThis.fetch=cfFetch;try{
 const app=createMmfStageGate(env);
 for(const req of [route(),route('a.b.c'),route(jwt({aud:['other']})),route(jwt({email:'attacker@example.com'})),route(jwt({exp:Math.floor(Date.now()/1000)-30}))]){
  const res=await app.fetch(req);assert.equal(res.status,403);assert.equal(res.headers.get('cache-control'),'no-store');
 }
 }finally{globalThis.fetch=oldFetch}
});
test('valid cryptographic Access assertion gives private status only',async()=>{
 globalThis.fetch=cfFetch;try{
 const app=createMmfStageGate(env);const response=await app.fetch(route(jwt()));
 assert.equal(response.status,200);const data=await response.json();
 assert.equal(data.stage,'private-access-verified');assert.equal(data.realSending,false);assert.equal(data.payments,false);assert.equal(data.realOidcLoginVerified,false);
 assert.equal((await app.fetch(route(jwt(),'/'))).status,404);
 assert.equal((await app.fetch(new Request(base+'/private/gateway',{method:'POST',headers:{'cf-access-jwt-assertion':jwt()}}))).status,403);
 }finally{globalThis.fetch=oldFetch}
});
test('signed Access browser cookie authenticates without an assertion header',async()=>{
 globalThis.fetch=cfFetch;try{
  const token=jwt(),app=createMmfStageGate(env);
  const good=await app.fetch(new Request(base+'/private/gateway',{headers:{cookie:'theme=dark; CF_Authorization='+token}}));
  assert.equal(good.status,200);
  const invalid=await app.fetch(new Request(base+'/private/gateway',{headers:{cookie:'CF_Authorization='+token,'cf-access-jwt-assertion':'invalid'}}));
  assert.equal(invalid.status,403);
 }finally{globalThis.fetch=oldFetch}
});
test('corrupted operator-pinned key material never opens private staging',async()=>{
 const app=createMmfStageGate({...env,MMF_PINNED_ACCESS_CERTS:{keys:[{...jwk,n:'abc'}],validUntil:Date.now()+60000}});
 const res=await app.fetch(route(jwt()));
 assert.equal(res.status,403);
 assert.deepEqual(await res.json(),{error:'MMF_PRIVATE_ACCESS_DENIED',supportCode:'SIGNING_KEY'});
});
test('public pins fail closed when validity window exceeds operator maximum',async()=>{
 const app=createMmfStageGate({...env,MMF_PINNED_ACCESS_CERTS:{keys:[jwk],validUntil:Date.now()+16*86400000}});
 const res=await app.fetch(route(jwt()));
 assert.equal(res.status,403);
 assert.deepEqual(await res.json(),{error:'MMF_PRIVATE_ACCESS_DENIED',supportCode:'SIGNING_KEY'});
});
// Cloudflare Access's public cert endpoint can be unreachable from the Worker
// even when it is available from independent operator verification.
test('live pinned verified public keys work without outbound fetch',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async()=>{throw Error('OUTBOUND_DENIED')};
  try{
    const config={...env, MMF_PINNED_ACCESS_CERTS:{keys:[jwk],validUntil:Date.now()+60000}};
    const app=createMmfStageGate(config);
    const res=await app.fetch(route(jwt()));
    assert.equal(res.status,200,'verified JWT should not need runtime network fetch');
    assert.equal((await res.json()).stage,'private-access-verified');
    assert.equal((await app.fetch(route(jwt({email:'other@example.com'})))).status,403);
    assert.equal((await app.fetch(route(jwt({aud:'wrong-aud'})))).status,403);
  } finally {globalThis.fetch=original}
});
test('pinned keys fail closed on stale set, unknown key and absent proof',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async()=>{throw Error('OUTBOUND_DENIED')};
  try{
    for(const pins of [
      {keys:[jwk],validUntil:Date.now()-1000},
      {keys:[],validUntil:Date.now()+60000},
      {keys:[{...jwk,kid:'different'}],validUntil:Date.now()+60000}
    ]){
      const res=await createMmfStageGate({...env,MMF_PINNED_ACCESS_CERTS:pins}).fetch(route(jwt()));
      assert.equal(res.status,403);
    }
    assert.equal((await createMmfStageGate({...env,MMF_PINNED_ACCESS_CERTS:undefined}).fetch(route(jwt()))).status,403);
  } finally {globalThis.fetch=original}
});
test('private dashboard renders a responsive non-commercial operator interface only after signed Access identity', async()=>{
 const app=createMmfStageGate(env);
 const req=token=>new Request(base+'/private/dashboard',{headers:token?{'cf-access-jwt-assertion':token}:{}});
 const resp=await app.fetch(req(jwt()));
 assert.equal(resp.status,200);
 assert.match(resp.headers.get('content-type'),/^text\/html/);
 assert.equal(resp.headers.get('cache-control'),'no-store');
 const csp=resp.headers.get('content-security-policy');
 assert.match(csp,/script-src 'none'/);
 assert.match(csp,/connect-src 'none'/);
 assert.match(csp,/form-action 'none'/);
 const body=await resp.text();
 assert.match(body,/MUSITU Mail Fabric/);
 assert.match(body,/name="viewport"/);
 assert.match(body,/Private operator workspace/);
 assert.match(body,/Access verified/);
 assert.match(body,/Application OIDC/);
 assert.match(body,/callback unverified/);
 assert.match(body,/No domain inventory is exposed here/);
 assert.match(body,/Real outbound sending disabled/);
 assert.match(body,/href="\/private\/gateway"/);
 assert.doesNotMatch(body,/<script\b|<form\b|onclick=|API_KEY|client_secret|@example\.com/i);
 for(const rejected of [req(),req(jwt({email:'attacker@example.com'})),req(jwt({aud:['WRONG']}))]){
  const r=await app.fetch(rejected);assert.equal(r.status,403);
  assert.notEqual(r.headers.get('content-type'),'text/html; charset=utf-8');
 }
 assert.equal((await app.fetch(new Request(base+'/private/dashboard?x=1',{headers:{'cf-access-jwt-assertion':jwt()}}))).status,403);
 assert.equal((await app.fetch(new Request(base+'/private/dashboard',{method:'POST',headers:{'cf-access-jwt-assertion':jwt()}}))).status,403);
});
