import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {
  SUPPORT_ACCOUNT_ID,
  SUPPORT_BRANCH,
  cloudflareRequest,
  selectCloudflareCredential,
} from './provision_cloudflare_d1.mjs';
import {SUPPORT_ZONE_ID, SUPPORT_ZONE_NAME, SUPPORT_EMAIL_ALIAS} from './verify_cloudflare_email_routing.mjs';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MIGRATION_CONFIRM = 'MIGRATE_MUSITU_AXIOM_EMAIL_ROUTING';
const RETIREMENT_CONFIRM = 'RETIRE_UNUSED_ZOHO_TEST_MAILBOXES';
const ROUTING_DKIM_NAME = `cf2024-1._domainkey.${SUPPORT_ZONE_NAME}`;
const RETIRED_ZOHO_SPF = 'v=spf1 include:zohomail.com ~all';
const PROTECTED_PROVIDER_HOSTS = [
  'auth.mftintelligence.com',
  'mcp.mftintelligence.com',
  'claude-auth.mftintelligence.com',
  'claude-mcp.mftintelligence.com',
];

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function normalizedName(name) {
  const value = String(name || '').trim().toLowerCase();
  return value === '@' ? SUPPORT_ZONE_NAME : value;
}

function normalizeTxtContent(raw) {
  const content = String(raw || '').trim();
  const chunks = [...content.matchAll(/"((?:\\.|[^"])*)"/g)];
  if (chunks.length) {
    const consumed = chunks.map(match => match[0]).join('');
    const compact = content.replace(/\s+/g, '');
    if (consumed.replace(/\s+/g, '') === compact) {
      return chunks.map(match => match[1].replace(/\\(["\\])/g, '$1')).join('');
    }
  }
  if (content.length >= 2 && content.startsWith('"') && content.endsWith('"')) {
    return content.slice(1, -1);
  }
  return content;
}

function normalizeRecord(row, {keepId = false} = {}) {
  const type = String(row?.type || '').toUpperCase();
  let content = String(row?.content || '').trim();
  if (type === 'TXT') {
    content = normalizeTxtContent(content);
  } else {
    content = content.replace(/\.$/, '');
  }
  const out = {
    type,
    name: normalizedName(row?.name),
    content,
    priority: type === 'MX' && row?.priority !== null && row?.priority !== undefined && Number.isFinite(Number(row.priority)) ? Number(row.priority) : null,
    ttl: Number.isFinite(Number(row?.ttl)) ? Number(row.ttl) : 1,
  };
  if (keepId) out.id = String(row?.id || '');
  return out;
}

function isSpf(row) {
  const value = normalizeRecord(row);
  return value.type === 'TXT' && value.name === SUPPORT_ZONE_NAME && value.content.toLowerCase().startsWith('v=spf1');
}

function isRetiredZohoSpf(row) {
  const value = normalizeRecord(row);
  return isSpf(value) && value.content.toLowerCase() === RETIRED_ZOHO_SPF;
}

function isRoutingDkim(row) {
  const value = normalizeRecord(row);
  return value.type === 'TXT' && value.name === ROUTING_DKIM_NAME && value.content.toLowerCase().startsWith('v=dkim1');
}

function isRoutingDkimName(row) {
  const value = normalizeRecord(row);
  return value.type === 'TXT' && value.name === ROUTING_DKIM_NAME;
}

function isMailRecord(row) {
  const value = normalizeRecord(row);
  return (value.type === 'MX' && value.name === SUPPORT_ZONE_NAME) || isSpf(value);
}

function recordKey(row) {
  const value = normalizeRecord(row);
  const content = value.type === 'MX' ? value.content.toLowerCase() : value.content;
  return JSON.stringify({type: value.type, name: value.name, content, priority: value.priority});
}

function sameRecordSet(left, right) {
  const a = left.map(recordKey).sort();
  const b = right.map(recordKey).sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function fingerprintRecords(rows) {
  return sha256(JSON.stringify(rows.map(row => normalizeRecord(row)).sort((a, b) => recordKey(a).localeCompare(recordKey(b)))));
}

function targetsSupport(rule) {
  return (Array.isArray(rule?.matchers) ? rule.matchers : []).some(row =>
    String(row?.type || '').toLowerCase() === 'literal' &&
    String(row?.field || '').toLowerCase() === 'to' &&
    String(row?.value || '').trim().toLowerCase() === SUPPORT_EMAIL_ALIAS,
  );
}

function exactForward(rule, destination) {
  if (rule?.enabled !== true) return false;
  const actions = Array.isArray(rule?.actions) ? rule.actions : [];
  if (actions.length !== 1 || String(actions[0]?.type || '').toLowerCase() !== 'forward') return false;
  const values = Array.isArray(actions[0]?.value) ? actions[0].value : [];
  return values.length === 1 && String(values[0] || '').trim().toLowerCase() === destination;
}

function safeDisabledDropAll(rule) {
  if (rule?.enabled !== false) return false;
  const matchers = Array.isArray(rule?.matchers) ? rule.matchers : [];
  const actions = Array.isArray(rule?.actions) ? rule.actions : [];
  return matchers.length === 1 &&
    String(matchers[0]?.type || '').toLowerCase() === 'all' &&
    actions.length === 1 &&
    String(actions[0]?.type || '').toLowerCase() === 'drop';
}

async function getResult({fetchImpl, headers, path}) {
  return (await cloudflareRequest({fetchImpl, headers, path})).result;
}

async function readRootMail({fetchImpl, headers}) {
  const rows = await getResult({
    fetchImpl,
    headers,
    path: `/zones/${SUPPORT_ZONE_ID}/dns_records?name=${encodeURIComponent(SUPPORT_ZONE_NAME)}&per_page=100`,
  });
  return (Array.isArray(rows) ? rows : []).filter(isMailRecord).map(row => normalizeRecord(row, {keepId: true}));
}

async function readRoutingDkim({fetchImpl, headers}) {
  const rows = await getResult({
    fetchImpl,
    headers,
    path: `/zones/${SUPPORT_ZONE_ID}/dns_records?name=${encodeURIComponent(ROUTING_DKIM_NAME)}&per_page=100`,
  });
  return (Array.isArray(rows) ? rows : []).filter(isRoutingDkimName).map(row => normalizeRecord(row, {keepId: true}));
}

async function readRoutingMail({fetchImpl, headers}) {
  const [root, dkim] = await Promise.all([
    readRootMail({fetchImpl, headers}),
    readRoutingDkim({fetchImpl, headers}),
  ]);
  return [...root, ...dkim];
}

async function readProtectedProviderDns({fetchImpl, headers}) {
  const result = {};
  for (const host of PROTECTED_PROVIDER_HOSTS) {
    const rows = await getResult({
      fetchImpl,
      headers,
      path: `/zones/${SUPPORT_ZONE_ID}/dns_records?name=${encodeURIComponent(host)}&per_page=100`,
    });
    const normalized = (Array.isArray(rows) ? rows : []).map(row => normalizeRecord(row));
    result[host] = {count: normalized.length, fingerprint_sha256: fingerprintRecords(normalized)};
  }
  return result;
}

function sameProtectedProviderDns(before, after) {
  return PROTECTED_PROVIDER_HOSTS.every(host =>
    before?.[host]?.count === after?.[host]?.count &&
    before?.[host]?.fingerprint_sha256 === after?.[host]?.fingerprint_sha256,
  );
}

async function readDestination({fetchImpl, headers, destination}) {
  const rows = await getResult({
    fetchImpl,
    headers,
    path: `/accounts/${SUPPORT_ACCOUNT_ID}/email/routing/addresses?page=1&per_page=100`,
  });
  const matches = (Array.isArray(rows) ? rows : []).filter(row => String(row?.email || '').trim().toLowerCase() === destination);
  return {
    matchCount: matches.length,
    verified: matches.length === 1 && (matches[0]?.verified === true || (typeof matches[0]?.verified === 'string' && matches[0].verified.length > 0)),
  };
}

async function readRules({fetchImpl, headers}) {
  const rows = await getResult({
    fetchImpl,
    headers,
    path: `/zones/${SUPPORT_ZONE_ID}/email/routing/rules?page=1&per_page=100`,
  });
  return Array.isArray(rows) ? rows : [];
}

async function readCatchAll({fetchImpl, headers}) {
  return getResult({
    fetchImpl,
    headers,
    path: `/zones/${SUPPORT_ZONE_ID}/email/routing/rules/catch_all`,
  });
}

function catchAllSafeForRetirement(rule) {
  if (rule?.enabled !== true) return true;
  const actions = Array.isArray(rule?.actions) ? rule.actions : [];
  return actions.length === 1 && String(actions[0]?.type || '').toLowerCase() === 'drop';
}

async function ensureSupportRule({fetchImpl, headers, destination}) {
  const rules = await readRules({fetchImpl, headers});
  const unrelated = rules.filter(rule => !targetsSupport(rule) && !safeDisabledDropAll(rule));
  if (unrelated.length) throw new Error('unexpected non-support Email Routing rule exists');
  const matches = rules.filter(targetsSupport);
  const exact = matches.filter(rule => exactForward(rule, destination));
  const conflict = matches.filter(rule => !exactForward(rule, destination));
  if (conflict.length || exact.length > 1) throw new Error('conflicting support Email Routing rule exists');
  if (exact.length === 1) return {id: String(exact[0]?.id || ''), created: false};
  const payload = await cloudflareRequest({
    fetchImpl,
    headers,
    path: `/zones/${SUPPORT_ZONE_ID}/email/routing/rules`,
    method: 'POST',
    body: {
      name: 'MUSITU Axiom official support',
      enabled: true,
      matchers: [{type: 'literal', field: 'to', value: SUPPORT_EMAIL_ALIAS}],
      actions: [{type: 'forward', value: [destination]}],
    },
  });
  const id = String(payload?.result?.id || '');
  if (!id) throw new Error('Cloudflare did not return a support routing rule id');
  return {id, created: true};
}

async function routingState({fetchImpl, headers}) {
  const row = await getResult({fetchImpl, headers, path: `/zones/${SUPPORT_ZONE_ID}/email/routing`});
  const status = String(row?.status || '').toLowerCase();
  return {enabled: row?.enabled === true, status, ready: row?.enabled === true && ['ready', 'active'].includes(status)};
}

async function waitForRoutingConvergence({
  fetchImpl,
  headers,
  desiredMail,
  sleepImpl,
  attempts = 90,
  delayMs = 2000,
}) {
  let afterRouting = null;
  let afterMail = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    [afterRouting, afterMail] = await Promise.all([
      routingState({fetchImpl, headers}),
      readRoutingMail({fetchImpl, headers}),
    ]);
    if (afterRouting.ready && sameRecordSet(afterMail, desiredMail)) {
      return {afterRouting, afterMail, attemptsUsed: attempt};
    }
    if (attempt < attempts) await sleepImpl(delayMs);
  }
  if (!afterRouting?.ready) throw new Error('EMAIL_ROUTING_NOT_READY');
  throw new Error('EMAIL_ROUTING_DNS_NOT_CONVERGED');
}

async function requiredDns({fetchImpl, headers}) {
  const rows = await getResult({fetchImpl, headers, path: `/zones/${SUPPORT_ZONE_ID}/email/routing/dns`});
  const normalized = (Array.isArray(rows) ? rows : []).map(row => normalizeRecord(row))
    .filter(row => isMailRecord(row) || isRoutingDkimName(row));
  if (!normalized.some(row => row.type === 'MX')) throw new Error('Cloudflare Email Routing returned no required MX records');
  if (!normalized.some(isSpf)) throw new Error('Cloudflare Email Routing returned no required SPF record');
  const dkim = normalized.filter(isRoutingDkimName);
  if (dkim.length !== 1 || !isRoutingDkim(dkim[0])) throw new Error('Cloudflare Email Routing returned no exact required DKIM record');
  return normalized;
}

async function ensureRequiredRoutingAuthDns({fetchImpl, headers, desired}) {
  let current = await readRoutingMail({fetchImpl, headers});
  const desiredKeys = new Set(desired.map(recordKey));
  const unexpectedSpfOrDkim = current.filter(row =>
    (isSpf(row) || isRoutingDkimName(row)) && !desiredKeys.has(recordKey(row))
  );
  if (unexpectedSpfOrDkim.length) {
    const shape = rows => rows.filter(row => isSpf(row) || isRoutingDkimName(row)).map(row => {
      const value = normalizeRecord(row);
      return {
        type: value.type,
        name: value.name,
        priority: value.priority,
        content_length: value.content.length,
        content_sha256: sha256(value.content),
        public_spf_value: isSpf(value) ? value.content : null,
        valid_spf: isSpf(value),
        valid_routing_dkim: isRoutingDkim(value),
      };
    });
    throw new Error(`unexpected SPF or routing DKIM conflicts with Cloudflare required DNS; current=${JSON.stringify(shape(current))}; desired=${JSON.stringify(shape(desired))}`);
  }

  const missing = desired.filter(row => !new Set(current.map(recordKey)).has(recordKey(row)));
  for (const row of missing) {
    if (row.type !== 'TXT') throw new Error('Cloudflare activation did not create required MX records');
    const body = {type: row.type, name: row.name, content: row.content, ttl: row.ttl || 1};
    await cloudflareRequest({
      fetchImpl,
      headers,
      path: `/zones/${SUPPORT_ZONE_ID}/dns_records`,
      method: 'POST',
      body,
    });
  }
  current = await readRoutingMail({fetchImpl, headers});
  if (!sameRecordSet(current, desired)) throw new Error('Cloudflare required Email Routing DNS did not converge after exact TXT repair');
  return {created: missing.length, current};
}

async function removeConflictingRootMx({fetchImpl, headers, current, desired}) {
  const desiredKeys = new Set(desired.map(recordKey));
  const desiredMx = new Set(desired.filter(row => row.type === 'MX').map(recordKey));
  const unauthorizedAuthConflicts = current.filter(row =>
    (isSpf(row) || isRoutingDkimName(row)) &&
    !desiredKeys.has(recordKey(row)) &&
    !isRetiredZohoSpf(row)
  );
  if (unauthorizedAuthConflicts.length) {
    throw new Error('unexpected non-Zoho SPF or routing DKIM conflict exists before migration');
  }
  const conflicts = current.filter(row =>
    (row.type === 'MX' && !desiredMx.has(recordKey(row))) ||
    (isRetiredZohoSpf(row) && !desiredKeys.has(recordKey(row)))
  );
  for (const row of conflicts) {
    if (!row.id) throw new Error('conflicting retired-provider mail record has no id for bounded migration');
    await cloudflareRequest({
      fetchImpl,
      headers,
      path: `/zones/${SUPPORT_ZONE_ID}/dns_records/${encodeURIComponent(row.id)}`,
      method: 'DELETE',
    });
  }
  const after = await readRoutingMail({fetchImpl, headers});
  const remainingConflict = after.some(row =>
    (row.type === 'MX' && !desiredMx.has(recordKey(row))) ||
    (isRetiredZohoSpf(row) && !desiredKeys.has(recordKey(row)))
  );
  if (remainingConflict) throw new Error('conflicting retired-provider mail record remains after bounded migration delete');
  return {
    mx: conflicts.filter(row => row.type === 'MX').length,
    zoho_spf: conflicts.filter(isRetiredZohoSpf).length,
  };
}

async function deleteRule({fetchImpl, headers, id}) {
  if (!id) return;
  await cloudflareRequest({fetchImpl, headers, path: `/zones/${SUPPORT_ZONE_ID}/email/routing/rules/${encodeURIComponent(id)}`, method: 'DELETE'});
}

async function restoreRootMail({fetchImpl, headers, snapshot}) {
  try {
    await cloudflareRequest({fetchImpl, headers, path: `/zones/${SUPPORT_ZONE_ID}/email/routing/dns`, method: 'DELETE'});
  } catch (error) {
    if (![409, 422].includes(Number(error?.status))) throw error;
  }
  const current = await readRoutingMail({fetchImpl, headers});
  const wantedKeys = new Set(snapshot.map(recordKey));
  for (const row of current) {
    if (!wantedKeys.has(recordKey(row)) && row.id) {
      await cloudflareRequest({fetchImpl, headers, path: `/zones/${SUPPORT_ZONE_ID}/dns_records/${encodeURIComponent(row.id)}`, method: 'DELETE'});
    }
  }
  const afterDelete = await readRoutingMail({fetchImpl, headers});
  const existingKeys = new Set(afterDelete.map(recordKey));
  for (const row of snapshot) {
    if (existingKeys.has(recordKey(row))) continue;
    const body = {type: row.type, name: row.name, content: row.content, ttl: row.ttl || 1};
    if (row.type === 'MX' && row.priority !== null) body.priority = row.priority;
    await cloudflareRequest({fetchImpl, headers, path: `/zones/${SUPPORT_ZONE_ID}/dns_records`, method: 'POST', body});
  }
  const restored = await readRoutingMail({fetchImpl, headers});
  if (!sameRecordSet(restored, snapshot)) throw new Error('root mail DNS rollback verification failed');
  return restored;
}

export async function migrateEmailRouting({
  env = process.env,
  fetchImpl = fetch,
  now = new Date().toISOString(),
  sleepImpl = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  if (env.GITHUB_REF_NAME !== SUPPORT_BRANCH) throw new Error('email-routing migration may run only from the isolated support branch');
  if (env.SUPPORT_EMAIL_ROUTING_MIGRATION_CONFIRM !== MIGRATION_CONFIRM) throw new Error('email-routing migration confirmation is missing');
  if (env.SUPPORT_ZOHO_RETIREMENT_CONFIRM !== RETIREMENT_CONFIRM) throw new Error('Zoho retirement confirmation is missing');
  const destination = String(env.SUPPORT_MAILBOX_DESTINATION || '').trim().toLowerCase();
  if (!EMAIL.test(destination)) throw new Error('approved support mailbox destination is invalid');

  const credential = await selectCloudflareCredential({fetchImpl, env});
  const destinationState = await readDestination({fetchImpl, headers: credential.headers, destination});
  if (destinationState.matchCount !== 1 || !destinationState.verified) throw new Error('approved support destination is not verified');
  const catchAll = await readCatchAll({fetchImpl, headers: credential.headers});
  if (!catchAllSafeForRetirement(catchAll)) throw new Error('catch-all routing must be disabled or dropping mail before retiring Zoho test mailboxes');

  const beforeMail = await readRoutingMail({fetchImpl, headers: credential.headers});
  const beforeProtected = await readProtectedProviderDns({fetchImpl, headers: credential.headers});
  const desiredMail = await requiredDns({fetchImpl, headers: credential.headers});
  const initialRouting = await routingState({fetchImpl, headers: credential.headers});

  let supportRule = null;
  let cutoverPerformed = false;
  try {
    supportRule = await ensureSupportRule({fetchImpl, headers: credential.headers, destination});
    if (!initialRouting.ready || !sameRecordSet(beforeMail, desiredMail)) {
      cutoverPerformed = true;
      await removeConflictingRootMx({
        fetchImpl,
        headers: credential.headers,
        current: beforeMail,
        desired: desiredMail,
      });
      await cloudflareRequest({
        fetchImpl,
        headers: credential.headers,
        path: `/zones/${SUPPORT_ZONE_ID}/email/routing/dns`,
        method: 'POST',
      });
      await ensureRequiredRoutingAuthDns({
        fetchImpl,
        headers: credential.headers,
        desired: desiredMail,
      });
    }

    const {afterRouting, afterMail} = await waitForRoutingConvergence({
      fetchImpl,
      headers: credential.headers,
      desiredMail,
      sleepImpl,
    });
    const [afterRules, afterProtected] = await Promise.all([
      readRules({fetchImpl, headers: credential.headers}),
      readProtectedProviderDns({fetchImpl, headers: credential.headers}),
    ]);
    const effectiveRules = afterRules.filter(rule => !safeDisabledDropAll(rule));
    const supportMatches = effectiveRules.filter(targetsSupport);
    const supportExact = effectiveRules.length === 1 && supportMatches.length === 1 && exactForward(supportMatches[0], destination);
    const providerUnchanged = sameProtectedProviderDns(beforeProtected, afterProtected);
    if (!supportExact) throw new Error('SUPPORT_RULE_NOT_EXACT');
    if (!providerUnchanged) throw new Error('PROTECTED_PROVIDER_DNS_DRIFT');

    return {
      schema: 'musitu.axiom.official-support-email-routing-migration-evidence.v1',
      gate: 'MUSITU_AXIOM_SUPPORT_EMAIL_ROUTING_MIGRATION_PASS',
      recorded_at: now,
      repository: String(env.GITHUB_REPOSITORY || ''),
      branch: String(env.GITHUB_REF_NAME || ''),
      source_commit: String(env.GITHUB_SHA || ''),
      authentication_mode: credential.mode,
      approved_destination: {
        fingerprint_sha256: sha256(destination),
        verified: true,
        raw_address_recorded: false,
        required_destination_count: 1,
        created_destination_count: 0,
      },
      retired_zoho_test_mailboxes: {
        count: 2,
        authorization: 'explicit_retirement',
        forwarding_rules_created: 0,
        raw_addresses_recorded: false,
      },
      prior_mail_dns: {
        record_count: beforeMail.length,
        fingerprint_sha256: fingerprintRecords(beforeMail),
        rollback_snapshot_held_ephemerally: true,
        record_ids_persisted: false,
      },
      target_mail_dns: {
        record_count: desiredMail.length,
        mx_count: desiredMail.filter(row => row.type === 'MX').length,
        spf_count: desiredMail.filter(isSpf).length,
        dkim_count: desiredMail.filter(isRoutingDkim).length,
        fingerprint_sha256: fingerprintRecords(desiredMail),
      },
      routing: afterRouting,
      support_rule: {exact_present: true, created: supportRule.created, unrelated_rules_present: false},
      catch_all: {safe_for_retirement: true, raw_rule_recorded: false},
      protected_provider_dns: {
        hosts: PROTECTED_PROVIDER_HOSTS.length,
        before_fingerprint_sha256: sha256(JSON.stringify(beforeProtected)),
        after_fingerprint_sha256: sha256(JSON.stringify(afterProtected)),
        unchanged: true,
      },
      cutover_performed: cutoverPerformed,
      rollback: {performed: false},
      delivery_verified: false,
      public_support_deployed: false,
      openai_surface_modified: false,
      claude_surface_modified: false,
      secrets_exposed: false,
    };
  } catch (error) {
    if (!cutoverPerformed) {
      if (supportRule?.created) await deleteRule({fetchImpl, headers: credential.headers, id: supportRule.id});
      throw error;
    }
    let rollbackOk = false;
    try {
      await restoreRootMail({fetchImpl, headers: credential.headers, snapshot: beforeMail});
      if (supportRule?.created) await deleteRule({fetchImpl, headers: credential.headers, id: supportRule.id});
      const restoredProtected = await readProtectedProviderDns({fetchImpl, headers: credential.headers});
      rollbackOk = sameProtectedProviderDns(beforeProtected, restoredProtected);
    } catch {
      rollbackOk = false;
    }
    const code = String(error?.message || 'MIGRATION_VERIFICATION_FAILED').replace(/[^A-Z0-9_]/gi, '_').toUpperCase();
    if (rollbackOk) throw new Error(`${code}_ROLLED_BACK`);
    throw new Error(`${code}_ROLLBACK_FAILED`);
  }
}

export async function main(env = process.env, fetchImpl = fetch) {
  const sentinel = await readFile(new URL('../MIGRATE_CLOUDFLARE_EMAIL_ROUTING.authorized', import.meta.url), 'utf8');
  if (sentinel !== `${MIGRATION_CONFIRM}\n${RETIREMENT_CONFIRM}\n`) throw new Error('email-routing migration authorization file is invalid');
  const evidence = await migrateEmailRouting({env, fetchImpl});
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  const digest = sha256(serialized);
  const output = env.SUPPORT_EMAIL_ROUTING_MIGRATION_OUTPUT || 'support-email-routing-migration.json';
  await writeFile(output, serialized, {encoding: 'utf8', mode: 0o600, flag: 'wx'});
  await writeFile(`${output}.sha256`, `${digest}  ${output}\n`, {encoding: 'utf8', mode: 0o600, flag: 'wx'});
  process.stdout.write(`${JSON.stringify({gate: evidence.gate, evidence_sha256: digest, delivery_verified: false, public_support_deployed: false})}\n`);
  return evidence;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main();
