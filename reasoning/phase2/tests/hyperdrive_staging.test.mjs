import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectStagingHyperdrive } from '../cloudflare-staging/src/probe.mjs';

function fakeClient(row, options={}) {
  const traces=[];
  return {traces, create(opts){
    traces.push(['construct', opts]);
    return { async connect(){traces.push(['connect']);if(options.connectFailure)throw Error('SECRET=do-not-leak')},
      async query(sql){traces.push(['query', sql]);if(options.queryFailure)throw Error('PASSWORD=do-not-leak');return {rows:[row]};},
      async end(){traces.push(['end'])}
    };
  }};
}
const env={HYPERDRIVE:{connectionString:'postgresql://worker@hyperdrive.invalid/axiom_phase2_stage'},EXPECTED_DATABASE:'axiom_phase2_stage',EXPECTED_ROLE:'axiom_stage_runtime'};
const completeRow={database_name:'axiom_phase2_stage',role_name:'axiom_stage_runtime',budget_table:true,organization_table:true,requests_table:true,privileged_role:false,neon_superuser_member:false,can_create_database_objects:false,can_create_schema_objects:false,privileged_role_membership:false,billing_table_owner_member:false,direct_billing_dml_authority:false,direct_billing_select_authority:false,protected_rpc_present:true,protected_rpc_definers_safe:true,protected_rpc_grants_safe:true,protected_rpc_schema_safe:true};

test('requires Hyperdrive binding, not an arbitrary public database URL', async()=>{
  await assert.rejects(()=>inspectStagingHyperdrive({...env,HYPERDRIVE:undefined,DATABASE_URL:'postgres://unsafe'},fakeClient(completeRow).create),/STAGING_HYPERDRIVE_MISSING/);
});
test('refuses a wrong database or unexpected privileged role',async()=>{
  await assert.rejects(()=>inspectStagingHyperdrive(env,fakeClient({...completeRow,database_name:'neondb'}).create),/STAGING_IDENTITY_MISMATCH/);
  await assert.rejects(()=>inspectStagingHyperdrive(env,fakeClient({...completeRow,role_name:'neondb_owner'}).create),/STAGING_IDENTITY_MISMATCH/);
});
test('refuses missing central billing tables',async()=>{
  await assert.rejects(()=>inspectStagingHyperdrive(env,fakeClient({...completeRow,organization_table:null}).create),/STAGING_SCHEMA_MISSING/);
});
test('queries only read-only identity/schema metadata with bounded connection settings',async()=>{
  const client=fakeClient(completeRow);
  const result=await inspectStagingHyperdrive(env,client.create);
  assert.deepEqual(result,{connected:true,identityVerified:true,billingSchemaPresent:true,productionBillingEnforced:false});
  assert.equal(client.traces.filter(x=>x[0]==='query').length,1);
  const query=client.traces.find(x=>x[0]==='query')[1];
  assert.match(query,/SELECT\s+current_database\(\)/);
  assert.match(query,/^SELECT\b/i);
  assert.doesNotMatch(query,/;/);
  assert.doesNotMatch(query,/\b(?:UPDATE|DELETE|INSERT|DROP)\s+(?:INTO|FROM|TABLE|[a-z_]+)\b/i);
  assert.match(query,/AS privileged_role_membership/);
  assert.match(query,/AS billing_table_owner_member/);
  assert.match(query,/pg_catalog\.pg_has_role\(c\.relowner,'MEMBER'\)/);
  assert.ok(client.traces.find(x=>x[0]==='construct')[1].connectionTimeoutMillis<=5000);
  assert.deepEqual(client.traces.at(-1),['end']);
});
test('errors redact secrets and release client',async()=>{
  const client=fakeClient(completeRow,{queryFailure:true});
  await assert.rejects(()=>inspectStagingHyperdrive(env,client.create),e=>{
    assert.equal(e.message,'STAGING_DATABASE_UNAVAILABLE');
    assert.doesNotMatch(e.message,/PASSWORD|secret/);return true;
  });
  assert.deepEqual(client.traces.at(-1),['end']);
});

// Worker event surface is intentionally closed to public HTTP; scheduled probe is opt-in.
const {createStagingProbeWorker}=await import('../cloudflare-staging/src/worker_core.mjs');
test('staging Worker never exposes HTTP diagnostics or invokes database from fetch',async()=>{
  let calls=0;
  const worker=createStagingProbeWorker(()=>{calls++;throw Error('should not query')},{info(){},error(){}});
  const response=await worker.fetch(new Request('https://example.test/anything'),env,{});
  assert.equal(response.status,404);
  assert.equal(calls,0);
});
test('scheduled probe fails closed unless explicitly enabled',async()=>{
  let calls=0;
  const worker=createStagingProbeWorker(()=>{calls++;throw Error('unexpected')},{info(){},error(){}});
  await worker.scheduled({},env,{});
  assert.equal(calls,0);
});
test('enabled scheduled diagnostic emits status without credentials',async()=>{
  const messages=[];const logger={info(s){messages.push(s)},error(s){messages.push(s)}};
  const client=fakeClient(completeRow);
  const worker=createStagingProbeWorker(client.create,logger);
  await worker.scheduled({}, {...env,STAGING_DATABASE_PROBE_ENABLED:'true'},{});
  assert.deepEqual(messages,['AXIOM_STAGING_SCHEMA_PRESENT_NOT_PRODUCTION_READY']);
  assert.doesNotMatch(messages.join(''),/secret|postgresql|worker:/i);
});
test('enabled scheduled diagnostic reports generic failure only',async()=>{
  const messages=[];const logger={info(s){messages.push(s)},error(s){messages.push(s)}};
  const worker=createStagingProbeWorker(fakeClient(completeRow,{queryFailure:true}).create,logger);
  await worker.scheduled({}, {...env,STAGING_DATABASE_PROBE_ENABLED:'true'},{});
  assert.deepEqual(messages,['AXIOM_STAGING_SCHEMA_BLOCKED']);
});

