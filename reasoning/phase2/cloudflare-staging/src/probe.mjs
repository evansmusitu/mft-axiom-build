/** Staging-only read-only SQL proof. This does NOT authorize paid provider calls. */
const IDENTIFIER=/^[a-z_][a-z0-9_]{0,62}$/;
const READINESS_SQL=`SELECT current_database() AS database_name,
 current_user AS role_name,
 to_regclass('public.axiom_provider_spend_budgets') IS NOT NULL AS budget_table,
 to_regclass('public.axiom_provider_spend_organizations') IS NOT NULL AS organization_table,
 to_regclass('public.axiom_provider_spend_requests') IS NOT NULL AS requests_table,
 EXISTS (SELECT 1 FROM pg_catalog.pg_roles r
   WHERE r.rolname=current_user
   AND (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls)) AS privileged_role,
 EXISTS (SELECT 1 FROM pg_catalog.pg_roles r
   WHERE r.rolname='neon_superuser'
   AND pg_catalog.pg_has_role(r.oid,'member')) AS neon_superuser_member,
 EXISTS (SELECT 1 FROM pg_catalog.pg_roles r
   WHERE (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls)
   AND pg_catalog.pg_has_role(r.oid,'MEMBER')) AS privileged_role_membership,
 EXISTS (SELECT 1 FROM pg_catalog.pg_class c
   JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public'
   AND c.relname IN ('axiom_provider_spend_budgets','axiom_provider_spend_organizations','axiom_provider_spend_requests')
   AND pg_catalog.pg_has_role(c.relowner,'MEMBER')) AS billing_table_owner_member,
 EXISTS (SELECT 1 FROM (VALUES
   (to_regclass('public.axiom_provider_spend_budgets')),
   (to_regclass('public.axiom_provider_spend_organizations')),
   (to_regclass('public.axiom_provider_spend_requests'))
 ) AS billing(table_oid)
 WHERE billing.table_oid IS NULL
 OR pg_catalog.has_table_privilege(current_user,billing.table_oid,
    'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES,MAINTAIN')
 OR pg_catalog.has_any_column_privilege(current_user,billing.table_oid,
    'INSERT,UPDATE,REFERENCES')) AS direct_billing_dml_authority,
 EXISTS (SELECT 1 FROM (VALUES
   (to_regclass('public.axiom_provider_spend_budgets')),
   (to_regclass('public.axiom_provider_spend_organizations')),
   (to_regclass('public.axiom_provider_spend_requests'))
 ) AS billing(table_oid)
 WHERE billing.table_oid IS NULL
 OR pg_catalog.has_table_privilege(current_user,billing.table_oid,'SELECT')
 OR pg_catalog.has_any_column_privilege(current_user,billing.table_oid,'SELECT'))
   AS direct_billing_select_authority,
 (pg_catalog.to_regprocedure('axiom_spend.reserve(text,text,text,text,text,bigint,text)') IS NOT NULL
 AND pg_catalog.to_regprocedure('axiom_spend.settle(text,text,text,text,text,bigint,text,text)') IS NOT NULL) AS protected_rpc_present,
 (SELECT COUNT(*)=2 AND pg_catalog.bool_and(
    p.prosecdef AND NOT o.rolcanlogin
    AND NOT (o.rolsuper OR o.rolcreaterole OR o.rolcreatedb OR o.rolreplication OR o.rolbypassrls)
    AND NOT pg_catalog.pg_has_role(o.oid,'MEMBER')
    AND pg_catalog.regexp_replace(pg_catalog.array_to_string(p.proconfig,','),
      '[[:space:]]+','','g')='search_path=pg_catalog,pg_temp')
   FROM pg_catalog.pg_proc p
   JOIN pg_catalog.pg_roles o ON o.oid=p.proowner
   WHERE p.oid IN (
     pg_catalog.to_regprocedure('axiom_spend.reserve(text,text,text,text,text,bigint,text)'),
     pg_catalog.to_regprocedure('axiom_spend.settle(text,text,text,text,text,bigint,text,text)')
   )) AS protected_rpc_definers_safe,
 (SELECT COUNT(*)=2 AND pg_catalog.bool_and(
    pg_catalog.has_function_privilege(current_user,p.oid,'EXECUTE')
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.aclexplode(
        COALESCE(p.proacl,pg_catalog.acldefault('f'::"char",p.proowner))) AS acl
      WHERE acl.privilege_type='EXECUTE'
      AND acl.grantee NOT IN (
        p.proowner,
        (SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user))))
   FROM pg_catalog.pg_proc p
   WHERE p.oid IN (
     pg_catalog.to_regprocedure('axiom_spend.reserve(text,text,text,text,text,bigint,text)'),
     pg_catalog.to_regprocedure('axiom_spend.settle(text,text,text,text,text,bigint,text,text)')
   )) AS protected_rpc_grants_safe,
 CASE WHEN pg_catalog.to_regnamespace('axiom_spend') IS NULL THEN FALSE
   ELSE pg_catalog.has_schema_privilege(current_user,'axiom_spend','USAGE')
    AND NOT pg_catalog.has_schema_privilege(current_user,'axiom_spend','CREATE')
 END AS protected_rpc_schema_safe,
 has_database_privilege(current_user,current_database(),'CREATE') AS can_create_database_objects,
 has_schema_privilege(current_user,'public','CREATE') AS can_create_schema_objects`;

