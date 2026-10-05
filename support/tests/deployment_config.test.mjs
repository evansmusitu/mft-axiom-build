import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {renderWranglerTemplate} from '../scripts/render_wrangler.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('deployment renderer accepts only controlled domains, opaque ownership and evidence-bound configuration', async () => {
  const template = await readFile(resolve(root, 'wrangler.support.template.jsonc'), 'utf8');
  const rendered = renderWranglerTemplate(template, {
    workerName: 'musitu-axiom-support', databaseName: 'musitu-axiom-support',
    databaseId: '123e4567-e89b-12d3-a456-426614174000', turnstileSiteKey: '0x4AAAAAAAAAAAAAAAAAAAAAA',
    supportDomain: 'support.mftintelligence.com', humanOwnerRef: 'owner_support_12345678', readinessSha256: 'a'.repeat(64),
  });
  const parsed = JSON.parse(rendered);
  assert.equal(parsed.workers_dev, false);
  assert.equal(parsed.routes[0].custom_domain, true);
  assert.deepEqual(parsed.assets.run_worker_first, ['/api/*', '/health']);
  assert.equal(parsed.vars.SUPPORT_READINESS_SHA256, 'a'.repeat(64));
  assert.equal(parsed.vars.TURNSTILE_SITE_KEY, '0x4AAAAAAAAAAAAAAAAAAAAAA');
  assert.equal(parsed.services, undefined);
  assert.doesNotMatch(rendered, /SUPPORT_DATA_KEY_B64/);
  assert.doesNotMatch(rendered, /TURNSTILE_SECRET_KEY/);
});

test('deployment renderer rejects foreign domains and unresolved identities', async () => {
  const template = await readFile(resolve(root, 'wrangler.support.template.jsonc'), 'utf8');
  const valid = {workerName: 'musitu-axiom-support', databaseName: 'musitu-axiom-support', databaseId: '123e4567-e89b-12d3-a456-426614174000', turnstileSiteKey: '0x4AAAAAAAAAAAAAAAAAAAAAA', supportDomain: 'support.mftintelligence.com', humanOwnerRef: 'owner_support_12345678', readinessSha256: 'a'.repeat(64)};
  assert.throws(() => renderWranglerTemplate(template, {...valid, supportDomain: 'attacker.example'}), /controlled mftintelligence.com/);
  assert.throws(() => renderWranglerTemplate(template, {...valid, humanOwnerRef: ''}), /opaque owner reference/);
});
