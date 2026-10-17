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
 MMF_REAL_SEND_ENABLED:'false',MMF_COMMERCE_ENABLED:'false',MMF_CUSTOMER_API_ENABLED:'false'};
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
test('browser receives a signed CF_Authorization cookie but no forwarded assertion',async()=>{
 globalThis.fetch=cfFetch;try{
  const app=createMmfStageGate(env),token=jwt();
  const cookieRequest=new Request(base+'/private/gateway',{headers:{cookie:'foo=bar; CF_Authorization='+token+'; theme=dark'}});
  const ok=await app.fetch(cookieRequest);assert.equal(ok.status,200);
  assert.equal((await ok.json()).stage,'private-access-verified');
  for(const bad of [
    {cookie:'CF_Authorization='+jwt({aud:['wrong']})},
    {cookie:'CF_Authorization='+jwt({email:'attacker@example.com'})},
    {cookie:'CF_Authorization='+token+'; CF_Authorization='+token},
    {cookie:'CF_Authorization='+token+'.bad'},
    {cookie:'CF_Authorization='+token+'; junk='+('a'.repeat(8200))}
  ]){assert.equal((await app.fetch(new Request(base+'/private/gateway',{headers:bad}))).status,403);}
  assert.equal((await app.fetch(new Request(base+'/private/gateway',{headers:{cookie:'CF_Authorization='+token,'cf-access-jwt-assertion':'invalid'}}))).status,403);
  assert.equal((await app.fetch(new Request(base+'/private/gateway',{headers:{cookie:'CF_Authorization='+jwt({email:'wrong@example.com'}),'cf-access-jwt-assertion':token}}))).status,200);
  assert.equal((await app.fetch(new Request(base+'/private/gateway',{headers:{cookie:'CF_Authorization='+token,'cf-access-jwt-assertion':''}}))).status,403);
 }finally{globalThis.fetch=oldFetch}
});

test('private staging provides only bounded non-identifying support codes when denied',async()=>{
 globalThis.fetch=cfFetch;try{
  const app=createMmfStageGate(env);
  const cases=[
   [route(), 'TOKEN_NOT_PRESENT'],
   [route('a.b.c'), 'TOKEN_FORMAT'],
   [route(jwt({email:'attacker@example.com'})), 'ADMIN_IDENTITY'],
   [route(jwt({aud:['wrong']})), 'CLAIMS'],
   [new Request(base+'/private/gateway',{method:'POST',headers:{'cf-access-jwt-assertion':jwt()}}),'REQUEST_CONTEXT'],
  ];
  for(const [req,expected] of cases){
    const res=await app.fetch(req);assert.equal(res.status,403);
    const obj=await res.json();assert.deepEqual(Object.keys(obj).sort(),['error','supportCode']);
    assert.equal(obj.error,'MMF_PRIVATE_ACCESS_DENIED');assert.equal(obj.supportCode,expected);
    assert.doesNotMatch(JSON.stringify(obj),/enrolled-administrator|attacker|trusted-access-audience|eyJ/i);
  }
 }finally{globalThis.fetch=oldFetch}
});