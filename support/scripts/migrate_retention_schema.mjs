import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const API='https://api.cloudflare.com/client/v4';
const SUPPORT_BRANCH='support/axiom-official-support-20261005';
const SUPPORT_DOMAIN='support.mftintelligence.com';
const WORKER='musitu-axiom-support';
const CONFIRM='MIGRATE_MUSITU_AXIOM_SUPPORT_RETENTION_SCHEMA';

const sha256=value=>createHash('sha256').update(String(value)).digest('hex');

async function cf({fetchImpl,token,path,method='GET',body}) {
  const response=await fetchImpl(API+path,{
    method,
    headers:{authorization:'Bearer '+token,accept:'application/json',...(body===undefined?{}:{'content-type':'application/json'})},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
  });
  let payload={}; try{payload=await response.json();}catch{}
  if(!response.ok||payload?.success===false){
    const codes=Array.isArray(payload?.errors)?payload.errors.map(x=>x?.code).filter(Boolean):[];
    const error=new Error(`Cloudflare ${method} ${path} failed HTTP ${response.status}; codes=${codes.join(',')||'none'}`);
    error.status=response.status;
    throw error;
  }
  return payload?.result;
}

function rows(result){
  const block=Array.isArray(result)?result[0]:result;
  return Array.isArray(block?.results)?block.results:[];
}

async function query({fetchImpl,token,accountId,databaseId,sql}) {
  return cf({
    fetchImpl,token,
    path:`/accounts/${accountId}/d1/database/${databaseId}/query`,
    method:'POST',
    body:{sql},
  });
}

async function countTable({fetchImpl,token,accountId,databaseId,table}) {
  const result=await query({fetchImpl,token,accountId,databaseId,sql:`SELECT COUNT(*) AS count FROM ${table};`});
  return Number(rows(result)[0]?.count??-1);
}

const REQUIRED_COLUMNS=Object.freeze([
  ['closed_at','TEXT'],
  ['retention_expires_at','TEXT'],
  ['legal_hold_until','TEXT'],
  ['legal_hold_review_at','TEXT'],
]);

const MIGRATION_SQL=Object.freeze([
`CREATE TABLE IF NOT EXISTS support_case_purge_authorizations (
  case_id TEXT PRIMARY KEY CHECK (case_id GLOB 'AX-*'),
  receipt_sha256 TEXT NOT NULL CHECK (length(receipt_sha256) = 64),
  authorized_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);`,
`CREATE TABLE IF NOT EXISTS support_deletion_receipts (
  receipt_sha256 TEXT PRIMARY KEY CHECK (length(receipt_sha256) = 64),
  case_reference_sha256 TEXT NOT NULL CHECK (length(case_reference_sha256) = 64),
  retention_class TEXT NOT NULL CHECK (retention_class IN ('SUPPORT_STANDARD','PRIVACY_RESTRICTED','SECURITY_RESTRICTED')),
  closed_at TEXT NOT NULL,
  retention_expires_at TEXT NOT NULL,
  purged_at TEXT NOT NULL,
  last_event_hash TEXT NOT NULL CHECK (length(last_event_hash) = 64),
  approval_evidence_hashes_json TEXT NOT NULL,
  processor_backup_expiry_note TEXT NOT NULL,
  created_at TEXT NOT NULL
);`,
`CREATE INDEX IF NOT EXISTS support_cases_retention ON support_cases(state, retention_expires_at, legal_hold_until);`,
`CREATE INDEX IF NOT EXISTS support_deletion_receipts_purged_at ON support_deletion_receipts(purged_at);`,
`DROP TRIGGER IF EXISTS support_case_event_no_delete;`,
`CREATE TRIGGER support_case_event_no_delete
BEFORE DELETE ON support_case_events
WHEN NOT EXISTS (
  SELECT 1 FROM support_case_purge_authorizations
  WHERE case_id = OLD.case_id AND expires_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now')
)
BEGIN SELECT RAISE(ABORT, 'support events are append-only outside an authorized case purge'); END;`,
`CREATE TRIGGER IF NOT EXISTS support_case_no_delete
BEFORE DELETE ON support_cases
WHEN NOT EXISTS (
  SELECT 1 FROM support_case_purge_authorizations
  WHERE case_id = OLD.case_id AND expires_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now')
)
BEGIN SELECT RAISE(ABORT, 'support cases may be deleted only by an authorized purge'); END;`,
`CREATE TRIGGER IF NOT EXISTS support_deletion_receipt_no_update
BEFORE UPDATE ON support_deletion_receipts BEGIN SELECT RAISE(ABORT, 'support deletion receipts are immutable'); END;`,
`CREATE TRIGGER IF NOT EXISTS support_deletion_receipt_no_delete
BEFORE DELETE ON support_deletion_receipts BEGIN SELECT RAISE(ABORT, 'support deletion receipts are immutable'); END;`,
]);

