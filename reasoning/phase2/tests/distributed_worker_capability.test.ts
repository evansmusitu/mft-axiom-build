import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { canonicalize } from "../../phase1/src/canonical.ts";

const A={tenantId:"tenant:p25c:sqlite"};
const H=(c:string)=>c.repeat(64);

function intent(overrides:Record<string,unknown>={}){
  return {
    tenantId:A.tenantId,principalId:"principal:dispatch",authorizationDecisionHash:H("a"),requestHash:H("b"),
    compilationId:"model-compilation:"+H("c"),compilationRecordHash:H("d"),
    profileId:"profile:p25c",profileVersion:"1.0.0",profileHash:H("e"),
    compilerManifest:{id:"axiom.phase1-compiler",version:"1.0.0",implementationHash:H("f")},
    operationRegistryManifestHash:H("1"),
    executionRequest:{
      asOf:"2026-10-10T00:00:00.000Z",issuedAt:"2026-10-10T00:00:01.000Z",
      program:{irVersion:"0.1",objective:"p25c",assumptions:[],inputs:{},nodes:[{id:"decision",kind:"Decision",operation:"boolean.and",inputs:{values:{literal:{type:{kind:"array",items:{kind:"boolean"}},value:[true]}}}}],constraints:[],decisionNodeId:"decision"},
      requirements:[],bindings:[]
    },
    snapshotId:"snapshot:"+H("2"),snapshotHash:H("2"),createdAt:"2026-10-10T00:00:02.000Z",...overrides
  };
}

