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