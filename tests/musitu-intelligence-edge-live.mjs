import assert from 'node:assert/strict';

const origin = 'https://musitu-intelligence-edge-20261019.mft-education-nexus-93f395f5.workers.dev';
async function request(path, options = {}) {
  return fetch(origin + path, { ...options, signal: AbortSignal.timeout(65000) });
}

const health = await request('/api/health');
console.log('Health HTTP:', health.status);
assert.equal(health.status, 200);
const info = await health.json();
assert.equal(info.status, 'ok');
assert.equal(info.service, 'MUSITU Intelligence Edge');

const preflight = await request('/api/chat', {
  method: 'OPTIONS',
  headers: { origin: 'https://evansmusitu.github.io', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' }
});
assert.equal(preflight.status, 204);
assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://evansmusitu.github.io');

const denial = await request('/api/chat', {
  method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://random.example' },
  body: JSON.stringify({ prompt: 'Explain why testing software is important.', mode: 'build' })
});
assert.equal(denial.status, 403, 'Cross-origin browser requests must fail closed');

const invalid = await request('/api/chat', {
  method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evansmusitu.github.io' },
  body: JSON.stringify({ prompt: 'short', mode: 'learn' })
});
assert.equal(invalid.status, 400, 'Short prompts must be refused without inference');

const result = await request('/api/chat', {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: 'https://evansmusitu.github.io' },
  body: JSON.stringify({ prompt: 'Explain feedback control systems and why engineers use closed-loop control with an example.', mode: 'learn', history: [] })
});
console.log('AI inference HTTP:', result.status);
const body = await result.text();
let data;
try { data = JSON.parse(body); } catch { throw new Error('Unexpected AI payload: ' + body.slice(0, 300)); }
if (result.status !== 200) throw new Error('AI model failed: ' + JSON.stringify(data).slice(0, 500));
assert.equal(typeof data.reply, 'string');
assert.ok(data.reply.length > 50, 'AI response should not be an empty template');
assert.equal(data.liveSearch, false);
assert.equal(data.mode, 'learn');
console.log('CLOUDFLARE LIVE AI INFERENCE VERIFIED, chars:', data.reply.length);
console.log('Sample:', data.reply.slice(0, 220));
