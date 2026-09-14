import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const read = name => readFile(resolve(root, name), 'utf8');

async function capabilityModule() {
  const source = await read('capability_registry.js');
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  return import(url);
}

test('native capability registry preserves the audited 74 → 2,400 boundary', async () => {
  const mod = await capabilityModule();
  assert.equal(mod.ATOMIC_OPERATIONS.length, 74);
  assert.equal(new Set(mod.ATOMIC_OPERATIONS).size, 74);
  assert.equal(mod.ARCHETYPES.length, 24);
  assert.equal(mod.INTENTS.length, 10);
  assert.equal(mod.CONTEXTS_PER_ARCHETYPE, 10);
  assert.equal(mod.DERIVED_CAPABILITY_COUNT, 2400);
  const atomic = new Set(mod.ATOMIC_OPERATIONS);
  for (const archetype of mod.ARCHETYPES) {
    assert.ok(archetype.ops.length >= 4);
    for (const op of archetype.ops) assert.ok(atomic.has(op), `${archetype.id} references unknown ${op}`);
  }
});

test('capability router remains compute-only and preview-only', async () => {
  const mod = await capabilityModule();
  const route = mod.routeCapability('stress test my portfolio and verify historical tail risk');
  assert.equal(route.side_effect_class, 'COMPUTE_ONLY');
  assert.equal(route.qualification, 'LOCAL_ROUTING_PREVIEW_NOT_EXECUTION');
  assert.equal(route.derived_catalog_size, 2400);
  assert.ok(route.atomic_operations.every(op => mod.ATOMIC_OPERATIONS.includes(op)));
  assert.match(route.archetype, /portfolio|drawdown/);
});

test('vNext shell has unique ids and the five-object outcome-first surfaces', async () => {
  const html = await read('index.html');
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(ids.length, new Set(ids).size, 'duplicate DOM id detected');
  for (const route of ['home','projects','work','agents','artifacts','research','analyze','build','create','live','computer','automations','developer','trust','settings']) {
    assert.match(html, new RegExp(`data-route="${route}"`));
  }
  assert.match(html, /What do you want accomplished|Ask AXIOM or delegate an outcome/);
  assert.match(html, /project-dialog/);
  assert.match(html, /work-dialog/);
});

test('vNext project/work adapter reuses earned stores and keeps fail-closed local boundaries', async () => {
  const source = await read('data_adapters.js');
  assert.match(source, /ProjectStore/);
  assert.match(source, /OutcomeContractStore/);
  assert.match(source, /BROWSER_LOCAL_INDEXEDDB/);
  assert.match(source, /PREVIEW_ONLY_NO_EXTERNAL_CONSEQUENTIAL_ACTIONS/);
  assert.match(source, /cloudSyncClaim:false/);
  assert.match(source, /multiDeviceSyncClaim:false/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /XMLHttpRequest/);
});

test('vNext application does not introduce direct network execution', async () => {
  const [app, adapter, registry] = await Promise.all([read('app.js'), read('data_adapters.js'), read('capability_registry.js')]);
  for (const [name, source] of [['app.js',app],['data_adapters.js',adapter],['capability_registry.js',registry]]) {
    assert.doesNotMatch(source, /\bfetch\s*\(/, `${name} introduced direct fetch`);
    assert.doesNotMatch(source, /XMLHttpRequest/, `${name} introduced XHR`);
    assert.doesNotMatch(source, /WebSocket\s*\(/, `${name} introduced WebSocket`);
  }
  assert.match(app, /initBrowserSession/);
  assert.match(app, /VNextDataAdapter/);
  assert.match(app, /Phase 13 · Independent review/);
  assert.match(app, /physical tablet scenario missing/);
  assert.match(app, /No world-best claim is authorized/);
});
