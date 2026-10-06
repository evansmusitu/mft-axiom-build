import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const SUPPORT_BRANCH = 'support/axiom-official-support-20261005';
const CONFIRM = 'VERIFY_MUSITU_AXIOM_SUPPORT_BACKUP_RESTORE';
const API = 'https://api.cloudflare.com/client/v4';

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

async function cf({fetchImpl, token, path, method = 'GET', body}) {
  const response = await fetchImpl(API + path, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      ...(body === undefined ? {} : {'content-type': 'application/json'}),
    },
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
  });
  let payload = {};
  try { payload = await response.json(); } catch {}
  if (!response.ok || payload?.success === false) {
    const codes = Array.isArray(payload?.errors) ? payload.errors.map(x => x?.code).filter(Boolean) : [];
    const error = new Error(`Cloudflare ${method} ${path} failed HTTP ${response.status}; codes=${codes.join(',') || 'none'}`);
    error.status = response.status;
    throw error;
  }
  return payload?.result;
}

function queryRows(result) {
  const block = Array.isArray(result) ? result[0] : result;
  return Array.isArray(block?.results) ? block.results : [];
}

async function query({fetchImpl, token, accountId, databaseId, sql}) {
  return cf({
    fetchImpl,
    token,
    path: `/accounts/${accountId}/d1/database/${databaseId}/query`,
    method: 'POST',
    body: {sql},
  });
}

