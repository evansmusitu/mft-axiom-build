import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { hashJson } from "../../phase1/src/index.ts";

const A={tenantId:"tenant:jobs:a"},B={tenantId:"tenant:jobs:b"};
const H=(ch:string)=>ch.repeat(64);

function intentCore(overrides:Record<string,unknown>={}){
  return {
    tenantId:A.tenantId,
    principalId:"principal:dispatch",
    authorizationDecisionHash:H("a"),
    requestHash:H("b"),
    compilationId:"model-compilation:"+H("c"),
    compilationRecordHash:H("d"),
    profileId:"profile:distributed",
    profileVersion:"1.0.0",
    profileHash:H("e"),
    compilerManifest:{id:"axiom.phase1-compiler",version:"1.0.0",implementationHash:H("f")},
    operationRegistryManifestHash:H("1"),
    executionRequest:{
      asOf:"2026-10-08T12:00:00.000Z",
      issuedAt:"2026-10-08T12:00:01.000Z",
      program:{
        irVersion:"0.1",objective:"fixture",assumptions:[],
        inputs:{},nodes:[{id:"decision",kind:"Decision",operation:"boolean.and",inputs:{values:{literal:{type:{kind:"array",items:{kind:"boolean"}},value:[true]}}}}],
        constraints:[],decisionNodeId:"decision"
      },
      requirements:[],bindings:[]
    },
    snapshotId:"snapshot:"+H("2"),
    snapshotHash:H("2"),
    createdAt:"2026-10-08T12:00:02.000Z",
    ...overrides
  };
}

test("SQLite distributed execution store fences leases and preserves immutable terminal state",async()=>{
  const phase2:any=await import("../src/index.ts");
  assert.equal(typeof phase2.DistributedExecutionStore,"function");
  const dir=mkdtempSync(join(tmpdir(),"axiom-p25a-jobs-")),db=join(dir,"jobs.db");
  const store:any=new phase2.DistributedExecutionStore(db);
  try{
    const created=await store.create(A,intentCore());
    assert.equal(created.intent.tenantId,A.tenantId);
    assert.match(created.intent.jobId,/^execution-job:[0-9a-f]{64}$/);
    assert.match(created.intent.intentHash,/^[0-9a-f]{64}$/);
    assert.equal(created.state.status,"PENDING");
    assert.equal(created.state.leaseEpoch,0);
    assert.equal(created.state.attemptCount,0);
    assert.match(created.state.stateHash,/^[0-9a-f]{64}$/);
    assert.deepEqual(await store.get(A,created.intent.jobId),created);
    await assert.rejects(()=>store.get(B,created.intent.jobId),/not found.*tenant/i);

    const lease1=await store.claimNext("worker:a","2026-10-08T12:00:03.000Z",1000);
    assert.ok(lease1);
    assert.equal(lease1.job.intent.jobId,created.intent.jobId);
    assert.equal(lease1.workerId,"worker:a");
    assert.equal(lease1.leaseEpoch,1);
    assert.equal(lease1.job.state.attemptCount,1);
    assert.equal(lease1.leaseExpiresAt,"2026-10-08T12:00:04.000Z");
    assert.equal(await store.claimNext("worker:b","2026-10-08T12:00:03.500Z",1000),undefined);

    const heart=await store.heartbeat(A,created.intent.jobId,"worker:a",1,"2026-10-08T12:00:03.500Z",2000);
    assert.equal(heart.leaseExpiresAt,"2026-10-08T12:00:05.500Z");
    await assert.rejects(()=>store.heartbeat(A,created.intent.jobId,"worker:b",1,"2026-10-08T12:00:04.000Z",1000),/stale lease/i);

    const lease2=await store.claimNext("worker:b","2026-10-08T12:00:05.500Z",1000);
    assert.ok(lease2);
    assert.equal(lease2.leaseEpoch,2);
    assert.equal(lease2.job.state.attemptCount,2);
    await assert.rejects(()=>store.releaseForRetry(A,created.intent.jobId,"worker:a",1,"2026-10-08T12:00:05.600Z"),/stale lease/i);
    await assert.rejects(
      ()=>store.complete(A,created.intent.jobId,"worker:a",1,"2026-10-08T12:00:05.600Z",{
        status:"APPROVED",snapshotId:created.intent.snapshotId,policyDecision:{status:"ALLOW",snapshotId:created.intent.snapshotId,checks:[]},
        certificateId:"cert:old",executionRecordId:"platform:old"
      }),
      /stale lease/i
    );

    const result={
      status:"APPROVED",snapshotId:created.intent.snapshotId,
      policyDecision:{status:"ALLOW",snapshotId:created.intent.snapshotId,checks:[]},
      certificateId:"cert:new",executionRecordId:"platform:new"
    };
    const completed=await store.complete(A,created.intent.jobId,"worker:b",2,"2026-10-08T12:00:06.000Z",result);
    assert.equal(completed.state.status,"SUCCEEDED");
    assert.deepEqual(completed.state.result,result);
    assert.equal(completed.state.resultHash,hashJson(result as any));
    await assert.rejects(()=>store.complete(A,created.intent.jobId,"worker:b",2,"2026-10-08T12:00:06.100Z",result),/terminal|stale lease/i);
    assert.equal(await store.claimNext("worker:c","2026-10-08T12:00:10.000Z",1000),undefined);
  }finally{
    store.close();
    rmSync(dir,{recursive:true,force:true});
  }
});

