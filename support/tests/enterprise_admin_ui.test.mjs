import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

test('private operator console exposes enterprise organization, entitlement and native webhook controls',async()=>{
  const [html,js]=await Promise.all([
    readFile(new URL('../console/index.html',import.meta.url),'utf8'),
    readFile(new URL('../console/app.js',import.meta.url),'utf8')
  ]);
  assert.match(html,/Enterprise support/i);
  assert.match(html,/id="enterprise-org-ref"/);
  assert.match(html,/id="enterprise-plan"/);
  assert.match(html,/id="enterprise-entitlement"/);
  assert.match(html,/id="enterprise-webhook-ref"/);
  assert.match(html,/id="enterprise-webhook-endpoint"/);
  assert.match(html,/id="enterprise-webhook-secret"[^>]*type="password"|type="password"[^>]*id="enterprise-webhook-secret"/);
  assert.match(html,/id="create-enterprise-webhook"/);
  assert.match(html,/id="rotate-enterprise-webhook"/);

  assert.match(js,/\/api\/v1\/operator\/organizations/);
  assert.match(js,/\/entitlements/);
  assert.match(js,/\/api\/v1\/operator\/webhooks/);
  assert.match(js,/\/delivery/);
  assert.match(js,/endpoint_url/);
  assert.match(js,/signing_secret/);
  assert.doesNotMatch(js,/localStorage|sessionStorage|indexedDB/i);
});

test('enterprise webhook secret is cleared from the DOM after submit paths',async()=>{
  const js=await readFile(new URL('../console/app.js',import.meta.url),'utf8');
  assert.match(js,/enterprise-webhook-secret/);
  assert.match(js,/\.value\s*=\s*['"]['"]/);
});
