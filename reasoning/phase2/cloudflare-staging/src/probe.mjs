/** Staging-only read-only SQL proof. This does NOT authorize paid provider calls. */
const IDENTIFIER=/^[a-z_][a-z0-9_]{0,62}$/;
const READINESS_SQL=`SELECT current_database() AS database_name,
 current_user AS role_name,
 to_regclass('public.axiom_provider_spend_budgets') IS NOT NULL AS budget_table,
 to_regclass('public.axiom_provider_spend_organizations') IS NOT NULL AS organization_table,
 to_regclass('public.axiom_provider_spend_requests') IS NOT NULL AS requests_table`;

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
    // Schema existence is not evidence of budgets, enforced call paths, or invoice reconciliation.
    return {connected:true,identityVerified:true,billingSchemaPresent:true,productionBillingEnforced:false};
  }catch(error){
    if(error instanceof Error && /^STAGING_(?:IDENTITY_MISMATCH|SCHEMA_MISSING)$/.test(error.message))throw error;
    throw new Error('STAGING_DATABASE_UNAVAILABLE');
  }finally{
    if(client){try{await client.end();}catch{}}
  }
}
