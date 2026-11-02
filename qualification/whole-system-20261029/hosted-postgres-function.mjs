/** Native Neon Node 24 qualification. Only module startup can change fixtures.
 * Deploy prepare, read PREPARED, then redeploy recover to start a fresh isolate.
 * No private fixture key or database credential is persisted or returned.
 */
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {initializePostgresSchema,PostgresWorldStateRepository,PostgresExecutionRepository} from '../../reasoning/phase2/src/postgres.ts';
import {PostgresDistributedExecutionRepository} from '../../reasoning/phase2/src/distributed_execution_postgres.ts';
import {PostgresModelCompilationRepository} from '../../reasoning/phase2/src/model_postgres.ts';
import {ReasoningControlPlane} from '../../reasoning/phase2/src/control_plane.ts';
import {PersistedDistributedCompletionVerifier} from '../../reasoning/phase2/src/distributed_execution_proof.ts';
import {createWorkerTrustRecord,WorkerRequestAuthenticator} from '../../reasoning/phase2/src/worker_authentication.ts';
import {createStaticWorkerLeaseSigner} from '../../reasoning/phase2/src/worker_lease_capability.ts';
import {createStaticWorkerCredential,AuthenticatedDistributedWorkerControl} from '../../reasoning/phase2/src/distributed_worker_control.ts';
import {distributedWorkerOperationBodyHash} from '../../reasoning/phase2/src/distributed_execution_store.ts';
import {DistributedModelExecutionWorker} from '../../reasoning/phase2/src/distributed_model_execution.ts';
import {ModelExecutionService} from '../../reasoning/phase2/src/model_execution_service.ts';
import {ModelCompilerRegistry} from '../../reasoning/phase2/src/model_compiler.ts';
import {createStaticSignerProvider,createExternalEd25519SignerProvider} from '../../reasoning/phase2/src/signer.ts';
import {createSigner} from '../../reasoning/phase1/src/certificate.ts';
import {createDefaultRegistry} from '../../reasoning/phase1/src/registry.ts';
import {compilerManifest} from '../../reasoning/phase1/src/compiler.ts';
import {hashJson} from '../../reasoning/phase1/src/canonical.ts';

