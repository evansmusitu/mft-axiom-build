// Mandatory negative-path WORKER test, executed separately to preserve the
// earlier Cloudflare Vitest remote-exception diagnostic (prior failure preserved).
// Require an explicit no-dispatch receipt and NO SQLite ledger initialized.
// Earlier thrown-constructor run failed on unhandled remote exceptions; this
// repairs that failure without authorizing model inference or a public route.
import {env} from 'cloudflare:workers';
import {it,expect} from 'vitest';
import {runInDurableObject} from 'cloudflare:test';
import {canonicalName,utcDay} from '../src/identity.mjs';
it('real Workers runtime denies alternate named object before reservation',async()=>{
  const canonical=canonicalName(env.AXIOM_ACCOUNT_ID,utcDay());
  const alternate=env.AXIOM_QUOTA_S0.getByName(canonical+':attacker');
  expect(alternate.name).not.toBe(canonical);
  const denial=await alternate.reserve({});
  expect(denial).toMatchObject({status:'DENIED',dispatch_allowed:false,reason:'NONCANONICAL_DURABLE_OBJECT'});
  const revokeDenial=await alternate.revoke({});
  expect(revokeDenial).toMatchObject({status:'DENIED',dispatch_allowed:false,reason:'NONCANONICAL_DURABLE_OBJECT'});
  await runInDurableObject(alternate,async(instance,state)=>{
    expect(instance.core).toBe(null); // no quota ledger initialized
    expect(state.storage.sql.exec("SELECT name FROM sqlite_master WHERE name='quota_meta'").toArray()).toEqual([]);
  });
});

// Independent adversarial workload-signature validation under genuine workerd.
// A correctly signed quota grant alone MUST NOT initialize admission state.
import {TEST_PRIVATE_JWK} from './fixture_key.mjs';
import {WORKLOAD_TEST_PRIVATE_JWK} from './fixture_workload_key.mjs';
const encoder=new TextEncoder();
const asB64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes)));
async function signWith(keyJwk,document){
  const key=await crypto.subtle.importKey('jwk',keyJwk,{name:'Ed25519'},false,['sign']);
  const payload=encoder.encode(JSON.stringify(document));
  return {payload_b64:asB64(payload),signature_b64:asB64(await crypto.subtle.sign('Ed25519',key,payload))};
}
it('real Workers runtime rejects forged workload identity before quota reservation',async()=>{
  const day=utcDay(),now=Math.floor(Date.now()/1000);
  const canonical=canonicalName(env.AXIOM_ACCOUNT_ID,day);
  const stub=env.AXIOM_QUOTA_S0.getByName(canonical);
  const signed=await signWith(TEST_PRIVATE_JWK,{
    schema:'musitu.axiom.trackb15.s0.quota-grant.v1',account_id:env.AXIOM_ACCOUNT_ID,
    utc_day:day,tenant_id:'tenant-A',workload_id:'agent-A',grant_id:'attack-grant',
    issued_at:now-5,expires_at:now+120,max_calls:5,max_per_call_neurons:100,
    daily_capacity_neurons:500,provider_remaining_certified:true,production_authority:false
  });
  const request={signed,request_id:'attack-op',request_sha:'a'.repeat(64),neurons:100,
    tenant_id:'tenant-A',workload_id:'agent-A'};
  const grant_sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(
    signed.payload_b64+'.'+signed.signature_b64))),x=>x.toString(16).padStart(2,'0')).join('');
  const nowSec=Math.floor(Date.now()/1000);
  const payload={schema:'axiom.trackb16.s0.workload-auth.v1',audience:'axiom.trackb16.s0.reserve',
    account_id:env.AXIOM_ACCOUNT_ID,utc_day:day,tenant_id:'tenant-A',workload_id:'agent-A',
    request_id:request.request_id,request_sha:request.request_sha,neurons:request.neurons,
    grant_sha256,issued_at:nowSec-3,expires_at:nowSec+60,production_authority:false};
  const auth=await signWith(WORKLOAD_TEST_PRIVATE_JWK,payload);
  const signature=Uint8Array.from(atob(auth.signature_b64),c=>c.charCodeAt(0));
  signature[0]^=1;
  request.auth={...auth,signature_b64:asB64(signature)};
  const denied=await stub.reserve(request);
  expect(denied).toMatchObject({status:'DENIED',dispatch_allowed:false,reason:'WORKLOAD_SIGNATURE_INVALID'});
  // Even a correctly signed workload envelope does not authorize altered request arguments.
  const altered=await stub.reserve({...request,auth,request_sha:'b'.repeat(64)});
  expect(altered).toMatchObject({status:'DENIED',dispatch_allowed:false,reason:'WORKLOAD_BINDING_DENIED'});
  await runInDurableObject(stub,async(_instance,state)=>{
    expect(state.storage.sql.exec('SELECT * FROM quota_meta').toArray()).toEqual([]);
    expect(state.storage.sql.exec('SELECT * FROM reservations').toArray()).toEqual([]);
  });
});
