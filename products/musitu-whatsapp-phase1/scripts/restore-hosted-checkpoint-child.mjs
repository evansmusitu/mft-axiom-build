/** Restore only to a script-created disposable literal-loopback database. */
import {readFileSync} from 'node:fs';
import {randomBytes,randomUUID} from 'node:crypto';
import {checkpointDigest,HOSTED_CHECKPOINT_TABLES} from '../src/postgres/hosted-checkpoint.mjs';
import {CHECKPOINT_CATALOG_QUERIES} from '../src/postgres/checkpoint-catalog.mjs';
import {decryptLedger} from '../src/security/ledger-encryption.mjs';
const raw=process.env.PG_ADMIN_URL||'';let url;try{url=new URL(raw);}catch{}
if(process.env.PG_HOSTED_RECOVERY_CHILD!=='YES'||!url||!['postgresql:','postgres:'].includes(url.protocol)||url.hostname!=='127.0.0.1'||url.pathname!=='/postgres'||!url.port||Number(url.port)<1024||url.hash||url.search){console.error('BLOCKED: disposable local restore only');process.exit(78);}
const {default:pg}=await import('pg');const {compactDecrypt}=await import('jose');
const {Client}=pg,db='musitu_phase1_offsite_20261023',owner='musitu_whatsapp_phase1_owner';
const roleNames=[owner,'musitu_runtime','musitu_ingress','musitu_commands'];
const payload=JSON.parse(readFileSync(new URL('../.private-restore-payload.json',import.meta.url),'utf8'));
const quote=x=>"'"+x.replaceAll("'","''")+"'";
const conn=(name,user,password)=>{const u=new URL(raw);u.pathname='/'+name;if(user)u.username=user;if(password)u.password=password;return u.href;};
const admin=new Client({connectionString:raw}),made=[];let created=false,migration,restore,runtime,report,failure;
const require=(ok,code)=>{if(!ok)throw Error(code);};
async function catalog(c){
 // The connector source used PostgreSQL JSON serialization. Use the same
 // projection here so name[] policy roles cannot become driver-specific text.
 const out=[];
 for(const sql of CHECKPOINT_CATALOG_QUERIES)out.push((await c.query('SELECT to_jsonb(catalog_row) AS record FROM ('+sql+') catalog_row')).rows.map(r=>r.record));
 return out;
}
const started=Date.now();
try{
 await admin.connect();
 require((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[db])).rowCount===0,'EXISTING_RESTORE_DATABASE_REJECTED');
 require((await admin.query('SELECT 1 FROM pg_roles WHERE rolname=ANY($1::text[])',[roleNames])).rowCount===0,'EXISTING_RESTORE_ROLES_REJECTED');
 require(payload.sourceRoles.length===4&&payload.sourceRoles.every(r=>roleNames.includes(r.rolname)&&r.rolsuper===false),'ROLE_PROFILE_REJECTED');
 const passwords=new Map(roleNames.map(n=>[n,randomBytes(32).toString('hex')]));
 for(const name of roleNames){
  const r=payload.sourceRoles.find(r=>r.rolname===name);require(!!r,'ROLE_PROFILE_MISSING');
  const flags=[r.rolinherit?'INHERIT':'NOINHERIT',r.rolcreatedb?'CREATEDB':'NOCREATEDB',r.rolcreaterole?'CREATEROLE':'NOCREATEROLE',r.rolreplication?'REPLICATION':'NOREPLICATION',r.rolbypassrls?'BYPASSRLS':'NOBYPASSRLS'];
  require(name===owner||(!r.rolcreatedb&&!r.rolcreaterole&&!r.rolbypassrls&&!r.rolreplication&&!r.rolinherit),'RUNTIME_PRIVILEGES_REJECTED');
  await admin.query('CREATE ROLE '+name+' NOSUPERUSER '+(r.rolcanlogin?'LOGIN PASSWORD '+quote(passwords.get(name)):'NOLOGIN')+' '+flags.join(' '));made.push(name);
 }
 await admin.query('GRANT musitu_commands TO '+owner);
 await admin.query('CREATE DATABASE '+db+' OWNER '+owner);created=true;
 await admin.query('REVOKE ALL ON DATABASE '+db+' FROM PUBLIC');
 await admin.query('GRANT CONNECT ON DATABASE '+db+' TO musitu_runtime,musitu_ingress');
 migration=new Client({connectionString:conn(db,owner,passwords.get(owner))});await migration.connect();
 require((await migration.query("SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('musitu','musitu_identity')")).rows[0].n===0,'RESTORE_TARGET_NOT_EMPTY');
 for(const m of payload.migrations)await migration.query(m.sql);
 await migration.end();migration=null;
 restore=new Client({connectionString:conn(db)});await restore.connect();
 const order=[];
 while(order.length<HOSTED_CHECKPOINT_TABLES.length){
  const next=HOSTED_CHECKPOINT_TABLES.find(n=>!order.includes(n)&&payload.sourceDependencies.filter(d=>d.child===n&&d.parent!==n).every(d=>order.includes(d.parent)));
  require(!!next,'RESTORE_DEPENDENCY_CYCLE');order.push(next);
 }
 await restore.query('BEGIN');
 for(const table of order)if(payload.data[table].length)await restore.query('INSERT INTO '+table+' SELECT * FROM jsonb_populate_recordset(NULL::'+table+',$1::jsonb)',[JSON.stringify(payload.data[table])]);
 await restore.query('COMMIT');
 let matched=0,total=0;
 for(const table of HOSTED_CHECKPOINT_TABLES){
  const rows=(await restore.query("SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS rows FROM "+table+" t")).rows[0].rows;
  require(checkpointDigest(rows)===checkpointDigest(payload.data[table]),'ROW_FINGERPRINT_MISMATCH:'+table);matched++;total+=rows.length;
 }
 const restoredCatalog=await catalog(restore);
 const catalogMatches=restoredCatalog.map((part,i)=>checkpointDigest(part)===checkpointDigest(payload.sourceCatalog[i]));
 require(catalogMatches.every(Boolean),'SCHEMA_SECURITY_FINGERPRINT_MISMATCH:'+catalogMatches.map((ok,i)=>ok?'':i).filter(x=>x!=='').join(','));
 const profiles=(await admin.query("SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=ANY($1::text[]) ORDER BY 1",[roleNames])).rows;
 require(checkpointDigest(profiles)===checkpointDigest(payload.sourceRoles),'RESTORED_ROLE_PROFILE_MISMATCH');
 runtime=new Client({connectionString:conn(db,'musitu_runtime',passwords.get('musitu_runtime'))});await runtime.connect();
 const identity=(await runtime.query("SELECT current_user AS name,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0];
 require(identity.name==='musitu_runtime'&&!identity.rolsuper&&!identity.rolbypassrls,'RESTORED_RUNTIME_IDENTITY_REJECTED');
 for(const table of HOSTED_CHECKPOINT_TABLES)require((await runtime.query('SELECT count(*)::int AS n FROM '+table)).rows[0].n===0,'UNSCOPED_READ_NOT_DENIED');
 let tenantChecks=0;
 for(const tenant of payload.data['musitu.tenants']){
  await runtime.query('BEGIN');await runtime.query("SELECT set_config('app.tenant_id',$1,true)",[tenant.id]);
  for(const table of HOSTED_CHECKPOINT_TABLES.filter(n=>n.startsWith('musitu.'))){
   const expected=payload.data[table].filter(r=>table==='musitu.tenants'?r.id===tenant.id:r.tenant_id===tenant.id).length;
   require((await runtime.query('SELECT count(*)::int AS n FROM '+table)).rows[0].n===expected,'TENANT_BOUNDARY_MISMATCH');tenantChecks++;
  }
  await runtime.query('ROLLBACK');
 }
 const foreign=randomUUID();await runtime.query('BEGIN');await runtime.query("SELECT set_config('app.tenant_id',$1,true)",[foreign]);
 for(const table of HOSTED_CHECKPOINT_TABLES.filter(n=>n.startsWith('musitu.')))require((await runtime.query('SELECT count(*)::int AS n FROM '+table)).rows[0].n===0,'FOREIGN_TENANT_READ_NOT_DENIED');
 await runtime.query('ROLLBACK');
 let escalationDenied=false;try{await runtime.query('SET ROLE musitu_commands');}catch(e){escalationDenied=e.code==='42501';}require(escalationDenied,'RUNTIME_ROLE_ESCALATION_NOT_DENIED');
 const target='986eb904-7296-46a9-9e9b-94074db9b547';
 const contentKey=Buffer.from(payload.applicationKeys.contentEncryptionKey,'base64'),sessionKey=Buffer.from(payload.applicationKeys.sessionEncryptionKey,'base64');
 let decryptedMessages=0,unreadableOtherFixtureMessages=0,targetMessages=0,targetRecovered=0;
 for(const row of payload.data['musitu.messages']){
  const targetRow=row.tenant_id===target;if(targetRow)targetMessages++;
  try{const text=decryptLedger(row.encrypted_body,contentKey,[row.tenant_id,row.phone_number_id,row.provider_message_id]);require(typeof text==='string','MESSAGE_DECRYPTION_TYPE');decryptedMessages++;if(targetRow)targetRecovered++;}
  catch{require(!targetRow,'TARGET_MESSAGE_CONTENT_NOT_RECOVERED');unreadableOtherFixtureMessages++;}
 }
 require(targetMessages>0&&targetRecovered===targetMessages,'TARGET_MESSAGE_RECOVERY_REQUIRED');
 let sessionEnvelopesOpened=0,sessionEnvelopeOpenFailures=0;
 for(const row of payload.data['musitu_identity.sessions']){
  require(row.revoked||Date.parse(row.expires_at)<Date.now(),'ACTIVE_AUTHENTICATION_SESSION_COPY_REJECTED');
  try{const out=await compactDecrypt(row.encrypted_payload,sessionKey,{keyManagementAlgorithms:['dir'],contentEncryptionAlgorithms:['A256GCM']});out.plaintext.fill(0);sessionEnvelopesOpened++;}catch{sessionEnvelopeOpenFailures++;}
 }
 contentKey.fill(0);sessionKey.fill(0);
 report={kind:'MUSITU_OFFSITE_RECOVERY_RESULT',status:'PASS',scope:'FRESH_HOSTED_STATE_OFFSITE_RETRIEVAL_DISPOSABLE_NATIVE_RESTORE',sourceCapturedAt:payload.capturedAt,sourcePostgresVersion:payload.sourcePostgresVersion,restorePostgresVersion:(await restore.query('SHOW server_version')).rows[0].server_version,migrations:payload.migrations.length,tables:matched,rows:total,rowFingerprintsMatched:matched,catalogClassesMatched:catalogMatches.length,roleProfilesMatched:4,unscopedRelationsDenied:22,tenantScopedChecks:tenantChecks,foreignTenantRelationsDenied:21,runtimeRoleEscalationDenied:escalationDenied,unknownAiRequestsRetained:payload.data['musitu.ai_requests'].filter(r=>r.state==='UNKNOWN').length,unknownOutboundAttemptsRetained:payload.data['musitu.outbound_attempts'].filter(r=>r.status==='UNKNOWN').length,suppressionsRetained:payload.data['musitu.customer_suppressions'].length,decryptedMessages,unreadableOtherFixtureMessages,targetMessages,targetMessageBodiesRecovered:targetRecovered,sessionEnvelopesOpened,sessionEnvelopeOpenFailures,restoredSessionsUsedForAuthentication:false,restoreDurationMs:Date.now()-started,hostedDatabaseModified:false,secondCustodianQualified:false,applicationOrProviderRecoveryQualified:false};
}catch(e){failure=e;}
finally{
 await runtime?.end().catch(()=>{});await migration?.end().catch(()=>{});await restore?.end().catch(()=>{});
 if(created)try{await admin.query('DROP DATABASE '+db);}catch{failure??=Error('RESTORE_DATABASE_CLEANUP_FAILED');}
 for(const name of made.reverse())try{await admin.query('DROP ROLE '+name);}catch{failure??=Error('RESTORE_ROLE_CLEANUP_FAILED');}
 await admin.end().catch(()=>{});
}
if(failure){console.error(/^([A-Z_]+)(:[a-z0-9_.:,]+)?$/.test(failure.message)?failure.message:'ISOLATED_HOSTED_RESTORE_FAILED');process.exitCode=1;}
else console.log(JSON.stringify({...report,disposableDatabaseAndRolesRemoved:true}));
