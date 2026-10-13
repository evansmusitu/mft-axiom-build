// Mandatory negative-path WORKER test, executed separately to preserve the
// Cloudflare Vitest remote-exception/unhandled rejection diagnostic.
// Negative subprocess is expected to exit nonzero with NONCANONICAL evidence;
// this is NOT a clean runtime qualification or proof of production safety.
import {env} from 'cloudflare:workers';
import {it,expect} from 'vitest';
import {canonicalName,utcDay} from '../src/identity.mjs';
it('real Workers runtime denies alternate named object before reservation',async()=>{
  const canonical=canonicalName(env.AXIOM_ACCOUNT_ID,utcDay());
  const alternate=env.AXIOM_QUOTA_S0.getByName(canonical+':attacker');
  expect(alternate.name).not.toBe(canonical);
  await expect(alternate.reserve({})).rejects.toThrow();
});
