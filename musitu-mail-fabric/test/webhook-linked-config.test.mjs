import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('separate linked-webhook template binds explicitly to a different Worker's Durable Object',()=>{
 const cfg=JSON.parse(readFileSync(new URL('../wrangler.mmf.webhook-linked.template.jsonc',import.meta.url),'utf8'));
 assert.equal(cfg.name,'musitu-mail-fabric-webhook-linked-test-only');
 assert.equal(cfg.main,'src/edge/webhook-only.mjs');
 assert.equal(cfg.workers_dev,false);assert.deepEqual(cfg.routes,[]);
 const receipts=cfg.durable_objects.bindings.find(x=>x.name==='MMF_RECEIPTS');
 const outbox=cfg.durable_objects.bindings.find(x=>x.name==='MMF_OUTBOX');
 assert.equal(receipts.class_name,'MmfStagingSqliteDO');
 assert.equal(receipts.script_name,undefined);
 assert.equal(outbox.class_name,'MmfStagingSqliteDO');
 assert.equal(outbox.script_name,'musitu-mail-fabric-staging-20261010');
 assert.notEqual(receipts.script_name,outbox.script_name);
 for(const k of ['MMF_REAL_SEND_ENABLED','MMF_API_ENABLED','MMF_WEBHOOK_ENABLED','MMF_OUTBOX_LINK_ENABLED',
  'MMF_SUPPRESSION_API_ENABLED','MMF_SENDER_REVOKE_API_ENABLED','MMF_DIAGNOSTICS_ENABLED'])
   assert.equal(cfg.vars[k],'false',k);
 assert.equal(JSON.stringify(cfg).includes('whsec_'),false);
 assert.equal(JSON.stringify(cfg).includes('PRIVATE_KEY'),false);
});
test('separate webhook template provides no customer API, outbound or public route by default',()=>{
 const cfg=JSON.parse(readFileSync(new URL('../wrangler.mmf.webhook-linked.template.jsonc',import.meta.url),'utf8'));
 assert.equal(cfg.routes.length,0);
 assert.equal(cfg.vars.MMF_REAL_SEND_ENABLED,'false');
 assert.equal(cfg.vars.MMF_OUTBOX_LINK_ENABLED,'false');
 assert.equal(cfg.vars.MMF_WEBHOOK_ENABLED,'false');
});
