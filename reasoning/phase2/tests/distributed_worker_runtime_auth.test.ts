import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const A={tenantId:"tenant:p25c:worker"};
const H=(c:string)=>c.repeat(64);
function intent(overrides:Record<string,unknown>={}){
  return {
    tenantId:A.tenantId,principalId:"principal:dispatch",authorizationDecisionHash:H("a"),requestHash:H("b"),
    compilationId:"model-compilation:"+H("c"),compilationRecordHash:H("d"),profileId:"profile:p25c-worker",
    profileVersion:"1.0.0",profileHash:H("e"),compilerManifest:{id:"axiom.phase1-compiler",version:"1.0.0",implementationHash:H("f")},
    operationRegistryManifestHash:H("1"),
    executionRequest:{asOf:"2026-10-10T02:00:00.000Z",issuedAt:"2026-10-10T02:00:01.000Z",
      program:{irVersion:"0.1",objective:"p25c-worker",assumptions:[],inputs:{},nodes:[{id:"decision",kind:"Decision",operation:"boolean.and",inputs:{values:{literal:{type:{kind:"array",items:{kind:"boolean"}},value:[true]}}}}],constraints:[],decisionNodeId:"decision"},
      requirements:[],bindings:[]},
    snapshotId:"snapshot:"+H("2"),snapshotHash:H("2"),createdAt:"2026-10-10T02:00:02.000Z",...overrides
  };
}
function clock(...times:string[]){
  let i=0;return ()=>times[Math.min(i++,times.length-1)];
}

test("distributed worker signs lifecycle requests and control authenticates them before job mutation",async()=>{
  const phase2:any=await import("../src/index.ts");
  assert.equal(typeof phase2.createStaticWorkerCredential,"function");
  assert.equal(typeof phase2.AuthenticatedDistributedWorkerControl,"function");

  const workerKeys=generateKeyPairSync("ed25519"),leaseKeys=generateKeyPairSync("ed25519");
  let record=phase2.createWorkerTrustRecord({
    workerId:"worker:runtime",keyId:"worker-key:runtime:v1",poolId:"pool:runtime",publicKey:workerKeys.publicKey,
    status:"ACTIVE",maxLeaseMs:5000,allowedActions:["CLAIM","HEARTBEAT","RELEASE","COMPLETE","FAIL_TERMINAL"]
  });
  const trustStore={get:(workerId:string,keyId:string)=>workerId===record.identity.workerId&&keyId===record.identity.keyId?record:undefined};
  const authenticator=new phase2.WorkerRequestAuthenticator({trustStore,maxRequestAgeMs:60000,maxFutureSkewMs:0});
  const leaseSigner=phase2.createStaticWorkerLeaseSigner("lease:runtime:v1",leaseKeys);
  const credential=phase2.createStaticWorkerCredential("worker:runtime","worker-key:runtime:v1",workerKeys.privateKey);

  const dir=mkdtempSync(join(tmpdir(),"axiom-p25c-worker-runtime-")),db=join(dir,"jobs.db");
  const jobs:any=new phase2.DistributedExecutionStore(db,{workerTrustStore:trustStore,leaseSigner});
  try{
    const queued=await jobs.create(A,intent());
    const control=new phase2.AuthenticatedDistributedWorkerControl({jobs,authenticator});
    const requestIds=["request:claim","request:complete"];
    let validateCalls=0,executeCalls=0;
    const worker=new phase2.DistributedModelExecutionWorker({
      control,credential,leaseMs:1000,
      requestId:()=>requestIds.shift()!,
      clock:clock("2026-10-10T02:00:03.000Z","2026-10-10T02:00:03.100Z"),
      runtimes:{create(scope:any){
        assert.deepEqual(scope,A);
        return {
          modelExecutor:{async validatePrepared(){validateCalls++;return {};}},
          executions:{async getByIntent(){return undefined;}},
          plane:{async executeBound(){
            executeCalls++;
            return {status:"APPROVED",snapshotId:queued.intent.snapshotId,
              policyDecision:{status:"ALLOW",snapshotId:queued.intent.snapshotId,checks:[]},
              certificateId:"certificate:p25c",executionRecordId:"platform:p25c"};
          }}
        };
      }}
    });
    const outcome=await worker.runOnce();
    assert.deepEqual(outcome,{status:"COMPLETED",jobId:queued.intent.jobId,jobStatus:"SUCCEEDED"});
    assert.equal(validateCalls,1);assert.equal(executeCalls,1);
    const done=await jobs.get(A,queued.intent.jobId);
    assert.equal(done.state.status,"SUCCEEDED");
    assert.equal(done.state.leaseOwner,undefined);
    assert.equal(done.state.leaseWorkerKeyId,undefined);
    assert.equal(done.state.leaseCapabilityCoreHash,undefined);
  }finally{jobs.close();rmSync(dir,{recursive:true,force:true});}
});

