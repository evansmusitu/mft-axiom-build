import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const load=()=>JSON.parse(readFileSync(new URL('../wrangler.mmf.paynow-private-authority-stage.jsonc',import.meta.url),'utf8'));
test('isolated MMF authority stage has exactly one internal billing service binding and no Paynow merchant credential',()=>{
 const c=load();
 assert.equal(c.name,'musitu-mail-fabric-paynow-private-authority-stage-20261011');
 assert.equal(c.main,'src/edge/mmf-paynow-private-authority-stage.mjs');
 assert.equal(c.workers_dev,false);assert.equal(c.preview_urls,false);assert.deepEqual(c.routes,[]);
 assert.deepEqual(c.services,[{binding:'MMF_PRIVATE_PAYMENT_STAGE',service:'musitu-mail-fabric-payment-private-stage-20261011'}]);
 assert.equal(c.durable_objects,undefined);assert.equal(c.d1_databases,undefined);
 for(const [k,v] of Object.entries({MMF_PRIVATE_AUTHORITY_STAGE_ENABLED:'false',MMF_STAGE_BRIDGE_ENABLED:'false',
  MMF_STAGE_RECEIPTS_ENABLED:'false',MMF_REAL_SEND_ENABLED:'false',MMF_MAIL_SENDING_ENABLED:'false',
  MMF_COMMERCE_ENABLED:'false',MMF_API_ENABLED:'false',MMF_WEBHOOK_ENABLED:'false',MMF_STAGE_ONLY:'true',
  MMF_BILLING_API_ENABLED:'true',MMF_TENANT_ID:'mmf_stage_20261011'}))assert.equal(c.vars[k],v,k);
 assert.equal(JSON.stringify(c).match(/PAYNOW_INTEGRATION_KEY|FMI_AUTHORITY_BRIDGE_TOKEN|PAYNOW_TRANSPORT|https:\/\//g),null);
});