const REQUIRED_OBJECTS=Object.freeze([
  'support_case_purge_authorizations',
  'support_deletion_receipts',
  'support_case_event_no_update',
  'support_case_event_no_delete',
  'support_case_no_delete',
  'support_deletion_receipt_no_update',
  'support_deletion_receipt_no_delete',
]);

export async function migrateRetentionSchema({
  env=process.env,
  fetchImpl=fetch,
  now=new Date().toISOString(),
  sleepImpl=ms=>new Promise(resolve=>setTimeout(resolve,ms)),
}={}){
  if(env.GITHUB_REF_NAME!==SUPPORT_BRANCH) throw new Error('retention migration may run only from the isolated support branch');
  if(env.SUPPORT_RETENTION_MIGRATION_CONFIRM!==CONFIRM) throw new Error('retention migration confirmation is missing');

  const accountId=String(env.CLOUDFLARE_ACCOUNT_ID||'').trim();
  const zoneId=String(env.CLOUDFLARE_ZONE_ID||'').trim();
  const databaseId=String(env.SUPPORT_D1_DATABASE_ID||'').trim();
  const token=String(env.CLOUDFLARE_API_TOKEN||'').trim();
  if(!accountId||!zoneId||!databaseId||!token) throw new Error('retention migration Cloudflare configuration is incomplete');

  const [domains,subdomain,dns,caseCount,eventCount]=await Promise.all([
    cf({fetchImpl,token,path:`/accounts/${accountId}/workers/domains`}),
    cf({fetchImpl,token,path:`/accounts/${accountId}/workers/scripts/${WORKER}/subdomain`}),
    cf({fetchImpl,token,path:`/zones/${zoneId}/dns_records?name=${encodeURIComponent(SUPPORT_DOMAIN)}&per_page=100`}),
    countTable({fetchImpl,token,accountId,databaseId,table:'support_cases'}),
    countTable({fetchImpl,token,accountId,databaseId,table:'support_case_events'}),
  ]);

  const publicDomain=(Array.isArray(domains)?domains:[]).some(x=>String(x?.hostname||'').toLowerCase()===SUPPORT_DOMAIN);
  const supportDns=Array.isArray(dns)?dns:[];
  const workersDev=subdomain?.enabled===true;
  const previews=subdomain?.previews_enabled===true;
  if(publicDomain||supportDns.length||workersDev||previews) throw new Error('retention migration requires the support origin to remain non-public');
  if(caseCount!==0||eventCount!==0) throw new Error('retention migration requires zero support cases and events');

  const bookmarkRow=await cf({
    fetchImpl,token,
    path:`/accounts/${accountId}/d1/database/${databaseId}/time_travel/bookmark`,
  });
  const bookmark=String(bookmarkRow?.bookmark||'');
  if(!bookmark) throw new Error('pre-migration D1 Time Travel bookmark is missing');

  let wrote=false;
  try {
    const beforeColumns=new Set(rows(await query({
      fetchImpl,token,accountId,databaseId,sql:'PRAGMA table_info(support_cases);',
    })).map(x=>String(x?.name||'')));

    for(const [name,type] of REQUIRED_COLUMNS){
      if(beforeColumns.has(name)) continue;
      await query({
        fetchImpl,token,accountId,databaseId,
        sql:`ALTER TABLE support_cases ADD COLUMN ${name} ${type};`,
      });
      wrote=true;
    }

    for(const sql of MIGRATION_SQL){
      await query({fetchImpl,token,accountId,databaseId,sql});
      wrote=true;
    }

    const afterColumns=new Set(rows(await query({
      fetchImpl,token,accountId,databaseId,sql:'PRAGMA table_info(support_cases);',
    })).map(x=>String(x?.name||'')));
    for(const [name] of REQUIRED_COLUMNS) if(!afterColumns.has(name)) throw new Error(`retention column missing after migration: ${name}`);

    const objectRows=rows(await query({
      fetchImpl,token,accountId,databaseId,
      sql:`SELECT type,name FROM sqlite_master WHERE name IN ('${REQUIRED_OBJECTS.join("','")}') ORDER BY type,name;`,
    }));
    const objectNames=new Set(objectRows.map(x=>String(x?.name||'')));
    for(const name of REQUIRED_OBJECTS) if(!objectNames.has(name)) throw new Error(`retention schema object missing after migration: ${name}`);

    const [afterCases,afterEvents]=await Promise.all([
      countTable({fetchImpl,token,accountId,databaseId,table:'support_cases'}),
      countTable({fetchImpl,token,accountId,databaseId,table:'support_case_events'}),
    ]);
    if(afterCases!==0||afterEvents!==0) throw new Error('retention migration unexpectedly changed support case/event counts');

    return {
      schema:'musitu.axiom.support-readiness-evidence.v1',
      gate:'PRIVACY_RETENTION_SCHEMA',
      status:'PASS',
      verified_at:now,
      verifier_ref:String(env.GITHUB_RUN_ID||'')?`github-actions:run:${String(env.GITHUB_RUN_ID)}`:'github-actions:retention-schema-migration',
      artifact_sha256:sha256(`retention-schema|${now}|${databaseId}|empty-non-public`),
      support_case_count_before:caseCount,
      support_event_count_before:eventCount,
      support_case_count_after:afterCases,
      support_event_count_after:afterEvents,
      public_route_absent_verified:true,
      columns_verified:REQUIRED_COLUMNS.map(([name])=>name),
      lifecycle_objects_verified:[...REQUIRED_OBJECTS],
      rollback_bookmark_recorded:false,
      migration_write_performed:wrote,
      customer_data_modified:false,
      secret_exposed:false,
      public_support_deployed:false,
    };
  } catch(error) {
    if(wrote){
      await cf({
        fetchImpl,token,
        path:`/accounts/${accountId}/d1/database/${databaseId}/time_travel/restore?bookmark=${encodeURIComponent(bookmark)}`,
        method:'POST',
      });
      for(let attempt=0;attempt<10;attempt+=1){
        const [restoredCases,restoredEvents]=await Promise.all([
          countTable({fetchImpl,token,accountId,databaseId,table:'support_cases'}),
          countTable({fetchImpl,token,accountId,databaseId,table:'support_case_events'}),
        ]);
        if(restoredCases===caseCount&&restoredEvents===eventCount) {
          throw new Error(`retention migration failed and was rolled back: ${error.message}`);
        }
        if(attempt<9) await sleepImpl(1000);
      }
      throw new Error(`retention migration failed; rollback verification did not converge: ${error.message}`);
    }
    throw error;
  }
}

export async function main(){
  const evidence=await migrateRetentionSchema();
  const serialized=JSON.stringify(evidence,null,2)+'\n';
  const digest=sha256(serialized);
  await writeFile('support-retention-schema-evidence.json',serialized,{encoding:'utf8',mode:0o600,flag:'wx'});
  await writeFile('support-retention-schema-evidence.json.sha256',`${digest}  support-retention-schema-evidence.json\n`,{encoding:'utf8',mode:0o600,flag:'wx'});
  process.stdout.write(JSON.stringify({
    gate:evidence.gate,status:evidence.status,public_route_absent_verified:evidence.public_route_absent_verified,
    support_case_count_before:evidence.support_case_count_before,support_event_count_before:evidence.support_event_count_before,
    migration_write_performed:evidence.migration_write_performed,evidence_sha256:digest,
  })+'\n');
  return evidence;
}

if(import.meta.url===pathToFileURL(process.argv[1]||'').href) await main();
