/** Provider-created A2 R2 bucket integration coherence.
 * Source pin drift would make live readback HOLD or target an unapproved R2.
 * Static contract only, not a Cloudflare provider attestation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root=new URL('./',import.meta.url);
const read=f=>readFileSync(new URL(f,root),'utf8');
const bucket='musitu-axiom-b27-highwater-a2';
const old='musitu-axiom-authority2-worm';
const account='67469478aa9349fa0a57fe3a72da200a';
const all=['authority2-lock-policy.mjs','authority2-provider-readonly-check.mjs',
 'authority2-worker-bindings.mjs','authority2-lock-policy.test.mjs',
 'authority2-provider-readonly-check.test.mjs','authority2-worker-bindings.test.mjs',
 'wrangler.example.toml'];

test('B27 all operator and Worker binding gates pin exactly one provider-backed A2 bucket',()=>{
 for(const f of all){
  const s=read(f);
  assert.ok(s.includes(bucket),f+': expected provider-created R2 bucket pin');
  assert.equal(s.includes(old),false,f+': historical unprovisioned bucket forbidden');
  assert.ok(s.includes(account),f+': expected separately designated A2 account');
 }
});
test('B27 source candidate never enables public Worker preview routing',()=>{
 const s=read('wrangler.example.toml');
 assert.match(s,/^workers_dev\s*=\s*false\s*$/m);
 assert.match(s,/^preview_urls\s*=\s*false\s*$/m);
 assert.doesNotMatch(s,/^\s*(?:route|routes)\s*=/m);
 assert.match(s,/^bucket_name\s*=\s*"musitu-axiom-b27-highwater-a2"/m);
});
