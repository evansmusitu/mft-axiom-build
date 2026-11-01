import assert from 'node:assert/strict';
import {sha256Json,canonicalJson} from '../../axiom_interface/vnext/execution_integrity.mjs';
import {SHARED_SCOPE} from './shared-d1-scope.mjs';
export const REUSE_DATABASE=Object.freeze({account_id:'93f395f5121954671f92fffa453d6b61',name:'mft-axiom-claude-staging-20260927',uuid:'a7384b8a-0751-4705-ac77-0616b0885e7c',existing_worker:'mft-axiom-claude-staging-20260927',namespace:'axiom_q06_'});
const quote=name=>'"'+name.replaceAll('"','""')+'"';
const userObject=name=>!name.startsWith('_cf_')&&!name.startsWith('sqlite_');
export async function inspectReusedD1(cf,{previous}={}){
  const d=REUSE_DATABASE,base=`/accounts/${d.account_id}`,database=await cf(`${base}/d1/database/${d.uuid}`);
  assert.equal(database.uuid,d.uuid,'selected database ID changed');assert.equal(database.name,d.name,'selected database name changed');
  assert.ok(database.file_size<=16*1024*1024,'bounded reuse snapshot exceeded');
  const settings=await cf(`${base}/workers/scripts/${d.existing_worker}/settings`);
  assert.ok(settings.bindings?.some(b=>b.type==='d1'&&(b.id||b.database_id)===d.uuid),'selected staging Worker binding changed');
  const query=async(sql,params=[])=>{const result=await cf(`${base}/d1/database/${d.uuid}/query`,{method:'POST',body:{sql,params}});assert.equal(result.length,1);assert.equal(result[0].success,true);return result[0].results;};
  const objects=(await query("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type IN('table','index','trigger','view') ORDER BY type,name")).filter(x=>userObject(x.name));
  if(!previous)assert.equal(objects.some(x=>x.name.startsWith(d.namespace)),false,'reuse namespace already exists; reconcile instead of retry');
  const legacy=objects.filter(x=>!x.name.startsWith(d.namespace));
  assert.ok(legacy.length<=1000,'bounded legacy metadata capacity exceeded');
  const tables=[];
  for(const table of legacy.filter(x=>x.type==='table')){
    const rows=await query('SELECT * FROM '+quote(table.name)+' LIMIT 5001');assert.ok(rows.length<=5000,'bounded legacy row snapshot exceeded');
    const hashes=await Promise.all(rows.map(row=>sha256Json(row)));hashes.sort();
    tables.push({name:table.name,row_count:rows.length,rows_sha256:await sha256Json(hashes)});
  }
  const snapshot={objects_sha256:await sha256Json(legacy),tables,existing_worker_settings_sha256:await sha256Json(settings)};
  const result={database_name:d.name,database_id:d.uuid,namespace:d.namespace,storage_scope:SHARED_SCOPE,isolated_database:false,
    snapshot,legacy_commitment_sha256:await sha256Json(snapshot),legacy_table_names:tables.map(x=>x.name),row_values_logged:false,existing_worker:d.existing_worker};
  if(previous){assert.equal(canonicalJson(snapshot),canonicalJson(previous.snapshot),'original staging schema, records or Worker settings changed');result.original_schema_records_and_worker_unchanged=true;}
  return result;
}
export async function seedReusedNamespace(cf,{runId,preflight}={}){
  const d=REUSE_DATABASE;assert.equal(runId,'axiom-acceptance-20261101-06');assert.equal(preflight.database_id,d.uuid);
  const marker=d.namespace+'axiom_acceptance_reuse_scope';
  // No IF NOT EXISTS: existing or ambiguous one-shot state must be reconciled.
  const path=`/accounts/${d.account_id}/d1/database/${d.uuid}/query`;
  await cf(path,{method:'POST',body:{sql:`CREATE TABLE ${marker}(singleton INTEGER PRIMARY KEY CHECK(singleton=1),run_id TEXT NOT NULL UNIQUE,database_uuid TEXT NOT NULL,scope TEXT NOT NULL,namespace TEXT NOT NULL,legacy_commitment_sha256 TEXT NOT NULL);`,params:[]}});
  return cf(path,{method:'POST',body:{
    sql:`INSERT INTO ${marker} VALUES(1,?1,?2,?3,?4,?5);`,
    params:[runId,d.uuid,SHARED_SCOPE,d.namespace,preflight.legacy_commitment_sha256],
  }});
}
