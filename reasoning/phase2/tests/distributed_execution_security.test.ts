import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const A={tenantId:"tenant:security-regression"};
const H=(c:string)=>c.repeat(64);

function intent(){
  return {
    tenantId:A.tenantId,
    principalId:"principal:dispatcher",
    authorizationDecisionHash:H("a"),
    requestHash:H("b"),
    compilationId:"model-compilation:"+H("c"),
    compilationRecordHash:H("d"),
    profileId:"profile:security",
    profileVersion:"1.0.0",
    profileHash:H("e"),
    compilerManifest:{id:"axiom.phase1-compiler",version:"1.0.0",implementationHash:H("f")},
    operationRegistryManifestHash:H("1"),
    executionRequest:{
      asOf:"2026-10-08T12:00:00.000Z",
      issuedAt:"2026-10-08T12:00:01.000Z",
      program:{
        irVersion:"0.1",objective:"security regression",assumptions:[],inputs:{},
        nodes:[{id:"decision",kind:"Decision",operation:"boolean.and",inputs:{values:{literal:{type:{kind:"array",items:{kind:"boolean"}},value:[true]}}}}],
        constraints:[],decisionNodeId:"decision"
      },
      requirements:[],bindings:[]
    },
    snapshotId:"snapshot:"+H("2"),
    snapshotHash:H("2"),
    createdAt:"2026-10-08T12:00:02.000Z"
  };
}

test("distributed job terminalization accepts a signed runtime DENIED execution and rejects only partial proof references",async()=>{
  const phase2:any=await import("../src/index.ts");
  const dir=mkdtempSync(join(tmpdir(),"axiom-p25a-signed-denied-")),db=join(dir,"jobs.db");
  const store:any=new phase2.DistributedExecutionStore(db);
  try{
    const created=await store.create(A,intent());
    const lease=await store.claimNext("worker:denied","2026-10-08T12:00:03.000Z",5000);
    assert.ok(lease);
    const signedDenied={
      status:"DENIED",
      snapshotId:created.intent.snapshotId,
      policyDecision:{status:"ALLOW",snapshotId:created.intent.snapshotId,checks:[]},
      certificateId:"certificate:signed-denial",
      executionRecordId:"platform:signed-denial"
    };
    const terminal=await store.complete(
      A,created.intent.jobId,"worker:denied",lease.leaseEpoch,
      "2026-10-08T12:00:03.500Z",signedDenied
    );
    assert.equal(terminal.state.status,"DENIED");
    assert.deepEqual(terminal.state.result,signedDenied);

    const created2=await store.create(A,{...intent(),requestHash:H("3"),compilationId:"model-compilation:"+H("3")});
    const lease2=await store.claimNext("worker:partial","2026-10-08T12:01:00.000Z",5000);
    assert.equal(lease2.job.intent.jobId,created2.intent.jobId);
    await assert.rejects(
      ()=>store.complete(A,created2.intent.jobId,"worker:partial",lease2.leaseEpoch,"2026-10-08T12:01:00.500Z",{
        status:"DENIED",
        snapshotId:created2.intent.snapshotId,
        policyDecision:{status:"ALLOW",snapshotId:created2.intent.snapshotId,checks:[]},
        certificateId:"certificate:partial"
      }),
      /certificate|execution record|proof|result/i
    );
  }finally{
    store.close();
    rmSync(dir,{recursive:true,force:true});
  }
});

test("distributed worker resamples trusted time before terminalization and cannot complete after its lease expires",async()=>{
  const phase2:any=await import("../src/index.ts");
  const dir=mkdtempSync(join(tmpdir(),"axiom-p25a-worker-expiry-")),db=join(dir,"jobs.db");
  const jobs:any=new phase2.DistributedExecutionStore(db);
  try{
    const created=await jobs.create(A,intent());
    const times=[
      "2026-10-08T12:00:03.000Z",
      "2026-10-08T12:00:04.100Z"
    ];
    const worker=new phase2.DistributedModelExecutionWorker({
      jobs,
      leaseMs:1000,
      clock:()=>{
        const next=times.shift();
        if(!next)throw new Error("worker clock exhausted");
        return next;
      },
      runtimes:{
        create(scope:any){
          assert.deepEqual(scope,A);
          return {
            modelExecutor:{async validatePrepared(){return {};}},
            executions:{async getByIntent(){return undefined;}},
            plane:{async executeBound(){
              return {
                status:"APPROVED",
                snapshotId:created.intent.snapshotId,
                policyDecision:{status:"ALLOW",snapshotId:created.intent.snapshotId,checks:[]},
                certificateId:"certificate:late",
                executionRecordId:"platform:late"
              };
            }}
          };
        }
      }
    });

    const outcome=await worker.runOnce("worker:slow");
    assert.deepEqual(outcome,{status:"LEASE_LOST",jobId:created.intent.jobId});

    const expired=await jobs.get(A,created.intent.jobId);
    assert.equal(expired.state.status,"LEASED");
    assert.equal(expired.state.leaseEpoch,1);
    assert.equal(expired.state.leaseOwner,"worker:slow");

    const reclaimed=await jobs.claimNext("worker:new","2026-10-08T12:00:04.100Z",1000);
    assert.ok(reclaimed);
    assert.equal(reclaimed.leaseEpoch,2);
    assert.equal(reclaimed.job.state.attemptCount,2);
  }finally{
    jobs.close();
    rmSync(dir,{recursive:true,force:true});
  }
});
