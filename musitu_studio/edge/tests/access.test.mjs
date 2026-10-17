import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,exportJWK,createLocalJWKSet,SignJWT} from 'jose';
import {validateAccess,validatedAccessSettings,isExplicitLocalTest} from '../src/access.mjs';
import worker from '../src/index.mjs';

const domain='https://studio-safety-test.cloudflareaccess.com';
const aud='a'.repeat(64);
const env={STUDIO_ACCESS_TEAM_DOMAIN:domain,STUDIO_ACCESS_POLICY_AUD:aud};
const makeReq=(url='https://studio.mftintelligence.com/')=>new Request(url);

test('Access not configured returns 403 even for static dashboard',async()=>{
 const e={ASSETS:{fetch:async()=>new Response('secret-dashboard')}};
 const r=await worker.fetch(makeReq(),e);
 assert.equal(r.status,403);
 const data=await r.json();assert.equal(data.error,'ACCESS_DENIED');
});
test('Unsigned and unconfigured Access token is never allowed',async()=>{
 assert.equal(await validateAccess(makeReq(),env),false);
 assert.equal(validatedAccessSettings({STUDIO_ACCESS_TEAM_DOMAIN:'https://evil.test',STUDIO_ACCESS_POLICY_AUD:aud}),null);
 assert.equal(validatedAccessSettings({...env,STUDIO_ACCESS_POLICY_AUD:'abcd'}),null);
});
test('Loopback bypass requires explicitly enabled local HTTP only',async()=>{
 const local={...env,STUDIO_LOCAL_TEST_ONLY:'true'};
 assert.equal(isExplicitLocalTest(makeReq('http://127.0.0.1:8787/'),local),true);
 assert.equal(isExplicitLocalTest(makeReq('http://localhost:8787/'),local),true);
 assert.equal(isExplicitLocalTest(makeReq('https://127.0.0.1:8787/'),local),false);
 assert.equal(isExplicitLocalTest(makeReq('http://127.0.0.2:8787/'),local),false);
 assert.equal(isExplicitLocalTest(makeReq('https://studio.mftintelligence.com/'),local),false);
 assert.equal(isExplicitLocalTest(makeReq('http://127.0.0.1:8787/'),env),false);
});
test('Cloudflare Access signed RS256 JWT requires matching issuer, AUD and subject',async()=>{
 const {publicKey,privateKey}=await generateKeyPair('RS256');
 const jwk=await exportJWK(publicKey);jwk.kid='kid-1';jwk.alg='RS256';jwk.use='sig';
 const keys=createLocalJWKSet({keys:[jwk]});
 const signed=async ({issuer=domain,audience=aud,subject='owner-1',expires='10m',type='app'}={})=>
   await new SignJWT({type,sub:subject})
     .setProtectedHeader({alg:'RS256',kid:'kid-1'})
     .setIssuer(issuer).setAudience(audience).setIssuedAt()
     .setExpirationTime(expires).sign(privateKey);
 const evaluate=async options=>{
   const token=await signed(options);
   const req=new Request('https://studio.mftintelligence.com/',{headers:{'cf-access-jwt-assertion':token}});
   return validateAccess(req,env,{keySet:keys});
 };
 assert.equal(await evaluate(),true);
 assert.equal(await evaluate({issuer:'https://wrong.cloudflareaccess.com'}),false);
 assert.equal(await evaluate({audience:'b'.repeat(64)}),false);
 assert.equal(await evaluate({subject:''}),false);
 assert.equal(await evaluate({type:'org'}),false);
 assert.equal(await evaluate({expires:'-1h'}),false);
});
test('Remote HTTP or invalid team domain does not permit local bypass',async()=>{
 const e={...env,STUDIO_LOCAL_TEST_ONLY:'true'};
 assert.equal(await validateAccess(makeReq('http://studio.mftintelligence.com/'),e),false);
});