export async function inspectStagingHyperdrive(env, clientFactory){
  if(typeof env?.HYPERDRIVE?.connectionString !== 'string'||
     !/^postgres(?:ql)?:\/\//.test(env.HYPERDRIVE.connectionString))
    throw new Error('STAGING_HYPERDRIVE_MISSING');
  if(!IDENTIFIER.test(env.EXPECTED_DATABASE??'')||
     !IDENTIFIER.test(env.EXPECTED_ROLE??'')||
     env.EXPECTED_ROLE==='neondb_owner'||env.EXPECTED_ROLE==='postgres')
    throw new Error('STAGING_EXPECTED_IDENTITY_MISSING');
  let client;
  try {
    client=clientFactory({connectionString:env.HYPERDRIVE.connectionString,
      connectionTimeoutMillis:4000,query_timeout:4000,statement_timeout:4000});
    await client.connect();
    const result=await client.query(READINESS_SQL);
    const row=result?.rows?.length===1?result.rows[0]:null;
    if(!row||row.database_name!==env.EXPECTED_DATABASE||row.role_name!==env.EXPECTED_ROLE)
      throw new Error('STAGING_IDENTITY_MISMATCH');
    if(row.budget_table!==true||row.organization_table!==true||row.requests_table!==true)
      throw new Error('STAGING_SCHEMA_MISSING');
    // Missing privilege evidence or elevated runtime capabilities are both denial.
    if(row.privileged_role!==false||row.neon_superuser_member!==false||
       row.privileged_role_membership!==false||row.billing_table_owner_member!==false||
       row.direct_billing_dml_authority!==false||row.direct_billing_select_authority!==false||
       row.can_create_database_objects!==false||row.can_create_schema_objects!==false)
      throw new Error('STAGING_PRIVILEGED_ROLE_DENIED');
    if(row.protected_rpc_present!==true||row.protected_rpc_definers_safe!==true||
       row.protected_rpc_grants_safe!==true||row.protected_rpc_schema_safe!==true)
      throw new Error('STAGING_PROTECTED_RPC_INVALID');
    // Schema existence is not evidence of budgets, enforced call paths, or invoice reconciliation.
    return {connected:true,identityVerified:true,billingSchemaPresent:true,productionBillingEnforced:false};
  }catch(error){
    if(error instanceof Error && /^STAGING_(?:IDENTITY_MISMATCH|SCHEMA_MISSING|PRIVILEGED_ROLE_DENIED|PROTECTED_RPC_INVALID)$/.test(error.message))throw error;
    throw new Error('STAGING_DATABASE_UNAVAILABLE');
  }finally{
    if(client){try{await client.end();}catch{}}
  }
}
