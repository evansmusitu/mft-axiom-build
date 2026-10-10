import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=name=>JSON.parse(readFileSync(new URL('../'+name,import.meta.url),'utf8'));
const owner=read('wrangler.mmf.do-feedback-locked.jsonc');
const linked=read('wrangler.mmf.webhook-linked-locked.jsonc');
test('post-qualification two Workers remain linked but all synthetic invocation channels are disabled',()=>{
 assert.equal(owner.name,'musitu-mail-fabric-staging-20261010');
 assert.equal(linked.name,'musitu-mail-fabric-webhook-linked-test-only');
 assert.equal(owner.services,undefined);
 assert.equal(owner.vars.MMF_FEEDBACK_RPC_ENABLED,'true');
 assert.equal(linked.main,'src/edge/webhook-only.mjs');
 assert.equal(linked.vars.MMF_OUTBOX_LINK_ENABLED,'true');
 assert.equal(linked.vars.MMF_PRIVATE_BRIDGE_TEST_ENABLED,'false');
 for(const cfg of [owner,linked]){
  assert.equal(cfg.vars.MMF_STAGE_ONLY,'true');
  assert.equal(cfg.vars.MMF_REAL_SEND_ENABLED,'false');
  assert.equal(cfg.vars.MMF_WEBHOOK_ENABLED,'false');
  assert.equal(cfg.vars.MMF_API_ENABLED,'false');
  assert.equal(cfg.workers_dev,false);
  assert.deepEqual(cfg.routes,[]);
 }
 assert.equal(linked.durable_objects.bindings.find(x=>x.name==='MMF_OUTBOX').script_name,owner.name);
});
