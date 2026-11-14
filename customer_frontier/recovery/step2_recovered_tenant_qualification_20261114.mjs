/** Exercise the unchanged canonical application seam on the exact recovered D1.
 * Fixture principals are synthetic; this does not qualify real customer login.
 * Every mutation is restricted to fixture identifiers on the disposable target.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { canonicalCustomerForPrincipal } from '../customer_control_plane/canonical_identity.mjs';
import { assertCanonicalOAuthLink } from '../../auth/keyless_customer_link_candidate.mjs';
import { ACCOUNT, NAME, targetD1Plan, CATALOG_SQL } from './step2_create_restore_target_20261114.mjs';
import { TARGET, TARGET_BASE, ACCOUNT_BASE, provider, storage, fingerprint } from './step2_hosted_restore_20261114.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const FILE = 'recovered_tenant_qualification_20261114.json';
export const F = Object.freeze({ issuer: 'https://axiom-gate2.example.invalid',
  ta: 'axiom_g2_tenant_a_20261114', tb: 'axiom_g2_tenant_b_20261114',
  ia: 'axiom_g2_identity_a_20261114', ib: 'axiom_g2_identity_b_20261114',
  sa: 'axiom-gate2-subject-a', sb: 'axiom-gate2-subject-b',
  ca: 'a4444444-1111-4111-8111-111111111111', cb: 'b4444444-2222-4222-8222-222222222222',
  pa: 'axiom-gate2-proof-a-20261114', pb: 'axiom-gate2-proof-b-20261114',
  consent: 'axiom-gate2-fixture-consent-20261114', hash: 'a'.repeat(64),
  attack: "axiom-gate2-' OR 1=1 --", unknown: 'axiom-gate2-unknown',
});
export const SQL = Object.freeze({
  tenantCount: 'SELECT count(*) AS n FROM tenants WHERE id IN (?,?)',
  identityCount: 'SELECT count(*) AS n FROM identities WHERE id IN (?,?)',
  linkCount: 'SELECT count(*) AS n FROM canonical_customer_links WHERE customer_id IN (?,?) OR proof_id IN (?,?)',
  seedTenants: "INSERT INTO tenants(id,name,status) VALUES(?,'GATE2 SYNTHETIC A','active'),(?,'GATE2 SYNTHETIC B','active')",
  seedIdentities: 'INSERT INTO identities(id,issuer,external_sub) VALUES(?,?,?),(?,?,?)',
  seedMemberships: "INSERT INTO memberships(tenant_id,identity_id,role,status) VALUES(?,?,'viewer','active'),(?,?,'owner','active')",
  seedLink: "INSERT INTO canonical_customer_links(identity_id,tenant_id,customer_id,link_kind,proof_id,proof_sha256,consent_id,authority_subject) VALUES(?,?,?,'fresh',?,?,?,'axiom-gate2-recovery-fixture')",
  membership: `SELECT i.id AS identity_id,m.role,t.id AS tenant_id FROM identities i
 JOIN memberships m ON m.identity_id=i.id JOIN tenants t ON t.id=m.tenant_id
 WHERE i.issuer=? AND i.external_sub=? AND m.tenant_id=? AND m.status='active' AND t.status='active'`,
  canonical: 'SELECT * FROM canonical_customer_links WHERE identity_id=?',
  oauthCanonical: `SELECT i.issuer,i.external_sub AS subject,l.tenant_id,l.customer_id
 FROM canonical_customer_links l JOIN identities i ON i.id=l.identity_id
 WHERE l.customer_id=? AND l.tenant_id=? AND l.status='active'`,
  mutateLink: 'UPDATE canonical_customer_links SET tenant_id=? WHERE identity_id=?',
  revokeLink: "UPDATE canonical_customer_links SET status='revoked' WHERE identity_id=?",
  reactivateLink: "UPDATE canonical_customer_links SET status='active' WHERE identity_id=?",
  revokeMembership: "UPDATE memberships SET status='revoked' WHERE tenant_id=? AND identity_id=?",
  suspendTenant: "UPDATE tenants SET status='suspended' WHERE id=?",
});
const PARAMETERS = new Map([
  [SQL.tenantCount, 2], [SQL.identityCount, 2], [SQL.linkCount, 4], [SQL.seedTenants, 2],
  [SQL.seedIdentities, 6], [SQL.seedMemberships, 4], [SQL.seedLink, 6], [SQL.membership, 3],
  [SQL.canonical, 1], [SQL.oauthCanonical, 2], [SQL.mutateLink, 2], [SQL.revokeLink, 1],
  [SQL.reactivateLink, 1], [SQL.revokeMembership, 2], [SQL.suspendTenant, 1],
]);
const VALUES = new Set(Object.values(F));
const BOOKMARK = /^[A-Za-z0-9-]{16,256}$/;
export class TenantStop extends Error { constructor(code) { super(code); this.code = code; } }
export class ConstraintDenied extends Error { constructor(code) { super(code); this.code = code; } }
const check = (ok, code) => { if (!ok) throw new TenantStop(code); };
function result(doc) { check(doc?.success === true, 'PROVIDER_ENVELOPE_INVALID'); return doc.result; }

export function fixtureQueryAllowed(body) {
  return body && Object.keys(body).sort().join('|') === 'params|sql' && PARAMETERS.has(body.sql) &&
    Array.isArray(body.params) && body.params.length === PARAMETERS.get(body.sql) &&
    body.params.every(value => typeof value === 'string' && VALUES.has(value));
}
export function credentialedRequest(token) {
  const base = provider({ target: token });
  return async (method, path, body) => {
    if (path !== TARGET_BASE + '/query' || !fixtureQueryAllowed(body)) return base('target', method, path, body);
    check(method === 'POST' && typeof token === 'string' && token.length > 5 && !/[\r\n]/.test(token), 'TARGET_CREDENTIAL_OR_METHOD_INVALID');
    let response, doc;
    try {
      response = await fetch('https://api.cloudflare.com/client/v4' + path, {
        method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(20000),
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      check(text.length < 150000, 'TARGET_QUERY_RESPONSE_OVER_BUDGET');
      doc = JSON.parse(text);
    } catch (error) {
      if (error instanceof TenantStop) throw error;
      throw new TenantStop('TARGET_QUERY_TRANSPORT_UNKNOWN');
    }
    if (response.status === 400 && doc?.success === false && Array.isArray(doc.errors)) {
      const known = ['FOREIGN KEY constraint failed', 'canonical_link_immutable', 'canonical_link_revocation_terminal'];
      for (const code of known) if (doc.errors.some(e => typeof e.message === 'string' && e.message.includes(code)))
        throw new ConstraintDenied(code);
    }
    check(response.ok && doc?.success === true, 'TARGET_QUERY_HTTP_OR_SQL_FAILURE');
    return doc;
  };
}
function rowset(doc) {
  const rows = result(doc);
  check(Array.isArray(rows) && rows.length === 1 && rows[0].success === true && Array.isArray(rows[0].results),
    'QUERY_RESULT_INVALID');
  return rows[0];
}
export function applicationAdapter(call) {
  return { prepare(sql) {
    let params = [];
    const run = async () => {
      check(fixtureQueryAllowed({ sql, params }), 'APPLICATION_SQL_OR_FIXTURE_VALUE_OUTSIDE_SCOPE');
      return rowset(await call('POST', TARGET_BASE + '/query', { sql, params }));
    };
    const statement = { bind(...values) { params = values; return statement; },
      async first() { return (await run()).results[0] ?? null; },
      async all() { return { results: (await run()).results }; }, async run() { return run(); } };
    return statement;
  } };
}
export function ownerResultMatches(receipt, proof) {
  return receipt?.status === 'HOSTED_LOGICAL_RESTORE_PARITY_AND_ROLLBACK_VERIFIED' &&
    receipt.target_database === TARGET && receipt.target_account === ACCOUNT && receipt.target_name === NAME &&
    receipt.hosted_schema_and_data_parity === true && receipt.source_data_unchanged === true &&
    proof?.status === 'OWNER_CURRENT_BACKUP_DECRYPTION_VERIFIED' && proof.authenticated_decryption_verified === true &&
    proof.decrypted_plaintext_written === false && proof.provider_operations === 0 &&
    proof.source_account === receipt.source_account && proof.source_database === receipt.source_database &&
    proof.recipient_spki_sha256 === receipt.recipient_spki_sha256 &&
    proof.encrypted_backup_sha256 === receipt.encrypted_backup_sha256 &&
    proof.source_sql_sha256 === receipt.source_sql_sha256 && proof.sql_bytes === receipt.source_sql_bytes;
}
const same = (a, b) => a.catalog_sha256 === b.catalog_sha256 && a.user_data_sha256 === b.user_data_sha256 &&
  JSON.stringify(a.tables) === JSON.stringify(b.tables);
async function snapshot(call, transfer, inspect, pause) {
  let body = { output_format: 'polling' }, bookmark;
  for (let i = 0; i < 40; i++) {
    const job = result(await call('POST', TARGET_BASE + '/export', body));
    check(job && job.success !== false && job.status !== 'error', 'TARGET_EXPORT_FAILED');
    if (job.at_bookmark) {
      check(BOOKMARK.test(job.at_bookmark) && (!bookmark || job.at_bookmark === bookmark), 'TARGET_EXPORT_BOOKMARK_DRIFT');
      bookmark = job.at_bookmark;
    }
    if (job.status === 'complete') {
      check(bookmark && typeof job.result?.signed_url === 'string', 'TARGET_EXPORT_INCOMPLETE');
      const bytes = await transfer('GET', job.result.signed_url);
      try { return inspect(bytes); } finally { bytes.fill(0); }
    }
    check(bookmark, 'TARGET_EXPORT_BOOKMARK_MISSING');
    body = { output_format: 'polling', current_bookmark: bookmark };
    await pause(500);
  }
  throw new TenantStop('TARGET_EXPORT_POLL_LIMIT');
}
function persist(receipt) {
  const bytes = Buffer.from(JSON.stringify(receipt, null, 2) + '\n');
  writeFileSync(FILE, bytes, { mode: 0o600 });
  writeFileSync(FILE + '.sha256', sha(bytes) + '  ' + FILE + '\n', { mode: 0o600 });
}

export async function qualify({ token, baselineReceipt, ownerProof, call = credentialedRequest(token),
  transfer = storage, inspect = fingerprint, pause = ms => new Promise(resolve => setTimeout(resolve, ms)), save = persist } = {}) {
  const r = { schema: 'musitu.axiom.recovered-tenant-qualification.v1', observed_at_utc: new Date().toISOString(),
    target_account: ACCOUNT, target_database: TARGET, source_database: baselineReceipt?.source_database,
    owner_decryption_result_matches: false, production_operations_available: false,
    real_customer_login_qualified: false, production_oauth_migrated: false, fixture_principals_only: true,
    tests: [], fixtures_attempted: false, rollback_attempted: false, rollback_acknowledged: false,
    cleanup_all_table_parity_verified: false, gate2_closed: false, release_status: 'NOT_RELEASE', status: 'PREFLIGHT_PENDING' };
  const db = applicationAdapter(call);
  let rollbackBookmark;
  const record = () => save(r);
  const query = (sql, ...params) => db.prepare(sql).bind(...params).run();
  const principal = (subject, tenant_id, issuer = F.issuer) => ({ issuer, subject, tenant_id });
  const app = (subject, tenant, issuer) => canonicalCustomerForPrincipal(db, principal(subject, tenant, issuer));
  const run = async (name, fn) => { await fn(); r.tests.push({ name, result: 'PASS' }); record(); };
  const denied = async (fn, code, constraint = false) => {
    let refusal;
    try { await fn(); } catch (error) { refusal = error; }
    check(refusal && (constraint ? refusal instanceof ConstraintDenied && refusal.code === code : refusal.message === code),
      'EXPECTED_DENIAL_NOT_QUALIFIED');
  };
  record();
  try {
    check(ownerResultMatches(baselineReceipt, ownerProof), 'OWNER_BACKUP_RESULT_OR_BASELINE_MISMATCH');
    r.owner_decryption_result_matches = true;
    const account = result(await call('GET', ACCOUNT_BASE));
    check(account?.id === ACCOUNT, 'RECOVERY_ACCOUNT_DRIFT');
    Object.assign(r, targetD1Plan(await call('GET', ACCOUNT_BASE + '/subscriptions')));
    const catalog = await call('GET', ACCOUNT_BASE + '/d1/database?page=1&per_page=100');
    check(Array.isArray(result(catalog)) && catalog.result.length === 1 && catalog.result[0].uuid === TARGET &&
      catalog.result[0].name === NAME && catalog.result_info?.total_count === 1 && catalog.result_info.count === 1,
    'RECOVERY_DATABASE_CATALOG_DRIFT');
    const workers = result(await call('GET', ACCOUNT_BASE + '/workers/scripts'));
    const pages = await call('GET', ACCOUNT_BASE + '/pages/projects?page=1&per_page=10');
    check(Array.isArray(workers) && workers.length === 0 && Array.isArray(result(pages)) && pages.result.length === 0 &&
      pages.result_info?.total_count === 0, 'RECOVERED_TARGET_HAS_CONSUMERS');
    const detail = result(await call('GET', TARGET_BASE));
    check(detail?.uuid === TARGET && detail.name === NAME, 'RECOVERED_TARGET_IDENTITY_DRIFT');
    const initial = await snapshot(call, transfer, inspect, pause);
    check(same(initial, baselineReceipt.baseline), 'RECOVERED_DATA_DRIFT_BEFORE_FIXTURES');
    r.baseline = initial; record();
    for (const [sql, params] of [[SQL.tenantCount, [F.ta, F.tb]], [SQL.identityCount, [F.ia, F.ib]],
      [SQL.linkCount, [F.ca, F.cb, F.pa, F.pb]]]) {
      const count = await db.prepare(sql).bind(...params).first();
      check(count?.n === 0, 'FIXTURE_IDENTIFIER_COLLISION');
    }
    const mark = result(await call('GET', TARGET_BASE + '/time_travel/bookmark'))?.bookmark;
    check(BOOKMARK.test(mark ?? ''), 'ROLLBACK_BOOKMARK_MISSING'); rollbackBookmark = mark;
    r.rollback_bookmark_sha256 = sha(mark);
    r.fixtures_attempted = true; r.status = 'FIXTURE_SEED_STARTING'; record();
    await query(SQL.seedTenants, F.ta, F.tb);
    await query(SQL.seedIdentities, F.ia, F.issuer, F.sa, F.ib, F.issuer, F.sb);
    await query(SQL.seedMemberships, F.ta, F.ia, F.tb, F.ib);
    await run('cross_tenant_canonical_insert_fk_denied', () => denied(() => query(SQL.seedLink, F.ia, F.tb, F.ca, F.pa, F.hash, F.consent), 'FOREIGN KEY constraint failed', true));
    await query(SQL.seedLink, F.ia, F.ta, F.ca, F.pa, F.hash, F.consent);
    await query(SQL.seedLink, F.ib, F.tb, F.cb, F.pb, F.hash, F.consent);
    await run('tenant_a_resolves_own_customer_and_viewer_role', async () => {
      const p = await app(F.sa, F.ta); check(p.customer_id === F.ca && p.identity_id === F.ia && p.role === 'viewer', 'TENANT_A_MAPPING_FAILED');
    });
    await run('tenant_b_resolves_own_customer_and_owner_role', async () => {
      const p = await app(F.sb, F.tb); check(p.customer_id === F.cb && p.identity_id === F.ib && p.role === 'owner', 'TENANT_B_MAPPING_FAILED');
    });
    for (const [name, subject, tenant, issuer] of [
      ['a_cannot_select_b', F.sa, F.tb, F.issuer], ['b_cannot_select_a', F.sb, F.ta, F.issuer],
      ['unknown_subject_denied', F.unknown, F.ta, F.issuer], ['unknown_issuer_denied', F.sa, F.ta, F.unknown],
      ['sql_injection_tenant_is_bound_value', F.sa, F.attack, F.issuer],
    ]) await run(name, () => denied(() => app(subject, tenant, issuer), 'membership_not_authorized'));
    const link = (customer_id, tenant_id, subject) => ({ issuer: F.issuer, customer_id, tenant_id,
      subject_sha256: sha(F.issuer + '\n' + subject) });
    await run('oauth_canonical_seam_accepts_own_mapping', async () => {
      const p = await assertCanonicalOAuthLink({ CUSTOMER_DB: db }, link(F.ca, F.ta, F.sa));
      check(p.customer_id === F.ca && p.role === 'viewer', 'OAUTH_CANONICAL_MAPPING_FAILED');
    });
    await run('oauth_cross_customer_mapping_denied', () => denied(() => assertCanonicalOAuthLink({ CUSTOMER_DB: db },
      link(F.cb, F.ta, F.sa)), 'canonical_mapping_mismatch'));
    await run('canonical_link_identity_mutation_denied', () => denied(() => query(SQL.mutateLink, F.tb, F.ia), 'canonical_link_immutable', true));
    await query(SQL.revokeLink, F.ia);
    await run('revoked_link_cannot_resolve_customer', () => denied(() => app(F.sa, F.ta), 'canonical_link_revoked'));
    await run('revoked_link_cannot_be_reactivated', () => denied(() => query(SQL.reactivateLink, F.ia), 'canonical_link_revocation_terminal', true));
    await query(SQL.revokeMembership, F.ta, F.ia);
    await run('revoked_membership_denied', () => denied(() => app(F.sa, F.ta), 'membership_not_authorized'));
    await query(SQL.suspendTenant, F.tb);
    await run('suspended_tenant_denied', () => denied(() => app(F.sb, F.tb), 'membership_not_authorized'));
    r.status = 'APPLICATION_TENANT_CHECKS_PASSED_CLEANUP_REQUIRED';
  } catch (error) {
    r.status = 'TENANT_QUALIFICATION_STOPPED';
    r.error = error instanceof TenantStop ? error.code : 'UNEXPECTED_QUALIFICATION_FAILURE';
  } finally {
    if (r.fixtures_attempted && rollbackBookmark) {
      r.rollback_attempted = true; record();
      try {
        await call('POST', TARGET_BASE + '/time_travel/restore?bookmark=' + rollbackBookmark);
        r.rollback_acknowledged = true;
      } catch { r.rollback_error = 'ROLLBACK_ACKNOWLEDGEMENT_UNCONFIRMED'; }
      try {
        const after = await snapshot(call, transfer, inspect, pause);
        check(same(after, r.baseline), 'AFTER_TEST_RECOVERED_DATA_MISMATCH');
        r.cleanup_all_table_parity_verified = true; r.after_cleanup = after;
      } catch { r.cleanup_error = 'ROLLBACK_DATA_PARITY_UNCONFIRMED'; }
      if (r.status === 'APPLICATION_TENANT_CHECKS_PASSED_CLEANUP_REQUIRED' && r.cleanup_all_table_parity_verified)
        r.status = 'RECOVERED_APPLICATION_TENANT_BOUNDARIES_AND_CLEANUP_VERIFIED';
      else if (!r.cleanup_all_table_parity_verified) r.status = 'TENANT_TEST_CLEANUP_REQUIRES_RECONCILIATION';
    }
    record();
  }
  return r;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const readPinned = (name, expected) => {
    const bytes = readFileSync(new URL('../evidence/hosted_recovery_20261114/' + name, import.meta.url));
    check(sha(bytes) === expected, 'EVIDENCE_FILE_PIN_MISMATCH'); return JSON.parse(bytes);
  };
  const baselineReceipt = readPinned('hosted_restore_parity_rollback_passed.json', '82ab871ea31dc55eeabb79803bb03e4a2d8ee98d789bafb8a1d6c9e99480cf07');
  const ownerProof = readPinned('owner_submitted_decryption_proof_20261114.json', '212546bab17be2c12f5dfa1084d640bdae105fd5c57604e58d6b30ea7f4de8e2');
  const r = await qualify({ token: process.env.AXIOM_D1_RECOVERY_CF_API_TOKEN, baselineReceipt, ownerProof });
  console.log(r.status); if (r.error) console.log('error=' + r.error);
  console.log('checks_passed=' + r.tests.length);
  process.exitCode = r.status === 'RECOVERED_APPLICATION_TENANT_BOUNDARIES_AND_CLEANUP_VERIFIED' ? 0 : 2;
}