test('rejects a privileged SQL runtime even when its name matches the expected application role',async()=>{
  for(const field of ['privileged_role','neon_superuser_member','can_create_database_objects','can_create_schema_objects']){
    await assert.rejects(
      ()=>inspectStagingHyperdrive(env,fakeClient({...completeRow,[field]:true}).create),
      /STAGING_PRIVILEGED_ROLE_DENIED/,
      field
    );
  }
});
test('fails closed if the SQL privilege audit is absent or incomplete',async()=>{
  const incomplete={...completeRow};delete incomplete.neon_superuser_member;
  await assert.rejects(
    ()=>inspectStagingHyperdrive(env,fakeClient(incomplete).create),
    /STAGING_PRIVILEGED_ROLE_DENIED/
  );
});

// A role can have innocuous own flags but still assume a privileged or billing-owner role.
test('rejects inherited/assumable elevated PostgreSQL roles',async()=>{
  await assert.rejects(
    ()=>inspectStagingHyperdrive(env,fakeClient({...completeRow,privileged_role_membership:true}).create),
    /STAGING_PRIVILEGED_ROLE_DENIED/
  );
});
test('rejects runtime membership of any billing table owner',async()=>{
  await assert.rejects(
    ()=>inspectStagingHyperdrive(env,fakeClient({...completeRow,billing_table_owner_member:true}).create),
    /STAGING_PRIVILEGED_ROLE_DENIED/
  );
});
test('fails closed when expanded role and owner audit is absent',async()=>{
  for(const field of ['privileged_role_membership','billing_table_owner_member']){
    const partial={...completeRow};delete partial[field];
    await assert.rejects(
      ()=>inspectStagingHyperdrive(env,fakeClient(partial).create),
      /STAGING_PRIVILEGED_ROLE_DENIED/,field
    );
  }
});

test('rejects direct DML privilege grants on protected provider-spend tables',async()=>{
  await assert.rejects(
    ()=>inspectStagingHyperdrive(env,fakeClient({...completeRow,direct_billing_dml_authority:true}).create),
    /STAGING_PRIVILEGED_ROLE_DENIED/
  );
});
test('rejects absent DML privilege-audit evidence',async()=>{
  const row={...completeRow};delete row.direct_billing_dml_authority;
  await assert.rejects(
    ()=>inspectStagingHyperdrive(env,fakeClient(row).create),
    /STAGING_PRIVILEGED_ROLE_DENIED/
  );
});
test('readiness SQL checks direct table and column DML grants across all three protected ledgers',async()=>{
  const client=fakeClient(completeRow);
  await inspectStagingHyperdrive(env,client.create);
  const sql=client.traces.find(x=>x[0]==='query')[1];
  assert.match(sql,/AS direct_billing_dml_authority/);
  assert.match(sql,/has_table_privilege/);
  assert.match(sql,/has_any_column_privilege/);
  for(const table of ['axiom_provider_spend_budgets','axiom_provider_spend_organizations','axiom_provider_spend_requests'])
    assert.ok(sql.includes(table),table);
});

test('rejects direct read grants to protected provider-spend tables',async()=>{
  await assert.rejects(
    ()=>inspectStagingHyperdrive(env,fakeClient({...completeRow,direct_billing_select_authority:true}).create),
    /STAGING_PRIVILEGED_ROLE_DENIED/
  );
});
test('rejects missing read-privilege audit evidence',async()=>{
  const row={...completeRow};delete row.direct_billing_select_authority;
  await assert.rejects(
    ()=>inspectStagingHyperdrive(env,fakeClient(row).create),
    /STAGING_PRIVILEGED_ROLE_DENIED/
  );
});
test('readiness query audits table and column SELECT rights against all protected ledgers',async()=>{
  const client=fakeClient(completeRow);
  await inspectStagingHyperdrive(env,client.create);
  const sql=client.traces.find(x=>x[0]==='query')[1];
  assert.match(sql,/AS direct_billing_select_authority/);
  assert.match(sql,/has_table_privilege\(current_user,billing.table_oid,'SELECT'\)/);
  assert.match(sql,/has_any_column_privilege\(current_user,billing.table_oid,'SELECT'\)/);
  for(const table of ['axiom_provider_spend_budgets','axiom_provider_spend_organizations','axiom_provider_spend_requests'])
    assert.ok(sql.includes(table),table);
});

