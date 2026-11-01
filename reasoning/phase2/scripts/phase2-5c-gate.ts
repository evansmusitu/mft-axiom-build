import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { compilerManifest, createDefaultRegistry, createSigner, hashJson } from "../../phase1/src/index.ts";
import {
  AuthenticatedDistributedWorkerControl, DistributedExecutionStore, DistributedModelExecutionWorker,
  ExecutionStore, ReasoningControlPlane, WorkerRequestAuthenticator, WorldStateStore,
  createStaticSignerProvider, createStaticWorkerCredential, createStaticWorkerLeaseSigner,
  createWorkerTrustRecord, distributedWorkerOperationBodyHash
} from "../src/index.ts";

const tenant={tenantId:"tenant:phase25c-gate"};
const H=(c:string)=>c.repeat(64);
const registry=createDefaultRegistry();
const dir=mkdtempSync(join(tmpdir(),"axiom-phase25c-gate-")),db=join(dir,"platform.db");

const keysA=generateKeyPairSync("ed25519");
const keysB=generateKeyPairSync("ed25519");
const keysCrash=generateKeyPairSync("ed25519");
const keysRecovery=generateKeyPairSync("ed25519");
const leaseKeys=generateKeyPairSync("ed25519");
const records=new Map<string,any>();

function record(workerId:string,keyId:string,poolId:string,publicKey:any,status:"ACTIVE"|"REVOKED"="ACTIVE"){
  return createWorkerTrustRecord({
    workerId,keyId,poolId,publicKey,status,maxLeaseMs:5000,
    allowedActions:["CLAIM","HEARTBEAT","RELEASE","COMPLETE","FAIL_TERMINAL"]
  });
}
function put(r:any){records.set(`${r.identity.workerId}\u0000${r.identity.keyId}`,r);return r;}
put(record("worker:a","worker-key:a:v1","pool:a",keysA.publicKey));
put(record("worker:b","worker-key:b:v1","pool:b",keysB.publicKey));
put(record("worker:crash","worker-key:crash:v1","pool:runtime",keysCrash.publicKey));
put(record("worker:recovery","worker-key:recovery:v1","pool:runtime",keysRecovery.publicKey));

const trustStore={get:(workerId:string,keyId:string)=>records.get(`${workerId}\u0000${keyId}`)};
const authenticator=new WorkerRequestAuthenticator({trustStore,maxRequestAgeMs:1000,maxFutureSkewMs:0});
const leaseSigner=createStaticWorkerLeaseSigner("lease:phase25c:v1",leaseKeys);
const jobs:any=new DistributedExecutionStore(db,{workerTrustStore:trustStore,leaseSigner});
const world=new WorldStateStore(db),executions=new ExecutionStore(db);
const control=new AuthenticatedDistributedWorkerControl({jobs,authenticator});
const credentialA=createStaticWorkerCredential("worker:a","worker-key:a:v1",keysA.privateKey);
const credentialB=createStaticWorkerCredential("worker:b","worker-key:b:v1",keysB.privateKey);
const credentialCrash=createStaticWorkerCredential("worker:crash","worker-key:crash:v1",keysCrash.privateKey);
const credentialRecovery=createStaticWorkerCredential("worker:recovery","worker-key:recovery:v1",keysRecovery.privateKey);

let requestNo=0;
function proof(credential:any,action:any,issuedAt:string,body:any,targetJobId?:string,requestId?:string){
  return credential.sign({
    requestId:requestId??`request:phase25c:${++requestNo}`,action,
    ...(targetJobId===undefined?{}:{targetJobId}),
    bodyHash:distributedWorkerOperationBodyHash(action,body),issuedAt
  });
}
function intent(id:string,requestHash:string,snapshotId:string,snapshotHash:string,program:any,createdAt:string){
  return {
    tenantId:tenant.tenantId,principalId:"principal:phase25c",authorizationDecisionHash:H("a"),requestHash,
    compilationId:`model-compilation:${id}`,compilationRecordHash:H("d"),profileId:"profile:phase25c",
    profileVersion:"1.0.0",profileHash:H("e"),compilerManifest:compilerManifest(),
    operationRegistryManifestHash:hashJson(registry.manifest() as any),
    executionRequest:{asOf:"2026-10-10T03:00:00.000Z",issuedAt:"2026-10-10T03:00:01.000Z",program,requirements:[],bindings:[]},
    snapshotId,snapshotHash,createdAt
  };
}
function workerClock(...values:string[]){
  let i=0;return ()=>values[Math.min(i++,values.length-1)];
}

