import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const cfg=JSON.parse(readFileSync(new URL('../wrangler.mmf.billing-private-do-authorized-20261011.jsonc',import.meta.url),'utf8'));
test('separate authorized Cloudflare SQLite DO billing stage is non-public and has no existing resource binding',()=>{
 assert.equal(cfg.name,'musitu-mail-fabric-payment-private-stage-20261011');
 assert.equal(cfg.main,'src/edge/billing-private-do-stage.mjs');
 assert.equal(cfg.workers_dev,false);assert.equal(cfg.preview_urls,false);assert.deepEqual(cfg.routes,[]);
 assert.equal(cfg.durable_objects?.bindings?.length,1);
 assert.deepEqual(cfg.durable_objects.bindings[0],{name:'MMF_BILLING_LEDGER',class_name:'MmfBillingPrivateStageSqliteDO'});
 assert.deepEqual(cfg.migrations,[{tag:'mmf-private-billing-sqlite-stage-v1-20261011',new_sqlite_classes:['MmfBillingPrivateStageSqliteDO']}]);
 for(const [k,v] of Object.entries({MMF_STAGE_ONLY:'true',MMF_REAL_SEND_ENABLED:'false',MMF_MAIL_SENDING_ENABLED:'false',MMF_COMMERCE_ENABLED:'false',MMF_BILLING_API_ENABLED:'true',MMF_STAGE_RECEIPTS_ENABLED:'false',MMF_API_ENABLED:'false',MMF_WEBHOOK_ENABLED:'false',MMF_TENANT_ID:'mmf_stage_20261011'}))assert.equal(cfg.vars[k],v,k);
 for(const forbidden of ['services','d1_databases','queues','triggers','route','zone_id','assets','send_email'])assert.equal(cfg[forbidden],undefined,forbidden);
 assert.equal(JSON.stringify(cfg).includes('CLOUDFLARE_API_TOKEN'),false);
 assert.equal(JSON.stringify(cfg).includes('PAYNOW_SECRET'),false);
});
