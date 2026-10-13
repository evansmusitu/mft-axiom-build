/** B18 S0: real Workerd Durable Object, fake provider transport, zero live calls.
 * B16 and B17 source are inherited unchanged from the verified B17 parent.
 */
import {env,exports} from 'cloudflare:workers';
import {it,expect} from 'vitest';
import {runInDurableObject,evictDurableObject} from 'cloudflare:test';
import {guardedDispatch,digestPayload} from '../../trackb17/dispatch_guard.mjs';
import {routeQuota,canonicalName,utcDay} from '../src/identity.mjs';
import {TEST_PRIVATE_JWK} from './fixture_key.mjs';
import {WORKLOAD_TEST_PRIVATE_JWK} from './fixture_workload_key.mjs';
const enc=new TextEncoder();
const td=new TextDecoder();
const model='@cf/zai-org/glm-4.7-flash';
function b64(buf){return btoa(String.fromCharCode(...new Uint8Array(buf)));}
async function signed(priv,obj){
  const key=await crypto.subtle.importKey('jwk',priv,{name:'Ed25519'},false,['sign']);
  const msg=enc.encode(JSON.stringify(obj));
  return {payload_b64:b64(msg),signature_b64:b64(await crypto.subtle.sign('Ed25519',key,msg))};
}
function payload(n){return {model,messages:[{role:'user',content:'isolated-worker-task-'+n}],max_output_tokens:32};}
async function authoriseRequest(grant,n){
  const utc_day=utcDay(),now=Math.floor(Date.now()/1000),body=payload(n);
  const request_sha=await digestPayload(body);
  const grant_sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(
     grant.payload_b64+'.'+grant.signature_b64))),x=>x.toString(16).padStart(2,'0')).join('');
  const request_id='b18-'+n;
  const auth=await signed(WORKLOAD_TEST_PRIVATE_JWK,{
    schema:'axiom.trackb16.s0.workload-auth.v1',audience:'axiom.trackb16.s0.reserve',
    account_id:env.AXIOM_ACCOUNT_ID,utc_day,tenant_id:'tenant-B18',workload_id:'worker-B18',
    request_id,request_sha,neurons:100,grant_sha256,issued_at:now-3,expires_at:now+60,
    production_authority:false
  });
  return {body,request:{auth,signed:grant,request_id,request_sha,neurons:100,
    tenant_id:'tenant-B18',workload_id:'worker-B18'}};
}
function runOnce(item,onSend){return guardedDispatch({trustedEnv:env,request:item.request,payload:item.body,
  allowedModels:[model],maxOutputTokens:48,now:()=>Date.now(),sendProvider:onSend});}

it('B18 REAL WORKER: exact bytes, replay, signed grant, atomic cap, revocation, eviction and ambiguity',async()=>{
  const day=utcDay(),time=Math.floor(Date.now()/1000), nonce=crypto.randomUUID().replaceAll('-','');
  const grant=await signed(TEST_PRIVATE_JWK,{
    schema:'musitu.axiom.trackb15.s0.quota-grant.v1',account_id:env.AXIOM_ACCOUNT_ID,
    utc_day:day,tenant_id:'tenant-B18',workload_id:'worker-B18',grant_id:'grant-b18-'+nonce,
    issued_at:time-5,expires_at:time+120,max_calls:20,max_per_call_neurons:100,
    daily_capacity_neurons:500,provider_remaining_certified:true,production_authority:false
  });
  const stub=routeQuota(env);
  expect(stub.name).toBe(canonicalName(env.AXIOM_ACCOUNT_ID,day));
  let transportCalls=0;
  const fakeProvider=async bytes=>{transportCalls++;const obj=JSON.parse(td.decode(bytes));
    expect(obj.model).toBe(model);expect(obj.max_output_tokens).toBe(32);
    return {synthetic:true,body_sha256:await digestPayload(obj)};
  };
  const first=await authoriseRequest(grant,'first');
  const accepted=await runOnce(first,fakeProvider);
  expect(accepted.status).toBe('COMPLETED');
  expect(accepted.provider_result.body_sha256).toBe(first.request.request_sha);
  expect(transportCalls).toBe(1);
  const replay=await runOnce(first,fakeProvider);
  expect(replay.status).toBe('REPLAY_DENIED');expect(transportCalls).toBe(1);
  await expect(runOnce({...first,body:payload('attacker-swapped')},fakeProvider)).rejects.toMatchObject({code:'PAYLOAD_HASH_MISMATCH'});
  expect(transportCalls).toBe(1);
  const uncertain=await authoriseRequest(grant,'uncertain');
  const transportError=await runOnce(uncertain,async()=>{transportCalls++;throw Error('synthetic 504 after potential provider send')});
  expect(transportError).toMatchObject({status:'UNKNOWN_AFTER_RESERVATION',resend_prohibited:true,dispatch_allowed:false});
  const blockedRetry=await runOnce(uncertain,fakeProvider);
  expect(blockedRetry.status).toBe('REPLAY_DENIED');expect(transportCalls).toBe(2);
  // 12 concurrent distinct authorized calls from separate canonical stubs,
  // only the remaining 3/5 admission capacity can reach provider transport.
  const racers=await Promise.all(Array.from({length:12},(_,i)=>authoriseRequest(grant,'race'+i)));
  const outcomes=await Promise.all(racers.map(item=>runOnce(item,fakeProvider)));
  expect(outcomes.filter(x=>x.status==='COMPLETED').length).toBe(3);
  expect(outcomes.filter(x=>x.status==='DENIED').length).toBe(9);
  expect(outcomes.filter(x=>x.status==='DENIED').every(x=>x.reason==='ACCOUNT_DAILY_CAPACITY_EXHAUSTED')).toBe(true);
  expect(transportCalls).toBe(5); // 1 accepted, 1 uncertain, 3 racers.
  await runInDurableObject(stub,async(_instance,state)=>{
    expect(state.storage.sql.exec('SELECT used FROM quota_meta WHERE id=1').one().used).toBe(500);
    expect(state.storage.sql.exec('SELECT COUNT(*) as count FROM reservations').one().count).toBe(5);
  });
  await evictDurableObject(stub);
  const afterEviction=await runOnce(first,fakeProvider);
  expect(afterEviction.status).toBe('REPLAY_DENIED');expect(transportCalls).toBe(5);
  const revocation=await signed(TEST_PRIVATE_JWK,{
    schema:'musitu.axiom.trackb15.s0.revocation.v1',account_id:env.AXIOM_ACCOUNT_ID,
    utc_day:day,issued_at:Math.floor(Date.now()/1000)-2,
    expires_at:Math.floor(Date.now()/1000)+120,sequence:1,reason:'b18-security-test'
  });
  const revoked=await routeQuota(env).revoke({signed:revocation});
  expect(revoked.status).toBe('REVOKED');
  const afterRevoke=await runOnce(await authoriseRequest(grant,'post-revoke'),fakeProvider);
  expect(afterRevoke).toMatchObject({status:'DENIED',reason:'ACCOUNT_STATE_DENIED',dispatch_allowed:false});
  expect(transportCalls).toBe(5);
  const publicResponse=await exports.default.fetch('http://localhost/untrusted');
  expect(publicResponse.status).toBe(503);
  console.log('AXIOM_B18_REAL_WORKER_SYNTHETIC_PROVIDER_DISPATCH_S0_PASS_NO_LIVE_INFERENCE');
});