const instanceId=randomUUID(),headers={'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'};
const pg=createRequire(new URL('../../reasoning/phase2/package.json',import.meta.url))('pg');
const migration=readFileSync(new URL('../../reasoning/phase2/sql/postgres.sql',import.meta.url),'utf8');
const digest=value=>createHash('sha256').update(value).digest('hex');
let current={schema:'axiom.hosted-postgres-acceptance.v1',status:'STARTING',instance_id:instanceId,checks:[],hosted_postgres_qualified:false};
function poolFor(schema){
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL_UNPOOLED,max:4,connectionTimeoutMillis:10000,idleTimeoutMillis:1000,query_timeout:20000,options:`-c search_path=${schema} -c statement_timeout=15000 -c lock_timeout=10000`});
  pool.on('error',()=>{});return pool;
}
function authFixture(id){
  const keys=generateKeyPairSync('ed25519');
  const active=()=>createWorkerTrustRecord({workerId:id,keyId:id+':key',poolId:'pool:hosted-acceptance',publicKey:keys.publicKey,status:'ACTIVE',maxLeaseMs:5000,allowedActions:['CLAIM','HEARTBEAT','RELEASE','COMPLETE','FAIL_TERMINAL']});
  return {keys,record:active(),active,credential:createStaticWorkerCredential(id,id+':key',keys.privateKey)};
}
function dependencies(pool,signer,workers){
  const registry=createDefaultRegistry(),world=new PostgresWorldStateRepository(pool),executions=new PostgresExecutionRepository(pool);
  const trustStore={get:(workerId,keyId)=>workers.find(worker=>worker.record.identity.workerId===workerId&&worker.record.identity.keyId===keyId)?.record};
  const authenticator=new WorkerRequestAuthenticator({trustStore,maxRequestAgeMs:60000,maxFutureSkewMs:0});
  const jobs=new PostgresDistributedExecutionRepository(pool,{workerTrustStore:trustStore,leaseSigner:createStaticWorkerLeaseSigner('lease:hosted:'+instanceId,generateKeyPairSync('ed25519')),completionVerifier:new PersistedDistributedCompletionVerifier({world,executions,signer,registry})});
  const control=new AuthenticatedDistributedWorkerControl({jobs,authenticator});
  const context=(worker,action,body,now,targetJobId,id=randomUUID())=>{
    const proof=worker.credential.sign({requestId:id,action,...(targetJobId?{targetJobId}:{}),bodyHash:distributedWorkerOperationBodyHash(action,body),issuedAt:now});
    return authenticator.authenticate(proof,{action,targetJobId,bodyHash:proof.bodyHash,now});
  };
  return {registry,world,executions,authenticator,jobs,control,context};
}
async function prepare(pool,report){
  const workers=[authFixture('worker:hosted:a'),authFixture('worker:hosted:b')];
  const fixtureSigner=createSigner(),signer=createStaticSignerProvider('signer:hosted:fixture',fixtureSigner);
  const d=dependencies(pool,signer,workers),A={tenantId:'tenant:hosted:alpha'},B={tenantId:'tenant:hosted:beta'};
  const base=Date.now(),time=offset=>new Date(base+offset).toISOString(),at=time(0);
  const check=async(name,work)=>{await work();report.checks.push({name,status:'PASS'});};
  let snapshot,job,winning,lease,winningWorker,result;
  await check('canonical_migration_idempotent_and_schema_isolated',async()=>{
    await initializePostgresSchema(pool);await initializePostgresSchema(pool);
    assert.equal((await pool.query('SELECT current_schema() AS schema')).rows[0].schema,report.schema_name);
    const tables=(await pool.query('SELECT table_name FROM information_schema.tables WHERE table_schema=$1',[report.schema_name])).rows.map(row=>row.table_name);
    for(const name of ['axiom_distributed_execution_jobs','axiom_worker_operation_receipts','axiom_platform_executions','axiom_world_snapshots','axiom_model_compilations'])assert.ok(tables.includes(name));
  });
  await check('actual_world_repository_tenant_isolation_equal_fact_ids',async()=>{
    for(const [scope,value]of[[A,0.3],[B,0.1]])await d.world.putFact(scope,{id:'same-fixture-fact',entity:'risk:acceptance',attribute:'limit',value:{type:{kind:'number',unit:'ratio'},value},validFrom:at,observedAt:at,source:'fixture:declared-test-assumption',confidence:1});
    snapshot=await d.world.snapshot(A,at);const other=await d.world.snapshot(B,at);
    assert.equal(snapshot.facts[0].value.value,0.3);assert.equal(other.facts[0].value.value,0.1);
    await assert.rejects(()=>d.world.getSnapshot(B,snapshot.snapshotId),/not found.*tenant/i);
  });
  const program={irVersion:'0.1',objective:'A bounded hosted storage proof',assumptions:[],inputs:{},nodes:[{id:'decision',kind:'Decision',operation:'logic.not',inputs:{value:{literal:{type:{kind:'boolean'},value:false}}}}],constraints:[],decisionNodeId:'decision'};
  const executionRequest={asOf:at,issuedAt:at,program,requirements:[],bindings:[]},H='a'.repeat(64);
  job=await d.jobs.create(A,{tenantId:A.tenantId,principalId:'principal:acceptance',authorizationDecisionHash:H,requestHash:H,compilationId:'compilation:acceptance',compilationRecordHash:H,profileId:'profile:acceptance',profileVersion:'1',profileHash:H,compilerManifest:compilerManifest(),operationRegistryManifestHash:hashJson(d.registry.manifest()),executionRequest,snapshotId:snapshot.snapshotId,snapshotHash:snapshot.snapshotHash,createdAt:at});
  await check('actual_job_repository_cross_tenant_read_denied',()=>assert.rejects(()=>d.jobs.get(B,job.intent.jobId),/not found.*tenant/i));
  await check('worker_max_lease_admission_bound_leaves_no_receipt',async()=>{
    const ctx=d.context(workers[0],'CLAIM',{leaseMs:5001},time(10));
    await assert.rejects(()=>d.jobs.claimNextAuthenticated(ctx,time(10),5001),/maximum lease/i);
    assert.equal(Number((await pool.query('SELECT COUNT(*) AS n FROM axiom_worker_operation_receipts')).rows[0].n),0);
  });
  await check('concurrent_authenticated_claim_has_one_durable_winner',async()=>{
    const contexts=workers.map(worker=>d.context(worker,'CLAIM',{leaseMs:1000},time(20)));
    const claims=await Promise.all(contexts.map(ctx=>d.jobs.claimNextAuthenticated(ctx,time(20),1000)));
    assert.equal(claims.filter(Boolean).length,1);
    const index=claims.findIndex(Boolean);winning=contexts[index];lease=claims[index];winningWorker=workers[index];
    assert.equal(lease.job.state.leaseEpoch,1);assert.equal(lease.job.state.attemptCount,1);
  });
  await check('authenticated_claim_receipt_replay_does_not_reclaim',async()=>{
    const replay=await d.jobs.claimNextAuthenticated(winning,time(30),1000);
    assert.deepEqual(replay.capability,lease.capability);
    assert.equal((await d.jobs.get(A,job.intent.jobId)).state.leaseEpoch,1);
  });
  await check('revocation_after_authentication_denies_before_storage_mutation',async()=>{
    const ctx=d.context(winningWorker,'HEARTBEAT',{leaseMs:1000,capabilityId:lease.capability.capabilityId},time(40),job.intent.jobId);
    const before=await d.jobs.get(A,job.intent.jobId);
    winningWorker.record=createWorkerTrustRecord({workerId:winningWorker.record.identity.workerId,keyId:winningWorker.record.identity.keyId,poolId:winningWorker.record.identity.poolId,publicKey:winningWorker.keys.publicKey,status:'REVOKED',maxLeaseMs:5000,allowedActions:['CLAIM','HEARTBEAT','RELEASE','COMPLETE','FAIL_TERMINAL']});
    await assert.rejects(()=>d.jobs.heartbeatAuthenticated(A,job.intent.jobId,ctx,lease.capability,time(40),1000),/revoked|not active/i);
    assert.throws(()=>d.context(winningWorker,'CLAIM',{leaseMs:1000},time(50)),/revoked/i);
    assert.equal((await d.jobs.get(A,job.intent.jobId)).state.stateHash,before.state.stateHash);
    winningWorker.record=winningWorker.active();
  });
  await check('expired_lease_reclamation_fences_stale_capability',async()=>{
    const fresh=d.context(workers[0],'CLAIM',{leaseMs:1000},time(1100));
    const reclaimed=await d.jobs.claimNextAuthenticated(fresh,time(1100),1000);
    assert.equal(reclaimed.job.state.leaseEpoch,2);assert.equal(reclaimed.job.state.attemptCount,2);
    const stale=d.context(winningWorker,'HEARTBEAT',{leaseMs:1000,capabilityId:lease.capability.capabilityId},time(1200),job.intent.jobId);
    await assert.rejects(()=>d.jobs.heartbeatAuthenticated(A,job.intent.jobId,stale,lease.capability,time(1200),1000),/stale|capability/i);
    lease=reclaimed;winningWorker=workers[0];
  });
  await check('real_reasoning_execution_persists_proof_and_missing_proof_rolls_back',async()=>{
    const plane=new ReasoningControlPlane({tenant:A,...d,signer});
    result=await plane.executeBound(executionRequest,snapshot.snapshotId,job.intent.jobId);
    assert.equal(result.status,'APPROVED');assert.equal((await plane.replayStored(result.executionRecordId)).status,'MATCH');
    const missing={...result,certificateId:'missing',executionRecordId:'missing'};
    const ctx=d.context(winningWorker,'COMPLETE',{capabilityId:lease.capability.capabilityId,result:missing},time(1300),job.intent.jobId);
    await assert.rejects(()=>d.jobs.completeAuthenticated(A,job.intent.jobId,ctx,lease.capability,time(1300),missing),/not found/i);
    assert.equal((await d.jobs.get(A,job.intent.jobId)).state.status,'LEASED');
    assert.equal(await d.executions.getByIntent(B,job.intent.jobId),undefined);
  });
  const persisted=await d.executions.getByIntent(A,job.intent.jobId);
  report.status='PREPARED';report.prepare_instance_id=instanceId;
  report.recovery={tenant_id:A.tenantId,job_id:job.intent.jobId,snapshot_id:snapshot.snapshotId,record_id:persisted.id,record_hash:persisted.recordHash,execution_request:executionRequest,recovery_at:time(3000),signer_key_id:signer.keyId,signer_public_key_pem:signer.trustedPublicKeyPem(),prior_epoch:2,expected_result:result};
  report.durable_execution_count=Number((await pool.query('SELECT COUNT(*) AS n FROM axiom_platform_executions')).rows[0].n);
  assert.equal(report.durable_execution_count,1);
  report.checks.push({name:'durable_execution_left_leased_before_new_deployment',status:'PASS'});
  return report;
}
async function recover(pool,report){
  assert.equal(report.status,'PREPARED');assert.notEqual(report.prepare_instance_id,instanceId);
  const r=report.recovery,scope={tenantId:r.tenant_id};let signingCalls=0;
  // Public verification key only. Any attempt to issue a new certificate fails.
  const signer=createExternalEd25519SignerProvider({providerId:'acceptance-verification-only',activeKeyId:r.signer_key_id,activePublicKey:r.signer_public_key_pem,trustedKeys:{[r.signer_key_id]:r.signer_public_key_pem},backend:{async sign(){signingCalls++;throw new Error('new signing forbidden during persisted recovery');}}});
  const worker=authFixture('worker:hosted:recovery:'+instanceId),d=dependencies(pool,signer,[worker]);
  const plane=new ReasoningControlPlane({tenant:scope,...d,signer});
  const executor=new ModelExecutionService({repository:new PostgresModelCompilationRepository(pool),profiles:new ModelCompilerRegistry(d.registry,[]),registry:d.registry,plane});
  const actual=new DistributedModelExecutionWorker({control:d.control,credential:worker.credential,leaseMs:5000,clock:()=>r.recovery_at,requestId:()=>randomUUID(),runtimes:{create(tenant){assert.deepEqual(tenant,scope);return {modelExecutor:executor,executions:d.executions,plane};}}});
  const outcome=await actual.runOnce();assert.equal(outcome.status,'COMPLETED');assert.equal(outcome.jobId,r.job_id);
  const terminal=await d.jobs.get(scope,r.job_id),record=await d.executions.getByIntent(scope,r.job_id);
  assert.equal(terminal.state.status,'SUCCEEDED');assert.equal(terminal.state.leaseEpoch,3);
  assert.deepEqual(terminal.state.result,r.expected_result);assert.equal(record.id,r.record_id);assert.equal(record.recordHash,r.record_hash);
  assert.equal((await plane.replayStored(record.id)).status,'MATCH');assert.equal(signingCalls,0);
  for(const table of ['axiom_platform_executions','axiom_execution_intents'])assert.equal(Number((await pool.query(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n),1);
  report.checks.push({name:'fresh_deployment_actual_worker_recovers_durable_execution',status:'PASS'},{name:'persisted_execution_replay_matches_after_restart',status:'PASS'},{name:'no_second_durable_execution_or_signing_call',status:'PASS'});
  report.recovery_instance_id=instanceId;report.recovery_worker_outcome=outcome;report.terminal_state_hash=terminal.state.stateHash;report.final_epoch=terminal.state.leaseEpoch;
  report.status='COMPLETED';report.hosted_postgres_qualified=true;report.completed_at=new Date().toISOString();
  return report;
}
async function initialize(){
  const run=process.env.ACCEPTANCE_RUN_ID,branch=process.env.ACCEPTANCE_BRANCH_NAME,stage=process.env.ACCEPTANCE_STAGE;
  assert.match(run||'',/^axiom-acceptance-20261101-[A-Za-z0-9_-]{1,70}$/);
  assert.equal(process.env.NEON_BRANCH,branch);assert.notEqual(branch,'main');assert.ok(['prepare','recover'].includes(stage));
  assert.ok(process.env.DATABASE_URL_UNPOOLED,'native branch direct database binding required');
  const schema='axiom_acceptance_'+digest(run).slice(0,20),bootstrap=poolFor('pg_catalog');
  try{
    const identity=(await bootstrap.query('SELECT current_database() AS database, current_setting(\'server_version_num\') AS version')).rows[0];
    assert.equal(identity.database,process.env.ACCEPTANCE_DATABASE_NAME);assert.ok(Number(identity.version)>=170000);
    await bootstrap.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  }finally{await bootstrap.end();}
  const pool=poolFor(schema),lock=await pool.connect();let acquired=false,guarded=false;
  try{
    acquired=(await lock.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired',[run])).rows[0].acquired;
    if(!acquired)return {...current,status:'RUNNING_IN_ANOTHER_ISOLATE',run_id:run,schema_name:schema};
    await lock.query('CREATE TABLE IF NOT EXISTS axiom_acceptance_guard(singleton INTEGER PRIMARY KEY CHECK(singleton=1),run_id TEXT NOT NULL,state TEXT NOT NULL,report JSONB NOT NULL)');
    let row=(await lock.query('SELECT * FROM axiom_acceptance_guard WHERE singleton=1')).rows[0];
    if(row){
      assert.equal(row.run_id,run);
      if(stage==='prepare'||row.state!=='PREPARED')return row.report;
      current=row.report;
      await lock.query("UPDATE axiom_acceptance_guard SET state='RECOVERING' WHERE singleton=1");guarded=true;
    }else{
      assert.equal(stage,'prepare');
      current={schema:'axiom.hosted-postgres-acceptance.v1',status:'STARTED',run_id:run,branch_name:branch,database_name:process.env.ACCEPTANCE_DATABASE_NAME,schema_name:schema,source_commit:process.env.ACCEPTANCE_SOURCE_COMMIT,node_version:process.version,instance_id:instanceId,started_at:new Date().toISOString(),migration_sha256:digest(migration),checks:[],hosted_postgres_qualified:false,production_authority:false,independent_custody_qualified:false,compute_provider_budget_qualified:false,budget_scope:'worker maxLeaseMs only',private_fixture_keys_persisted:false};
      await lock.query("INSERT INTO axiom_acceptance_guard VALUES(1,$1,'STARTED',$2::jsonb)",[run,JSON.stringify(current)]);guarded=true;
    }
    current=stage==='prepare'?await prepare(pool,current):await recover(pool,current);
    await lock.query('UPDATE axiom_acceptance_guard SET state=$1,report=$2::jsonb WHERE singleton=1 AND run_id=$3',[current.status,JSON.stringify(current),run]);
    return current;
  }catch(error){
    current={...current,status:'FAILED',hosted_postgres_qualified:false,error:{name:error?.name||'Error',code:error?.code||'ACCEPTANCE_CHECK_FAILED'},failed_at:new Date().toISOString()};
    if(guarded)await lock.query("UPDATE axiom_acceptance_guard SET state='FAILED',report=$1::jsonb WHERE singleton=1 AND run_id=$2",[JSON.stringify(current),run]).catch(()=>{});
    return current;
  }finally{
    if(acquired)await lock.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[run]).catch(()=>{});
    lock.release();await pool.end();
  }
}
const startup=initialize().then(report=>{current=report;}).catch(error=>{current={...current,status:'FAILED',error:{name:error?.name||'Error',code:error?.code||'STARTUP_FAILED'}};});
export default {async fetch(request){
  const path=new URL(request.url).pathname;
  if(request.method!=='GET')return new Response(JSON.stringify({error:'read_only_acceptance_report'}),{status:405,headers});
  if(!['/report','/health','/'].includes(path))return new Response('{}',{status:404,headers});
  if(path!=='/health')await Promise.race([startup,new Promise(resolve=>setTimeout(resolve,7000))]);
  return new Response(JSON.stringify(current),{status:current.status==='FAILED'?500:200,headers});
}};
