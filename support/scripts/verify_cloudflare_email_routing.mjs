import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {
  SUPPORT_ACCOUNT_ID,
  SUPPORT_BRANCH,
  cloudflareRequest,
  selectCloudflareCredential,
} from './provision_cloudflare_d1.mjs';
import {SUPPORT_DOMAIN, SUPPORT_WORKER_NAME} from './provision_cloudflare_control_plane.mjs';

export const SUPPORT_ZONE_ID = '5b56528f03948ff5917a5e0cd9f7109e';
export const SUPPORT_ZONE_NAME = 'mftintelligence.com';
export const SUPPORT_EMAIL_ALIAS = 'support@mftintelligence.com';
export const PROTECTED_OPENAI_HOSTS = ['auth.mftintelligence.com', 'mcp.mftintelligence.com'];
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function fingerprint(value) {
  return sha256(JSON.stringify(value));
}

function normalizeDns(records) {
  return [...records].map(row => ({
    type: String(row?.type || ''),
    name: String(row?.name || '').toLowerCase(),
    content: String(row?.content || ''),
    priority: Number.isFinite(Number(row?.priority)) ? Number(row.priority) : null,
    proxied: typeof row?.proxied === 'boolean' ? row.proxied : null,
  })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function mailRecordKey(row) {
  const name = row.name === '@' ? SUPPORT_ZONE_NAME : row.name;
  return JSON.stringify({type: row.type, name, content: row.content.toLowerCase().replace(/\.$/, ''), priority: row.priority});
}

function sameRecordSet(left, right) {
  const a = left.map(mailRecordKey).sort();
  const b = right.map(mailRecordKey).sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function classifyMxProvider(records) {
  if (!records.length) return 'none';
  const values = records.map(row => row.content.toLowerCase().replace(/\.$/, ''));
  if (values.every(value => value.endsWith('.mx.cloudflare.net'))) return 'cloudflare_email_routing';
  if (values.every(value => value.endsWith('.google.com') || value.endsWith('.googlemail.com'))) return 'google_workspace';
  if (values.every(value => value.endsWith('.outlook.com') || value.endsWith('.protection.outlook.com'))) return 'microsoft_365';
  if (values.every(value => value.includes('.zoho.'))) return 'zoho_mail';
  if (values.every(value => value.endsWith('.registrar-servers.com'))) return 'namecheap_mail';
  if (values.every(value => value.endsWith('.forwardemail.net'))) return 'forward_email';
  return 'other_or_mixed';
}

async function safeCloudflareRead({fetchImpl, headers, path}) {
  try {
    const payload = await cloudflareRequest({fetchImpl, headers, path});
    return {ok: true, http_status: 200, result: payload.result};
  } catch (error) {
    return {ok: false, http_status: Number(error?.status) || 0, result: null};
  }
}

function matcherTargetsSupport(rule) {
  return (Array.isArray(rule?.matchers) ? rule.matchers : []).some(row =>
    String(row?.type || '').toLowerCase() === 'literal' &&
    String(row?.field || '').toLowerCase() === 'to' &&
    String(row?.value || '').trim().toLowerCase() === SUPPORT_EMAIL_ALIAS,
  );
}

function exactForward(rule, destinationEmail) {
  const actions = Array.isArray(rule?.actions) ? rule.actions : [];
  if (rule?.enabled !== true || actions.length !== 1 || String(actions[0]?.type || '').toLowerCase() !== 'forward') return false;
  const values = Array.isArray(actions[0]?.value) ? actions[0].value : [];
  return values.length === 1 && String(values[0] || '').trim().toLowerCase() === destinationEmail;
}

function scrubbedRule(rule, destinationEmail) {
  return {
    enabled: rule?.enabled === true,
    matchers: (Array.isArray(rule?.matchers) ? rule.matchers : []).map(row => ({
      type: String(row?.type || ''),
      field: String(row?.field || ''),
      value: String(row?.value || '').trim().toLowerCase() === SUPPORT_EMAIL_ALIAS ? 'support_alias' : 'other_match',
    })),
    actions: (Array.isArray(rule?.actions) ? rule.actions : []).map(row => ({
      type: String(row?.type || ''),
      value: (Array.isArray(row?.value) ? row.value : []).map(value =>
        String(value || '').trim().toLowerCase() === destinationEmail ? 'approved_destination' : 'other_destination',
      ),
    })),
  };
}

export function buildEmailRoutingEvidence(input) {
  const allowed = new Set(['destinationEmail', 'destination', 'routing', 'requiredDns', 'rules', 'customDomains', 'dnsByName', 'authMode', 'env', 'now']);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error(`unexpected evidence input ${key}`);
  const {
    destinationEmail,
    destination,
    routing,
    requiredDns,
    rules,
    customDomains,
    dnsByName,
    authMode = 'unknown',
    env = process.env,
    now = new Date().toISOString(),
  } = input;
  const destinationNormalized = String(destinationEmail || '').trim().toLowerCase();
  if (!EMAIL.test(destinationNormalized)) throw new Error('approved support mailbox destination is invalid');
  const ruleRows = rules.ok && Array.isArray(rules.result) ? rules.result : [];
  const supportRules = ruleRows.filter(matcherTargetsSupport);
  const exactRules = supportRules.filter(row => exactForward(row, destinationNormalized));
  const conflictingRules = supportRules.filter(row => !exactForward(row, destinationNormalized));
  const routingEnabled = routing.ok && routing.result?.enabled === true;
  const routingStatus = routing.ok ? String(routing.result?.status || '').toLowerCase() : 'unreadable';
  const routingReady = routingEnabled && ['ready', 'active'].includes(routingStatus);
  const customDomainRows = customDomains.ok && Array.isArray(customDomains.result) ? customDomains.result : [];
  const supportDomains = customDomainRows.filter(row => String(row?.hostname || row?.domain || '').toLowerCase() === SUPPORT_DOMAIN);
  const exactWorkerDomain = supportDomains.some(row => String(row?.service || '').toLowerCase() === SUPPORT_WORKER_NAME);

  const rootDnsRead = dnsByName.get(SUPPORT_ZONE_NAME) || {ok: false, http_status: 0, result: null};
  const supportDnsRead = dnsByName.get(SUPPORT_DOMAIN) || {ok: false, http_status: 0, result: null};
  const rootDns = rootDnsRead.ok && Array.isArray(rootDnsRead.result) ? normalizeDns(rootDnsRead.result) : [];
  const mx = rootDns.filter(row => row.type === 'MX');
  const spf = rootDns.filter(row => row.type === 'TXT' && row.content.trim().toLowerCase().startsWith('v=spf1'));
  const requiredRows = requiredDns.ok && Array.isArray(requiredDns.result) ? normalizeDns(requiredDns.result) : [];
  const requiredMx = requiredRows.filter(row => row.type === 'MX');
  const requiredSpf = requiredRows.filter(row => row.type === 'TXT' && row.content.trim().toLowerCase().startsWith('v=spf1'));
  const supportDns = supportDnsRead.ok && Array.isArray(supportDnsRead.result) ? normalizeDns(supportDnsRead.result) : [];
  const protectedDnsReads = PROTECTED_OPENAI_HOSTS.map(host => [host, dnsByName.get(host) || {ok: false, http_status: 0, result: null}]);
  const protectedDnsReadable = protectedDnsReads.every(([, value]) => value.ok);
  const protectedDns = protectedDnsReads.map(([host, value]) => ({
    host,
    readable: value.ok,
    http_status: value.http_status,
    record_count: value.ok && Array.isArray(value.result) ? value.result.length : 0,
    fingerprint_sha256: value.ok && Array.isArray(value.result) ? fingerprint(normalizeDns(value.result)) : null,
  }));
  const allRequiredReads = routing.ok && requiredDns.ok && rules.ok && customDomains.ok && rootDnsRead.ok && supportDnsRead.ok && protectedDnsReadable;
  const safeToCreate = destination.read_access === true && destination.verified === true && routingReady && allRequiredReads && supportRules.length === 0;
  const migrationSafe = destination.read_access === true && destination.verified === true && routing.ok && requiredDns.ok && rules.ok && conflictingRules.length === 0 && protectedDnsReadable && requiredMx.length > 0;

  return {
    schema: 'musitu.axiom.official-support-email-routing-preflight.v1',
    recorded_at: now,
    repository: String(env.GITHUB_REPOSITORY || ''),
    branch: String(env.GITHUB_REF_NAME || ''),
    source_commit: String(env.GITHUB_SHA || ''),
    cloudflare_account_id: SUPPORT_ACCOUNT_ID,
    zone_id: SUPPORT_ZONE_ID,
    authentication_mode: authMode,
    destination: {
      fingerprint_sha256: destination.fingerprint,
      read_access: destination.read_access === true,
      http_status: destination.http_status,
      exact_match_count: destination.match_count,
      verified: destination.verified === true,
      raw_address_recorded: false,
    },
    email_routing: {
      read_access: routing.ok,
      http_status: routing.http_status,
      enabled: routingEnabled,
      status: routingStatus,
      ready: routingReady,
    },
    email_routing_migration: {
      required_dns_read_access: requiredDns.ok,
      required_dns_http_status: requiredDns.http_status,
      current_mx_provider: classifyMxProvider(mx),
      current_mx_count: mx.length,
      required_mx_count: requiredMx.length,
      current_spf_count: spf.length,
      required_spf_count: requiredSpf.length,
      current_mail_fingerprint_sha256: rootDnsRead.ok ? fingerprint({mx, spf}) : null,
      required_mail_fingerprint_sha256: requiredDns.ok ? fingerprint({mx: requiredMx, spf: requiredSpf}) : null,
      would_change_mx: requiredDns.ok && rootDnsRead.ok ? !sameRecordSet(mx, requiredMx) : null,
      would_change_spf: requiredDns.ok && rootDnsRead.ok ? !sameRecordSet(spf, requiredSpf) : null,
      safe_to_apply_endpoint: migrationSafe,
      endpoint_write_performed: false,
    },
    support_rule: {
      alias_fingerprint_sha256: sha256(SUPPORT_EMAIL_ALIAS),
      rules_read_access: rules.ok,
      rules_http_status: rules.http_status,
      matching_rule_count: supportRules.length,
      exact_present: exactRules.length === 1 && conflictingRules.length === 0,
      conflict_present: conflictingRules.length > 0 || exactRules.length > 1,
      matching_rules_fingerprint_sha256: fingerprint(supportRules.map(row => scrubbedRule(row, destinationNormalized))),
      safe_to_create: safeToCreate,
    },
    email_dns: {
      root_read_access: rootDnsRead.ok,
      root_http_status: rootDnsRead.http_status,
      mx_count: mx.length,
      spf_count: spf.length,
      root_mail_fingerprint_sha256: rootDnsRead.ok ? fingerprint({mx, spf}) : null,
    },
    support_hostname: {
      dns_read_access: supportDnsRead.ok,
      dns_http_status: supportDnsRead.http_status,
      dns_record_count: supportDns.length,
      dns_fingerprint_sha256: supportDnsRead.ok ? fingerprint(supportDns) : null,
      custom_domains_read_access: customDomains.ok,
      custom_domains_http_status: customDomains.http_status,
      custom_domain_count: supportDomains.length,
      exact_worker_domain_attached: exactWorkerDomain,
      custom_domain_fingerprint_sha256: fingerprint(supportDomains.map(row => ({
        hostname: String(row?.hostname || row?.domain || '').toLowerCase(),
        service: String(row?.service || ''),
        environment: String(row?.environment || ''),
      }))),
    },
    protected_openai_dns: {
      readable: protectedDnsReadable,
      hosts: protectedDns,
      combined_fingerprint_sha256: protectedDnsReadable ? fingerprint(protectedDns.map(row => ({host: row.host, record_count: row.record_count, fingerprint_sha256: row.fingerprint_sha256}))) : null,
    },
    all_required_reads_passed: allRequiredReads,
    write_performed: false,
    public_support_deployed: exactWorkerDomain,
    openai_surface_modified: false,
    secrets_exposed: false,
  };
}

export async function inspectEmailRouting({env = process.env, fetchImpl = fetch, now = new Date().toISOString()} = {}) {
  if (env.GITHUB_REF_NAME !== SUPPORT_BRANCH) throw new Error('email-routing preflight may run only from the isolated support branch');
  if (env.SUPPORT_EMAIL_ROUTING_CONFIRM !== 'VERIFY_MUSITU_AXIOM_SUPPORT_EMAIL_ROUTING') throw new Error('email-routing preflight confirmation is missing');
  const destinationEmail = String(env.SUPPORT_MAILBOX_DESTINATION || '').trim().toLowerCase();
  if (!EMAIL.test(destinationEmail)) throw new Error('approved support mailbox destination is invalid');
  const credential = await selectCloudflareCredential({fetchImpl, env});
  const addresses = await safeCloudflareRead({fetchImpl, headers: credential.headers, path: `/accounts/${SUPPORT_ACCOUNT_ID}/email/routing/addresses?page=1&per_page=50`});
  const matches = addresses.ok && Array.isArray(addresses.result) ? addresses.result.filter(row => String(row?.email || '').trim().toLowerCase() === destinationEmail) : [];
  const destination = {
    fingerprint: sha256(destinationEmail),
    read_access: addresses.ok,
    http_status: addresses.http_status,
    match_count: matches.length,
    verified: matches.length === 1 && (matches[0]?.verified === true || (typeof matches[0]?.verified === 'string' && matches[0].verified.length > 0)),
  };
  const [routing, requiredDns, rules, customDomains] = await Promise.all([
    safeCloudflareRead({fetchImpl, headers: credential.headers, path: `/zones/${SUPPORT_ZONE_ID}/email/routing`}),
    safeCloudflareRead({fetchImpl, headers: credential.headers, path: `/zones/${SUPPORT_ZONE_ID}/email/routing/dns`}),
    safeCloudflareRead({fetchImpl, headers: credential.headers, path: `/zones/${SUPPORT_ZONE_ID}/email/routing/rules?page=1&per_page=50`}),
    safeCloudflareRead({fetchImpl, headers: credential.headers, path: `/accounts/${SUPPORT_ACCOUNT_ID}/workers/domains`}),
  ]);
  const names = [SUPPORT_ZONE_NAME, SUPPORT_DOMAIN, ...PROTECTED_OPENAI_HOSTS];
  const dnsRows = await Promise.all(names.map(async name => [name, await safeCloudflareRead({
    fetchImpl,
    headers: credential.headers,
    path: `/zones/${SUPPORT_ZONE_ID}/dns_records?name=${encodeURIComponent(name)}&per_page=100`,
  })]));
  return buildEmailRoutingEvidence({
    destinationEmail,
    destination,
    routing,
    requiredDns,
    rules,
    customDomains,
    dnsByName: new Map(dnsRows),
    authMode: credential.mode,
    env,
    now,
  });
}

export async function main(env = process.env, fetchImpl = fetch) {
  const sentinel = await readFile(new URL('../VERIFY_CLOUDFLARE_EMAIL_ROUTING.authorized', import.meta.url), 'utf8');
  if (sentinel !== 'VERIFY_MUSITU_AXIOM_SUPPORT_EMAIL_ROUTING\n') throw new Error('email-routing preflight authorization file is invalid');
  const evidence = await inspectEmailRouting({env, fetchImpl});
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  const digest = sha256(serialized);
  const output = env.SUPPORT_EMAIL_ROUTING_OUTPUT || 'support-email-routing-preflight.json';
  await writeFile(output, serialized, {encoding: 'utf8', mode: 0o600, flag: 'wx'});
  await writeFile(`${output}.sha256`, `${digest}  ${output}\n`, {encoding: 'utf8', mode: 0o600, flag: 'wx'});
  process.stdout.write(`${JSON.stringify({gate: 'MUSITU_AXIOM_SUPPORT_EMAIL_ROUTING_PREFLIGHT_OBSERVED', evidence_sha256: digest, evidence})}\n`);
  return evidence;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main();
