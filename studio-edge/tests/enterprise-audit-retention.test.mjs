import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {pruneTenantAudit} from '../enterprise-audit-retention.mjs';

const NOW=1800000000,DAY=86400;
function fixture(){
 const sql=new DatabaseSync(':memory:');
 sql.exec('PRAGMA foreign_keys=ON');
 sql.exec(readFileSync(new URL('../migrations/0001_enterprise_workspace.sql',import.meta.url),'utf8'));
 for(const [tenant,artifact,age] of [
  ['tenant_alpha001','artifact_old_001',90],
  ['tenant_bravo002','artifact_old_002',40],
  ['tenant_alpha001','artifact_old_003',31],
  ['tenant_bravo002','artifact_edge_001',30],
  ['tenant_alpha001','artifact_new_001',5],
  ['tenant_bravo002','artifact_new_002',0]
 ]){
  sql.prepare('INSERT INTO tenant_audit(tenant_id,artifact_id,subject,event,at) VALUES (?,?,?,?,?)')
    .run(tenant,artifact,'signed-subject','put',NOW-age*DAY);
 }
 sql.prepare('INSERT INTO tenants VALUES (?)').run('tenant_alpha001');
 sql.prepare('INSERT INTO tenant_artifacts(tenant_id,artifact_id,iv,ciphertext,version,updated_at) VALUES (?,?,?,?,?,?)')
    .run('tenant_alpha001','artifact_saved_001','private-iv','private-ciphertext',1,NOW);
 const db={prepare:query=>({bind:(...args)=>({
  run:async()=>({meta:{changes:sql.prepare(query).run(...args).changes}})
 })})};
 return {sql,db,close:()=>sql.close()};
}
test('retention helper is inert until explicit execute=true, and validates legal window',async()=>{
 const h=fixture();try{
  const before=h.sql.prepare('SELECT count(*) n FROM tenant_audit').get().n;
  const dry=await pruneTenantAudit(h.db,{now:NOW,tenantId:'tenant_alpha001',retentionDays:30,batchSize:2});
  assert.deepEqual(dry,{executed:false,deleted:0,retentionDays:30,batchSize:2});
  assert.equal(h.sql.prepare('SELECT count(*) n FROM tenant_audit').get().n,before);
  for(const opts of [{now:NOW,tenantId:'tenant_alpha001',execute:true,retentionDays:0},{now:NOW,tenantId:'tenant_alpha001',execute:true,batchSize:0},
   {now:NOW,tenantId:'tenant_alpha001',execute:true,batchSize:1000},{now:-1,tenantId:'tenant_alpha001',execute:true},{execute:true}]){
   await assert.rejects(pruneTenantAudit(h.db,opts));
  }
  assert.equal(h.sql.prepare('SELECT count(*) n FROM tenant_audit').get().n,before);
 }finally{h.close();}
});
test('bounded cleanup removes only expired audit rows, oldest first, never ciphertext',async()=>{
 const h=fixture();try{
  const first=await pruneTenantAudit(h.db,{now:NOW,tenantId:'tenant_alpha001',retentionDays:30,batchSize:2,execute:true});
  assert.deepEqual(first,{executed:true,deleted:2,retentionDays:30,batchSize:2});
  let remaining=h.sql.prepare('SELECT artifact_id FROM tenant_audit ORDER BY at,id').all().map(x=>x.artifact_id);
  assert.deepEqual(remaining,['artifact_old_002','artifact_edge_001','artifact_new_001','artifact_new_002']);
  const second=await pruneTenantAudit(h.db,{now:NOW,tenantId:'tenant_bravo002',retentionDays:30,batchSize:2,execute:true});
  assert.equal(second.deleted,1);
  const third=await pruneTenantAudit(h.db,{now:NOW,tenantId:'tenant_alpha001',retentionDays:30,batchSize:2,execute:true});
  assert.equal(third.deleted,0);
  remaining=h.sql.prepare('SELECT artifact_id FROM tenant_audit ORDER BY at,id').all().map(x=>x.artifact_id);
  assert.deepEqual(remaining,['artifact_edge_001','artifact_new_001','artifact_new_002']);
  assert.equal(h.sql.prepare("SELECT ciphertext FROM tenant_artifacts WHERE artifact_id='artifact_saved_001'").get().ciphertext,'private-ciphertext');
 }finally{h.close();}
});
test('helper fails closed if database cannot confirm exact count',async()=>{
 const broken={prepare:()=>({bind:()=>({run:async()=>({})})})};
 await assert.rejects(pruneTenantAudit(broken,{now:NOW,tenantId:'tenant_alpha001',execute:true}),/STORE_UNAVAILABLE/);
 await assert.rejects(pruneTenantAudit({}, {now:NOW,tenantId:'tenant_alpha001',execute:true}));
});


test('audit retention cannot operate without explicitly scoped tenant authorization',async()=>{
 const h=fixture();try{
  await assert.rejects(pruneTenantAudit(h.db,{now:NOW,execute:true}),/INVALID_RETENTION_PARAMETERS/);
  await assert.rejects(pruneTenantAudit(h.db,{now:NOW,tenantId:'../cross_tenant',execute:true}),/INVALID_RETENTION_PARAMETERS/);
  assert.equal(h.sql.prepare('SELECT count(*) AS n FROM tenant_audit').get().n,6);
 }finally{h.close();}
});
test('tenant-specific audit purge never deletes an expired event belonging to another tenant',async()=>{
 const h=fixture();try{
  const result=await pruneTenantAudit(h.db,{now:NOW,tenantId:'tenant_alpha001',retentionDays:30,batchSize:5,execute:true});
  assert.equal(result.deleted,2);
  assert.deepEqual(h.sql.prepare('SELECT artifact_id FROM tenant_audit WHERE tenant_id=? ORDER BY at').all('tenant_bravo002').map(x=>x.artifact_id),
   ['artifact_old_002','artifact_edge_001','artifact_new_002']);
  assert.equal(h.sql.prepare('SELECT count(*) AS n FROM tenant_audit WHERE tenant_id=?').get('tenant_alpha001').n,1);
 }finally{h.close();}
});
