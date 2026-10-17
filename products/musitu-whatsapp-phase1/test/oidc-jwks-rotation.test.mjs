import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createPrivateAdminServer} from '../src/private-stage/admin-server.mjs';

const a=generateKeyPairSync('rsa',{modulusLength:2048});
const b=generateKeyPairSync('rsa',{modulusLength:2048});
const issuer='https://identity.example.invalid/realms/musitu';
const jwksUri=issuer+'/protocol/openid-connect/certs';
const audience='musitu-saas-private';
const keys={kid1:{...a.publicKey.export({format:'jwk'}),alg:'RS256',kid:'kid1',use:'sig'},kid2:{...b.publicKey.export({format:'jwk'}),alg:'RS256',kid:'kid2',use:'sig'}};
const now=()=>Math.floor(Date.now()/1000);
const encode=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
function jwt(kid='kid1',claims={}) {
 const header=encode({typ:'JWT',alg:'RS256',kid});
 const body=encode({iss:issuer,aud:audience,sub:'merchant-admin',iat:now()-1,nbf:now()-1,exp:now()+120,...claims});
 const signed=header+'.'+body;
 return signed+'.'+sign('RSA-SHA256',Buffer.from(signed),kid==='kid2'?b.privateKey:a.privateKey).toString('base64url');
}
function config(fetchImpl,extra={}) {return {issuer,audience,jwksUri,fetchImpl,maxTokenAgeSeconds:300,jwksTtlSeconds:120,...extra};}
const store={
 async snapshot(tenantId,subject){if(tenantId!=='merchant-A'||subject!=='merchant-admin')throw new Error('ACCESS_DENIED');return {tenantId,inquiries:3};},
 async listReplyDrafts(tenantId,subject){if(tenantId!=='merchant-A'||subject!=='merchant-admin')throw new Error('ACCESS_DENIED');return [];}
};
function fetchJwks(source,count) {
 return async(url,options)=>{
  count.calls++;
  assert.equal(url,jwksUri);
  assert.equal(options.method,'GET');assert.equal(options.redirect,'error');
  return new Response(JSON.stringify({keys:source()}),{headers:{'content-type':'application/json'}});
 };
}
test('private API validates live JWKS only from the trusted issuer endpoint and checks tenant membership',async t=>{
 const count={calls:0};const api=createPrivateAdminServer({store,identityConfig:config(fetchJwks(()=>[keys.kid1],count))});
 const base=await api.start();t.after(()=>api.stop());
 assert.equal((await fetch(base+'/v1/tenants/merchant-A/metrics')).status,401);
 const headers={authorization:'Bearer '+jwt()};
 const ok=await fetch(base+'/v1/tenants/merchant-A/metrics',{headers});
 assert.equal(ok.status,200);assert.equal((await ok.json()).inquiries,3);
 assert.equal((await fetch(base+'/v1/tenants/merchant-B/metrics',{headers})).status,403);
 assert.equal(count.calls,1,'JWKS cached for same kid');
 assert.equal((await fetch(base+'/v1/tenants/merchant-A/metrics',{headers:{authorization:'Bearer '+jwt('kid1',{aud:'wrong'})}})).status,401);
 assert.equal(count.calls,1,'invalid audience must not cause refresh');
});
test('unknown key forces one rotation refresh; removed keys are immediately rejected',async t=>{
 let current=[keys.kid1];const count={calls:0};const api=createPrivateAdminServer({store,identityConfig:config(fetchJwks(()=>current,count))});
 const base=await api.start();t.after(()=>api.stop());
 const url=base+'/v1/tenants/merchant-A/metrics';
 const call=token=>fetch(url,{headers:{authorization:'Bearer '+token}});
 assert.equal((await call(jwt('kid1'))).status,200);
 current=[keys.kid2];
 assert.equal((await call(jwt('kid2'))).status,200);
 assert.equal((await call(jwt('kid1'))).status,401);
 assert.equal(count.calls,2,'rotate once; do not hammer remote for removed kid');
});
test('JWKS fetch failures, redirects, malformed responses and oversized documents fail closed',async t=>{
 for(const response of [
  ()=>{throw new Error('network offline');},
  ()=>Response.redirect('https://attacker.invalid/keys'),
  ()=>new Response('not json',{headers:{'content-type':'text/plain'}}),
  ()=>new Response('x'.repeat(70000),{headers:{'content-type':'application/json'}}),
  ()=>new Response(JSON.stringify({keys:[keys.kid1,keys.kid1]}),{headers:{'content-type':'application/json'}})
 ]){
  const api=createPrivateAdminServer({store,identityConfig:config(async()=>response())});const base=await api.start();
  try{assert.equal((await fetch(base+'/v1/tenants/merchant-A/metrics',{headers:{authorization:'Bearer '+jwt()}})).status,401);}
  finally{await api.stop();}
 }
});
test('remote JWKS URL is pinned to the issuer, never caller-selected, and disallows HTTP',()=>{
 for(const url of [
  'http://identity.example.invalid/realms/musitu/protocol/openid-connect/certs',
  'https://evil.invalid/protocol/openid-connect/certs',
  'https://identity.example.invalid/other-tenant/keys',
  'https://identity.example.invalid/realms/musitu@evil.invalid/keys',
  'https://identity.example.invalid/realms/musitu/keys#attack'
 ])assert.throws(()=>createPrivateAdminServer({store,identityConfig:config(async()=>{}, {jwksUri:url})}),/OIDC_TRUST_CONFIGURATION_MISSING|PRIVATE_IDENTITY_CONFIG_REQUIRED/);
});
test('simultaneous valid requests share one JWKS refresh',async t=>{
 let called=0;const api=createPrivateAdminServer({store,identityConfig:config(async()=>{
  called++;await new Promise(r=>setTimeout(r,15));return new Response(JSON.stringify({keys:[keys.kid1]}),{headers:{'content-type':'application/json'}});
 })});const base=await api.start();t.after(()=>api.stop());
 const url=base+'/v1/tenants/merchant-A/metrics';const auth={authorization:'Bearer '+jwt()};
 const statuses=await Promise.all(Array.from({length:7},()=>fetch(url,{headers:auth}).then(r=>r.status)));
 assert.deepEqual(statuses,Array(7).fill(200));assert.equal(called,1);
});
