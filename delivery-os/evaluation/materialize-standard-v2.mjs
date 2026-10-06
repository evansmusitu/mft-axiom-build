import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './benchmark.mjs';
import { generateStandardWorkload, workloadFingerprint } from './standard-workload.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const scenario = JSON.parse(fs.readFileSync(path.join(here, 'scenario.standard-v2.json'), 'utf8'));
const workload = generateStandardWorkload(scenario);
const fingerprint = workloadFingerprint(workload);
const outputIndex = process.argv.indexOf('--output');
const output = outputIndex >= 0 ? process.argv[outputIndex + 1] : null;
if (outputIndex >= 0 && !output) throw new Error('--output requires a file path');
const body = canonicalJson(workload);
if (output) {
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, body);
  fs.writeFileSync(`${output}.sha256`, `${fingerprint}  ${path.basename(output)}\n`);
} else {
  process.stdout.write(body);
}
console.error(`MUSITU_DELIVERY_OS_STANDARD_V2_WORKLOAD_READY sha256=${fingerprint}`);
