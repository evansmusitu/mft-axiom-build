/**
 * MUSITU Studio V0.3 — one-shot source-authorized Neon import candidate.
 * Staging-only; never opens a connection itself and never disables triggers.
 * Caller must supply the externally authenticated, immutable, frozen source
 * snapshot and an isolated database client. NOT a production cutover switch.
 */
import {normalizeStudioLedgerSnapshot,reconcileStudioLedgers} from './ledger_reconcile.mjs';

const ORDER=Object.freeze(['projects','memberships','jobs','assets','audit_events']);
const COLS=Object.freeze({
  projects:['id','title','owner_sub','created_at'],
  memberships:['project_id','member_sub','role','created_at'],
  jobs:['id','project_id','submission_key','payload_json','payload_sha256','render_device',
    'state','created_by_sub','approved_by_sub','dispatched_by_sub','call_id','error_code',
    'created_at','approved_at','dispatched_at','finished_at'],
  assets:['job_id','filename','object_key','sha256','bytes'],
  audit_events:['id','project_id','job_id','action','actor_sub','at','details']
});
const MAX_TOTAL_ROWS=25000;
const strictCount=(v)=>{
  const n=Number(v);
  if(!Number.isSafeInteger(n)||n<0)throw Error('NEON_COUNT_NOT_SAFE');
  return n;
};
const ensure= (ok,code)=>{if(!ok)throw Error(code)};
const SQL=(table,columns)=>{
  ensure(ORDER.includes(table),'NEON_TABLE_NOT_ALLOWLISTED');
  ensure(columns.every(c=>COLS[table].includes(c)),'NEON_COLUMN_NOT_ALLOWLISTED');
  const placeholders=columns.map((_,i)=>'$'+(i+1)).join(',');
  return 'INSERT INTO studio_v03.'+table+'('+columns.join(',')+') VALUES('+placeholders+')';
};
function connectionValid(client){
  return client&&typeof client.connect==='function'&&typeof client.query==='function'&&
    typeof client.end==='function';
}
const exactRows=async(client,table)=>{
  const result=await client.query('SELECT '+COLS[table].join(',')+
    ' FROM studio_v03.'+table);
  ensure(Array.isArray(result?.rows),'NEON_DESTINATION_READBACK_UNAVAILABLE');
  return result.rows;
};
/** An empty destination is mandatory: never merge/overwrite existing records. */
async function assertEmpty(client){
  for(const table of ORDER){
    const result=await client.query('SELECT COUNT(*) AS n FROM studio_v03.'+table);
    ensure(Array.isArray(result?.rows)&&result.rows.length===1,'NEON_PREIMPORT_COUNT_UNAVAILABLE');
    ensure(strictCount(result.rows[0].n)===0,'NEON_TARGET_NOT_EMPTY_'+table.toUpperCase());
  }
}
/** A transaction must retain the real v2 immutability triggers. */
// PostgreSQL pg_trigger.tgtype bitmasks: ROW=1, BEFORE=2,
// INSERT=4, DELETE=8, UPDATE=16. Names alone do not prove guards.
// The importer must refuse a wrong table, firing event or called function.
const REQUIRED_TRIGGERS=Object.freeze({
  job_state_integrity:['jobs',19,'enforce_job_asset_integrity'],
  asset_insert_integrity:['assets',7,'enforce_asset_integrity'],
  asset_update_integrity:['assets',19,'enforce_asset_integrity'],
  asset_delete_integrity:['assets',11,'enforce_asset_integrity'],
  audit_immutable_update:['audit_events',19,'deny_audit_mutation'],
  audit_immutable_delete:['audit_events',11,'deny_audit_mutation']
});
// Immutable v2 function bodies are pinned to the reviewed SQL migrations.
// pg_trigger names and tgtype alone cannot exclude replaced no-op functions,
// conditional WHEN triggers or UPDATE OF partial-column triggers.
const REQUIRED_FUNCTION_SOURCES=Object.freeze({"deny_audit_mutation":"BEGIN RAISE EXCEPTION 'AUDIT_IMMUTABLE' USING ERRCODE='23514'; END;","enforce_job_asset_integrity":"DECLARE item_count INTEGER;\n BEGIN\n  -- A terminal row is entirely immutable, including edits to payload or job identity.\n  IF OLD.state IN ('COMPLETED','FAILED') THEN\n    RAISE EXCEPTION 'TERMINAL_JOB_IMMUTABLE' USING ERRCODE='23514';\n  END IF;\n  IF NEW.state='COMPLETED' AND OLD.state IS DISTINCT FROM NEW.state THEN\n   SELECT COUNT(*) INTO item_count FROM studio_v03.assets WHERE job_id=NEW.id;\n   IF item_count<>3 THEN\n    RAISE EXCEPTION 'COMPLETED_JOB_REQUIRES_THREE_ASSETS' USING ERRCODE='23514';\n   END IF;\n  END IF;\n  RETURN NEW;\n END;","enforce_asset_integrity":"DECLARE current_state TEXT;\n BEGIN\n  -- Row locks serialize asset writes with job completion. Never rely on a\n  -- nonlocking SELECT because the completion transaction updates jobs.state.\n  IF TG_OP='INSERT' THEN\n    SELECT state INTO current_state FROM studio_v03.jobs WHERE id=NEW.job_id FOR UPDATE;\n    IF current_state IS NULL OR current_state NOT IN ('RUNNING','DISPATCHING') THEN\n      RAISE EXCEPTION 'ASSET_INSERT_NONACTIVE_JOB' USING ERRCODE='23514';\n    END IF;\n    RETURN NEW;\n  ELSIF TG_OP='UPDATE' THEN\n    -- Checking only NEW.job_id previously permitted moving a completed-job\n    -- artifact to an active job and thereby evading completed immutability.\n    IF NEW.job_id IS DISTINCT FROM OLD.job_id THEN\n      RAISE EXCEPTION 'ASSET_JOB_REASSIGNMENT_DENIED' USING ERRCODE='23514';\n    END IF;\n    SELECT state INTO current_state FROM studio_v03.jobs WHERE id=OLD.job_id FOR UPDATE;\n    IF current_state IS NULL OR current_state='COMPLETED' THEN\n      RAISE EXCEPTION 'COMPLETED_ASSET_IMMUTABLE' USING ERRCODE='23514';\n    END IF;\n    RETURN NEW;\n  ELSIF TG_OP='DELETE' THEN\n    SELECT state INTO current_state FROM studio_v03.jobs WHERE id=OLD.job_id FOR UPDATE;\n    IF current_state IS NULL OR current_state='COMPLETED' THEN\n      RAISE EXCEPTION 'COMPLETED_ASSET_IMMUTABLE' USING ERRCODE='23514';\n    END IF;\n    RETURN OLD;\n  END IF;\n  RAISE EXCEPTION 'INVALID_ASSET_TRIGGER_ACTION' USING ERRCODE='23514';\n END;"});
const normalizeFunctionSource=value=>
  typeof value==='string'?value.replace(/\r\n/g,'\n').trim():null;
