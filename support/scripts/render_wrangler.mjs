import {readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {dirname, resolve} from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const HASH = /^[a-f0-9]{64}$/i;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+mftintelligence\.com$/;
const OWNER = /^[a-z][a-z0-9._:-]{7,191}$/i;
const TURNSTILE_SITE_KEY = /^[A-Za-z0-9_-]{20,100}$/;

export function validateDeploymentConfig(value) {
  const errors = [];
  if (!NAME.test(value.workerName || '')) errors.push('workerName must be a safe Cloudflare Worker name');
  if (!NAME.test(value.databaseName || '')) errors.push('databaseName must be a safe D1 name');
  if (!UUID.test(value.databaseId || '')) errors.push('databaseId must be a UUID');
  if (!TURNSTILE_SITE_KEY.test(value.turnstileSiteKey || '')) errors.push('turnstileSiteKey must be a public Cloudflare Turnstile site key');
  if (!DOMAIN.test(value.supportDomain || '')) errors.push('supportDomain must be a controlled mftintelligence.com hostname');
  if (!OWNER.test(value.humanOwnerRef || '')) errors.push('humanOwnerRef must be an opaque owner reference');
  if (!OWNER.test(value.independentApproverRef || '')) errors.push('independentApproverRef must be an opaque approver reference');
  if (value.humanOwnerRef && value.independentApproverRef && value.humanOwnerRef === value.independentApproverRef) errors.push('owner and approver must be different people');
  if (!HASH.test(value.readinessSha256 || '')) errors.push('readinessSha256 must be a SHA-256 digest');
  if (errors.length) throw new TypeError(errors.join('; '));
  return value;
}

export function renderWranglerTemplate(template, input) {
  const value = validateDeploymentConfig(input);
  const replacements = {
    '__WORKER_NAME__': value.workerName,
    '__D1_DATABASE_NAME__': value.databaseName,
    '__D1_DATABASE_ID__': value.databaseId,
    '__TURNSTILE_SITE_KEY__': value.turnstileSiteKey,
    '__SUPPORT_DOMAIN__': value.supportDomain,
    '__HUMAN_OWNER_REF__': value.humanOwnerRef,
    '__INDEPENDENT_APPROVER_REF__': value.independentApproverRef,
    '__READINESS_SHA256__': value.readinessSha256.toLowerCase(),
  };
  let rendered = template;
  for (const [marker, replacement] of Object.entries(replacements)) rendered = rendered.replaceAll(marker, replacement);
  if (/__[A-Z0-9_]+__/.test(rendered)) throw new TypeError('unresolved deployment marker');
  JSON.parse(rendered);
  return rendered;
}

async function main() {
  const templatePath = resolve(root, 'support', 'wrangler.support.template.jsonc');
  const outputPath = resolve(root, process.argv[2] || 'support-wrangler.generated.json');
  const input = {
    workerName: process.env.SUPPORT_WORKER_NAME,
    databaseName: process.env.SUPPORT_D1_DATABASE_NAME,
    databaseId: process.env.SUPPORT_D1_DATABASE_ID,
    turnstileSiteKey: process.env.SUPPORT_TURNSTILE_SITE_KEY,
    supportDomain: process.env.SUPPORT_DOMAIN,
    humanOwnerRef: process.env.SUPPORT_HUMAN_OWNER_REF,
    independentApproverRef: process.env.SUPPORT_INDEPENDENT_APPROVER_REF,
    readinessSha256: process.env.SUPPORT_READINESS_SHA256,
  };
  const rendered = renderWranglerTemplate(await readFile(templatePath, 'utf8'), input);
  await writeFile(outputPath, rendered, {encoding: 'utf8', mode: 0o600, flag: 'wx'});
  process.stdout.write(`${outputPath}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main();
