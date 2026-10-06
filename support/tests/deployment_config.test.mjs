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
    supportDomain: 'support.mftintelligence.com', humanOwnerRef: 'owner_support_12345678', independentApproverRef: 'approver_support_87654321', readinessSha256: 'a'.repeat(64),
  });
  const parsed = JSON.parse(rendered);
  assert.equal(parsed.workers_dev, false);
  assert.equal(parsed.routes[0].custom_domain, true);
  assert.deepEqual(parsed.assets.run_worker_first, ['/api/*', '/health']);
  assert.equal(parsed.vars.SUPPORT_READINESS_SHA256, 'a'.repeat(64));
  assert.equal(parsed.vars.TURNSTILE_SITE_KEY, '0x4AAAAAAAAAAAAAAAAAAAAAA');
  assert.equal(parsed.vars.SUPPORT_INDEPENDENT_APPROVER_REF, 'approver_support_87654321');
  assert.equal(parsed.services, undefined);
  assert.doesNotMatch(rendered, /SUPPORT_DATA_KEY_B64/);
  assert.doesNotMatch(rendered, /TURNSTILE_SECRET_KEY/);
});

test('deployment renderer rejects foreign domains and unresolved identities', async () => {
  const template = await readFile(resolve(root, 'wrangler.support.template.jsonc'), 'utf8');
  const valid = {workerName: 'musitu-axiom-support', databaseName: 'musitu-axiom-support', databaseId: '123e4567-e89b-12d3-a456-426614174000', turnstileSiteKey: '0x4AAAAAAAAAAAAAAAAAAAAAA', supportDomain: 'support.mftintelligence.com', humanOwnerRef: 'owner_support_12345678', independentApproverRef: 'approver_support_87654321', readinessSha256: 'a'.repeat(64)};
  assert.throws(() => renderWranglerTemplate(template, {...valid, supportDomain: 'attacker.example'}), /controlled mftintelligence.com/);
  assert.throws(() => renderWranglerTemplate(template, {...valid, humanOwnerRef: ''}), /opaque owner reference/);
  assert.throws(() => renderWranglerTemplate(template, {...valid, independentApproverRef: ''}), /opaque approver reference/);
  assert.throws(() => renderWranglerTemplate(template, {...valid, independentApproverRef: valid.humanOwnerRef}), /must be different people/);
});

test('deployment workflow can use the established masked Cloudflare global-key credentials', async () => {
  const workflow = await readFile(resolve(root, '..', '.github', 'workflows', 'axiom-official-support-deploy.yml'), 'utf8');
  assert.match(workflow, /CLOUDFLARE_API_KEY:\s*\$\{\{ secrets\.CLOUDFLARE_GLOBAL_API_KEY \}\}/);
  assert.match(workflow, /CLOUDFLARE_EMAIL:\s*\$\{\{ secrets\.CLOUDFLARE_EMAIL \}\}/);
  assert.doesNotMatch(workflow, /[A-Fa-f0-9]{37}|cfk_[A-Za-z0-9_-]{20,}/);
});

test('bootstrap rendering removes every public route and does not claim readiness', async () => {
  const template = await readFile(resolve(root, 'wrangler.support.template.jsonc'), 'utf8');
  const rendered = renderWranglerTemplate(template, {
    workerName: 'musitu-axiom-support', databaseName: 'musitu-axiom-support',
    databaseId: '123e4567-e89b-12d3-a456-426614174000', turnstileSiteKey: '0x4AAAAAAAAAAAAAAAAAAAAAA',
    supportDomain: 'support.mftintelligence.com', humanOwnerRef: 'github:evansmusitu', independentApproverRef: 'person:elvis-musitu', readinessSha256: '', deploymentMode: 'bootstrap',
  });
  const parsed = JSON.parse(rendered);
  assert.equal(parsed.vars.ENVIRONMENT, 'bootstrap');
  assert.equal(parsed.vars.SUPPORT_READINESS_SHA256, '');
  assert.equal(parsed.routes, undefined);
  assert.equal(parsed.workers_dev, false);
});

test('email-routing migration workflow is isolated, exact-commit-gated and never exposes retired mailbox addresses', async () => {
  const workflow = await readFile(resolve(root, '..', '.github', 'workflows', 'axiom-official-support-email-routing-migration.yml'), 'utf8');
  assert.match(workflow, /support\/axiom-official-support-20261005/);
  assert.match(workflow, /expected_commit/);
  assert.match(workflow, /MIGRATE_MUSITU_AXIOM_EMAIL_ROUTING/);
  assert.match(workflow, /RETIRE_UNUSED_ZOHO_TEST_MAILBOXES/);
  assert.match(workflow, /node support\/scripts\/migrate_cloudflare_email_routing\.mjs/);
  assert.match(workflow, /CLOUDFLARE_API_TOKEN:\s*\$\{\{ secrets\.CLOUDFLARE_RULESETS_API_TOKEN \}\}/);
  assert.match(workflow, /SUPPORT_MAILBOX_DESTINATION:\s*\$\{\{ secrets\.CLOUDFLARE_EMAIL \}\}/);
  assert.doesNotMatch(workflow, /evans(?:\.musitu)?@mftintelligence\.com/);
  assert.doesNotMatch(workflow, /branches:\s*\n\s*-\s*['"]?main/);
});


test('deployment workflow proves the canonical eleven-gate snapshot is fully ready and hash-bound before deploy', async () => {
  const workflow = await readFile(resolve(root, '..', '.github', 'workflows', 'axiom-official-support-deploy.yml'), 'utf8');
  assert.match(workflow, /EVIDENCE\/axiom-official-support-readiness-current\.json/);
  assert.match(workflow, /public_operational_claim_authorized/);
  assert.match(workflow, /deployment_dispatch_authorized/);
  assert.match(workflow, /required_gate_count/);
  assert.match(workflow, /pass_count/);
  assert.match(workflow, /partial_count/);
  assert.match(workflow, /missing_count/);
  assert.match(workflow, /status\s*!==?\s*['"]PASS['"]/);
  assert.match(workflow, /SUPPORT_READINESS_SHA256/);
  assert.match(workflow, /createHash\(['"]sha256['"]\)/);
});