export async function runBackupRestoreDrill({
  env = process.env,
  fetchImpl = fetch,
  now = new Date().toISOString(),
  sleepImpl = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  if (env.GITHUB_REF_NAME !== SUPPORT_BRANCH) throw new Error('backup/restore drill may run only from the isolated support branch');
  if (env.SUPPORT_BACKUP_RESTORE_CONFIRM !== CONFIRM) throw new Error('backup/restore drill confirmation is missing');
  const accountId = String(env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const token = String(env.CLOUDFLARE_API_TOKEN || '').trim();
  if (!accountId || !token) throw new Error('Cloudflare D1 credentials are not configured');

  const runId = String(env.GITHUB_RUN_ID || 'local').replace(/[^a-zA-Z0-9-]/g, '').slice(-24) || 'local';
  const databaseName = `axiom-support-restore-drill-${runId}`.toLowerCase();
  const payloadSha = sha256('synthetic-support-backup-restore-v1');
  const existingSupportDatabaseId = String(env.SUPPORT_D1_DATABASE_ID || '').trim();
  const usingExistingSupportDatabase = Boolean(existingSupportDatabaseId);
  const probeTable = usingExistingSupportDatabase
    ? `support_backup_probe_${runId.replace(/-/g, '_').toLowerCase()}`
    : 'support_backup_probe';
  let databaseId = '';
  let cleanupOk = false;
  let evidence = null;
  let supportCaseCountBefore = null;
  let supportEventCountBefore = null;

  try {
    if (usingExistingSupportDatabase) {
      const zoneId = String(env.CLOUDFLARE_ZONE_ID || '').trim();
      if (!zoneId) throw new Error('Cloudflare zone id is required for non-public support D1 drill');

      const [domains, dns] = await Promise.all([
        cf({fetchImpl, token, path: `/accounts/${accountId}/workers/domains`}),
        cf({fetchImpl, token, path: `/zones/${zoneId}/dns_records?name=${encodeURIComponent('support.mftintelligence.com')}&per_page=100`}),
      ]);
      const publicDomain = (Array.isArray(domains) ? domains : []).some(row =>
        String(row?.hostname || '').toLowerCase() === 'support.mftintelligence.com'
      );
      if (publicDomain || (Array.isArray(dns) && dns.length)) throw new Error('support D1 restore drill requires the support hostname to remain non-public');

      databaseId = existingSupportDatabaseId;
      const caseRows = queryRows(await query({
        fetchImpl, token, accountId, databaseId,
        sql: 'SELECT COUNT(*) AS count FROM support_cases;',
      }));
      const eventRows = queryRows(await query({
        fetchImpl, token, accountId, databaseId,
        sql: 'SELECT COUNT(*) AS count FROM support_case_events;',
      }));
      supportCaseCountBefore = Number(caseRows[0]?.count ?? -1);
      supportEventCountBefore = Number(eventRows[0]?.count ?? -1);
      if (supportCaseCountBefore !== 0 || supportEventCountBefore !== 0) {
        throw new Error('support D1 restore drill refuses to run when real support data exists');
      }
    } else {
      const created = await cf({
        fetchImpl, token,
        path: `/accounts/${accountId}/d1/database`,
        method: 'POST',
        body: {name: databaseName},
      });
      databaseId = String(created?.uuid || created?.id || '');
      if (!databaseId) throw new Error('temporary D1 database id missing');
    }

    await query({
      fetchImpl, token, accountId, databaseId,
      sql: `CREATE TABLE ${probeTable}(case_id TEXT PRIMARY KEY, payload_sha256 TEXT NOT NULL, marker TEXT NOT NULL);
INSERT INTO ${probeTable}(case_id,payload_sha256,marker) VALUES('AX-BACKUP-RESTORE-DRILL','${payloadSha}','seed');`,
    });
    const seeded = queryRows(await query({
      fetchImpl, token, accountId, databaseId,
      sql: `SELECT payload_sha256, marker FROM ${probeTable} WHERE case_id='AX-BACKUP-RESTORE-DRILL' LIMIT 1;`,
    }))[0];
    if (seeded?.marker !== 'seed' || seeded?.payload_sha256 !== payloadSha) throw new Error('synthetic seed readback failed');

    const bookmarkRow = await cf({
      fetchImpl, token,
      path: `/accounts/${accountId}/d1/database/${databaseId}/time_travel/bookmark`,
    });
    const bookmark = String(bookmarkRow?.bookmark || '');
    if (!bookmark) throw new Error('D1 Time Travel bookmark missing');

    await query({
      fetchImpl, token, accountId, databaseId,
      sql: `UPDATE ${probeTable} SET marker='mutated' WHERE case_id='AX-BACKUP-RESTORE-DRILL';`,
    });
    const mutated = queryRows(await query({
      fetchImpl, token, accountId, databaseId,
      sql: `SELECT payload_sha256, marker FROM ${probeTable} WHERE case_id='AX-BACKUP-RESTORE-DRILL' LIMIT 1;`,
    }))[0];
    if (mutated?.marker !== 'mutated') throw new Error('destructive mutation verification failed');

    const restored = await cf({
      fetchImpl, token,
      path: `/accounts/${accountId}/d1/database/${databaseId}/time_travel/restore?bookmark=${encodeURIComponent(bookmark)}`,
      method: 'POST',
    });
    if (!restored?.bookmark && !restored?.previous_bookmark) throw new Error('D1 Time Travel restore acknowledgement missing');

    let finalRow = null;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const rows = queryRows(await query({
        fetchImpl, token, accountId, databaseId,
        sql: `SELECT payload_sha256, marker FROM ${probeTable} WHERE case_id='AX-BACKUP-RESTORE-DRILL' LIMIT 1;`,
      }));
      finalRow = rows[0] || null;
      if (finalRow?.marker === 'seed' && finalRow?.payload_sha256 === payloadSha) break;
      if (attempt < 9) await sleepImpl(1000);
    }
    if (finalRow?.marker !== 'seed' || finalRow?.payload_sha256 !== payloadSha) throw new Error('D1 Time Travel restore readback mismatch');

    evidence = {
      schema: 'musitu.axiom.support-readiness-evidence.v1',
      gate: 'BACKUP_RESTORE',
      status: 'PASS',
      verified_at: now,
      verifier_ref: 'cloudflare:d1-time-travel-isolated-drill',
      artifact_sha256: payloadSha,
      synthetic_seed_restored: true,
      existing_support_database_used: usingExistingSupportDatabase,
      support_case_count_before: supportCaseCountBefore,
      support_event_count_before: supportEventCountBefore,
      temporary_database_deleted: false,
      temporary_table_deleted: false,
      production_support_database_modified: false,
      bookmark_recorded: false,
      customer_data_used: false,
      secret_exposed: false,
    };
  } finally {
    if (databaseId) {
      try {
        if (usingExistingSupportDatabase) {
          await query({
            fetchImpl, token, accountId, databaseId,
            sql: `DROP TABLE IF EXISTS ${probeTable};`,
          });
        } else {
          await cf({
            fetchImpl, token,
            path: `/accounts/${accountId}/d1/database/${databaseId}`,
            method: 'DELETE',
          });
        }
        cleanupOk = true;
      } catch {
        cleanupOk = false;
      }
    }
    if (!cleanupOk && databaseId) throw new Error('backup/restore drill cleanup failed');
  }
  if (!evidence) throw new Error('backup/restore drill did not produce evidence');
  evidence.temporary_database_deleted = cleanupOk && !usingExistingSupportDatabase;
  evidence.temporary_table_deleted = cleanupOk && usingExistingSupportDatabase;
  return evidence;
}

export async function main(env = process.env, fetchImpl = fetch) {
  const evidence = await runBackupRestoreDrill({env, fetchImpl});
  const serialized = JSON.stringify(evidence, null, 2) + '\n';
  const digest = sha256(serialized);
  const output = env.SUPPORT_BACKUP_RESTORE_OUTPUT || 'support-backup-restore-evidence.json';
  await writeFile(output, serialized, {encoding:'utf8', mode:0o600, flag:'wx'});
  await writeFile(output + '.sha256', `${digest}  ${output}\n`, {encoding:'utf8', mode:0o600, flag:'wx'});
  process.stdout.write(JSON.stringify({
    gate:evidence.gate,
    status:evidence.status,
    synthetic_seed_restored:true,
    temporary_database_deleted:evidence.temporary_database_deleted,
    temporary_table_deleted:evidence.temporary_table_deleted,
    existing_support_database_used:evidence.existing_support_database_used,
    production_support_database_modified:false,
    evidence_sha256:digest,
  }) + '\n');
  return evidence;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main();
