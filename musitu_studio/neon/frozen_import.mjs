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
async function assertIntegrityTriggers(client){
  const versions=await client.query('SELECT COUNT(*) AS n FROM studio_v03._studio_schema_versions WHERE version=2');
  ensure(versions?.rows?.length===1&&strictCount(versions.rows[0].n)===1,
    'NEON_SCHEMA_V2_MISSING');
  const triggers=await client.query(
    "SELECT tgname FROM pg_trigger WHERE tgrelid IN ("+
    "'studio_v03.jobs'::regclass,'studio_v03.assets'::regclass,"+
    "'studio_v03.audit_events'::regclass) AND NOT tgisinternal AND tgenabled='O'");
  const seen=new Set((triggers?.rows||[]).map(r=>r.tgname));
  for(const required of ['job_state_integrity','asset_insert_integrity',
    'asset_update_integrity','asset_delete_integrity',
    'audit_immutable_update','audit_immutable_delete']){
    ensure(seen.has(required),'NEON_IMMUTABILITY_TRIGGER_MISSING');
  }
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
