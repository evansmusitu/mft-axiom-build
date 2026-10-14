/**
 * An intentionally destructive, disposable PostgreSQL-only verification.
 * Creates and DROPS database musitu_phase1_ci and two test roles.
 * Refuses to run without PG_ISOLATED_QUALIFICATION=YES, loopback admin URL,
 * and a separately launched single-purpose PostgreSQL test service.
 *
 * `npm install --no-save pg@8` is required in the isolated test environment.
 * Never point PG_ADMIN_URL at live/production databases or a remote host.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes,randomUUID,createHmac} from 'node:crypto';
import {resolve} from 'node:path';
import {PostgresTenantRepository} from '../src/postgres/tenant-repository.mjs';
import {qualifyPostgresRuntime,qualifyPostgresRuntimePrivileges,qualifyPostgresTenantReadIsolation,createQualifiedPostgresRepository,createRuntimeRoleBoundPool} from '../src/postgres/runtime-role-guard.mjs';
import {createRoleBoundSignedWebhookIngestor} from '../src/postgres/signed-inbound.mjs';

if(process.env.PG_ISOLATED_QUALIFICATION!=='YES'){
 console.error('BLOCKED: PG_ISOLATED_QUALIFICATION must equal YES');process.exit(78);
}
const raw=process.env.PG_ADMIN_URL||'';
let adminUrl;
try{adminUrl=new URL(raw);}catch{console.error('BLOCKED: valid PG_ADMIN_URL required');process.exit(78);}
if(!['127.0.0.1','localhost','::1','[::1]'].includes(adminUrl.hostname)||!['postgres:','postgresql:'].includes(adminUrl.protocol)||adminUrl.pathname!=='/postgres'){
 console.error('BLOCKED: admin URL must be a loopback postgres database, not a production endpoint');process.exit(78);
}
const dbName='musitu_phase1_ci';
const migrator='musitu_migrator';
const runtime='musitu_runtime';
const ingress='musitu_ingress';
const secret=()=>randomBytes(24).toString('hex');
const quoteLiteral=s=>"'"+s.replaceAll("'","''")+"'";
const migrationRoot=resolve(import.meta.dirname,'../db');
const {default:pg}=await import('pg');
const {Client,Pool}=pg;
const admin=new Client({connectionString:raw});
const tA='00000000-0000-4000-8000-00000000000a';
const tB='00000000-0000-4000-8000-00000000000b';
const rA='00000000-0000-4000-8000-00000000000d';
const rB='00000000-0000-4000-8000-00000000000e';
let dbCreated=false,roleCreated=false;
let migratorClient,serverAdminClient,pool,ingressPool;
const connectUrl=(base,dbname,username,password)=>{
 const u=new URL(base);u.pathname='/'+dbname;u.username=username;u.password=password;return u.toString();
};
try{
 await admin.connect();
 // Never replace existing state. A CI service must be fresh and disposable.
 const existing=await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[dbName]);
 const existingRole=await admin.query('SELECT rolname FROM pg_roles WHERE rolname=ANY($1::text[])',[[migrator,runtime,ingress]]);
 if(existing.rows.length||existingRole.rows.length)throw new Error('BLOCKED_EXISTING_TEST_DATABASE_OR_ROLES');
 const migratePass=secret(),runtimePass=secret(),ingressPass=secret();
 await admin.query(`CREATE ROLE ${migrator} LOGIN PASSWORD ${quoteLiteral(migratePass)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
 await admin.query(`CREATE ROLE ${runtime} LOGIN PASSWORD ${quoteLiteral(runtimePass)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
 await admin.query(`CREATE ROLE ${ingress} LOGIN PASSWORD ${quoteLiteral(ingressPass)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
 roleCreated=true;
 await admin.query(`CREATE DATABASE ${dbName} OWNER ${migrator}`);
 dbCreated=true;
 await admin.query(`REVOKE ALL ON DATABASE ${dbName} FROM PUBLIC`);
 await admin.query(`GRANT CONNECT ON DATABASE ${dbName} TO ${runtime}, ${ingress}`);
 migratorClient=new Client({connectionString:connectUrl(raw,dbName,migrator,migratePass)});
 await migratorClient.connect();
 for(const filename of ['001_private_tenant_core.sql','002_faq_draft_rls_candidate.sql','003_runtime_role_permissions.sql','004_signed_ingress_role.sql','005_verified_status_reconciliation.sql','006_offline_draft_approvals.sql','007_offline_outbound_preparations.sql','008_signed_customer_suppression.sql']){
  await migratorClient.query(readFileSync(resolve(migrationRoot,filename),'utf8'));
 }
 await migratorClient.end();migratorClient=null;
 // Privileged seeding happens OUTSIDE application; no provisioning endpoints exist.
 serverAdminClient=new Client({connectionString:connectUrl(raw,dbName,adminUrl.username,adminUrl.password)});
 await serverAdminClient.connect();
 const tablePolicies=await serverAdminClient.query(`SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='musitu' AND c.relkind='r'`);
 assert.equal(tablePolicies.rows.length,15);
 assert.ok(tablePolicies.rows.every(r=>r.relrowsecurity&&r.relforcerowsecurity));
 const roles=await serverAdminClient.query('SELECT rolname,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=$1',[runtime]);
 assert.deepEqual(roles.rows[0],{rolname:runtime,rolsuper:false,rolbypassrls:false});
 const tenantRows=[
  [tA,'A','owner-a','WABA_A','PHONE_A',rA],
  [tB,'B','owner-b','WABA_B','PHONE_B',rB]
 ];
 for(const [id,name,owner,waba,phone,resource] of tenantRows){
  await serverAdminClient.query("INSERT INTO musitu.tenants(id,legal_name,status) VALUES($1,$2,'ACTIVE')",[id,name]);
  await serverAdminClient.query("INSERT INTO musitu.memberships(tenant_id,actor_id,role,status) VALUES($1,$2,'OWNER','ACTIVE')",[id,owner]);
  await serverAdminClient.query("INSERT INTO musitu.whatsapp_channels(tenant_id,waba_id,phone_number_id,status) VALUES($1,$2,$3,'VERIFIED')",[id,waba,phone]);
  await serverAdminClient.query('INSERT INTO musitu.resources(tenant_id,resource_id,label) VALUES($1,$2,$3)',[id,resource,name+' Room']);
 }
 const otherBooking=randomUUID();
 await serverAdminClient.query(`INSERT INTO musitu.bookings
  (tenant_id,booking_id,resource_id,start_at,end_at,status,source_idempotency_key)
  VALUES($1,$2,$3,$4,$5,'CONFIRMED',$6)`,[tB,otherBooking,rB,'2026-12-02T09:00:00.000Z','2026-12-02T10:00:00.000Z','tenant-b-seed']);
 await serverAdminClient.query('INSERT INTO musitu.faqs(tenant_id,faq_id,normalized_question,answer) VALUES($1,$2,$3,$4)',
  [tA,randomUUID(),'what hours?','Open at 8.']);
 // A trusted, offline fixture representing a prior accepted outbound. The
 // ingress role has no authority to create outbound attempts or send messages.
 const recipientHash='hmac256:'+createHmac('sha256',Buffer.alloc(32,123))
  .update(JSON.stringify(['remote',tA,'PHONE_A','263771234567'])).digest('hex');
 await serverAdminClient.query(`INSERT INTO musitu.outbound_attempts
   (tenant_id,attempt_id,effect_key,channel_phone_number_id,status,provider_message_id,recipient_hash)
   VALUES($1,$2,$3,$4,'ACCEPTED',$5,$6)`,
  [tA,randomUUID(),'trusted-fixture-only','PHONE_A','wamid.native.status',recipientHash]);
 await serverAdminClient.end();serverAdminClient=null;
 pool=new Pool({connectionString:connectUrl(raw,dbName,runtime,runtimePass),max:2});
 // Verify the actual leased runtime role and exact tenant policy matrix, not
 // only ENABLE/FORCE ROW LEVEL SECURITY flags in administrative metadata.
 const runtimeGate=await qualifyPostgresRuntime({pool,expectedRole:runtime});
 assert.equal(runtimeGate.policiesChecked,15);
 const effectivePrivileges=await qualifyPostgresRuntimePrivileges({pool});
 assert.equal(effectivePrivileges.insertTablesChecked,4);
 const behavior=await qualifyPostgresTenantReadIsolation({pool,expectedRole:runtime,tenantProbes:[tA,tB]});
 assert.equal(behavior.scopesChecked,3);
 const repo=await createQualifiedPostgresRepository({pool,expectedRole:runtime,tenantProbes:[tA,tB]});
 assert.equal((await repo.snapshot(tA,'owner-a')).bookings,0);
 assert.equal((await repo.snapshot(tB,'owner-b')).bookings,1);
 await assert.rejects(repo.snapshot(tB,'owner-a'),/ACCESS_DENIED/);
 await assert.rejects(repo.listReplyDrafts(tB,'owner-a'),/ACCESS_DENIED/);
 const client=await pool.connect();
 try{
  // Default (unset) context sees no tenant rows and cannot create cross-tenant data.
  const noContext=await client.query('SELECT count(*)::int AS n FROM musitu.tenants');
  assert.equal(noContext.rows[0].n,0);
  await client.query('BEGIN');
  await client.query("SELECT set_config('app.tenant_id',$1,true)",[tA]);
  const cannotReadOther=await client.query('SELECT count(*)::int AS n FROM musitu.bookings WHERE tenant_id=$1',[tB]);
  assert.equal(cannotReadOther.rows[0].n,0);
  await assert.rejects(client.query('INSERT INTO musitu.resources(tenant_id,resource_id,label) VALUES($1,$2,$3)',[tA,randomUUID(),'unauthorized']),e=>e.code==='42501');
  await client.query('ROLLBACK');
  await client.query('BEGIN');
  await client.query("SELECT set_config('app.tenant_id',$1,true)",[tA]);
  // Runtime is allowed to book only its current RLS-scoped tenant.
  await assert.rejects(client.query(`INSERT INTO musitu.bookings
    (tenant_id,booking_id,resource_id,start_at,end_at,status,source_idempotency_key)
    VALUES ($1,$2,$3,$4,$5,'CONFIRMED',$6)`,
    [tB,randomUUID(),rB,'2026-12-05T09:00:00.000Z','2026-12-05T10:00:00.000Z','cross-tenant-illegal']),e=>e.code==='42501');
  await client.query('ROLLBACK');
 }finally{client.release();}
 
 // Real PostgreSQL ingress-role qualification: no direct membership, booking or
 // outbound permissions. The test invokes a signed format payload only; no
 // Meta network endpoint is contacted and no real customer details are used.
 ingressPool=new Pool({connectionString:connectUrl(raw,dbName,ingress,ingressPass),max:2});
 const ingressClient=await ingressPool.connect();
 try {
  const roleTest=await ingressClient.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user');
  assert.deepEqual(roleTest.rows[0],{rolsuper:false,rolbypassrls:false});
  const unscoped=await ingressClient.query('SELECT count(*)::int AS n FROM musitu.whatsapp_channels');
  assert.equal(unscoped.rows[0].n,0);
  await ingressClient.query('BEGIN');
  await ingressClient.query("SELECT set_config('app.tenant_id',$1,true)",[tA]);
  await assert.rejects(ingressClient.query("INSERT INTO musitu.memberships(tenant_id,actor_id,role,status) VALUES($1,$2,'AGENT','ACTIVE')",[tA,'injected']),e=>e.code==='42501');
  await ingressClient.query('ROLLBACK');
 } finally {ingressClient.release();}
 const secretString='isolated-hmac-only';
 const bindings=[{tenantId:tA,wabaId:'WABA_A',phoneNumberId:'PHONE_A'},
  {tenantId:tB,wabaId:'WABA_B',phoneNumberId:'PHONE_B'}];
 const ingressAdapter=createRoleBoundSignedWebhookIngestor({pool:ingressPool,expectedRole:ingress,appSecret:secretString,
  bindings,privacyKey:Buffer.alloc(32,123)});
 const envelope=(sender='263771234567')=>Buffer.from(JSON.stringify({object:'whatsapp_business_account',
  entry:[{id:'WABA_A',changes:[{field:'messages',value:{metadata:{phone_number_id:'PHONE_A'},
   messages:[{id:'wamid.native.pg',from:sender,type:'text',timestamp:String(Math.floor(Date.now()/1000)),text:{body:'What hours?'}}]}}]}]}));
 const sign=raw=>'sha256='+createHmac('sha256',secretString).update(raw).digest('hex');
 const msg=envelope();
 const admitted=await ingressAdapter.ingest({rawBody:msg,signature:sign(msg)});
 assert.equal(admitted[0].status,'ACCEPTED');assert.equal(admitted[0].draftStatus,'DRAFT');
 const again=await ingressAdapter.ingest({rawBody:msg,signature:sign(msg)});
 assert.equal(again[0].status,'DUPLICATE');
 const forged=envelope('263779999999');
 await assert.rejects(ingressAdapter.ingest({rawBody:forged,signature:sign(forged)}),/MESSAGE_SENDER_OR_CONTENT_CONFLICT/);
 const ingressRead=await ingressPool.connect();
 try {
  await ingressRead.query('BEGIN');
  await ingressRead.query("SELECT set_config('app.tenant_id',$1,true)",[tA]);
  const drafts=await ingressRead.query('SELECT body FROM musitu.reply_drafts WHERE tenant_id=$1',[tA]);
  assert.equal(drafts.rows.length,1);assert.equal(drafts.rows[0].body,'Open at 8.');
  const other=await ingressRead.query('SELECT count(*)::int AS n FROM musitu.reply_drafts WHERE tenant_id=$1',[tB]);
  assert.equal(other.rows[0].n,0);
  await ingressRead.query('ROLLBACK');
 } finally {ingressRead.release();}
 // Native approval checks: the real signed ingress-created draft can be
 // reviewed by a current tenant member, but not by a different tenant; no
 // outbound provider attempts are created and the webhook service cannot
 // read or mutate approval evidence.
 const draftInfo=await repo.listReplyDrafts(tA,'owner-a');
 assert.equal(draftInfo.length,1);
 assert.equal(draftInfo[0].status,'DRAFT');
 const approvalArgs={tenantId:tA,actorId:'owner-a',draftId:draftInfo[0].draftId,approvalKey:'native-review-0001'};
 const reviewed=await repo.approveReplyDraft(approvalArgs);
 assert.equal(reviewed.status,'APPROVED_OFFLINE');
 assert.equal(reviewed.providerDelivery,'NEVER_SUBMITTED');
 assert.equal((await repo.approveReplyDraft(approvalArgs)).idempotent,true);
 await assert.rejects(repo.approveReplyDraft({...approvalArgs,approvalKey:'different'}),/APPROVAL_CONFLICT/);
 await assert.rejects(repo.approveReplyDraft({...approvalArgs,tenantId:tB,actorId:'owner-b'}),/DRAFT_REVIEW_REQUIRED/);
 const approvedList=await repo.listReplyDrafts(tA,'owner-a');
 assert.equal(approvedList[0].status,'APPROVED_OFFLINE');
 assert.equal(approvedList[0].providerDelivery,'NEVER_SUBMITTED');
 const privilegeCheck=await ingressPool.connect();
 try{
  await privilegeCheck.query('BEGIN');
  await privilegeCheck.query("SELECT set_config('app.tenant_id',$1,true)",[tA]);
  await assert.rejects(privilegeCheck.query('SELECT * FROM musitu.draft_approvals'),e=>e.code==='42501');
  await privilegeCheck.query('ROLLBACK');
 }finally{privilegeCheck.release();}
 // Real database offline-staging qualification; no provider send route exists.
 const stageArgs={tenantId:tA,actorId:'owner-a',draftId:draftInfo[0].draftId,reservationKey:'native-offline-stage-0001'};
 await assert.rejects(repo.stageApprovedReply(stageArgs),/CONSENT_REQUIRED/);
 await assert.rejects(repo.stageApprovedReply({...stageArgs,tenantId:tB,actorId:'owner-b'}),/DRAFT_NOT_STAGEABLE/);
 const offlineAdmin=new Client({connectionString:connectUrl(raw,dbName,adminUrl.username,adminUrl.password)});
 await offlineAdmin.connect();
 try {
  await offlineAdmin.query(`INSERT INTO musitu.channel_consent_evidence
   (tenant_id,phone_number_id,recipient_hash,scope,status,evidence_ref,confirmed_at,expires_at)
   VALUES($1,$2,$3,'CUSTOMER_SERVICE','GRANTED',$4,now()-interval '1 hour',now()+interval '1 day')`,
   [tA,'PHONE_A',recipientHash,'offline-test-fixture:operator-verified']);
 } finally { await offlineAdmin.end(); }
 const staged=await repo.stageApprovedReply(stageArgs);
 assert.equal(staged.status,'STAGED_OFFLINE');assert.equal(staged.providerDelivery,'NEVER_SUBMITTED');
 assert.equal((await repo.stageApprovedReply(stageArgs)).idempotent,true);
 await assert.rejects(repo.stageApprovedReply({...stageArgs,reservationKey:'different'}),/STAGE_CONFLICT/);
 const inspectStage=await pool.connect();
 try{
  await inspectStage.query('BEGIN');
  await inspectStage.query("SELECT set_config('app.tenant_id',$1,true)",[tA]);
  const stagedRecords=await inspectStage.query('SELECT count(*)::int AS n FROM musitu.outbound_preparations');
  assert.equal(stagedRecords.rows[0].n,1);
  const cannotWriteAttempts=inspectStage.query(`INSERT INTO musitu.outbound_attempts
   (tenant_id,attempt_id,effect_key,channel_phone_number_id,status)
   VALUES($1,$2,$3,$4,'RESERVED')`,[tA,randomUUID(),'unauthorized-stage-to-live','PHONE_A']);
  await assert.rejects(cannotWriteAttempts,e=>e.code==='42501');
  await inspectStage.query('ROLLBACK');
 }finally{inspectStage.release();}
 const revokeAdmin=new Client({connectionString:connectUrl(raw,dbName,adminUrl.username,adminUrl.password)});
 await revokeAdmin.connect();
 try{ await revokeAdmin.query(`UPDATE musitu.channel_consent_evidence SET status='REVOKED'
  WHERE tenant_id=$1 AND phone_number_id=$2`,[tA,'PHONE_A']); }
 finally{await revokeAdmin.end();}
 await assert.rejects(repo.stageApprovedReply(stageArgs),/CONSENT_REQUIRED/);
 const scopedIngress=await ingressPool.connect();
 try{
  await scopedIngress.query('BEGIN');
  await scopedIngress.query("SELECT set_config('app.tenant_id',$1,true)",[tA]);
  await assert.rejects(scopedIngress.query('SELECT * FROM musitu.outbound_preparations'),e=>e.code==='42501');
  await scopedIngress.query('ROLLBACK');
 }finally{scopedIngress.release();}
 // Genuine PostgreSQL concurrency/RLS test for synthetic Meta-format status
 // callbacks. A forged or unknown status must never be acknowledged as valid.
 const statusEnvelope=(id='wamid.native.status',status='delivered',recipient='263771234567')=>
  Buffer.from(JSON.stringify({object:'whatsapp_business_account',entry:[{id:'WABA_A',changes:[{
   field:'messages',value:{metadata:{phone_number_id:'PHONE_A'},statuses:[
    {id,status,timestamp:'1799999000',recipient_id:recipient}]}}]}]}));
 const status=statusEnvelope();
 const result=await ingressAdapter.ingest({rawBody:status,signature:sign(status)});
 assert.equal(result[0].status,'DELIVERED');assert.equal(result[0].result,'RECORDED');
 assert.equal((await ingressAdapter.ingest({rawBody:status,signature:sign(status)}))[0].result,'DUPLICATE');
 const unknown=statusEnvelope('wamid.not-known');
 await assert.rejects(ingressAdapter.ingest({rawBody:unknown,signature:sign(unknown)}),/UNKNOWN_OR_UNBOUND_OUTBOUND/);
 const wrongRecipient=statusEnvelope('wamid.native.status','delivered','263779999999');
 await assert.rejects(ingressAdapter.ingest({rawBody:wrongRecipient,signature:sign(wrongRecipient)}),/UNKNOWN_OR_UNBOUND_OUTBOUND/);
 const stateClient=await ingressPool.connect();
 try{
  await stateClient.query('BEGIN');
  await stateClient.query("SELECT set_config('app.tenant_id',$1,true)",[tA]);
  const attempts=await stateClient.query('SELECT status FROM musitu.outbound_attempts WHERE tenant_id=$1 AND provider_message_id=$2',
   [tA,'wamid.native.status']);
  assert.equal(attempts.rows[0].status,'DELIVERED');
  await assert.rejects(stateClient.query(`INSERT INTO musitu.outbound_attempts
     (tenant_id,attempt_id,effect_key,channel_phone_number_id,status)
     VALUES($1,$2,$3,$4,'ACCEPTED')`,[tA,randomUUID(),'not-authorized','PHONE_A']),e=>e.code==='42501');
  await stateClient.query('ROLLBACK');
 } finally {stateClient.release();}
 await ingressPool.end();ingressPool=null;

 const startAt='2026-12-03T09:00:00.000Z',endAt='2026-12-03T10:00:00.000Z';
 const options={tenantId:tA,actorId:'owner-a',resourceId:rA,startAt,endAt};
 const results=await Promise.allSettled([
  repo.reserveBooking({...options,effectKey:'simultaneous-1'}),
  repo.reserveBooking({...options,effectKey:'simultaneous-2'})
 ]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(results.filter(r=>r.status==='rejected'&&r.reason?.message==='SLOT_UNAVAILABLE').length,1);
 const success=results.find(r=>r.status==='fulfilled').value;
 const replay=await repo.reserveBooking({...options,effectKey:success.effectKey});
 assert.equal(replay.bookingId,success.bookingId);
 await assert.rejects(repo.reserveBooking({...options,endAt:'2026-12-03T11:00:00.000Z',effectKey:success.effectKey}),/IDEMPOTENCY_CONFLICT/);
 await pool.end();pool=null;
 pool=new Pool({connectionString:connectUrl(raw,dbName,runtime,runtimePass),max:2});
 const restarted=new PostgresTenantRepository({pool:createRuntimeRoleBoundPool({pool,expectedRole:runtime})});
 assert.equal((await restarted.reserveBooking({...options,effectKey:success.effectKey})).bookingId,success.bookingId);
 assert.equal((await restarted.snapshot(tA,'owner-a')).bookings,1);
 console.log('NATIVE_PG17_TWO_TENANT_RLS_BOOKING_INGRESS_STATUS_APPROVAL_OFFLINE_STAGING_PASS');
}catch(error){
 console.error('POSTGRES_NATIVE_QUALIFICATION_FAILED:',error.message);
 process.exitCode=1;
}finally{
 if(pool)await pool.end().catch(()=>{});
 if(ingressPool)await ingressPool.end().catch(()=>{});
 if(migratorClient)await migratorClient.end().catch(()=>{});
 if(serverAdminClient)await serverAdminClient.end().catch(()=>{});
 if(dbCreated){
  await admin.query(`DROP DATABASE ${dbName} WITH (FORCE)`).catch(e=>{console.error('CLEANUP_FAILED_DATABASE:',e.message);process.exitCode=1;});
 }
 if(roleCreated){
  await admin.query(`DROP ROLE IF EXISTS ${ingress}, ${runtime}, ${migrator}`).catch(e=>{console.error('CLEANUP_FAILED_ROLE:',e.message);process.exitCode=1;});
 }
 await admin.end().catch(()=>{});
}
