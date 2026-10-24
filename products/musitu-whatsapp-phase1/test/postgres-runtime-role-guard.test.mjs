import test from 'node:test';
import assert from 'node:assert/strict';
import {qualifyPostgresRuntime} from '../src/postgres/runtime-role-guard.mjs';
const tables=['tenants','memberships','whatsapp_channels','conversations','inbound_events','message_status_events','resources','bookings','outbound_attempts','faqs','reply_drafts','draft_approvals','channel_consent_evidence','outbound_preparations','customer_suppressions'];
const tenantExpr="tenant_id = NULLIF(current_setting('app.tenant_id', true),'')::uuid";
const ownerExpr="id = NULLIF(current_setting('app.tenant_id', true),'')::uuid";
function mock({role='musitu_runtime',bypass=false,superuser=false,missing=[],weak=[],badReturn=false,policies}={}){
 const observed=[];const state={released:0,error:null};
 const policyRows=policies??tables.map(tablename=>({tablename,policyname:'tenant_boundary',permissive:'PERMISSIVE',roles:['public'],cmd:'ALL',qual:tablename==='tenants'?ownerExpr:tenantExpr,with_check:tablename==='tenants'?ownerExpr:tenantExpr}));
 const client={async query(sql){observed.push(sql);if(badReturn)throw Error('DATABASE_OFFLINE');
  if(/pg_roles/.test(sql))return {rows:[{role_name:role,rolbypassrls:bypass,rolsuper:superuser}]};
  if(/pg_class/.test(sql))return {rows:tables.filter(t=>!missing.includes(t)).map(relname=>({relname,relrowsecurity:!weak.includes(relname),relforcerowsecurity:!weak.includes(relname)}))};
  if(/pg_policies/.test(sql))return {rows:policyRows};
  throw Error('UNEXPECTED_QUERY');
 },release(err){state.released++;state.error=err||null;}};
 return {pool:{async connect(){return client;}},state,observed,policyRows};
}

test('trusted non-bypass role and full RLS plus tenant policy matrix qualify in one leased client',async()=>{
 const {pool,state,observed}=mock(); const result=await qualifyPostgresRuntime({pool,expectedRole:'musitu_runtime'});
 assert.deepEqual(result,{role:'musitu_runtime',tablesChecked:15,policiesChecked:15,qualified:true});
 assert.equal(state.released,1);assert.equal(observed.length,3);
});

test('native PostgreSQL pg_policies expression formatting and text-array roles are accepted without weakening tenant scope',async()=>{
 const native="(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)";
 const nativeOwner="(id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)";
 const nativePolicies=mock().policyRows.map(p=>({...p,roles:'{public}',qual:p.tablename==='tenants'?nativeOwner:native,with_check:p.tablename==='tenants'?nativeOwner:native}));
 const {pool}=mock({policies:nativePolicies});
 assert.equal((await qualifyPostgresRuntime({pool,expectedRole:'musitu_runtime'})).qualified,true);
});

test('Neon owner BYPASSRLS detected despite FORCE ROW LEVEL SECURITY',async()=>{
 const {pool,state}=mock({role:'musitu_whatsapp_phase1_owner',bypass:true});
 await assert.rejects(qualifyPostgresRuntime({pool,expectedRole:'musitu_whatsapp_phase1_owner'}),/ROLE_BYPASSES_RLS/);
 assert.equal(state.released,1);
});

test('superusers, role mismatch, weak or incomplete RLS matrix fail closed',async()=>{
 for(const config of [{superuser:true},{role:'owner'},{missing:['bookings']},{weak:['conversations']}]){
  const {pool}=mock(config);
  await assert.rejects(qualifyPostgresRuntime({pool,expectedRole:'musitu_runtime'}),/ROLE_|RLS_/);
 }
});

test('missing, duplicated or broadened tenant policy rejects an otherwise secure RLS role',async()=>{
 const original=mock().policyRows;
 const insecure=[
  original.filter(p=>p.tablename!=='bookings'),
  [...original,{...original[2],policyname:'allow_other_tenants',qual:'true',with_check:'true'}],
  original.map(p=>p.tablename==='bookings'?{...p,qual:`(${tenantExpr}) OR true`}:p),
  original.map(p=>p.tablename==='bookings'?{...p,with_check:'true'}:p),
  original.map(p=>p.tablename==='bookings'?{...p,permissive:'RESTRICTIVE'}:p),
  original.map(p=>p.tablename==='bookings'?{...p,cmd:'SELECT'}:p),
 ];
 for(const policies of insecure){
  const {pool,state}=mock({policies});
  await assert.rejects(qualifyPostgresRuntime({pool,expectedRole:'musitu_runtime'}),/TENANT_POLICY_UNQUALIFIED/);
  assert.equal(state.released,1);
 }
});

test('qualification errors release leased client and never return success',async()=>{
 const {pool,state}=mock({badReturn:true});
 await assert.rejects(qualifyPostgresRuntime({pool,expectedRole:'musitu_runtime'}),/DATABASE_OFFLINE/);
 assert.equal(state.released,1);
 await assert.rejects(qualifyPostgresRuntime({pool,expectedRole:''}),/EXPECTED_RUNTIME_ROLE_REQUIRED/);
});
