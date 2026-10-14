import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign as signRsa,createHmac} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PrivateStageStore} from '../src/private-stage/store.mjs';
import {verifyPinnedOidcJwt} from '../src/security/oidc.mjs';
import {createPrivateAdminServer} from '../src/private-stage/admin-server.mjs';
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const trustedKey={...publicKey.export({format:'jwk'}),kid:'stage-test-key',alg:'RS256',use:'sig'};
const issuer='https://idp.example.invalid/realms/private-test';
const audience='musitu-saas-stage-test';
const now=Math.floor(Date.now()/1000);
function b64(obj){return Buffer.from(JSON.stringify(obj)).toString('base64url');}
function jwt({header={},claims={}}={}){
  const h=b64({typ:'JWT',alg:'RS256',kid:'stage-test-key',...header});
  const p=b64({iss:issuer,aud:audience,sub:'owner-A',iat:now-1,nbf:now-1,exp:now+120,...claims});
  const content=h+'.'+p;const sig=signRsa('RSA-SHA256',Buffer.from(content),privateKey).toString('base64url');
  return content+'.'+sig;
}
const config={issuer,audience,jwks:{keys:[trustedKey]},maxTokenAgeSeconds:600};
function setup(t){const dir=mkdtempSync(join(tmpdir(),'musitu-oidc-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const store=new PrivateStageStore(join(dir,'db.sqlite'),{identityKey:Buffer.alloc(32,77)});t.after(()=>store.close());for(const x of ['A','B'])store.seedTenant({tenantId:'tenant-'+x,legalName:'Tenant '+x,ownerId:'owner-'+x,wabaId:'WABA_'+x,phoneNumberId:'PHONE_'+x});return store;}

test('pinned RS256 OIDC JWT authenticates exact issuer, audience, subject and time',()=>{
 const subject=verifyPinnedOidcJwt(jwt(),config,{now});assert.equal(subject.subject,'owner-A');
 assert.equal(subject.issuer,issuer);
 assert.throws(()=>verifyPinnedOidcJwt(jwt({claims:{aud:'another'}}),config,{now}),/INVALID_AUDIENCE/);
 assert.throws(()=>verifyPinnedOidcJwt(jwt({claims:{iss:'https:\/\/attacker.invalid'}}),config,{now}),/INVALID_ISSUER/);
 assert.throws(()=>verifyPinnedOidcJwt(jwt({claims:{iat:now-120,nbf:now-120,exp:now-1}}),config,{now}),/TOKEN_EXPIRED/);
 assert.throws(()=>verifyPinnedOidcJwt(jwt({claims:{nbf:now+500}}),config,{now}),/TOKEN_NOT_YET_VALID/);
 assert.throws(()=>verifyPinnedOidcJwt(jwt({claims:{iat:now+500,exp:now+800}}),config,{now}),/TOKEN_FROM_FUTURE/);
});

test('rejects alg none, key-switch tricks, malformed JWT, unknown kid and signature changes',()=>{
 assert.throws(()=>verifyPinnedOidcJwt('abc.def.ghi',config,{now}),/INVALID_JWT/);
 assert.throws(()=>verifyPinnedOidcJwt(jwt({header:{alg:'none'}}),config,{now}),/DISALLOWED_JWT_HEADER/);
 assert.throws(()=>verifyPinnedOidcJwt(jwt({header:{jku:'https://evil.example.invalid/jwks'}}),config,{now}),/DISALLOWED_JWT_HEADER/);
 assert.throws(()=>verifyPinnedOidcJwt(jwt({header:{kid:'unknown'}}),config,{now}),/UNKNOWN_SIGNING_KEY/);
 const original=jwt(); const tampered=original.slice(0,-3)+'ABC';
 assert.throws(()=>verifyPinnedOidcJwt(tampered,config,{now}),/INVALID_JWT_SIGNATURE/);
});

test('rejects stale bearer tokens and missing mandatory claims rather than trusting caller headers',()=>{
 assert.throws(()=>verifyPinnedOidcJwt(jwt({claims:{iat:now-2000}}),config,{now}),/TOKEN_TOO_OLD/);
 assert.throws(()=>verifyPinnedOidcJwt(jwt({claims:{sub:''}}),config,{now}),/INVALID_SUBJECT/);
 assert.throws(()=>verifyPinnedOidcJwt(jwt({claims:{exp:undefined}}),config,{now}),/INVALID_TOKEN_TIME/);
});

test('private admin API serves member-scoped metrics only with pinned verified JWT',async t=>{
 const store=setup(t);const server=createPrivateAdminServer({store,identityConfig:config});const addr=await server.start();t.after(()=>server.stop());
 const url=addr+'/v1/tenants/tenant-A/metrics';
 const missing=await fetch(url);assert.equal(missing.status,401);
 const forged=await fetch(url,{headers:{authorization:'Bearer forged-token','x-actor-id':'owner-A'}});assert.equal(forged.status,401);
 const good=await fetch(url,{headers:{authorization:'Bearer '+jwt()}});
 assert.equal(good.status,200);assert.equal((await good.json()).tenantId,'tenant-A');
 assert.equal(good.headers.get('cache-control'),'no-store');
 const other=await fetch(addr+'/v1/tenants/tenant-B/metrics',{headers:{authorization:'Bearer '+jwt()}});
 assert.equal(other.status,403);
 const wrongAudience=await fetch(url,{headers:{authorization:'Bearer '+jwt({claims:{aud:'other-app'}})}});
 assert.equal(wrongAudience.status,401);
});

test('private admin API returns tenant-scoped draft listing, no public enrollment or write routes',async t=>{
 const store=setup(t);const server=createPrivateAdminServer({store,identityConfig:config});const addr=await server.start();t.after(()=>server.stop());
 const authed={authorization:'Bearer '+jwt()};
 const own=await fetch(addr+'/v1/tenants/tenant-A/drafts',{headers:authed});
 assert.equal(own.status,200);assert.deepEqual(await own.json(),{tenantId:'tenant-A',drafts:[]});
 assert.equal((await fetch(addr+'/v1/tenants/tenant-B/drafts',{headers:authed})).status,403);
 assert.equal((await fetch(addr+'/v1/tenants/tenant-A/metrics',{method:'POST',headers:authed})).status,404);
 assert.equal((await fetch(addr+'/v1/signup',{method:'POST',headers:authed})).status,404);
});
