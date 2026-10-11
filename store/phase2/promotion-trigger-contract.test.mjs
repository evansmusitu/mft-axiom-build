import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const releases=[
  '.github/workflows/musitu-store-browser-first-production.yml',
  '.github/workflows/musitu-store-install-button-production.yml',
  '.github/workflows/musitu-store-self-install-production.yml',
];
for(const path of releases) {
  test(path+' cannot promote on ordinary source push',()=>{
    const workflow=readFileSync(path,'utf8');
    assert.match(workflow,/^on:\n  workflow_dispatch:\s*$/m);
    assert.doesNotMatch(workflow,/^  push:\s*$/m);
    assert.match(workflow,/^concurrency:\n  group: musitu-store-production/m);
    assert.match(workflow,/deploy-(?:browser-first-launch|install-button-behavior|store-self-install-behavior)\.py/);
  });
}
test('browser-first preflight enforces the shared carrier contract',()=>{
  const verifier=readFileSync('store/phase2/verify-browser-first-candidate.mjs','utf8');
  assert.match(verifier,/import\s+\{assertInstallCarrier,assertInstallController\}/);
  assert.match(verifier,/assertInstallCarrier\(markup,\{platform,action\}\)/);
  assert.match(verifier,/assertInstallController\(controllerText,\{transport\}\)/);
  assert.doesNotMatch(verifier,/hrefs\(ios\)\.some\(h=>h\.startsWith\('sidestore/);
});
