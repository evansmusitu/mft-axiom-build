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
