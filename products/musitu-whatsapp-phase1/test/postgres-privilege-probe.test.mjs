import test from 'node:test';
import assert from 'node:assert/strict';
import * as guard from '../src/postgres/runtime-role-guard.mjs';
const {qualifyPostgresRuntimePrivileges}=guard;
const tables=['tenants','memberships','whatsapp_channels','conversations','inbound_events','message_status_events','resources','bookings','outbound_attempts','faqs','reply_drafts','draft_approvals','channel_consent_evidence','outbound_preparations','customer_suppressions'];
const writes=new Set(['bookings','draft_approvals','outbound_preparations','customer_suppressions']);
function fake({overGrant=null,missing=null,canCreateSchema=false,columnUpdateOn=null}={}){
 const released=[];
 const rows=tables.filter(tablename=>tablename!==missing).map(tablename=>({tablename,
  can_select:true,can_insert:writes.has(tablename)||tablename===overGrant,
  can_update:false,can_insert_any_column:writes.has(tablename)||tablename===overGrant,
  can_update_any_column:tablename===columnUpdateOn,can_references_any_column:false,
  can_delete:false,can_truncate:false,can_trigger:false,can_references:false}));
 return {released,pool:{async connect(){return {async query(sql){
  if(sql.includes('has_schema_privilege'))return {rows:[{can_use_schema:true,can_create_schema:canCreateSchema,can_create_database:false}]};
  if(sql.includes('has_table_privilege'))return {rows};
  throw Error('UNEXPECTED_SQL');
 },release(error){released.push(error||null);}};}}};
}
test('least-privilege runtime has only read and four explicit insert tables',async()=>{
 const r=fake();
 const result=await qualifyPostgresRuntimePrivileges({pool:r.pool});
 assert.deepEqual(result,{qualified:true,tablesChecked:15,insertTablesChecked:4,mode:'EFFECTIVE_PRIVILEGES'});
 assert.equal(r.released.length,1);
});
test('runtime cannot create schemas, grant membership, insert outbound attempts, or update payments',async()=>{
 for(const cfg of [{overGrant:'memberships'},{overGrant:'outbound_attempts'},{canCreateSchema:true},{missing:'draft_approvals'}]){
  const r=fake(cfg);
  await assert.rejects(qualifyPostgresRuntimePrivileges({pool:r.pool}),/RUNTIME_PRIVILEGES_UNQUALIFIED/);
  assert.equal(r.released.length,1);
 }
});

test('column-level UPDATE grant is not mistaken for least privilege',async()=>{
 const r=fake({columnUpdateOn:'memberships'});
 await assert.rejects(qualifyPostgresRuntimePrivileges({pool:r.pool}),/RUNTIME_PRIVILEGES_UNQUALIFIED/);
 assert.equal(r.released.length,1);
});
