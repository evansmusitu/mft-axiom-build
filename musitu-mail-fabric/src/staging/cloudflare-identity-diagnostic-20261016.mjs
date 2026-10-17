import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, createCipheriv, publicEncrypt, constants, createHash, createPublicKey, X509Certificate } from 'node:crypto';
import { qualifyPrivateMmfOidcProvider } from '../commercial/mmf-oidc-provider-discovery.mjs';

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
  // Diagnose the approved enrollment subject through the existing admin API.
  // The address and all configuration evidence remain encrypted; never export
  // a roster, login IP, cookie, token, or authenticator secret to public logs.
  const launcherId = '9dfc2a78-0dae-463b-9235-03ae134be007';
  const [launcher, launcherPolicies] = await Promise.all([
    get('accounts/' + account + '/access/apps/' + launcherId, 'enrollmentLauncher'),
    get('accounts/' + account + '/access/apps/' + launcherId + '/policies?per_page=100', 'enrollmentPolicies'),
  ]);
  const enrollmentPolicy = launcherPolicies?.[0];
  const subject = enrollmentPolicy?.include?.[0]?.email?.email;
  if (launcher?.type !== 'app_launcher' || launcher.domain !== 'musitu-axiom.cloudflareaccess.com' || launcher.session_duration !== '15m' || JSON.stringify(launcher.allowed_idps) !== JSON.stringify(['ec04a8ab-9382-4df0-9589-d2c98618e6af']) || launcherPolicies?.length !== 1 || enrollmentPolicy.decision !== 'allow' || enrollmentPolicy.include?.length !== 1 || enrollmentPolicy.require?.length !== 1 || enrollmentPolicy.require[0].login_method?.id !== 'ec04a8ab-9382-4df0-9589-d2c98618e6af' || (enrollmentPolicy.exclude || []).length || typeof subject !== 'string') throw Error('ENROLLMENT_SCOPE_DRIFT');
  const [members, users, logs] = await Promise.all([
    get('accounts/' + account + '/members?per_page=100', 'accountMembershipPermission'),
    get('accounts/' + account + '/access/users?per_page=100', 'accessUsersPermission'),
    get('accounts/' + account + '/access/logs/access_requests?per_page=100&limit=100&since=' + encodeURIComponent('2026-10-17T03:50:00Z') + '&email=' + encodeURIComponent(subject), 'accessAuthenticationLogsPermission'),
  ]);
  const sameEmail = x => typeof x === 'string' && x.toLowerCase() === subject.toLowerCase();
  const matchedMembers = Array.isArray(members) ? members.filter(x => sameEmail(x.user?.email)) : null;
  const matchedUsers = Array.isArray(users) ? users.filter(x => sameEmail(x.email) || x.emails?.some(e => sameEmail(e.value))) : null;
  detail.enrollmentDiagnostic = { launcherId, subject, launcherScopeVerified: true,
    membershipReadAvailable: matchedMembers !== null,
    members: matchedMembers?.map(x => ({status:x.status, nativeAccountTwoFactorEnabled:x.user?.two_factor_authentication_enabled})),
    accessUsersReadAvailable: matchedUsers !== null,
    users: matchedUsers?.map(x => ({id:x.id,email:x.email,accessSeat:x.access_seat,lastSuccessfulLogin:x.last_successful_login,keys:Object.keys(x).sort()})),
    logsReadAvailable: Array.isArray(logs),
    events: Array.isArray(logs) ? logs.filter(x => [launcherId,'f8ab12fe-251f-44fa-80de-1c2f2bdc4055','4ae515a1-189d-41c2-8020-c99ea157b021'].includes(x.app_uid) && sameEmail(x.user_email)).map(x => ({action:x.action,allowed:x.allowed,appId:x.app_uid,connection:x.connection,createdAt:x.created_at,rayId:x.ray_id})) : null,
    realMfaCompletionVerified: false,
  };
  if (matchedUsers?.length === 1 && /^[a-zA-Z0-9-]{20,64}$/.test(matchedUsers[0].id)) {
    const user = await get('accounts/' + account + '/access/users/' + matchedUsers[0].id, 'approvedAccessUserDetails');
    if (user) detail.enrollmentDiagnostic.userDetails = { keys:Object.keys(user).sort(), lastSuccessfulLogin:user.last_successful_login,
      mfaAuthenticators:Array.isArray(user.mfa_authenticators) ? user.mfa_authenticators.map(x => ({type:x.type,method:x.method})) : null };
  }
  // Read the existing dedicated OIDC client; this diagnostic never registers or
  // updates one, and never treats an unauthenticated probe as proof of PKCE/MFA.
  const clients = (apps || []).filter(x => x.id === '4ae515a1-189d-41c2-8020-c99ea157b021' && x.type === 'saas');
  if (clients.length !== 1) throw Error('EXISTING_OIDC_CLIENT_NOT_FOUND');
  const [client, clientPolicies] = await Promise.all([
    get('accounts/' + account + '/access/apps/' + clients[0].id, 'oidcClient'),
    get('accounts/' + account + '/access/apps/' + clients[0].id + '/policies?per_page=100', 'oidcPolicies'),
  ]);
  const cfg = client?.saas_app;
  if (!cfg || !Array.isArray(clientPolicies) || clientPolicies.length !== 0) throw Error('OIDC_CLOSED_STATE_DRIFT');
  detail.oidc = { application: appSafe(client), policyCount: clientPolicies.length,
    redirectUris: cfg.redirect_uris, grants: cfg.grant_types,
    publicPkceClient: cfg.allow_pkce_without_client_secret === true,
    livePkceVerified: false, liveMfaClaimsVerified: false, probes: [] };
  if (org?.auth_domain !== 'musitu-axiom.cloudflareaccess.com' || cfg.client_id !== 'cf09992056460080b94aa85a4906ad386356e21cdb0d0d317218a21cc228785a') throw Error('OIDC_ISSUER_DRIFT');
  const issuer = 'https://' + org.auth_domain + '/cdn-cgi/access/sso/oidc/' + cfg.client_id;
  const expected = { issuer, authorizationEndpoint: issuer + '/authorization', tokenEndpoint: issuer + '/token', jwksUri: issuer + '/jwks' };
  const fingerprint = key => createHash('sha256').update(key.export({ format: 'der', type: 'spki' })).digest('hex');
  const readPublic = async url => {
    const r = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000), cache: 'no-store' });
    const body = await r.text();
    if (!r.ok || body.length > 100000 || !r.headers.get('content-type')?.includes('json')) throw Error('OIDC_PUBLIC_METADATA_UNAVAILABLE');
    return { status: r.status, body: JSON.parse(body) };
  };
  const [metadata, jwks] = await Promise.all([readPublic(issuer + '/.well-known/openid-configuration'), readPublic(expected.jwksUri)]);
  detail.oidc.discovery = metadata;
  const pin = fingerprint(new X509Certificate(cfg.public_key).publicKey);
  const matching = (jwks.body.keys || []).filter(j => { try { return fingerprint(createPublicKey({key:j,format:'jwk'})) === pin; } catch { return false; } });
  if (matching.length !== 1) throw Error('OIDC_SIGNING_PIN_DRIFT');
  detail.oidc.authenticatedSigningKey = { kid: matching[0].kid, spkiFingerprint: pin, publicJwksStatus: jwks.status };
  try {
    await qualifyPrivateMmfOidcProvider({ ...expected, approvedKeys: [{kid:matching[0].kid,spkiFingerprint:pin}] });
    detail.oidc.strictMetadataQualified = true;
  } catch (error) {
    detail.oidc.strictMetadataQualified = false;
    detail.oidc.qualificationFailure = /^[A-Z_]+$/.test(error.message) ? error.message : 'OIDC_QUALIFICATION_ERROR';
  }
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  for (const [name, pkce] of [
    ['s256', {code_challenge:challenge,code_challenge_method:'S256'}],
    ['missing_pkce', {}],
    ['plain', {code_challenge:verifier,code_challenge_method:'plain'}],
    ['invalid_method', {code_challenge:challenge,code_challenge_method:'MMF_INVALID_METHOD'}],
  ]) {
    const u = new URL(expected.authorizationEndpoint);
    u.search = new URLSearchParams({client_id:cfg.client_id,response_type:'code',scope:'openid',redirect_uri:'https://' + hostname + '/private/oidc/callback',state:randomBytes(24).toString('base64url'),nonce:randomBytes(24).toString('base64url'),...pkce});
    const r = await fetch(u, {redirect:'manual',signal:AbortSignal.timeout(15000),cache:'no-store'});
    // Do not persist response bodies, cookies, authorization codes, or query strings.
    const location = r.headers.get('location');
    let destination = null;
    try { const v = new URL(location, u); destination = { origin:v.origin,path:v.pathname,error:v.searchParams.get('error') }; } catch {}
    await r.body?.cancel();
    detail.oidc.probes.push({name,status:r.status,destination,interpretation:'PRE_AUTHENTICATION_OBSERVATION_ONLY'});
  }
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
  if (detail.failure || !summary.closedApplicationVerified || !summary.publicIngressAbsent) process.exitCode = 2;
}
