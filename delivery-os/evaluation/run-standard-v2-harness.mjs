import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OptimizerClient } from '../core/src/optimizer.mjs';
import { canonicalJson } from './benchmark.mjs';
import { generateStandardWorkload } from './standard-workload.mjs';
import { runStandardV2Harness } from './standard-v2-harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const scenario = JSON.parse(fs.readFileSync(path.join(here, 'scenario.standard-v2.json'), 'utf8'));
const workload = generateStandardWorkload(scenario);

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const output = arg('--output');
const productHead = arg('--product-head') || process.env.GITHUB_SHA || null;
const capturedAt = arg('--captured-at') || new Date().toISOString();
const vroomUrl = arg('--vroom-url') || process.env.VROOM_URL || 'http://127.0.0.1:3000';
const vroomRelease = arg('--vroom-release') || process.env.VROOM_RELEASE || null;

if (!output) throw new Error('--output requires a file path');
if (!productHead) throw new Error('--product-head or GITHUB_SHA is required');

const artifact = await runStandardV2Harness({
  scenario,
  workload,
  optimizer: new OptimizerClient(vroomUrl),
  productHead,
  capturedAt,
  vroomRelease,
});

fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
fs.writeFileSync(output, `${canonicalJson(artifact)}\n`);
console.error(
  `MUSITU_DELIVERY_OS_STANDARD_V2_HARNESS_PASS workload_sha256=${artifact.workload_sha256} `
  + `provider=${artifact.planner.provider} delivered=${artifact.execution.orders_delivered} `
  + `disruptions=${artifact.execution.disruptions_applied} chain=${artifact.chain.valid}`,
);
