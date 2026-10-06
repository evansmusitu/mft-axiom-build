import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBenchmarkReport, canonicalJson } from './benchmark.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const output = outputIndex >= 0 ? args[outputIndex + 1] : null;
if (outputIndex >= 0 && !output) throw new Error('--output requires a file path');

const musitu = JSON.parse(
  fs.readFileSync(path.join(here, 'fixtures', 'musitu-internal-controlled.json'), 'utf8'),
);
const report = buildBenchmarkReport({ musitu, competitors: [] });
const body = `${canonicalJson(report)}\n`;
if (output) {
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, body);
} else {
  process.stdout.write(body);
}
console.error(
  `MUSITU_DELIVERY_OS_BENCHMARK_POLICY_PASS claim_status=${report.claim_status} comparison_ready=${report.comparison_ready}`,
);
