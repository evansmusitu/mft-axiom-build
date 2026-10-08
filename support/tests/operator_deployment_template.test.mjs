import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

test('operator deployment template is private-by-default and has no production route authority',async()=>{
  const text=await readFile(new URL('../wrangler.support-operator.template.jsonc',import.meta.url),'utf8');
  assert.match(text,/"main"\s*:\s*"operator_worker\.js"/);
  assert.match(text,/"workers_dev"\s*:\s*false/);
  assert.match(text,/"preview_urls"\s*:\s*false/);
  assert.match(text,/"directory"\s*:\s*"\.\/console"/);
  assert.match(text,/"binding"\s*:\s*"ASSETS"/);
  assert.match(text,/"binding"\s*:\s*"SUPPORT_DB"/);
  assert.doesNotMatch(text,/"routes"\s*:/);
  assert.doesNotMatch(text,/support-ops\.mftintelligence\.com/);
  assert.doesNotMatch(text,/SUPPORT_DATA_KEY_B64\s*["':=]+\s*[A-Za-z0-9+/]{20,}/);
});

test('operator deployment handoff requires Cloudflare Access before hostname routing and separate release authorization',async()=>{
  const text=await readFile(new URL('../console/DEPLOYMENT.md',import.meta.url),'utf8');
  assert.match(text,/Cloudflare Access/i);
  assert.match(text,/before.*custom domain|custom domain.*before/is);
  assert.match(text,/production_authority:\s*false/);
  assert.match(text,/separate.*authorization/i);
  assert.match(text,/support-ops\.mftintelligence\.com/);
});
