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
  assert.deepEqual(parsed.ratelimits, [{
    name: 'SUPPORT_INTAKE_RATE_LIMITER',
    namespace_id: '910051',
    simple: {limit: 60, period: 60},
  }]);
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


test('authorized public-origin verification bootstrap is one-shot, exact-host, non-promotional and preserves the canonical deploy gate', async () => {
  const workflow = await readFile(resolve(root, '..', '.github', 'workflows', 'axiom-official-support-public-origin-verify-once.yml'), 'utf8');
  assert.match(workflow, /support\/axiom-official-support-20261005/);
  assert.match(workflow, /github\.event\.before/);
  assert.match(workflow, /support\.mftintelligence\.com/);
  assert.match(workflow, /axiom-support-production/);
  assert.match(workflow, /EVIDENCE\/axiom-official-support-readiness-current\.json/);
  assert.match(workflow, /PUBLIC_ORIGIN/);
  assert.match(workflow, /ANTI_ABUSE/);
  assert.match(workflow, /ACCESSIBILITY_REALITY/);
  assert.match(workflow, /public_operational_claim_authorized/);
  assert.match(workflow, /deployment_dispatch_authorized/);
  assert.match(workflow, /workers_dev/);
  assert.match(workflow, /previews_enabled/);
  assert.match(workflow, /SUPPORT_DEPLOYMENT_MODE:\s*production/);
  assert.match(workflow, /node --test support\/tests\/\*\.test\.mjs/);
  assert.doesNotMatch(workflow, /branches:\s*\n\s*-\s*['"]?main/);
  assert.doesNotMatch(workflow, /workflow_dispatch/);
});


test('public-origin verification bundles the browser app with all local module dependencies before embedding it', async () => {
  const workflow = await readFile(resolve(root, '..', '.github', 'workflows', 'axiom-official-support-public-origin-verify-once.yml'), 'utf8');
  assert.match(workflow, /esbuild@0\.25\.11 support\/app\.js --bundle --format=esm --platform=browser --target=es2022 --outfile=\.axiom-support-app\.browser\.js/);
  assert.match(workflow, /readFileSync\('\.axiom-support-app\.browser\.js','utf8'\)/);
  assert.doesNotMatch(workflow, /readFileSync\('support\/app\.js','utf8'\)/);
  assert.match(workflow, /if\(request\.method==='GET'&&u\.pathname==='\/app\.js'\) return asset\(APP,'text\/javascript; charset=utf-8'\)/);
});


test('canonical production deploy consumes an explicit approved readiness SHA and does not depend on repository deployment variables', async () => {
  const workflow = await readFile(resolve(root, '..', '.github', 'workflows', 'axiom-official-support-deploy.yml'), 'utf8');
  assert.match(workflow, /approved_readiness_sha256/);
  assert.match(workflow, /SUPPORT_READINESS_SHA256:\s*\$\{\{ inputs\.approved_readiness_sha256 \}\}/);
  assert.doesNotMatch(workflow, /\$\{\{ vars\./);
  assert.match(workflow, /CLOUDFLARE_RULESETS_API_TOKEN/);
  assert.match(workflow, /listD1Databases/);
  assert.match(workflow, /challenges\/widgets/);
  assert.match(workflow, /MUSITU Axiom Official Support/);
});

test('canonical production deploy uses the proven direct Worker upload with strict inherited secrets and exact domain controls', async () => {
  const workflow = await readFile(resolve(root, '..', '.github', 'workflows', 'axiom-official-support-deploy.yml'), 'utf8');
  assert.match(workflow, /esbuild@0\.25\.11 support\/app\.js --bundle/);
  assert.match(workflow, /workers\/scripts/);
  assert.match(workflow, /bindings_inherit=strict/);
  assert.match(workflow, /type:'inherit',name:'SUPPORT_DATA_KEY_B64'/);
  assert.match(workflow, /type:'inherit',name:'TURNSTILE_SECRET_KEY'/);
  assert.match(workflow, /workers\/domains/);
  assert.match(workflow, /workers_dev|subdomain/);
  assert.match(workflow, /previews_enabled/);
  assert.match(workflow, /support\.mftintelligence\.com/);
  assert.doesNotMatch(workflow, /wrangler@4 secret list/);
  assert.doesNotMatch(workflow, /wrangler@4 deploy/);
});

test('canonical live probe preserves the managed edge challenge instead of weakening it', async () => {
  const workflow = await readFile(resolve(root, '..', '.github', 'workflows', 'axiom-official-support-deploy.yml'), 'utf8');
  assert.match(workflow, /cf-mitigated/);
  assert.match(workflow, /challenge/);
  assert.match(workflow, /PUBLIC_ORIGIN/);
  assert.match(workflow, /ANTI_ABUSE/);
  assert.match(workflow, /ACCESSIBILITY_REALITY/);
  assert.doesNotMatch(workflow, /skip|disable.*challenge|bypass.*challenge/i);
});
