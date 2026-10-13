// MUST run within REAL Cloudflare Workers Vitest plugin integration (NOT Node sqlite).
// Requires parent branch with original ops/trackb15_do/ledger_core.mjs unchanged.
import {env,exports} from 'cloudflare:workers';
import {runInDurableObject,evictDurableObject} from 'cloudflare:test';
import {it,expect} from 'vitest';
import {canonicalName,utcDay,routeQuota} from '../src/identity.mjs';
import {TEST_PRIVATE_JWK} from './fixture_key.mjs';
import {WORKLOAD_TEST_PRIVATE_JWK} from './fixture_workload_key.mjs';
const enc = new TextEncoder();
function b64(b){return btoa(String.fromCharCode(...new Uint8Array(b)));}
async function signed(obj){
  const key=await crypto.subtle.importKey('jwk',TEST_PRIVATE_JWK,{name:'Ed25519'},false,['sign']);
  const bytes=enc.encode(JSON.stringify(obj));
  return {payload_b64:b64(bytes),signature_b64:b64(await crypto.subtle.sign('Ed25519',key,bytes))};
}
function makeGrant(day,nonce,limit=500){
  const now=Math.floor(Date.now()/1000);
  return {schema:'musitu.axiom.trackb15.s0.quota-grant.v1',account_id:env.AXIOM_ACCOUNT_ID,
    utc_day:day,tenant_id:'tenant-A',workload_id:'agent-A',grant_id:'grant-'+nonce,
    issued_at:now-5,expires_at:now+120,max_calls:20,max_per_call_neurons:100,
    daily_capacity_neurons:limit,provider_remaining_certified:true,production_authority:false};
}
async function r(signedGrant,id,overrides={}){
  const fields={signed:signedGrant,request_id:id,request_sha:'a'.repeat(64),neurons:100,
    tenant_id:'tenant-A',workload_id:'agent-A',...overrides};
  const grantHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(
    signedGrant.payload_b64+'.'+signedGrant.signature_b64))),x=>x.toString(16).padStart(2,'0')).join('');
  const now=Math.floor(Date.now()/1000);
  const authorizer=await crypto.subtle.importKey('jwk',WORKLOAD_TEST_PRIVATE_JWK,{name:'Ed25519'},false,['sign']);
  const authPayload=enc.encode(JSON.stringify({schema:'axiom.trackb16.s0.workload-auth.v1',
    audience:'axiom.trackb16.s0.reserve',account_id:env.AXIOM_ACCOUNT_ID,utc_day:utcDay(),
    tenant_id:fields.tenant_id,workload_id:fields.workload_id,
    request_id:fields.request_id,request_sha:fields.request_sha,neurons:fields.neurons,
    grant_sha256:grantHash,issued_at:now-3,expires_at:now+60,production_authority:false}));
  const signature=await crypto.subtle.sign('Ed25519',authorizer,authPayload);
  const auth={payload_b64:b64(authPayload),signature_b64:b64(signature)};
  return {...fields,auth};
}
it('REAL Durable Object: canonical route, bounded atomic reservation, eviction, revocation, no public access',async()=>{
  const day=utcDay();const canonical=canonicalName(env.AXIOM_ACCOUNT_ID,day);
  const s1=routeQuota(env),s2=routeQuota(env);
  expect(s1.name).toBe(canonical);
  expect(s2.name).toBe(canonical);
  const other=env.AXIOM_QUOTA_S0.getByName(canonical+':alt');
  const grant=await signed(makeGrant(day,crypto.randomUUID()));
  await expect(other.reserve(await r(grant,'alternate-name'))).rejects.toThrow();
  // 30 separate RPC submissions racing through 2 independent stubs; capacity allows five.
  // Even with a valid B15 quota grant, a missing independent workload signature
  // MUST be denied before any reservations are charged.
  await expect(s1.reserve({signed:grant,request_id:'no-auth',request_sha:'a'.repeat(64),neurons:100,tenant_id:'tenant-A',workload_id:'agent-A'})).rejects.toThrow();
  const results=await Promise.allSettled(Array.from({length:30},(_,i)=>(async()=> (i%2?s1:s2).reserve(await r(grant,'race-'+i)))()));
  const succeeded=results.filter(x=>x.status==='fulfilled'&&x.value.dispatch_allowed);
  expect(succeeded.length).toBe(5);
  await runInDurableObject(s1,async(_instance,state)=>{
    expect(state.storage.sql.exec('SELECT used FROM quota_meta WHERE id=1').one().used).toBe(500);
  });
  const first=succeeded[0].value;
  expect((await s2.reserve(await r(grant,first.request_id))).dispatch_allowed).toBe(false);
  await evictDurableObject(s1);
  const s3=env.AXIOM_QUOTA_S0.getByName(canonical);
  expect((await s3.reserve(await r(grant,first.request_id))).dispatch_allowed).toBe(false);
  const now=Math.floor(Date.now()/1000);
  const notice=await signed({schema:'musitu.axiom.trackb15.s0.revocation.v1',
    account_id:env.AXIOM_ACCOUNT_ID,utc_day:day,issued_at:now-5,expires_at:now+120,
    sequence:1,reason:'test-independent-revocation'});
  expect((await s3.revoke({signed:notice})).status).toBe('REVOKED');
  await expect(s3.reserve(await r(await signed(makeGrant(day,crypto.randomUUID())),'after-revoke'))).rejects.toThrow();
  const publicResponse=await exports.default.fetch('http://example.invalid/');
  expect(publicResponse.status).toBe(503);
});
