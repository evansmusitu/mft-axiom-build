import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const file=new URL('../wrangler.mmf.webhook-only.template.jsonc',import.meta.url);
test('independent webhook-only config has no public routes, no send API and a separate SQLite namespace',()=>{
 const config=JSON.parse(readFileSync(file,'utf8'));
 assert.equal(config.main,'src/edge/webhook-only.mjs');
 assert.equal(config.workers_dev,false);
 assert.deepEqual(config.routes,[]);
 for(const flag of ['MMF_REAL_SEND_ENABLED','MMF_API_ENABLED','MMF_WEBHOOK_ENABLED',
 'MMF_SUPPRESSION_API_ENABLED','MMF_SENDER_REVOKE_API_ENABLED','MMF_DIAGNOSTICS_ENABLED'])
   assert.equal(config.vars[flag],'false',flag);
 assert.deepEqual(config.durable_objects.bindings.map(b=>b.name),['MMF_RECEIPTS']);
 assert.equal(config.durable_objects.bindings[0].class_name,'MmfStagingSqliteDO');
 assert.ok(config.migrations.some(m=>m.new_sqlite_classes?.includes('MmfStagingSqliteDO')));
 assert.ok(!JSON.stringify(config).includes('MMF_LEDGER'));
 assert.ok(!JSON.stringify(config).includes('MMF_RESEND_API_KEY'));
 assert.ok(!JSON.stringify(config).includes('MMF_WEBHOOK_SECRET'));
});
