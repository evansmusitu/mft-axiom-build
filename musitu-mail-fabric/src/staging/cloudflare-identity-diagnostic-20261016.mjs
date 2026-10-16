import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, createCipheriv, publicEncrypt, constants } from 'node:crypto';

const account = '93f395f5121954671f92fffa453d6b61';
const hostname = 'mail-stage.mftintelligence.com';
const label = 'MUSITU Mail Fabric closed private stage (deny all)';
const token = process.env.CLOUDFLARE_API_TOKEN;
const detail = { schema: 'mmf-identity-diagnostic-v1', observedAt: new Date().toISOString(), sourceSha: process.env.GITHUB_SHA, mutations: 0, requests: [] };
const summary = { schema: detail.schema, observedAt: detail.observedAt, sourceSha: detail.sourceSha, mutations: 0, accountAndZoneVerified: false, closedApplicationVerified: false, publicIngressAbsent: false, organizationMfaEnabled: false, applicationMfaEnforced: false, genuineOidcVerified: false, realBrowserAcceptance: 'BLOCKED', gate: 'DIAGNOSTIC_INCOMPLETE' };

async function get(path, name) {
  const response = await fetch('https://api.cloudflare.com/client/v4/' + path, {
    method: 'GET', headers: { authorization: 'Bearer ' + token, accept: 'application/json' },
    redirect: 'error', signal: AbortSignal.timeout(20000), cache: 'no-store',
  });
  const text = await response.text();
  if (text.length > 2000000) throw Error('RESPONSE_SIZE_LIMIT');
  let data; try { data = JSON.parse(text); } catch { data = {}; }
  const record = { name, status: response.status, success: data.success === true,
    codes: Array.isArray(data.errors) ? data.errors.map(e => e.code).filter(Number.isInteger) : [] };
  detail.requests.push(record);
  if (!response.ok || !record.success) return null;
  if (Number(data.result_info?.total_pages || 1) > 1) throw Error('INCOMPLETE_PAGINATION');
  return data.result;
}
const mfa = value => value ? {
  allowed_authenticators: value.allowed_authenticators,
  mfa_disabled: value.mfa_disabled, session_duration: value.session_duration,
  amr_matching_session_duration: value.amr_matching_session_duration,
  required_aaguids: value.required_aaguids,
} : null;
const appSafe = x => ({ id: x.id, name: x.name, type: x.type, domain: x.domain,
  self_hosted_domains: x.self_hosted_domains, allowed_idps: x.allowed_idps,
  session_duration: x.session_duration, mfa_config: mfa(x.mfa_config),
  saasProtocol: x.saas_app?.auth_type, oidcClientRegistered: Boolean(x.saas_app?.client_id),
});
try {
  if (process.env.CLOUDFLARE_ACCOUNT_ID !== account || !token || token.length < 20) throw Error('AUTHORIZED_TOKEN_UNAVAILABLE');
  const [zones, apps, org, idps, domains, scripts] = await Promise.all([
    get('zones?name=mftintelligence.com&per_page=50', 'zone'),
    get('accounts/' + account + '/access/apps?per_page=100', 'apps'),
    get('accounts/' + account + '/access/organizations', 'organization'),
    get('accounts/' + account + '/access/identity_providers?per_page=100', 'identityProviders'),
    get('accounts/' + account + '/workers/domains?per_page=100', 'workerDomains'),
    get('accounts/' + account + '/workers/scripts?per_page=100', 'workerScripts'),
  ]);
  if (!Array.isArray(zones) || zones.length !== 1 || zones[0].account?.id !== account || zones[0].status !== 'active') throw Error('ACCOUNT_ZONE_NOT_VERIFIED');
  summary.accountAndZoneVerified = true;
  detail.zone = { id: zones[0].id, name: zones[0].name, status: zones[0].status, accountId: zones[0].account.id };
  detail.organization = org ? { ...org, keys: Object.keys(org).sort() } : null;
  summary.organizationMfaEnabled = Boolean(org?.mfa_config?.allowed_authenticators?.length);
  detail.identityProviders = Array.isArray(idps) ? idps.map(x => ({ id: x.id, name: x.name, type: x.type, restrictToAccountMembers: x.config?.restrict_to_account_members, configKeys: Object.keys(x.config || {}).sort() })) : null;
  detail.apps = Array.isArray(apps) ? apps.map(appSafe) : null;
  summary.identityProviderTypes = Array.isArray(idps) ? [...new Set(idps.map(x => x.type))] : [];
  const matches = Array.isArray(apps) ? apps.filter(x => x.name === label && x.domain === hostname && x.type === 'self_hosted') : [];
  if (matches.length !== 1) throw Error('MMF_APPLICATION_AMBIGUOUS');
  const [app, policies, dns, routes] = await Promise.all([
    get('accounts/' + account + '/access/apps/' + matches[0].id, 'mmfApp'),
    get('accounts/' + account + '/access/apps/' + matches[0].id + '/policies?per_page=100', 'mmfPolicies'),
    get('zones/' + zones[0].id + '/dns_records?name=' + hostname + '&per_page=100', 'mmfDns'),
    get('zones/' + zones[0].id + '/workers/routes?per_page=100', 'workerRoutes'),
  ]);
  detail.mmfApplication = app ? appSafe(app) : null;
  detail.mmfPolicyDecisions = Array.isArray(policies) ? policies.map(x => ({ id: x.id, decision: x.decision, mfa_config: mfa(x.mfa_config) })) : null;
  summary.closedApplicationVerified = app?.id === matches[0].id && app?.domain === hostname && Array.isArray(policies) && policies.length === 0;
  summary.applicationMfaEnforced = app?.mfa_config?.mfa_disabled === false && app?.mfa_config?.allowed_authenticators?.includes('totp') === true;
  const overlaps = pattern => typeof pattern === 'string' && (pattern.includes(hostname) || pattern.includes('*.mftintelligence.com') || pattern.startsWith('mftintelligence.com') || pattern === '*/*');
  detail.ingress = { dnsRecordCount: Array.isArray(dns) ? dns.length : null,
    overlappingWorkerRoutes: Array.isArray(routes) ? routes.filter(x => overlaps(x.pattern)) : null,
    matchingWorkerDomains: Array.isArray(domains) ? domains.filter(x => x.hostname === hostname || x.domain === hostname) : null };
  summary.publicIngressAbsent = Array.isArray(dns) && dns.length === 0 && Array.isArray(routes) && !routes.some(x => overlaps(x.pattern)) && Array.isArray(domains) && !domains.some(x => x.hostname === hostname || x.domain === hostname);
  const mmfScripts = Array.isArray(scripts) ? scripts.filter(x => /mmf|musitu-mail/i.test(x.id || '')) : [];
  detail.mmfWorkers = await Promise.all(mmfScripts.map(async x => ({ name: x.id,
    subdomain: await get('accounts/' + account + '/workers/scripts/' + encodeURIComponent(x.id) + '/subdomain', 'mmfWorkerSubdomain'),
  })));
  // Inspect policy MFA overrides, never policy email addresses, names or rules.
  detail.otherApplicationPolicyMfa = [];
  for (const other of (apps || []).filter(x => x.id !== matches[0].id)) {
    const policies = await get('accounts/' + account + '/access/apps/' + other.id + '/policies?per_page=100', 'otherPolicyMfa');
    detail.otherApplicationPolicyMfa.push({ appId: other.id, available: Array.isArray(policies),
      policies: Array.isArray(policies) ? policies.map(x => ({ decision: x.decision, mfa_config: mfa(x.mfa_config) })) : null });
  }
  summary.gate = summary.closedApplicationVerified && summary.publicIngressAbsent ? 'MMF_CLOSED_STATE_VERIFIED_IDENTITY_PENDING' : 'MMF_CLOSED_STATE_DRIFT';
} catch (error) {
  detail.failure = /^[A-Z_]+$/.test(error.message) ? error.message : 'NETWORK_OR_API_FAILURE';
  summary.gate = detail.failure;
} finally {
  summary.apiResults = detail.requests.map(({name,status,codes}) => ({name,status,codes}));
  // No plaintext configuration is uploaded to this public repository's artifacts.
  const key = randomBytes(32), iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(detail)), cipher.final()]);
  const envelope = { schema: 'mmf-private-diagnostic-envelope-v1', algorithm: 'RSA-OAEP-SHA256+AES-256-GCM',
    key: publicEncrypt({ key: process.env.MMF_EVIDENCE_PUBLIC_KEY, oaepHash: 'sha256', padding: constants.RSA_PKCS1_OAEP_PADDING }, key).toString('base64'),
    iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
  key.fill(0);
  writeFileSync(join(process.env.RUNNER_TEMP, 'mmf-identity-diagnostic.encrypted.json'), JSON.stringify(envelope), { mode: 0o600, flag: 'wx' });
  writeFileSync(join(process.env.RUNNER_TEMP, 'mmf-identity-diagnostic-summary.json'), JSON.stringify(summary, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ gate: summary.gate, mutations: 0, accountVerified: summary.accountAndZoneVerified, closed: summary.closedApplicationVerified, noIngress: summary.publicIngressAbsent, organizationMfaEnabled: summary.organizationMfaEnabled, applicationMfaEnforced: summary.applicationMfaEnforced }));
  if (!summary.closedApplicationVerified || !summary.publicIngressAbsent) process.exitCode = 2;
}
