/**
 * Native Postgres production preflight contract. Fail closed on BYPASSRLS,
 * superuser privileges, unexpected connected role or incomplete FORCE RLS.
 * The app is NOT authorized for public release merely because this passes.
 */
import {PostgresTenantRepository} from './tenant-repository.mjs';

const REQUIRED_TABLES=Object.freeze([
 'tenants','memberships','whatsapp_channels','conversations','inbound_events',
 'message_status_events','resources','bookings','outbound_attempts','faqs',
 'reply_drafts','draft_approvals','channel_consent_evidence','outbound_preparations',
 'customer_suppressions'
]);
const ROLE=/^[a-z][a-z0-9_]{2,62}$/;
const EXTENSION_TABLES=Object.freeze(['action_audit']);
// PostgreSQL may add casts to text or parentheses in pg_policies output.
// Anything other than the exact, audited tenant-scope expression fails closed.
// A successful metadata check is NOT a substitute for independent behavioral
// tests with the real non-BYPASSRLS runtime role and two tenant principals.
function normalizedPolicyExpression(value){
 if(typeof value!=='string')return null;
 return value.toLowerCase().replace(/::text\b/g,'').replace(/[()\s]/g,'');
}
function exactTenantPolicy(row){
 if(!row||![...REQUIRED_TABLES,...EXTENSION_TABLES].includes(row.tablename)||row.policyname!=='tenant_boundary'||
    row.permissive!=='PERMISSIVE'||row.cmd!=='ALL'||
    (!(Array.isArray(row.roles)&&row.roles.length===1&&row.roles[0]==='public')&&row.roles!=='{public}'))return false;
 const column=row.tablename==='tenants'?'id':'tenant_id';
 const expected=`${column}=nullifcurrent_setting'app.tenant_id',true,''::uuid`;
 return normalizedPolicyExpression(row.qual)===expected&&
        normalizedPolicyExpression(row.with_check)===expected;
}
/**
 * A previously qualified pool can return a different server role on a later
 * connection. Recheck the effective role on EACH lease before any application
 * transaction or tenant-specific data access. Rejected leases are discarded.
 * This gate does not by itself certify native RLS or grants.
 */
export function createRuntimeRoleBoundPool({pool,expectedRole}={}) {
 if(typeof expectedRole!=='string'||!ROLE.test(expectedRole))throw Error('EXPECTED_RUNTIME_ROLE_REQUIRED');
 if(typeof pool?.connect!=='function')throw Error('PG_POOL_REQUIRED');
 return Object.freeze({
  async connect(){
   const client=await pool.connect();
   if(typeof client?.query!=='function'||typeof client?.release!=='function'){
    client?.release?.(new Error('INVALID_PG_CLIENT'));
    throw Error('INVALID_PG_CLIENT');
   }
   try{
    const result=await client.query(`SELECT current_user AS role_name,r.rolbypassrls,r.rolsuper
      FROM pg_roles r WHERE r.rolname=current_user`);
    const actual=result.rows?.[0];
    if(result.rows?.length!==1||actual.role_name!==expectedRole)throw Error('ROLE_MISMATCH');
    if(actual.rolbypassrls!==false||actual.rolsuper!==false)throw Error('ROLE_BYPASSES_RLS');
    return client;
   }catch(error){
    client.release(error); // never return a questionable lease to the pool
    throw error;
   }
  }
 });
}
export async function qualifyPostgresRuntime({pool,expectedRole}={}) {
 if(typeof expectedRole!=='string'||!ROLE.test(expectedRole))throw Error('EXPECTED_RUNTIME_ROLE_REQUIRED');
 if(typeof pool?.connect!=='function')throw Error('PG_POOL_REQUIRED');
 const client=await pool.connect();
 if(typeof client?.query!=='function'||typeof client?.release!=='function'){
  client?.release?.(new Error('INVALID_PG_CLIENT'));throw Error('INVALID_PG_CLIENT');
 }
 try{
  const roles=await client.query(`SELECT current_user AS role_name,r.rolbypassrls,r.rolsuper
   FROM pg_roles r WHERE r.rolname=current_user`);
  const role=roles.rows?.[0];
  if(roles.rows?.length!==1||role.role_name!==expectedRole)throw Error('ROLE_MISMATCH');
  if(role.rolsuper!==false||role.rolbypassrls!==false)throw Error('ROLE_BYPASSES_RLS');
  const rls=await client.query(`SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='musitu' AND c.relkind='r'`);
  const map=new Map((rls.rows||[]).map(r=>[r.relname,r]));
  if(map.size!==rls.rows?.length||REQUIRED_TABLES.some(t=>!map.has(t))||[...map.keys()].some(t=>![...REQUIRED_TABLES,...EXTENSION_TABLES].includes(t))||
     (rls.rows||[]).some(r=>r.relrowsecurity!==true||r.relforcerowsecurity!==true))
   throw Error('RLS_MATRIX_UNQUALIFIED');
  // ENABLE/FORCE RLS alone does not prove tenant isolation: a second
  // permissive policy such as USING (true) would union across tenants.
  const policies=await client.query(`SELECT tablename,policyname,permissive,roles,cmd,qual,with_check
   FROM pg_policies WHERE schemaname='musitu'`);
  const pRows=policies.rows||[];
  if(pRows.length!==map.size||
     new Set(pRows.map(p=>p.tablename)).size!==map.size||
     pRows.some(p=>!exactTenantPolicy(p)))throw Error('TENANT_POLICY_UNQUALIFIED');
  return {role:expectedRole,tablesChecked:rls.rows.length,policiesChecked:pRows.length,qualified:true};
 }finally{client.release();}
}
/**
 * Inspect *effective* grants, not just explicit ACL rows. A user can gain
 * privileges through PUBLIC or inherited roles even without a direct GRANT.
 * This is a capability ceiling for the private runtime role, not release proof.
 */
