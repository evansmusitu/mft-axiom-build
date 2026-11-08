import test from 'node:test';
import assert from 'node:assert/strict';
import * as security from '../src/postgres/runtime-role-guard.mjs';

function fakeLeases(roles=['musitu_runtime']) {
 const events=[]; let number=0;
 const pool={async connect(){
  const i=number++,cfg=roles[i]??roles.at(-1);let releases=0;
  const client={
   async query(sql){
    events.push({lease:i,kind:'query',sql});
    if(sql.includes('FROM pg_roles')){
     if(cfg.throwQuery)throw new Error('DATABASE_OFFLINE');
     return {rows:cfg.empty?[]:[{role_name:cfg.role??cfg,rolsuper:cfg.superuser??false,rolbypassrls:cfg.bypass??false}]};
    }
    return {rows:[{safe:true}]};
   },
   release(error){releases++;events.push({lease:i,kind:'release',error:error?.message??null});if(releases>1)throw Error('DOUBLE_RELEASE');}
  };
  return client;
 }};
 return {pool,events};
}

test('every acquired connection must be checked before application SQL',async()=>{
 assert.equal(typeof security.createRuntimeRoleBoundPool,'function');
 const {pool,events}=fakeLeases(['musitu_runtime','musitu_runtime']);
 const wrapped=security.createRuntimeRoleBoundPool({pool,expectedRole:'musitu_runtime'});
 for(let i=0;i<2;i++){
  const c=await wrapped.connect();
  await c.query('SELECT application_data');
  c.release();
 }
 assert.deepEqual(events.filter(x=>x.kind==='query').map(x=>x.sql.includes('FROM pg_roles')?'role':'data'),['role','data','role','data']);
 assert.deepEqual(events.filter(x=>x.kind==='release').map(x=>x.error),[null,null]);
});

test('a privileged or changed role on a later lease is never returned to the repository',async()=>{
 const {pool,events}=fakeLeases(['musitu_runtime',{role:'neon_owner',bypass:true}]);
 const wrapped=security.createRuntimeRoleBoundPool({pool,expectedRole:'musitu_runtime'});
 const first=await wrapped.connect();first.release();
 await assert.rejects(wrapped.connect(),/ROLE_MISMATCH|ROLE_BYPASSES_RLS/);
 assert.equal(events.filter(x=>x.kind==='query').length,2);
 assert.equal(events.filter(x=>x.kind==='release').length,2);
 assert.match(events.at(-1).error,/ROLE_MISMATCH|ROLE_BYPASSES_RLS/);
});

test('same expected role with BYPASSRLS or superuser privilege is denied',async()=>{
 for(const bad of [{role:'musitu_runtime',bypass:true},{role:'musitu_runtime',superuser:true},{role:'musitu_runtime',empty:true}]){
  const {pool,events}=fakeLeases([bad]);
  const guarded=security.createRuntimeRoleBoundPool({pool,expectedRole:'musitu_runtime'});
  await assert.rejects(guarded.connect(),/ROLE_/);
  assert.equal(events.filter(x=>x.kind==='release').length,1);
  assert.equal(events.filter(x=>x.kind==='query').length,1);
 }
});

test('query errors quarantine and release untrusted connections',async()=>{
 const {pool,events}=fakeLeases([{role:'musitu_runtime',throwQuery:true}]);
 const guarded=security.createRuntimeRoleBoundPool({pool,expectedRole:'musitu_runtime'});
 await assert.rejects(guarded.connect(),/DATABASE_OFFLINE/);
 assert.equal(events.filter(x=>x.kind==='release').length,1);
 assert.equal(events.at(-1).error,'DATABASE_OFFLINE');
});

test('constructor rejects absent role or pool before acquiring a client',()=>{
 assert.throws(()=>security.createRuntimeRoleBoundPool({pool:{connect(){}},expectedRole:'not.valid'}),/EXPECTED_RUNTIME_ROLE_REQUIRED/);
 assert.throws(()=>security.createRuntimeRoleBoundPool({expectedRole:'musitu_runtime'}),/PG_POOL_REQUIRED/);
});

const A='00000000-0000-4000-8000-00000000000a';
const B='00000000-0000-4000-8000-00000000000b';
const TABLES=['tenants','memberships','whatsapp_channels','conversations','inbound_events','message_status_events','resources','bookings','outbound_attempts','faqs','reply_drafts','draft_approvals','channel_consent_evidence','outbound_preparations','customer_suppressions'];
const WRITABLE=new Set(['bookings','draft_approvals','outbound_preparations','customer_suppressions']);

test('qualified repository re-verifies the role on EACH later checkout, denying drift before membership/data SQL',async()=>{
 const calls=[];let leases=0;
 const pool={async connect(){
  const lease=++leases;let scope='',seenBegin=false;
  const client={
   async query(sql,params){
    calls.push({lease,sql});
    if(sql.includes('FROM pg_roles'))return {rows:[{role_name:lease===4?'owner_drift':'musitu_runtime',rolbypassrls:lease===4,rolsuper:false}]};
    if(lease===4)throw Error('UNAUTHORIZED_DATA_QUERY_REACHED');
    if(sql.includes('FROM pg_class'))return {rows:TABLES.map(relname=>({relname,relrowsecurity:true,relforcerowsecurity:true}))};
    if(sql.includes('FROM pg_policies'))return {rows:TABLES.map(tablename=>{
     const col=tablename==='tenants'?'id':'tenant_id',scopeSql=`${col} = NULLIF(current_setting('app.tenant_id', true),'')::uuid`;
     return {tablename,policyname:'tenant_boundary',permissive:'PERMISSIVE',roles:['public'],cmd:'ALL',qual:scopeSql,with_check:scopeSql};
    })};
    if(sql.includes('has_schema_privilege'))return {rows:[{can_use_schema:true,can_create_schema:false,can_create_database:false}]};
    if(sql.includes('has_table_privilege'))return {rows:TABLES.map(tablename=>({tablename,can_select:true,can_insert:WRITABLE.has(tablename),can_insert_any_column:WRITABLE.has(tablename),can_update:false,can_update_any_column:false,can_references_any_column:false,can_delete:false,can_truncate:false,can_trigger:false,can_references:false}))};
    if(sql==='BEGIN READ ONLY'){seenBegin=true;scope='';return {rows:[]};}
    if(sql.startsWith('SELECT set_config(')){
     assert.equal(seenBegin,true);scope=params[0];return {rows:[{set_config:scope}]};
    }
    if(sql.includes('FROM musitu.tenants ORDER BY id'))return {rows:(scope===''?[]:[scope]).map(id=>({id}))};
    if(sql==='ROLLBACK'){seenBegin=false;return {rows:[]};}
    throw Error('UNEXPECTED_QUALIFICATION_QUERY '+sql);
   },
   release(err){calls.push({lease,release:err?.message??null});}
  };return client;
 }};
 const repo=await security.createQualifiedPostgresRepository({pool,expectedRole:'musitu_runtime',tenantProbes:[A,B]});
 assert.ok(repo);
 await assert.rejects(repo.snapshot(A,'owner'),/ROLE_MISMATCH|ROLE_BYPASSES_RLS/);
 assert.equal(leases,4);
 assert.equal(calls.filter(c=>c.lease===4 && c.sql?.includes('FROM pg_roles')).length,1);
 assert.equal(calls.filter(c=>c.lease===4 && c.sql?.includes('FROM musitu.')).length,0);
 assert.match(calls.find(c=>c.lease===4&&c.release!==undefined)?.release,/ROLE_/);
});