test("SQLite distributed execution store supports fenced retry release denial and terminal integrity failure",async()=>{
  const phase2:any=await import("../src/index.ts");
  assert.equal(typeof phase2.DistributedExecutionStore,"function");
  const dir=mkdtempSync(join(tmpdir(),"axiom-p25a-job-transitions-")),db=join(dir,"jobs.db");
  const store:any=new phase2.DistributedExecutionStore(db);
  try{
    const retryJob=await store.create(A,intentCore({requestHash:H("3")}));
    const lease=await store.claimNext("worker:retry","2026-10-08T12:01:00.000Z",1000);
    assert.equal(lease.job.intent.jobId,retryJob.intent.jobId);
    const released=await store.releaseForRetry(A,retryJob.intent.jobId,"worker:retry",1,"2026-10-08T12:01:00.500Z");
    assert.equal(released.state.status,"PENDING");
    assert.equal(released.state.leaseEpoch,1);
    assert.equal(released.state.attemptCount,1);
    const reclaimed=await store.claimNext("worker:retry2","2026-10-08T12:01:00.600Z",1000);
    assert.equal(reclaimed.leaseEpoch,2);

    const deniedResult={
      status:"DENIED",snapshotId:retryJob.intent.snapshotId,
      policyDecision:{status:"DENY",snapshotId:retryJob.intent.snapshotId,checks:[{requirementId:"r",ok:false,code:"MISSING_EVIDENCE",factIds:[],message:"missing"}]}
    };
    const denied=await store.complete(A,retryJob.intent.jobId,"worker:retry2",2,"2026-10-08T12:01:01.000Z",deniedResult);
    assert.equal(denied.state.status,"DENIED");

    const failedJob=await store.create(A,intentCore({requestHash:H("4"),compilationId:"model-compilation:"+H("4")}));
    const failedLease=await store.claimNext("worker:integrity","2026-10-08T12:02:00.000Z",1000);
    assert.equal(failedLease.job.intent.jobId,failedJob.intent.jobId);
    const failed=await store.failTerminal(A,failedJob.intent.jobId,"worker:integrity",1,"2026-10-08T12:02:00.500Z","FAILED_INTEGRITY");
    assert.equal(failed.state.status,"FAILED_INTEGRITY");
    assert.equal(failed.state.failureCode,"FAILED_INTEGRITY");

    const staleJob=await store.create(A,intentCore({requestHash:H("5"),compilationId:"model-compilation:"+H("5")}));
    const staleLease=await store.claimNext("worker:stale","2026-10-08T12:03:00.000Z",1000);
    const stale=await store.failTerminal(A,staleJob.intent.jobId,"worker:stale",staleLease.leaseEpoch,"2026-10-08T12:03:00.500Z","STALE");
    assert.equal(stale.state.status,"STALE");
    assert.equal(stale.state.failureCode,"STALE");
  }finally{
    store.close();
    rmSync(dir,{recursive:true,force:true});
  }
});

test("SQLite distributed execution store detects persisted intent and state tampering",async()=>{
  const phase2:any=await import("../src/index.ts");
  assert.equal(typeof phase2.DistributedExecutionStore,"function");
  const dir=mkdtempSync(join(tmpdir(),"axiom-p25a-job-tamper-")),db=join(dir,"jobs.db");
  let store:any=new phase2.DistributedExecutionStore(db);
  try{
    const created=await store.create(A,intentCore());
    store.close();
    const raw=new DatabaseSync(db);
    raw.prepare("UPDATE distributed_execution_jobs SET intent_json=? WHERE job_id=?")
      .run(JSON.stringify({...created.intent,principalId:"principal:attacker"}),created.intent.jobId);
    raw.close();
    store=new phase2.DistributedExecutionStore(db);
    await assert.rejects(()=>store.get(A,created.intent.jobId),/intent.*integrity|integrity.*intent/i);
    store.close();

    const db2=join(dir,"jobs-state.db");
    store=new phase2.DistributedExecutionStore(db2);
    const stateJob=await store.create(A,intentCore());
    store.close();
    const raw2=new DatabaseSync(db2);
    raw2.prepare("UPDATE distributed_execution_jobs SET attempt_count=99 WHERE job_id=?").run(stateJob.intent.jobId);
    raw2.close();
    store=new phase2.DistributedExecutionStore(db2);
    await assert.rejects(()=>store.get(A,stateJob.intent.jobId),/state.*integrity|integrity.*state/i);
  }finally{
    try{store.close();}catch{}
    rmSync(dir,{recursive:true,force:true});
  }
});
