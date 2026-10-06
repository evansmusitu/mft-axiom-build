import fs from 'node:fs';
import path from 'node:path';
import { probeOnfleetAccess, probeBringgAccess } from './external-access.mjs';

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const offline = process.argv.includes('--offline');
const requireReady = process.argv.includes('--require-ready');
const output = argValue('--output');
if (process.argv.includes('--output') && !output) throw new Error('--output requires a file path');

const emptyFetch = async () => { throw new Error('network must not be used in offline mode'); };
const fetchImpl = offline ? emptyFetch : fetch;

const onfleet = await probeOnfleetAccess({
  apiKey: offline ? '' : process.env.ONFLEET_TEST_API_KEY,
  fetchImpl,
});
const bringg = await probeBringgAccess({
  tokenUrl: offline ? '' : process.env.BRINGG_SANDBOX_TOKEN_URL,
  clientId: offline ? '' : process.env.BRINGG_SANDBOX_CLIENT_ID,
  clientSecret: offline ? '' : process.env.BRINGG_SANDBOX_CLIENT_SECRET,
  fetchImpl,
});

const report = {
  schema: 'musitu-delivery-benchmark-access-report.v1',
  mode: offline ? 'offline_contract_check' : 'live_sandbox_preflight',
  ready: onfleet.ready && bringg.ready,
  providers: { onfleet, bringg },
};
const body = `${JSON.stringify(report, null, 2)}\n`;

if (output) {
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, body);
} else {
  process.stdout.write(body);
}

console.error(
  `MUSITU_DELIVERY_OS_EXTERNAL_ACCESS_${report.ready ? 'READY' : 'BLOCKED'} mode=${report.mode}`,
);
if (requireReady && !report.ready) process.exitCode = 2;
