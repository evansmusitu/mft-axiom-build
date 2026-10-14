/** Qualification for v1.8 business ledgers and opaque identity sessions. */
export async function qualifyPostgresExtensionPrivileges({pool}={}){
 const c=await pool.connect();
 try{
  const schema=(await c.query(`SELECT has_schema_privilege(current_user,'musitu_identity','CREATE') AS identity_create,
   has_database_privilege(current_user,current_database(),'TEMP') AS temp_create`)).rows[0];
  if(schema?.identity_create!==false||schema.temp_create!==false)throw Error('EXTENSION_PRIVILEGES_UNQUALIFIED');
  for(const table of ['action_audit','business_configuration','contacts','messages']){
   const name='musitu.'+table;const r=(await c.query(`SELECT has_table_privilege(current_user,$1,'SELECT') AS readable,
    has_any_column_privilege(current_user,$1,'INSERT') AS insertable,
    has_any_column_privilege(current_user,$1,'UPDATE') AS updateable,
    has_table_privilege(current_user,$1,'DELETE') AS deletable,
    has_table_privilege(current_user,$1,'TRUNCATE') AS truncatable`,[name])).rows[0];
   if(r?.readable!==true||r.insertable!==false||r.updateable!==false||r.deletable!==false||r.truncatable!==false)throw Error('EXTENSION_PRIVILEGES_UNQUALIFIED');
  }
  const r=(await c.query(`SELECT has_table_privilege(current_user,'musitu_identity.sessions','SELECT') AS readable,
   has_table_privilege(current_user,'musitu_identity.sessions','INSERT') AS insertable,
   has_column_privilege(current_user,'musitu_identity.sessions','revoked','UPDATE') AS revokeable,
   has_column_privilege(current_user,'musitu_identity.sessions','token_hash','UPDATE') AS hash_update,
   has_column_privilege(current_user,'musitu_identity.sessions','encrypted_payload','UPDATE') AS payload_update,
   has_column_privilege(current_user,'musitu_identity.sessions','expires_at','UPDATE') AS expiry_update,
   has_table_privilege(current_user,'musitu_identity.sessions','DELETE') AS deletable`)).rows[0];
  if(r?.readable!==true||r.insertable!==true||r.revokeable!==true||r.hash_update!==false||r.payload_update!==false||r.expiry_update!==false||r.deletable!==false)throw Error('SESSION_PRIVILEGES_UNQUALIFIED');
  const tables=(await c.query(`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='musitu_identity.sessions'::regclass`)).rows;
  const policies=(await c.query("SELECT policyname,qual,with_check FROM pg_policies WHERE schemaname='musitu_identity' AND tablename='sessions'")).rows;
  const norm=s=>s?.replace(/::text\b/g,'').replace(/[()\s]/g,'').toLowerCase();const expected="token_hash=nullifcurrent_setting'app.session_hash',true,''";
  if(tables.length!==1||tables[0].relrowsecurity!==true||tables[0].relforcerowsecurity!==true||policies.length!==1||policies[0].policyname!=='session_boundary'||norm(policies[0].qual)!==expected||norm(policies[0].with_check)!==expected)throw Error('SESSION_POLICY_UNQUALIFIED');
  return {qualified:true,extensionReadOnlyTables:4,opaqueSessionRls:true,temporaryDatabaseObjectsDenied:true};
 }finally{c.release();}
}
