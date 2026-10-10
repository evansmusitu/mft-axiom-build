import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const load=n=>JSON.parse(readFileSync(new URL('../'+n,import.meta.url),'utf8'));
const owner=load('wrangler.mmf.do-feedback-qualification.jsonc');
const linked=load('wrangler.mmf.webhook-linked-stage.jsonc');
test('staging cross-worker scope is isolated and cannot create a public sender/webhook endpoint',()=>{
 assert.equal(owner.name,'musitu-mail-fabric-staging-20261010');
 assert.equal(linked.name,'musitu-mail-fabric-webhook-linked-test-only');
 for(const cfg of [owner,linked]){
  assert.equal(cfg.workers_dev,false);
  assert.deepEqual(cfg.routes,[]);
  assert.equal(cfg.vars.MMF_REAL_SEND_ENABLED,'false');
  assert.equal(cfg.vars.MMF_API_ENABLED,'false');
  assert.equal(cfg.vars.MMF_WEBHOOK_ENABLED,'false');
  assert.equal(cfg.vars.MMF_STAGE_ONLY,'true');
  assert.equal(cfg.vars.MMF_TENANT_ID,'stage-tenant');
  assert.equal(JSON.stringify(cfg).includes('whsec_'),false);
  assert.equal(JSON.stringify(cfg).includes('sk-proj-'),false);
 }
 assert.equal(owner.vars.MMF_FEEDBACK_RPC_ENABLED,'true');
 assert.deepEqual(owner.services,[{binding:'MMF_PRIVATE_FEEDBACK_INGRESS',service:linked.name}]);
 assert.equal(linked.main,'src/edge/webhook-private-probe.mjs');
 assert.equal(linked.vars.MMF_PRIVATE_BRIDGE_TEST_ENABLED,'true');
 assert.equal(linked.vars.MMF_OUTBOX_LINK_ENABLED,'true');
 assert.equal(linked.vars.MMF_WEBHOOK_RECORDER_ONLY,'true');
 const out=linked.durable_objects.bindings.find(x=>x.name==='MMF_OUTBOX');
 assert.equal(out.script_name,owner.name);
 assert.equal(out.class_name,'MmfStagingSqliteDO');
 const receipts=linked.durable_objects.bindings.find(x=>x.name==='MMF_RECEIPTS');
 assert.notEqual(out.script_name,receipts.script_name);
});
test('previous isolated sender and linked deployment templates remain default-disabled',()=>{
 const sender=load('wrangler.mmf.do-staging.jsonc');
 const fallback=load('wrangler.mmf.webhook-linked.template.jsonc');
 assert.equal(sender.vars.MMF_FEEDBACK_RPC_ENABLED,undefined);
 assert.equal(sender.services,undefined);
 assert.equal(fallback.vars.MMF_WEBHOOK_ENABLED,'false');
 assert.equal(fallback.vars.MMF_OUTBOX_LINK_ENABLED,'false');
 assert.equal(fallback.main,'src/edge/webhook-only.mjs');
});
