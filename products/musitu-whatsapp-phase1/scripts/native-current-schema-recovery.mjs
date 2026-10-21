/** Synthetic-only recovery extension for the guarded disposable native runner.
 * Never exports a hosted database. This is not offsite/custodian qualification.
 */
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {sealPostgresBackup,openPostgresBackup} from '../src/postgres/encrypted-backup.mjs';
import {decryptLedger} from '../src/security/ledger-encryption.mjs';

const digest=value=>createHash('sha256').update(value).digest('hex');
const catalogQueries=[
 "SELECT n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner) AS owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('musitu','musitu_identity') AND c.relkind='r' ORDER BY 1,2",
 "SELECT table_schema,table_name,column_name,ordinal_position,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema IN ('musitu','musitu_identity') ORDER BY 1,2,4",
 "SELECT n.nspname,c.relname,k.conname,pg_get_constraintdef(k.oid) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('musitu','musitu_identity') ORDER BY 1,2,3",
 "SELECT schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname IN ('musitu','musitu_identity') ORDER BY 1,2,3",
 "SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,pg_get_userbyid(p.proowner) AS owner,p.proacl,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('musitu','musitu_identity') ORDER BY 1,2,3",
 "SELECT table_schema,table_name,grantee,privilege_type,is_grantable FROM information_schema.table_privileges WHERE table_schema IN ('musitu','musitu_identity') ORDER BY 1,2,3,4",
 "SELECT table_schema,table_name,column_name,grantee,privilege_type,is_grantable FROM information_schema.column_privileges WHERE table_schema IN ('musitu','musitu_identity') ORDER BY 1,2,3,4,5"
];
async function catalog(client){const rows=[];for(const sql of catalogQueries)rows.push((await client.query(sql)).rows);return digest(JSON.stringify(rows));}
export async function qualifyCurrentSchemaRecovery({admin,seed,Client,connection,migrationPassword,runtimePassword,dbRoot,files,contentKey}){
 const name='musitu_phase1_recovery_ci';let created=false,restore,migration,runtime;
 const directory=mkdtempSync(join(tmpdir(),'musitu-synthetic-recovery-'));
 try{
  assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[name])).rowCount,0,'BLOCKED_EXISTING_RECOVERY_DATABASE');
  // Add a retained uncertainty and suppression to the already synthetic source.
  await seed.query("UPDATE musitu.outbound_attempts SET status='UNKNOWN' WHERE attempt_id=(SELECT attempt_id FROM musitu.outbound_attempts ORDER BY attempt_id LIMIT 1)");
  await seed.query("INSERT INTO musitu.customer_suppressions(tenant_id,conversation_id,phone_number_id,remote_wa_id,source_provider_message_id) SELECT tenant_id,conversation_id,phone_number_id,remote_wa_id,'wamid.SYNTHETIC_STOP' FROM musitu.conversations ORDER BY conversation_id LIMIT 1");
  const tableNames=(await seed.query("SELECT n.nspname||'.'||c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('musitu','musitu_identity') AND c.relkind='r' ORDER BY 1")).rows.map(r=>r.name);
  assert.equal(tableNames.length,22);assert.ok(tableNames.every(n=>/^(musitu\.[a-z_]+|musitu_identity\.sessions)$/.test(n)));
  const dependencies=(await seed.query("SELECT conrelid::regclass::text AS child,confrelid::regclass::text AS parent FROM pg_constraint WHERE contype='f' AND connamespace='musitu'::regnamespace ORDER BY 1,2")).rows;
  const order=[];
  while(order.length<tableNames.length){const next=tableNames.find(n=>!order.includes(n)&&dependencies.filter(d=>d.child===n&&d.parent!==n).every(d=>order.includes(d.parent)));assert.ok(next,'RESTORE_DEPENDENCY_CYCLE');order.push(next);}
  await seed.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const data={};for(const table of tableNames)data[table]=(await seed.query(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS rows FROM ${table} t`)).rows[0].rows;
  const sourceCatalog=await catalog(seed);await seed.query('COMMIT');
  const expected=Object.fromEntries(tableNames.map(n=>[n,{count:data[n].length,sha256:digest(JSON.stringify(data[n]))}]));
  const migrations=files.map(file=>{const sql=readFileSync(join(dbRoot,file),'utf8');return{name:file,sql,sha256:digest(sql)};});
  const backupKey=randomBytes(32),archive=join(directory,'synthetic.musitubak');
  writeFileSync(archive,sealPostgresBackup({backupKey,data:{version:2,schemaVersion:15,qualificationOnly:true,source:{project:'jolly-scene-02112141',branch:'br-jolly-fire-b4klddds',database:'musitu_whatsapp_phase1'},migrations,data,applicationKeys:{contentEncryptionKey:contentKey.toString('base64'),sessionEncryptionKey:randomBytes(32).toString('base64')}}}),{mode:0o600});
  const recovered=openPostgresBackup({encrypted:readFileSync(archive),backupKey});
  for(const [i,m] of recovered.migrations.entries()){assert.equal(m.name,files[i]);assert.equal(m.sql,readFileSync(join(dbRoot,files[i]),'utf8'));}
  await admin.query(`CREATE DATABASE ${name} OWNER musitu_migrator`);created=true;
  await admin.query(`REVOKE ALL ON DATABASE ${name} FROM PUBLIC`);await admin.query(`GRANT CONNECT ON DATABASE ${name} TO musitu_runtime`);
  restore=new Client({connectionString:connection(name)});await restore.connect();
  assert.equal((await restore.query("SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('musitu','musitu_identity')")).rows[0].n,0);
  migration=new Client({connectionString:connection(name,'musitu_migrator',migrationPassword)});await migration.connect();
  for(const m of recovered.migrations)await migration.query(m.sql);await migration.end();migration=null;
  await restore.query('BEGIN');
  for(const table of order)if(recovered.data[table].length)await restore.query(`INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(NULL::${table},$1::jsonb)`,[JSON.stringify(recovered.data[table])]);
  await restore.query('COMMIT');
  for(const table of tableNames){const rows=(await restore.query(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS rows FROM ${table} t`)).rows[0].rows;assert.deepEqual({count:rows.length,sha256:digest(JSON.stringify(rows))},expected[table]);}
  assert.equal(await catalog(restore),sourceCatalog,'RESTORED_SCHEMA_PRIVILEGES_MUST_MATCH');
  runtime=new Client({connectionString:connection(name,'musitu_runtime',runtimePassword)});await runtime.connect();
  const role=(await runtime.query('SELECT current_user AS name,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];assert.deepEqual(role,{name:'musitu_runtime',rolsuper:false,rolbypassrls:false});
  for(const table of tableNames)assert.equal((await runtime.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n,0,'UNSCOPED_RESTORE_READ_DENIED:'+table);
  const tenant=recovered.data['musitu.tenants'][0].id;
  await runtime.query('BEGIN');await runtime.query("SELECT set_config('app.tenant_id',$1,true)",[tenant]);
  assert.equal((await runtime.query("SELECT count(*)::int AS n FROM musitu.outbound_attempts WHERE status='UNKNOWN'")).rows[0].n,1);
  assert.equal((await runtime.query('SELECT count(*)::int AS n FROM musitu.customer_suppressions')).rows[0].n,1);
  await runtime.query("SELECT set_config('app.tenant_id','00000000-0000-4000-8000-000000000001',true)");
  for(const table of tableNames.filter(n=>n.startsWith('musitu.')))assert.equal((await runtime.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n,0,'FOREIGN_RESTORE_READ_DENIED:'+table);
  await runtime.query('ROLLBACK');
  let decrypted=0;for(const row of recovered.data['musitu.messages']){assert.equal(decryptLedger(row.encrypted_body,Buffer.from(recovered.applicationKeys.contentEncryptionKey,'base64'),[row.tenant_id,row.phone_number_id,row.provider_message_id]),'Synthetic inbound');decrypted++;}
  return{scope:'NATIVE_SYNTHETIC_CURRENT_SCHEMA_ENCRYPTED_RESTORE_NOT_HOSTED_BACKUP',status:'PASS',migrations:15,tables:22,rowFingerprintsMatched:22,schemaSecurityFingerprintMatched:true,unscopedAndForeignTenantReadsDenied:true,unknownAttemptsRetained:1,suppressionsRetained:1,encryptedMessagesRecovered:decrypted,offsiteRetrievalQualified:false,secondCustodianQualified:false};
 }finally{
  await runtime?.end();await migration?.end();await restore?.end();
  if(created)await admin.query(`DROP DATABASE ${name}`);
  rmSync(directory,{recursive:true,force:true});
 }
}
