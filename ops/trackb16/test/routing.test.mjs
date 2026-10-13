import test from 'node:test';
import assert from 'node:assert/strict';
import {routeQuota,ScopeDenied,canonicalName} from '../src/identity.mjs';

const day13=Date.parse('2026-10-13T23:59:59.999Z');
const day14=Date.parse('2026-10-14T00:00:00.000Z');
const ACCOUNT='axiom-s0-isolated';
function makeEnv() {
  const names=[];
  const binding={getByName(name) {names.push(name);return {name,reserve:async()=>{},revoke:async()=>{}};}};
  return {env:{AXIOM_ACCOUNT_ID:ACCOUNT,AXIOM_QUOTA_S0:binding},names};
}
function denied(fn,code){assert.throws(fn,e=>e instanceof ScopeDenied&&e.code===code);}

test('routing derives object identity exclusively from trusted config and UTC clock',()=>{
  const {env,names}=makeEnv();
  const stub=routeQuota(env,day13);
  assert.equal(typeof stub.reserve,'function');
  assert.deepEqual(names,[canonicalName(ACCOUNT,'2026-10-13')]);
});
test('separate brokers deterministically share one identity',()=>{
  const a=makeEnv(),b=makeEnv();
  routeQuota(a.env,day13);routeQuota(b.env,day13);
  assert.deepEqual(a.names,b.names);
});
test('midnight routes to a new account/day object, never previous object',()=>{
  const e=makeEnv();routeQuota(e.env,day13);routeQuota(e.env,day14);
  assert.deepEqual(e.names,[canonicalName(ACCOUNT,'2026-10-13'),canonicalName(ACCOUNT,'2026-10-14')]);
});
test('configured account is mandatory and untrusted names are not routing inputs',()=>{
  const e=makeEnv();e.env.AXIOM_ACCOUNT_ID='bad:extra';
  denied(()=>routeQuota(e.env,day13),'INVALID_CONFIGURED_ACCOUNT');
  assert.deepEqual(e.names,[]);
});
test('invalid clock fails before reaching durable-object binding',()=>{
  const e=makeEnv();denied(()=>routeQuota(e.env,NaN),'INVALID_TRUSTED_CLOCK');
  assert.deepEqual(e.names,[]);
});
test('binding missing fails closed, not fallback to local or global map',()=>{
  denied(()=>routeQuota({AXIOM_ACCOUNT_ID:ACCOUNT},day13),'TRUSTED_BINDING_UNAVAILABLE');
  denied(()=>routeQuota(null,day13),'TRUSTED_BINDING_UNAVAILABLE');
});
test('binding that refuses a name does not fall back to newUniqueId',()=>{
  const e=makeEnv();e.env.AXIOM_QUOTA_S0={getByName(){throw new Error('denied')},newUniqueId(){throw Error('insecure fallback')}};
  assert.throws(()=>routeQuota(e.env,day13),/denied/);
});
test('binding return missing reserve/revoke methods fails closed',()=>{
  const e=makeEnv();e.env.AXIOM_QUOTA_S0.getByName=(name)=>({name});
  denied(()=>routeQuota(e.env,day13),'QUOTA_STUB_UNAVAILABLE');
});

// Threat model: a compromised/misconfigured namespace returns an unrelated
// stub even though it was asked for the canonical name. The broker must not
// expose that stub, including if it has valid callable RPC methods.
test('binding cannot substitute an alternate named stub for canonical name',()=>{
  const e=makeEnv();
  e.env.AXIOM_QUOTA_S0.getByName=()=>({name:'axiom.quota.b16.v1:wrong:2026-10-13',reserve:async()=>{},revoke:async()=>{}});
  denied(()=>routeQuota(e.env,day13),'NONCANONICAL_QUOTA_STUB');
});
test('binding cannot substitute a nameless or unique-id stub',()=>{
  const e=makeEnv();
  e.env.AXIOM_QUOTA_S0.getByName=()=>({reserve:async()=>{},revoke:async()=>{}});
  denied(()=>routeQuota(e.env,day13),'NONCANONICAL_QUOTA_STUB');
});
test('canonical stub must not be replaced by an object reporting another id name',()=>{
  const e=makeEnv();
  e.env.AXIOM_QUOTA_S0.getByName=(name)=>({name,id:{name:'foreign'},reserve:async()=>{},revoke:async()=>{}});
  denied(()=>routeQuota(e.env,day13),'NONCANONICAL_QUOTA_STUB');
});
