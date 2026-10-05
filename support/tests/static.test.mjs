import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFile(resolve(root, path), 'utf8');

test('public support page has unique ids, complete scope and accessible form semantics', async () => {
  const html = await read('index.html');
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, new Set(ids).size);
  for (const phrase of ['OAuth and accounts', 'MCP integrations', 'quantitative results', 'billing', 'privacy', 'security', 'accessibility', 'incidents']) assert.match(html, new RegExp(phrase, 'i'));
  assert.match(html, /<main id="main">/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /consent_to_process/);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /mailto:support@mftintelligence\.com/i);
  assert.match(html, /challenges\.cloudflare\.com\/turnstile\/v0\/api\.js\?render=explicit/);
  assert.match(html, /id="turnstile-widget"/);
});

test('support browser sends only relative same-origin intake and performs local secret inspection', async () => {
  const source = await read('app.js');
  assert.match(source, /inspectSecretMaterial/);
  assert.match(source, /fetch\('\/api\/v1\/cases'/);
  assert.match(source, /fetch\('\/api\/v1\/config'/);
  assert.match(source, /turnstile_token/);
  assert.doesNotMatch(source, /https?:\/\//);
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/);
});

test('support UI includes responsive, reduced-motion, contrast and dark-mode behavior', async () => {
  const css = await read('styles.css');
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /prefers-contrast:more/);
  assert.match(css, /prefers-color-scheme:dark/);
});

test('static asset deployment excludes server, schema, tests and operating documents', async () => {
  const [ignore, headers] = await Promise.all([read('.assetsignore'), read('_headers')]);
  for (const entry of ['tests/', 'scripts/', '*.md', 'schema.sql', 'worker.js', 'crypto_envelope.js', 'd1_case_store.js', 'evidence_packages.js', 'readiness.js', 'wrangler.*']) assert.match(ignore, new RegExp(entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(headers, /Content-Security-Policy/);
  assert.match(headers, /frame-ancestors 'none'/);
  assert.match(headers, /frame-src https:\/\/challenges\.cloudflare\.com/);
  assert.match(headers, /Permissions-Policy/);
});

test('D1 schema keeps events append-only and avoids plaintext narrative columns', async () => {
  const sql = await read('schema.sql');
  assert.match(sql, /support_case_event_no_update/);
  assert.match(sql, /support_case_event_no_delete/);
  assert.match(sql, /encrypted_payload TEXT NOT NULL/);
  assert.doesNotMatch(sql, /description TEXT|reproduction TEXT|impact TEXT/i);
});

test('deployment documentation refuses unverified public and operating claims', async () => {
  const [readme, policy, threat] = await Promise.all([read('README.md'), read('POLICY.md'), read('THREAT_MODEL.md')]);
  assert.match(readme, /not a live claim until deployment verification passes/i);
  assert.match(readme, /designated, trained human support owner/i);
  assert.match(policy, /not contractual guarantees/i);
  assert.match(threat, /human role identities remain deployment prerequisites/i);
});