async function assertIntegrityTriggers(client){
  const versions=await client.query('SELECT COUNT(*) AS n FROM studio_v03._studio_schema_versions WHERE version=2');
  ensure(versions?.rows?.length===1&&strictCount(versions.rows[0].n)===1,
    'NEON_SCHEMA_V2_MISSING');
  const triggers=await client.query(
    'SELECT t.tgname,t.tgenabled,t.tgtype,t.tgattr::text AS update_columns,'+
    '(t.tgqual IS NOT NULL) AS has_when_clause,tn.nspname AS table_schema,'+
    'c.relname AS table_name,fn.nspname AS function_schema,p.proname AS function_name,'+
    'p.prosrc AS function_body,lang.lanname AS function_language,'+
    'p.pronargs AS function_args,p.prosecdef AS security_definer,'+
    "(p.prorettype='pg_catalog.trigger'::regtype) AS returns_trigger "+
    'FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid '+
    'JOIN pg_namespace tn ON tn.oid=c.relnamespace '+
    'JOIN pg_proc p ON p.oid=t.tgfoid '+
    'JOIN pg_language lang ON lang.oid=p.prolang '+
    'JOIN pg_namespace fn ON fn.oid=p.pronamespace '+
    "WHERE t.tgrelid IN ('studio_v03.jobs'::regclass,"+
    "'studio_v03.assets'::regclass,'studio_v03.audit_events'::regclass) "+
    'AND NOT t.tgisinternal');
  ensure(Array.isArray(triggers?.rows),'NEON_TRIGGER_TOPOLOGY_UNAVAILABLE');
  const found=new Map();
  for(const row of triggers.rows){
    ensure(!found.has(row.tgname),'NEON_TRIGGER_TOPOLOGY_MISMATCH');
    found.set(row.tgname,row);
  }
  for(const [name,[table,type,func]] of Object.entries(REQUIRED_TRIGGERS)){
    const row=found.get(name);
    ensure(row,'NEON_IMMUTABILITY_TRIGGER_MISSING');
    ensure(row.tgenabled==='O'&&row.table_schema==='studio_v03'&&
      row.table_name===table&&row.function_schema==='studio_v03'&&
      row.function_name===func&&Number(row.tgtype)===type&&
      row.update_columns===''&&row.has_when_clause===false,
      'NEON_TRIGGER_TOPOLOGY_MISMATCH');
    ensure(row.function_language==='plpgsql'&&Number(row.function_args)===0&&
      row.security_definer===false&&row.returns_trigger===true&&
      normalizeFunctionSource(row.function_body)===REQUIRED_FUNCTION_SOURCES[func],
      'NEON_TRIGGER_FUNCTION_BODY_MISMATCH');
  }
  ensure(found.size===Object.keys(REQUIRED_TRIGGERS).length,
    'NEON_TRIGGER_TOPOLOGY_MISMATCH');
}
/** Never emit the row contents, subjects, assets or secret HMAC key. */
export async function importFrozenStudioLedger({makeClient,sourceSnapshot,integrityKey}={}){
  ensure(typeof makeClient==='function','NEON_IMPORT_CLIENT_REQUIRED');
  // Normalization checks all table sets, relationships, audit lineage and limits.
  const source=normalizeStudioLedgerSnapshot(sourceSnapshot);
  const size=ORDER.reduce((n,t)=>n+source[t].length,0);
  ensure(size<=MAX_TOTAL_ROWS,'NEON_IMPORT_ROW_LIMIT');
  ensure(integrityKey instanceof Uint8Array&&integrityKey.byteLength>=32,
    'NEON_IMPORT_INTEGRITY_KEY_REQUIRED');
  const client=makeClient();
  ensure(connectionValid(client),'NEON_IMPORT_CLIENT_INVALID');
  let connected=false,started=false,committed=false;
  try{
    await client.connect();connected=true;
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    started=true;
    await client.query('SET LOCAL search_path TO studio_v03, pg_catalog');
    // pg_trigger reports tgenabled='O' even if a privileged session uses
    // session_replication_role='replica' to suppress origin triggers. Verify
    // the *actual importing transaction* cannot bypass immutability guards.
    const replication=await client.query("SELECT current_setting('session_replication_role') AS replication_role");
    ensure(replication?.rows?.length===1&&replication.rows[0]?.replication_role==='origin',
      'NEON_REPLICATION_ROLE_UNSAFE');
    await assertIntegrityTriggers(client);
    await assertEmpty(client);

    for(const table of ORDER){
      if(table==='assets'||table==='audit_events')continue;
      for(const row of source[table]){
        const entry={...row};
        if(table==='jobs'){
          const hasAssets=source.assets.some(a=>a.job_id===row.id);
          if(hasAssets&& !['RUNNING','DISPATCHING'].includes(row.state)){
            ensure(!['PENDING_APPROVAL','APPROVED'].includes(row.state),
              'NEON_ASSET_STATE_INCONSISTENT');
            // PostgreSQL asset insert trigger requires an active job.
            // The original terminal state is restored before COMMIT.
            entry.state='RUNNING';
          }
        }
        await client.query(SQL(table,COLS[table]),COLS[table].map(k=>entry[k]));
      }
    }
    for(const row of source.assets){
      await client.query(SQL('assets',COLS.assets),COLS.assets.map(k=>row[k]));
    }
    for(const job of source.jobs){
      if(!['RUNNING','DISPATCHING'].includes(job.state) &&
          source.assets.some(a=>a.job_id===job.id)){
        const outcome=await client.query(
          'UPDATE studio_v03.jobs SET state=$1 WHERE id=$2 AND state=$3',
          [job.state,job.id,'RUNNING']);
        ensure(outcome?.rowCount===1,'NEON_TERMINAL_STATE_RESTORE_FAILED');
      }
    }
    for(const row of source.audit_events){
      await client.query(SQL('audit_events',COLS.audit_events),
        COLS.audit_events.map(k=>row[k]));
    }
    const readback={complete:true,freeze_id:source.freeze_id};
    for(const table of ORDER)readback[table]=await exactRows(client,table);
    // Verify all original columns and HMACs in the SAME transaction and
    // against a fresh SQL readback, not against the INSERT parameter objects.
    const receipt=reconcileStudioLedgers(source,readback,{integrityKey});
    ensure(receipt.verified,'NEON_RECONCILIATION_FAILED');
    await client.query('COMMIT');committed=true;
    return {schema:'musitu.studio.v03.neon.import.v1',committed:true,
      reconciliation:receipt,cloudflare_ledger_unchanged:true,
      live_cutover_authorized:false,rendering_enabled:false};
  }catch(error){
    if(started&&!committed)try{await client.query('ROLLBACK')}catch{}
    throw error;
  }finally{
    if(connected||client)await client.end();
  }
}
