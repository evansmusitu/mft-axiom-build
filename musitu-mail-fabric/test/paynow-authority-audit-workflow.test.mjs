import {readFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
const path=new URL('../../.github/workflows/mmf-paynow-existing-authority-readonly.yml',import.meta.url);
const content=()=>readFileSync(path,'utf8');
test('dedicated existing MUSITU payment audit uses account read-only API, never invokes checkout',()=>{
 const s=content();
 assert.match(s,/branches:\s*\['product\/musitu-mail-fabric-isolated-20261009'\]/);
 assert.match(s,/permissions:\s*\n\s+contents:\s+read/);
 assert.match(s,/mft-phase8-external-authority/);
 assert.match(s,/mft-paynow-transport-gateway/);
 assert.match(s,/mft-fmi-billing/);
 assert.match(s,/environment:\s+axiom-support-production/);
 assert.match(s,/method:\s*'GET'/);
 assert.match(s,/SHARED_PAYMENT_READONLY/);
 assert.doesNotMatch(s,/method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/);
 assert.doesNotMatch(s,/wrangler (?:deploy|secret|d1|publish)/i);
});
test('payment audit metadata contains no secret material or raw code in artifacts',()=>{
 const s=content();
 assert.match(s,/source_sha256/);
 assert.match(s,/source_bytes/);
 assert.match(s,/binding_name/);
 assert.match(s,/mmf-existing-paynow-audit\.json/);
 assert.match(s,/actions\/upload-artifact@v4/);
 assert.doesNotMatch(s,/print\(.*(?:source|secret|token|key)/i);
});
