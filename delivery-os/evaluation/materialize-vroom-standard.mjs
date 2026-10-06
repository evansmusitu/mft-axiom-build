import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './benchmark.mjs';
import { generateStandardWorkload } from './standard-workload.mjs';
import { buildStandardVroomInput } from './vroom-standard.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const scenario = JSON.parse(fs.readFileSync(path.join(here, 'scenario.standard-v2.json'), 'utf8'));
const workload = generateStandardWorkload(scenario);
const input = buildStandardVroomInput(workload);
const outputIndex = process.argv.indexOf('--output');
const output = outputIndex >= 0 ? process.argv[outputIndex + 1] : null;
if (!output) throw new Error('--output requires a file path');
const artifact = {
  schema: 'musitu-delivery-vroom-request-artifact.v1',
  status: 'LIVE_VROOM_REQUIRED',
  claim_status: 'NOT_CERTIFIED',
  metadata: input.metadata,
  request: { vehicles: input.vehicles, jobs: input.jobs },
};
fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
fs.writeFileSync(output, canonicalJson(artifact));
console.error(`MUSITU_DELIVERY_OS_VROOM_REQUEST_READY workload_sha256=${input.metadata.workload_sha256} vehicles=${input.vehicles.length} jobs=${input.jobs.length} status=${artifact.status}`);