try{
  for(const name of ["claimNext","heartbeat","releaseForRetry","complete","failTerminal","currentLease"]){
    assert.equal(typeof jobs[name],"undefined",`raw worker authority method must be absent: ${name}`);
  }

  const frozen=await world.snapshot(tenant,"2026-10-10T03:00:00.000Z");
  const program={
    irVersion:"0.1",objective:"Phase 2.5C authenticated worker gate",assumptions:[],inputs:{},
    nodes:[{id:"decision",kind:"Decision",operation:"boolean.and",inputs:{values:{literal:{type:{kind:"array",items:{kind:"boolean"}},value:[true]}}}}],
    constraints:[],decisionNodeId:"decision"
  };
  const direct=await jobs.create(tenant,intent(H("1"),H("2"),frozen.snapshotId,frozen.snapshotHash,program,"2026-10-10T03:00:02.000Z"));

  const claimBody={leaseMs:1000},claimId="request:phase25c:claim:stable";
  const claimProof=proof(credentialA,"CLAIM","2026-10-10T03:00:03.000Z",claimBody,undefined,claimId);
  const lease=await control.claim(claimProof,"2026-10-10T03:00:03.100Z",1000);
  assert.ok(lease);assert.equal(lease.job.intent.jobId,direct.intent.jobId);
  assert.equal(lease.capability.core.workerId,"worker:a");
  assert.equal(lease.capability.core.workerKeyId,"worker-key:a:v1");
  assert.equal(lease.capability.core.jobId,direct.intent.jobId);
  assert.equal(lease.capability.core.intentHash,direct.intent.intentHash);
  assert.equal(lease.capability.core.leaseEpoch,1);
  assert.equal(leaseSigner.verify(lease.capability),true);

  const staleReplay=await control.claim(claimProof,"2026-10-10T03:00:05.000Z",1000);
  assert.deepEqual(staleReplay,lease,"exact receipted retry must replay after request freshness expiry");

  const heartbeatBody={leaseMs:1000,capabilityId:lease.capability.capabilityId};
  const heartProof=proof(credentialA,"HEARTBEAT","2026-10-10T03:00:03.200Z",heartbeatBody,direct.intent.jobId);
  const heart=await control.heartbeat(tenant,direct.intent.jobId,heartProof,lease.capability,"2026-10-10T03:00:03.200Z",1000);
  assert.notEqual(heart.capability.core.leaseExpiresAt,lease.capability.core.leaseExpiresAt);
  assert.notEqual(heart.job.state.leaseCapabilityCoreHash,lease.job.state.leaseCapabilityCoreHash);

  const staleReleaseBody={capabilityId:lease.capability.capabilityId};
  await assert.rejects(
    ()=>control.release(
      tenant,direct.intent.jobId,
      proof(credentialA,"RELEASE","2026-10-10T03:00:03.300Z",staleReleaseBody,direct.intent.jobId),
      lease.capability,"2026-10-10T03:00:03.300Z"
    ),
    /lease capability|stale|current/i
  );

  const crossBody={leaseMs:1000,capabilityId:heart.capability.capabilityId};
  await assert.rejects(
    ()=>control.heartbeat(
      tenant,direct.intent.jobId,
      proof(credentialB,"HEARTBEAT","2026-10-10T03:00:03.300Z",crossBody,direct.intent.jobId),
      heart.capability,"2026-10-10T03:00:03.300Z",1000
    ),
    /lease capability|worker|identity|pool|stale/i
  );

  records.set("worker:a\u0000worker-key:a:v1",record("worker:a","worker-key:a:v1","pool:a",keysA.publicKey,"REVOKED"));
  await assert.rejects(
    ()=>control.release(
      tenant,direct.intent.jobId,
      proof(credentialA,"RELEASE","2026-10-10T03:00:03.400Z",{capabilityId:heart.capability.capabilityId},direct.intent.jobId),
      heart.capability,"2026-10-10T03:00:03.400Z"
    ),
    /revoked|active|worker/i
  );
  records.set("worker:a\u0000worker-key:a:v1",record("worker:a","worker-key:a:v1","pool:a",keysA.publicKey,"ACTIVE"));

  await control.release(
    tenant,direct.intent.jobId,
    proof(credentialA,"RELEASE","2026-10-10T03:00:03.500Z",{capabilityId:heart.capability.capabilityId},direct.intent.jobId),
    heart.capability,"2026-10-10T03:00:03.500Z"
  );

  const runtimeJob=await jobs.create(
    tenant,intent(H("3"),H("4"),frozen.snapshotId,frozen.snapshotHash,program,"2026-10-10T03:00:04.000Z")
  );
  const signer=createStaticSignerProvider("reasoning-key:phase25c",createSigner());
  const runtimes={create(scope:any){
    const plane=new ReasoningControlPlane({tenant:scope,world,executions,signer,registry});
    return {modelExecutor:{async validatePrepared(){return {}; }},executions,plane};
  }};

  let loseCompletion=true;
  const crashControl:any={
    claim:(...args:any[])=>control.claim(...args),
    heartbeat:(...args:any[])=>control.heartbeat(...args),
    release:(...args:any[])=>control.release(...args),
    fail:(...args:any[])=>control.fail(...args),
    async complete(...args:any[]){
      if(loseCompletion){loseCompletion=false;throw new Error("simulated lost completion response after durable execution");}
      return control.complete(...args);
    }
  };

  let crashRequest=0;
  const firstWorker=new DistributedModelExecutionWorker({
    control:crashControl,credential:credentialCrash,runtimes,leaseMs:1000,
    requestId:()=>`request:phase25c:crash:${++crashRequest}`,
    clock:workerClock("2026-10-10T03:00:05.000Z","2026-10-10T03:00:05.100Z","2026-10-10T03:00:05.200Z")
  });
  assert.deepEqual(await firstWorker.runOnce(),{status:"RETRY",jobId:runtimeJob.intent.jobId});
  assert.equal((await jobs.get(tenant,runtimeJob.intent.jobId)).state.status,"PENDING");
  const committed=await executions.getByIntent(tenant,runtimeJob.intent.jobId);
  assert.ok(committed,"durable execution must survive lost completion response");

  let recoveryRequest=0;
  const secondWorker=new DistributedModelExecutionWorker({
    control,credential:credentialRecovery,runtimes,leaseMs:1000,
    requestId:()=>`request:phase25c:recovery:${++recoveryRequest}`,
    clock:workerClock("2026-10-10T03:00:06.000Z","2026-10-10T03:00:06.100Z")
  });
  assert.deepEqual(await secondWorker.runOnce(),{status:"COMPLETED",jobId:runtimeJob.intent.jobId,jobStatus:"SUCCEEDED"});

  const inspect=new DatabaseSync(db);
  const executionCount=Number((inspect.prepare("SELECT COUNT(*) AS n FROM platform_executions WHERE tenant_id=?").get(tenant.tenantId) as any).n);
  const intentCount=Number((inspect.prepare("SELECT COUNT(*) AS n FROM execution_intents WHERE tenant_id=?").get(tenant.tenantId) as any).n);
  inspect.close();
  assert.equal(executionCount,1);
  assert.equal(intentCount,1);
  assert.deepEqual(
    await new ReasoningControlPlane({tenant,world,executions,signer,registry}).replayStored(committed.id),
    {status:"MATCH",diagnostics:[]}
  );

  console.log(JSON.stringify({
    phase:"P2.5C — Authenticated Workers and Lease-Scoped Capabilities",
    status:"PASS",
    checks:[
      "remove every raw worker-id lease mutation surface",
      "authenticate worker claims with Ed25519 proof-of-possession and server-owned trust",
      "bind server-signed lease capability to exact worker key pool tenant job intent epoch and expiry",
      "replay an exact durable worker receipt after request freshness expiry without a second mutation",
      "rotate the capability commitment on heartbeat and reject the superseded capability",
      "reject cross-worker capability substitution",
      "apply worker-key revocation immediately to an active lease",
      "release retry state after a simulated lost completion response",
      "recover the one durable execution under a new authenticated worker",
      "network-free replay the recovered execution with MATCH"
    ],
    tenantId:tenant.tenantId,
    executionJobId:runtimeJob.intent.jobId,
    executionRecordId:committed.id,
    executionCount,intentCount
  },null,2));
}finally{
  jobs.close();executions.close();world.close();rmSync(dir,{recursive:true,force:true});
}
