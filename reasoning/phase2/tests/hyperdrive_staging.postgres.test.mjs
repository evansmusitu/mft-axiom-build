import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { inspectStagingHyperdrive } from '../cloudflare-staging/src/probe.mjs';

// Only the PostgreSQL 17 ephemeral GitHub service is used. No Neon, real
// Hyperdrive binding, paid provider, private keys or production credentials.
const {Pool,Client}=pg;
const DB='axiom_hyperdrive_catalog_ci';
const RUNTIME='axiom_hyperdrive_runtime_ci';
const DEFINER='axiom_hyperdrive_definer_ci';
const SHAPES=[
  "axiom_spend.reserve(text,text,text,text,text,bigint,text)",
  "axiom_spend.settle(text,text,text,text,text,bigint,text,text)"
];

test('PostgreSQL 17 read-only staging probe rejects real unauthorized role and SQL grants',async()=>{
  const host=process.env.PGHOST??'127.0.0.1',port=Number(process.env.PGPORT??5432);
  const user=process.env.PGUSER??'axiom',password=process.env.PGPASSWORD??'test-only-ephemeral-password';
  const mainDb=process.env.PGDATABASE??'axiom_test';
  const master=new Pool({host,port,database:mainDb,user,password,max:2,connectionTimeoutMillis:2000});
  let isolated,createdDb=false,createdRuntime=false,createdDefiner=false;
  try{
    await master.query('CREATE DATABASE '+DB);createdDb=true;
    await master.query("CREATE ROLE "+DEFINER+" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT");
    createdDefiner=true;
    await master.query("CREATE ROLE "+RUNTIME+" LOGIN PASSWORD 'ci-only-not-production' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT");
    createdRuntime=true;
    isolated=new Pool({host,port,database:DB,user,password,max:3});
    await isolated.query("CREATE TABLE public.axiom_provider_spend_budgets(id text)");
    await isolated.query("CREATE TABLE public.axiom_provider_spend_organizations(id text)");
    await isolated.query("CREATE TABLE public.axiom_provider_spend_requests(id text)");
    await isolated.query("CREATE SCHEMA axiom_spend");
    for(const shape of SHAPES){
      await isolated.query("CREATE FUNCTION "+shape+
        " RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$ SELECT 'OK'::text $$");
      await isolated.query("REVOKE ALL ON FUNCTION "+shape+" FROM PUBLIC");
    }
    await isolated.query("GRANT USAGE,CREATE ON SCHEMA axiom_spend TO "+DEFINER);
    for(const shape of SHAPES)
      await isolated.query("ALTER FUNCTION "+shape+" OWNER TO "+DEFINER);
    await isolated.query("REVOKE CREATE ON SCHEMA axiom_spend FROM "+DEFINER);
    await isolated.query("GRANT USAGE ON SCHEMA axiom_spend TO "+RUNTIME);
    for(const shape of SHAPES)
      await isolated.query("GRANT EXECUTE ON FUNCTION "+shape+" TO "+RUNTIME);

    // The Client deliberately receives the CI-only PG configuration rather
    // than dereferencing a real binding or using any Hyperdrive credentials.
    const env={
      HYPERDRIVE:{connectionString:'postgresql://placeholder@hyperdrive.invalid/'+DB},
      EXPECTED_DATABASE:DB,EXPECTED_ROLE:RUNTIME
    };
    const client=()=>new Client({host,port,database:DB,user:RUNTIME,
      password:'ci-only-not-production',connectionTimeoutMillis:2000});
    const expected={connected:true,identityVerified:true,billingSchemaPresent:true,
      productionBillingEnforced:false};
    assert.deepEqual(await inspectStagingHyperdrive(env,client),expected);

    await isolated.query("GRANT SELECT ON TABLE public.axiom_provider_spend_budgets TO "+RUNTIME);
    await assert.rejects(()=>inspectStagingHyperdrive(env,client),/STAGING_PRIVILEGED_ROLE_DENIED/);
    await isolated.query("REVOKE SELECT ON TABLE public.axiom_provider_spend_budgets FROM "+RUNTIME);
    assert.deepEqual(await inspectStagingHyperdrive(env,client),expected);

    await isolated.query("GRANT EXECUTE ON FUNCTION "+SHAPES[0]+" TO PUBLIC");
    await assert.rejects(()=>inspectStagingHyperdrive(env,client),/STAGING_PROTECTED_RPC_INVALID/);
    await isolated.query("REVOKE EXECUTE ON FUNCTION "+SHAPES[0]+" FROM PUBLIC");
    assert.deepEqual(await inspectStagingHyperdrive(env,client),expected);

    await isolated.query("REVOKE EXECUTE ON FUNCTION "+SHAPES[1]+" FROM "+RUNTIME);
    await assert.rejects(()=>inspectStagingHyperdrive(env,client),/STAGING_PROTECTED_RPC_INVALID/);
    await isolated.query("GRANT EXECUTE ON FUNCTION "+SHAPES[1]+" TO "+RUNTIME);
    assert.deepEqual(await inspectStagingHyperdrive(env,client),expected);

    await isolated.query("GRANT CREATE ON SCHEMA axiom_spend TO "+RUNTIME);
    await assert.rejects(()=>inspectStagingHyperdrive(env,client),/STAGING_PROTECTED_RPC_INVALID/);
    await isolated.query("REVOKE CREATE ON SCHEMA axiom_spend FROM "+RUNTIME);
    assert.deepEqual(await inspectStagingHyperdrive(env,client),expected);

    // A login owner may run these functions but is NOT an acceptable definer.
    await isolated.query("ALTER FUNCTION "+SHAPES[0]+" OWNER TO "+user);
    await assert.rejects(()=>inspectStagingHyperdrive(env,client),/STAGING_PROTECTED_RPC_INVALID/);
    await isolated.query("GRANT CREATE ON SCHEMA axiom_spend TO "+DEFINER);
    await isolated.query("ALTER FUNCTION "+SHAPES[0]+" OWNER TO "+DEFINER);
    await isolated.query("REVOKE CREATE ON SCHEMA axiom_spend FROM "+DEFINER);
    assert.deepEqual(await inspectStagingHyperdrive(env,client),expected);
  }finally{
    if(isolated)await isolated.end();
    if(createdDb)await master.query('DROP DATABASE '+DB+' WITH (FORCE)');
    if(createdRuntime)await master.query('DROP ROLE '+RUNTIME);
    if(createdDefiner)await master.query('DROP ROLE '+DEFINER);
    await master.end();
  }
});