test("SQLite authenticated worker operations are receipt-idempotent capability-fenced and revocation-aware",async()=>{
  const phase2:any=await import("../src/index.ts");
  assert.equal(typeof phase2.distributedWorkerOperationBodyHash,"function");

  const workerKeys=generateKeyPairSync("ed25519");
  const otherKeys=generateKeyPairSync("ed25519");
  const leaseKeys=generateKeyPairSync("ed25519");
  let workerRecord=phase2.createWorkerTrustRecord({
    workerId:"worker:a",keyId:"worker-key:a:v1",poolId:"pool:a",publicKey:workerKeys.publicKey,
    status:"ACTIVE",maxLeaseMs:2000,allowedActions:["CLAIM","HEARTBEAT","RELEASE","COMPLETE","FAIL_TERMINAL"]
  });
  const otherRecord=phase2.createWorkerTrustRecord({
    workerId:"worker:b",keyId:"worker-key:b:v1",poolId:"pool:b",publicKey:otherKeys.publicKey,
    status:"ACTIVE",maxLeaseMs:2000,allowedActions:["CLAIM","HEARTBEAT","RELEASE","COMPLETE","FAIL_TERMINAL"]
  });
  const trustStore={
    get(workerId:string,keyId:string){
      if(workerId==="worker:a"&&keyId==="worker-key:a:v1")return workerRecord;
      if(workerId==="worker:b"&&keyId==="worker-key:b:v1")return otherRecord;
      return undefined;
    }
  };
  const auth=new phase2.WorkerRequestAuthenticator({trustStore,maxRequestAgeMs:60000,maxFutureSkewMs:0});
  const leaseSigner=phase2.createStaticWorkerLeaseSigner("lease-signing:p25c:v1",leaseKeys);
  const proof=(opts:{worker?:"a"|"b";requestId:string;action:string;targetJobId?:string;body:any;issuedAt?:string})=>{
    const isB=opts.worker==="b",key=isB?otherKeys.privateKey:workerKeys.privateKey;
    const unsigned={
      protocolVersion:"axiom.worker-request/v1",
      workerId:isB?"worker:b":"worker:a",
      keyId:isB?"worker-key:b:v1":"worker-key:a:v1",
      requestId:opts.requestId,
      action:opts.action,
      ...(opts.targetJobId?{targetJobId:opts.targetJobId}:{}),
      bodyHash:phase2.distributedWorkerOperationBodyHash(opts.action,opts.body),
      issuedAt:opts.issuedAt??"2026-10-10T00:00:03.000Z"
    };
    const signatureBase64=sign(null,Buffer.from(canonicalize(phase2.workerRequestSigningPayload(unsigned))),key).toString("base64");
    const p={...unsigned,signatureBase64};
    return auth.authenticate(p,{
      action:opts.action,targetJobId:opts.targetJobId,bodyHash:unsigned.bodyHash,now:"2026-10-10T00:00:03.100Z"
    });
  };

  const dir=mkdtempSync(join(tmpdir(),"axiom-p25c-auth-store-")),db=join(dir,"jobs.db");
  let store:any=new phase2.DistributedExecutionStore(db,{workerTrustStore:trustStore,leaseSigner});
  try{
    const first=await store.create(A,intent());
    const second=await store.create(A,intent({requestHash:H("3"),compilationId:"model-compilation:"+H("3")}));

    const claimCtx=proof({requestId:"request:claim:1",action:"CLAIM",body:{leaseMs:1000}});
    const lease=await store.claimNextAuthenticated(claimCtx,"2026-10-10T00:00:03.100Z",1000);
    assert.equal(lease.job.intent.jobId,first.intent.jobId);
    assert.equal(lease.workerId,"worker:a");
    assert.equal(lease.workerKeyId,"worker-key:a:v1");
    assert.equal(lease.poolId,"pool:a");
    assert.equal(lease.leaseEpoch,1);
    assert.equal(lease.job.state.leaseWorkerKeyId,"worker-key:a:v1");
    assert.equal(lease.job.state.leasePoolId,"pool:a");
    assert.equal(lease.job.state.leaseCapabilityCoreHash,phase2.workerLeaseCapabilityCoreHash(lease.capability.core));
    assert.equal(leaseSigner.verify(lease.capability),true);

    const replay=await store.claimNextAuthenticated(claimCtx,"2026-10-10T00:00:04.000Z",1000);
    assert.equal(replay.job.intent.jobId,first.intent.jobId);
    assert.deepEqual(replay.capability,lease.capability);
    assert.equal((await store.get(A,second.intent.jobId)).state.status,"PENDING");

    const conflictCtx=proof({requestId:"request:claim:1",action:"CLAIM",body:{leaseMs:1500}});
    await assert.rejects(()=>store.claimNextAuthenticated(conflictCtx,"2026-10-10T00:00:04.000Z",1500),/request.*conflict|receipt.*conflict/i);
    const tooLong=proof({requestId:"request:claim:long",action:"CLAIM",body:{leaseMs:2001}});
    await assert.rejects(()=>store.claimNextAuthenticated(tooLong,"2026-10-10T00:00:04.000Z",2001),/max.*lease|lease.*maximum/i);

    const hbBody={leaseMs:1500,capabilityId:lease.capability.capabilityId};
    const hbCtx=proof({requestId:"request:heartbeat:1",action:"HEARTBEAT",targetJobId:first.intent.jobId,body:hbBody});
    const heart=await store.heartbeatAuthenticated(A,first.intent.jobId,hbCtx,lease.capability,"2026-10-10T00:00:03.500Z",1500);
    assert.equal(heart.leaseExpiresAt,"2026-10-10T00:00:05.000Z");
    assert.notEqual(heart.job.state.leaseCapabilityCoreHash,lease.job.state.leaseCapabilityCoreHash);

    const oldResult={
      status:"APPROVED",snapshotId:first.intent.snapshotId,policyDecision:{status:"ALLOW",snapshotId:first.intent.snapshotId,checks:[]},
      certificateId:"cert:old",executionRecordId:"platform:old"
    };
    const oldCompleteBody={capabilityId:lease.capability.capabilityId,result:oldResult};
    const oldCompleteCtx=proof({requestId:"request:complete:old",action:"COMPLETE",targetJobId:first.intent.jobId,body:oldCompleteBody});
    await assert.rejects(()=>store.completeAuthenticated(A,first.intent.jobId,oldCompleteCtx,lease.capability,"2026-10-10T00:00:03.600Z",oldResult),/lease|capability/i);

    const otherBody={capabilityId:heart.capability.capabilityId};
    const otherCtx=proof({worker:"b",requestId:"request:release:other",action:"RELEASE",targetJobId:first.intent.jobId,body:otherBody});
    await assert.rejects(()=>store.releaseForRetryAuthenticated(A,first.intent.jobId,otherCtx,heart.capability,"2026-10-10T00:00:03.700Z"),/worker|lease|capability/i);

    const releaseCtx=proof({requestId:"request:release:revoked",action:"RELEASE",targetJobId:first.intent.jobId,body:{capabilityId:heart.capability.capabilityId}});
    workerRecord=phase2.createWorkerTrustRecord({
      workerId:"worker:a",keyId:"worker-key:a:v1",poolId:"pool:a",publicKey:workerKeys.publicKey,
      status:"REVOKED",maxLeaseMs:2000,allowedActions:["CLAIM","HEARTBEAT","RELEASE","COMPLETE","FAIL_TERMINAL"]
    });
    await assert.rejects(()=>store.releaseForRetryAuthenticated(A,first.intent.jobId,releaseCtx,heart.capability,"2026-10-10T00:00:03.800Z"),/revoked|active|worker/i);

    workerRecord=phase2.createWorkerTrustRecord({
      workerId:"worker:a",keyId:"worker-key:a:v1",poolId:"pool:a",publicKey:workerKeys.publicKey,
      status:"ACTIVE",maxLeaseMs:2000,allowedActions:["CLAIM","HEARTBEAT","RELEASE","COMPLETE","FAIL_TERMINAL"]
    });
    store.close();

    const raw=new DatabaseSync(db);
    raw.prepare("UPDATE distributed_execution_jobs SET lease_worker_key_id=? WHERE job_id=?").run("attacker-key",first.intent.jobId);
    raw.close();
    store=new phase2.DistributedExecutionStore(db,{workerTrustStore:trustStore,leaseSigner});
    await assert.rejects(()=>store.get(A,first.intent.jobId),/state.*integrity|integrity.*state/i);
  }finally{
    try{store.close();}catch{}
    rmSync(dir,{recursive:true,force:true});
  }
});