export async function qualifyPostgresRuntimePrivileges({pool}={}) {
 if(typeof pool?.connect!=='function')throw Error('PG_POOL_REQUIRED');
 const client=await pool.connect();
 if(typeof client?.query!=='function'||typeof client?.release!=='function'){
  client?.release?.(new Error('INVALID_PG_CLIENT'));throw Error('INVALID_PG_CLIENT');
 }
 try{
  const schema=await client.query(`SELECT
   has_schema_privilege(current_user,'musitu','USAGE') AS can_use_schema,
   has_schema_privilege(current_user,'musitu','CREATE') AS can_create_schema,
   has_database_privilege(current_user,current_database(),'CREATE') AS can_create_database`);
  const a=schema.rows?.[0];
  if(schema.rows?.length!==1||a.can_use_schema!==true||a.can_create_schema!==false||
     a.can_create_database!==false)throw Error('RUNTIME_PRIVILEGES_UNQUALIFIED');
  const result=await client.query(`SELECT t.tablename,
   has_table_privilege(current_user,format('musitu.%I',t.tablename),'SELECT') AS can_select,
   has_table_privilege(current_user,format('musitu.%I',t.tablename),'INSERT') AS can_insert,
   has_any_column_privilege(current_user,format('musitu.%I',t.tablename),'INSERT') AS can_insert_any_column,
   has_table_privilege(current_user,format('musitu.%I',t.tablename),'UPDATE') AS can_update,
   has_any_column_privilege(current_user,format('musitu.%I',t.tablename),'UPDATE') AS can_update_any_column,
   has_table_privilege(current_user,format('musitu.%I',t.tablename),'DELETE') AS can_delete,
   has_table_privilege(current_user,format('musitu.%I',t.tablename),'TRUNCATE') AS can_truncate,
   has_table_privilege(current_user,format('musitu.%I',t.tablename),'TRIGGER') AS can_trigger,
   has_table_privilege(current_user,format('musitu.%I',t.tablename),'REFERENCES') AS can_references,
   has_any_column_privilege(current_user,format('musitu.%I',t.tablename),'REFERENCES') AS can_references_any_column
   FROM unnest($1::text[]) AS t(tablename)`,[REQUIRED_TABLES]);
  const rows=result.rows||[];const writable=new Set(['bookings','draft_approvals','outbound_preparations','customer_suppressions']);
  if(rows.length!==REQUIRED_TABLES.length||new Set(rows.map(r=>r.tablename)).size!==REQUIRED_TABLES.length||
     rows.some(r=>!REQUIRED_TABLES.includes(r.tablename)||r.can_select!==true||
      r.can_insert!==writable.has(r.tablename)||r.can_insert_any_column!==writable.has(r.tablename)||
      r.can_update_any_column!==false||r.can_references_any_column!==false||r.can_update!==false||r.can_delete!==false||r.can_truncate!==false||
      r.can_trigger!==false||r.can_references!==false))throw Error('RUNTIME_PRIVILEGES_UNQUALIFIED');
  return {qualified:true,tablesChecked:rows.length,insertTablesChecked:writable.size,mode:'EFFECTIVE_PRIVILEGES'};
 }finally{client.release();}
}
/**
 * Destructive-free, two-fixture behavioral isolation gate.
 * Only for a private, disposable database pre-seeded with EXACTLY two known
 * test tenants. Never inspect genuine customer rows to qualify a release.
 * This is read-only and never grants production authority by itself.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function qualifyPostgresTenantReadIsolation({pool,expectedRole,tenantProbes}={}) {
 if(!Array.isArray(tenantProbes)||tenantProbes.length!==2||
    tenantProbes.some(id=>typeof id!=='string'||!UUID.test(id))||tenantProbes[0]===tenantProbes[1])
  throw Error('TWO_TENANT_FIXTURES_REQUIRED');
 if(typeof expectedRole!=='string'||!ROLE.test(expectedRole))throw Error('EXPECTED_RUNTIME_ROLE_REQUIRED');
 if(typeof pool?.connect!=='function')throw Error('PG_POOL_REQUIRED');
 const client=await pool.connect();
 if(typeof client?.query!=='function'||typeof client?.release!=='function'){
  client?.release?.(new Error('INVALID_PG_CLIENT'));throw Error('INVALID_PG_CLIENT');
 }
 let active=false;let discard=null;
 try{
  const role=await client.query(`SELECT current_user AS role_name,r.rolbypassrls,r.rolsuper
   FROM pg_roles r WHERE r.rolname=current_user`);
  const actual=role.rows?.[0];
  if(role.rows?.length!==1||actual.role_name!==expectedRole)throw Error('ROLE_MISMATCH');
  if(actual.rolbypassrls!==false||actual.rolsuper!==false)throw Error('ROLE_BYPASSES_RLS');
  for(const [scope,visible] of [['',[]],[tenantProbes[0],[tenantProbes[0]]],[tenantProbes[1],[tenantProbes[1]]]]){
   await client.query('BEGIN READ ONLY');active=true;
   await client.query("SELECT set_config('app.tenant_id', $1, true)",[scope]);
   // Deliberately query ALL tenants. A WHERE id = scopedTenant here would
   // hide a broken permissive policy and create a false-positive gate.
   const found=await client.query('SELECT id::text AS id FROM musitu.tenants ORDER BY id');
   if(!Array.isArray(found.rows)||found.rows.length!==visible.length||
      found.rows.some((row,i)=>row.id!==visible[i]))throw Error('TENANT_BEHAVIOR_UNQUALIFIED');
   await client.query('ROLLBACK');active=false;
  }
  return {qualified:true,role:expectedRole,tenantCount:2,scopesChecked:3,mode:'READ_ONLY_FIXTURE'};
 }catch(error){
  if(active){try{await client.query('ROLLBACK');}catch(rollbackError){discard=rollbackError;}}
  throw error;
 }finally{client.release(discard);}
}
export async function createQualifiedPostgresRepository({pool,expectedRole,tenantProbes}={}) {
 // Metadata-only admission is insufficient; require behavioral evidence from
 // a clean two-tenant sandbox before constructing the runtime repository.
 if(!Array.isArray(tenantProbes)||tenantProbes.length!==2)throw Error('TWO_TENANT_FIXTURES_REQUIRED');
 await qualifyPostgresRuntime({pool,expectedRole});
 await qualifyPostgresRuntimePrivileges({pool});
 await qualifyPostgresTenantReadIsolation({pool,expectedRole,tenantProbes});
 return new PostgresTenantRepository({pool:createRuntimeRoleBoundPool({pool,expectedRole})});
}