test('refuses absent protected spending function signatures',async()=>{
  for(const value of [false,null]){
    await assert.rejects(
      ()=>inspectStagingHyperdrive(env,fakeClient({...completeRow,protected_rpc_present:value}).create),
      /STAGING_PROTECTED_RPC_INVALID/
    );
  }
});
test('refuses untrusted definer role or unsafe function search path',async()=>{
  for(const value of [false,null]){
    await assert.rejects(
      ()=>inspectStagingHyperdrive(env,fakeClient({...completeRow,protected_rpc_definers_safe:value}).create),
      /STAGING_PROTECTED_RPC_INVALID/
    );
  }
});
test('refuses PUBLIC EXECUTE or missing direct restricted-role function access',async()=>{
  for(const value of [false,null]){
    await assert.rejects(
      ()=>inspectStagingHyperdrive(env,fakeClient({...completeRow,protected_rpc_grants_safe:value}).create),
      /STAGING_PROTECTED_RPC_INVALID/
    );
  }
});
test('refuses absent protected-schema USAGE or runtime CREATE access',async()=>{
  for(const value of [false,null]){
    await assert.rejects(
      ()=>inspectStagingHyperdrive(env,fakeClient({...completeRow,protected_rpc_schema_safe:value}).create),
      /STAGING_PROTECTED_RPC_INVALID/
    );
  }
});
test('readiness SQL attests exact signatures, definer, role, search path and PUBLIC ACL',async()=>{
  const client=fakeClient(completeRow);
  await inspectStagingHyperdrive(env,client.create);
  const sql=client.traces.find(x=>x[0]==='query')[1];
  for(const field of ['protected_rpc_present','protected_rpc_definers_safe','protected_rpc_grants_safe','protected_rpc_schema_safe'])
    assert.ok(sql.includes('AS '+field),field);
  assert.match(sql,/to_regprocedure\('axiom_spend\.reserve\(text,text,text,text,text,bigint,text\)'\)/);
  assert.match(sql,/to_regprocedure\('axiom_spend\.settle\(text,text,text,text,text,bigint,text,text\)'\)/);
  assert.match(sql,/p\.prosecdef/);
  assert.match(sql,/NOT\s+o\.rolcanlogin/);
  assert.match(sql,/pg_has_role\(o\.oid,'MEMBER'\)/);
  assert.match(sql,/search_path=pg_catalog,pg_temp/);
  assert.match(sql,/aclexplode\(/);
  assert.match(sql,/acl\.grantee\s+NOT\s+IN/);
  assert.match(sql,/p\.proowner/);
  assert.match(sql,/rolname=current_user/);
  assert.match(sql,/has_function_privilege\(current_user,p\.oid,'EXECUTE'\)/);
  assert.match(sql,/has_schema_privilege\(current_user,'axiom_spend','CREATE'\)/);
});


test('G1 strict origin TLS probe refuses missing, plaintext or obsolete live PostgreSQL session evidence',async()=>{
  const strict={...env,G1_REQUIRE_ORIGIN_TLS:'true'};
  for(const row of [
    {...completeRow},
    {...completeRow,origin_tls_active:false,origin_tls_version:null},
    {...completeRow,origin_tls_active:true,origin_tls_version:'TLSv1.0'},
    {...completeRow,origin_tls_active:true,origin_tls_version:'TLSv1.1'},
    {...completeRow,origin_tls_active:true,origin_tls_version:null}
  ]){
    await assert.rejects(
      ()=>inspectStagingHyperdrive(strict,fakeClient(row).create),
      /STAGING_ORIGIN_TLS_UNVERIFIED/,
      'production G1 cannot accept a DB role/catalog check without observed secure origin TLS'
    );
  }
  const accepted=await inspectStagingHyperdrive(strict,
    fakeClient({...completeRow,origin_tls_active:true,origin_tls_version:'TLSv1.3'}).create);
  assert.equal(accepted.productionBillingEnforced,false,
    'even TLS 1.3 plus catalog proof is NOT central spend or origin hostname certification');
});

test('G1 strict probe reads pg_stat_ssl for the exact current PostgreSQL backend',async()=>{
  const client=fakeClient({...completeRow,origin_tls_active:true,origin_tls_version:'TLSv1.3'});
  await inspectStagingHyperdrive({...env,G1_REQUIRE_ORIGIN_TLS:'true'},client.create);
  const sql=client.traces.find(([kind])=>kind==='query')?.[1];
  assert.match(sql,/pg_catalog\.pg_stat_ssl/);
  assert.match(sql,/pg_catalog\.pg_backend_pid\(\)/);
  assert.match(sql,/AS origin_tls_active/);
  assert.match(sql,/AS origin_tls_version/);
  assert.doesNotMatch(sql,/;/);
});
