import {createHash} from 'node:crypto';
import {cloudflareRequest, selectCloudflareCredential} from './provision_cloudflare_d1.mjs';
import {SUPPORT_ZONE_ID, SUPPORT_EMAIL_ALIAS} from './verify_cloudflare_email_routing.mjs';

const sha256 = value => createHash('sha256').update(String(value)).digest('hex');
const norm = value => String(value ?? '').trim().toLowerCase();
const safeName = value => {
  const s = String(value ?? '').trim();
  if (!s) return '';
  return s.includes('@') ? '[redacted-email-like-name]' : s.slice(0, 120);
};
const env = process.env;
const approved = norm(env.CLOUDFLARE_EMAIL);
if (!approved) throw new Error('approved destination secret is missing');

const credential = await selectCloudflareCredential({fetchImpl: fetch, env});
const get = async path => (await cloudflareRequest({fetchImpl: fetch, headers: credential.headers, path})).result;

const [rulesRaw, catchAll, routing] = await Promise.all([
  get(`/zones/${SUPPORT_ZONE_ID}/email/routing/rules?page=1&per_page=100`),
  get(`/zones/${SUPPORT_ZONE_ID}/email/routing/rules/catch_all`),
  get(`/zones/${SUPPORT_ZONE_ID}/email/routing`),
]);

const rules = Array.isArray(rulesRaw) ? rulesRaw : [];
const summarizeMatcher = m => {
  const type = norm(m?.type);
  const field = norm(m?.field);
  const raw = String(m?.value ?? '');
  return {
    type,
    field,
    value_present: raw.length > 0,
    value_fingerprint_sha256: raw ? sha256(norm(raw)) : null,
    targets_support_alias: type === 'literal' && field === 'to' && norm(raw) === norm(SUPPORT_EMAIL_ALIAS),
    target_is_mftintelligence_domain: type === 'literal' && field === 'to' && norm(raw).endsWith('@mftintelligence.com'),
  };
};
const summarizeAction = a => {
  const vals = Array.isArray(a?.value) ? a.value : (a?.value == null ? [] : [a.value]);
  return {
    type: norm(a?.type),
    value_count: vals.length,
    forwards_only_to_approved_destination:
      norm(a?.type) === 'forward' && vals.length === 1 && norm(vals[0]) === approved,
    value_fingerprints_sha256: vals.map(v => sha256(norm(v))).sort(),
  };
};
const summary = {
  gate: 'MUSITU_AXIOM_SUPPORT_EMAIL_ROUTING_DIAGNOSTIC_PASS',
  authentication_mode: credential.mode,
  routing: {
    enabled: routing?.enabled === true,
    status: String(routing?.status || '').toLowerCase(),
  },
  rule_count: rules.length,
  rules: rules.map(rule => {
    const matchers = Array.isArray(rule?.matchers) ? rule.matchers : [];
    const actions = Array.isArray(rule?.actions) ? rule.actions : [];
    return {
      id_fingerprint_sha256: sha256(String(rule?.id || '')),
      name: safeName(rule?.name),
      enabled: rule?.enabled === true,
      targets_support_alias: matchers.some(m => summarizeMatcher(m).targets_support_alias),
      matchers: matchers.map(summarizeMatcher),
      actions: actions.map(summarizeAction),
    };
  }),
  catch_all: {
    enabled: catchAll?.enabled === true,
    actions: (Array.isArray(catchAll?.actions) ? catchAll.actions : []).map(a => ({type: norm(a?.type)})),
  },
  raw_addresses_recorded: false,
  write_performed: false,
};
process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
