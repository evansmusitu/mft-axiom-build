import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createOidcJwksVerifier} from '../src/security/oidc-jwks.mjs';
import {createPrivateAdminServer} from '../src/private-stage/admin-server.mjs';
const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const issuer='https://identity.example.invalid/realms/musitu';
const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
function jwt(){const now=Math.floor(Date.now()/1000),h=encode({typ:'JWT',alg:'RS256',kid:'stage-key'}),p=encode({iss:issuer,aud:'stage-v16',sub:'owner-A',iat:now-1,nbf:now-1,exp:now+180});return h+'.'+p+'.'+sign('RSA-SHA256',Buffer.from(h+'.'+p),privateKey).toString('base64url');}
const config=fetchImpl=>({issuer,jwksUri:issuer+'/protocol/openid-connect/certs',audience:'stage-v16',jwksTtlSeconds:60,maxTokenAgeSeconds:300,jwksFetchTimeoutMs:100,fetchImpl});
const deadline=promise=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(Error('JWKS_PROMISE_HUNG')),500))]);

test('OIDC JWKS fetch that ignores AbortSignal cannot hang all authentication indefinitely',async()=>{
 let args;const verifier=createOidcJwksVerifier(config(async(url,options)=>{args=options;return new Promise(()=>{});}));
 await assert.rejects(deadline(verifier.verify(jwt())),/JWKS_FETCH_TIMEOUT/);
 assert.equal(args.signal.aborted,true);
});

test('OIDC JWKS streaming body that ignores cancellation is also time-bounded',async()=>{
 const stream=new ReadableStream({start() { /* deliberate unresponsive stream */ }});
 const verifier=createOidcJwksVerifier(config(async()=>new Response(stream,{status:200,headers:{'content-type':'application/json'}})));
 await assert.rejects(deadline(verifier.verify(jwt())),/JWKS_FETCH_TIMEOUT/);
});

test('out-of-range JWKS timeout options fail closed before any network call',()=>{
 for(const option of [1,0,-1,3001,1.3,NaN])
  assert.throws(()=>createOidcJwksVerifier({...config(async()=>{throw Error('SHOULD_NOT_FETCH')}),jwksFetchTimeoutMs:option}),/OIDC_TRUST_CONFIGURATION_MISSING/);
});

test('private administration endpoint rejects stalled IdP as 401 without waiting indefinitely',async t=>{
 const identityConfig=config(async()=>new Promise(()=>{}));
 const server=createPrivateAdminServer({store:{snapshot(){throw Error('MUST_NOT_REACH_STORE');}},identityConfig});
 const base=await server.start();t.after(()=>server.stop());
 const resp=await deadline(fetch(base+'/v1/tenants/tenant-A/metrics',{headers:{authorization:'Bearer '+jwt()}}));
 assert.equal(resp.status,401);
});
