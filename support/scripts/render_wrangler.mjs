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

export function validateDeploymentConfig(value) {
  const errors = [];
  if (!NAME.test(value.workerName || '')) errors.push('workerName must be a safe Cloudflare Worker name');
  if (!NAME.test(value.databaseName || '')) errors.push('databaseName must be a safe D1 name');
  if (!UUID.test(value.databaseId || '')) errors.push('databaseId must be a UUID');
  if (!NAME.test(value.abuseGateService || '')) errors.push('abuseGateService must be a safe service name');
  if (!DOMAIN.test(value.supportDomain || '')) errors.push('supportDomain must be a controlled mftintelligence.com hostname');
  if (!OWNER.test(value.humanOwnerRef || '')) errors.push('humanOwnerRef must be an opaque owner reference');
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
    '__ABUSE_GATE_SERVICE__': value.abuseGateService,
    '__SUPPORT_DOMAIN__': value.supportDomain,
    '__HUMAN_OWNER_REF__': value.humanOwnerRef,
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
    abuseGateService: process.env.SUPPORT_ABUSE_GATE_SERVICE,
    supportDomain: process.env.SUPPORT_DOMAIN,
    humanOwnerRef: process.env.SUPPORT_HUMAN_OWNER_REF,
    readinessSha256: process.env.SUPPORT_READINESS_SHA256,
  };
  const rendered = renderWranglerTemplate(await readFile(templatePath, 'utf8'), input);
  await writeFile(outputPath, rendered, {encoding: 'utf8', mode: 0o600, flag: 'wx'});
  process.stdout.write(`${outputPath}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main();
