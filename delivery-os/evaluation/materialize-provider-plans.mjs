import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './benchmark.mjs';
import { generateStandardWorkload } from './standard-workload.mjs';
import { buildOnfleetTaskPlan, buildBringgOrderPlan } from './provider-adapters.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const scenario = JSON.parse(fs.readFileSync(path.join(here, 'scenario.standard-v1.json'), 'utf8'));
const workload = generateStandardWorkload(scenario);
const outputIndex = process.argv.indexOf('--output-dir');
const outputDir = outputIndex >= 0 ? process.argv[outputIndex + 1] : null;
if (!outputDir) throw new Error('--output-dir requires a directory');
fs.mkdirSync(outputDir, { recursive: true });
const onfleet = buildOnfleetTaskPlan({ workload, city: 'Harare', country: 'Zimbabwe' });
const bringg = buildBringgOrderPlan({ workload });
fs.writeFileSync(path.join(outputDir, 'onfleet-standard-v1-plan.json'), canonicalJson(onfleet));
fs.writeFileSync(path.join(outputDir, 'bringg-standard-v1-blocked-plan.json'), canonicalJson(bringg));
console.error(`MUSITU_DELIVERY_OS_PROVIDER_PLANS_READY workload_sha256=${onfleet.workload_sha256} onfleet_requests=${onfleet.requests.length} bringg_ready=${bringg.ready}`);