test("worker key revocation between execution and completion loses lease authority without duplicate execution",async()=>{
  const phase2:any=await import("../src/index.ts");
  const workerKeys=generateKeyPairSync("ed25519"),leaseKeys=generateKeyPairSync("ed25519");
  let record=phase2.createWorkerTrustRecord({
    workerId:"worker:revocable",keyId:"worker-key:revocable:v1",poolId:"pool:runtime",publicKey:workerKeys.publicKey,
    status:"ACTIVE",maxLeaseMs:5000,allowedActions:["CLAIM","HEARTBEAT","RELEASE","COMPLETE","FAIL_TERMINAL"]
  });
  const trustStore={get:(workerId:string,keyId:string)=>workerId===record.identity.workerId&&keyId===record.identity.keyId?record:undefined};
  const authenticator=new phase2.WorkerRequestAuthenticator({trustStore,maxRequestAgeMs:60000,maxFutureSkewMs:0});
  const leaseSigner=phase2.createStaticWorkerLeaseSigner("lease:revocable:v1",leaseKeys);
  const credential=phase2.createStaticWorkerCredential("worker:revocable","worker-key:revocable:v1",workerKeys.privateKey);
  const dir=mkdtempSync(join(tmpdir(),"axiom-p25c-worker-revoke-")),db=join(dir,"jobs.db");
  const jobs:any=new phase2.DistributedExecutionStore(db,{workerTrustStore:trustStore,leaseSigner});
  try{
    const queued=await jobs.create(A,intent({requestHash:H("3"),compilationId:"model-compilation:"+H("3")}));
    const control=new phase2.AuthenticatedDistributedWorkerControl({jobs,authenticator});
    let executions=0;
    const worker=new phase2.DistributedModelExecutionWorker({
      control,credential,leaseMs:1000,requestId:(()=>{let n=0;return ()=>`request:revoke:${++n}`;})(),
      clock:clock("2026-10-10T02:01:03.000Z","2026-10-10T02:01:03.100Z","2026-10-10T02:01:03.200Z"),
      runtimes:{create(){return {
        modelExecutor:{async validatePrepared(){return {};}},
        executions:{async getByIntent(){return undefined;}},
        plane:{async executeBound(){
          executions++;
          record=phase2.createWorkerTrustRecord({
            workerId:"worker:revocable",keyId:"worker-key:revocable:v1",poolId:"pool:runtime",publicKey:workerKeys.publicKey,
            status:"REVOKED",maxLeaseMs:5000,allowedActions:["CLAIM","HEARTBEAT","RELEASE","COMPLETE","FAIL_TERMINAL"]
          });
          return {status:"APPROVED",snapshotId:queued.intent.snapshotId,
            policyDecision:{status:"ALLOW",snapshotId:queued.intent.snapshotId,checks:[]},
            certificateId:"certificate:revoked",executionRecordId:"platform:revoked"};
        }}
      };}}
    });
    const outcome=await worker.runOnce();
    assert.deepEqual(outcome,{status:"LEASE_LOST",jobId:queued.intent.jobId});
    assert.equal(executions,1);
    assert.equal((await jobs.get(A,queued.intent.jobId)).state.status,"LEASED");
  }finally{jobs.close();rmSync(dir,{recursive:true,force:true});}
});
