import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const workerPath = new URL('../../connect/production_worker.mjs', import.meta.url);

test('production worker exposes healthy pre-production canary surface', async () => {
  assert.equal(
    fs.existsSync(workerPath),
    true,
    'production worker module must exist before the runtime can be enabled',
  );
  const mod = await import(pathToFileURL(workerPath.pathname).href);
  const response = await mod.default.fetch(
    new Request('https://canary.example/health'),
    {
      AXIOM_ACCOUNT_KEY: 'test-account-key',
      PRODUCTION: 'false',
      RELEASE: 'test-release',
    },
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, {
    ok: true,
    service: 'MUSITU Connect',
    release: 'test-release',
    production: false,
    axiomIntegrationAllowed: true,
  });
});
