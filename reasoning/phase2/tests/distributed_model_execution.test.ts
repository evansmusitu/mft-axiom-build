import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { sign } from "node:crypto";
import {
  compileProgram, compilerManifest, createDefaultRegistry, createSigner, hashJson
} from "../../phase1/src/index.ts";

const A={tenantId:"tenant:distributed-model"};
const H=(c:string)=>c.repeat(64);
function workerClock(...times:string[]){
  let index=0;
  return ()=>{
    const value=times[Math.min(index,times.length-1)];
    index++;
    if(!value)throw new Error("worker clock has no timestamp");
    return value;
  };
}

function profile(overrides:any={}){
  return {
    profileId:"profile:distributed",version:"1.0.0",adapterId:"model:test",
    allowedOperationIds:["comparison.lte"],maxRepairAttempts:2,maxInputs:4,maxNodes:8,
    maxConstraints:4,maxAssumptions:4,maxObjectiveBytes:2048,maxModelResponseBytes:4096,...overrides
  };
}
function compileRequest(){
  return {
    profileId:"profile:distributed",
    objective:"Approve only when observed risk is within maximum",
    inputContracts:[
      {inputName:"observed",type:{kind:"number",unit:"ratio"},entity:"risk:dist",attribute:"current",requirementId:"current",maxAgeMs:60000},
      {inputName:"maximum",type:{kind:"number",unit:"ratio"},entity:"risk:dist",attribute:"maximum",requirementId:"maximum",maxAgeMs:60000}
    ]
  };
}
function proposal(){
  return {
    assumptions:["Trusted values arrive only from frozen world state"],
    nodes:[{id:"decision",kind:"Decision",operation:"comparison.lte",inputs:{left:{input:"observed"},right:{input:"maximum"}}}],
    constraints:[],decisionNodeId:"decision"
  };
}
function timing(){return {asOf:"2026-10-08T14:00:00.000Z",issuedAt:"2026-10-08T14:00:01.000Z"};}
function context(compilationId:string,action:any="model:dispatch"){
  return {
    principal:{principalId:"principal:dispatcher",issuer:"issuer:test",subject:"subject:test"},
    credential:{issuer:"issuer:test",subject:"subject:test",keyId:"kid",jwtId:"jti",issuedAt:"2026-10-08T13:59:00.000Z",expiresAt:"2026-10-08T15:00:00.000Z",tokenHash:H("1")},
    tenant:A,
    authorization:{
      status:"ALLOW",principalId:"principal:dispatcher",requestedTenantId:A.tenantId,action,
      resource:{kind:"model_compilation",id:compilationId},matchedGrantIds:["grant:dispatch"],
      policyManifest:{id:"axiom.api-authorization",version:"1.0.0",implementationHash:H("2"),grantsHash:H("3")},
      decisionHash:H("4")
    }
  };
}
function rehash(record:any){
  const core={...record};delete core.recordHash;record.recordHash=hashJson(core);return record;
}
async function fixture(){
  const phase2:any=await import("../src/index.ts");
  const registry=createDefaultRegistry(),p=profile();
  const profiles=new phase2.ModelCompilerRegistry(registry,[{profile:p,tenantIds:[A.tenantId]}]);
  const resolved=profiles.resolve(A,p.profileId),req=compileRequest();
  const program=compileProgram(phase2.assembleModelProgram(req,proposal(),p),registry);
  const compilationId="model-compilation:"+H("8");
  const core:any={
    compilationId,tenantId:A.tenantId,principalId:"principal:compiler",authorizationDecisionHash:H("5"),
    compilationRequestHash:H("6"),profileId:p.profileId,profileVersion:p.version,profileHash:resolved.profileHash,
    adapterManifest:{adapterId:"model:test",version:"1.0.0",implementationHash:H("7"),provider:"fixture",modelId:"fixture-model"},
    compilerManifest:compilerManifest(),operationRegistryManifestHash:hashJson(registry.manifest()),
    objective:req.objective,inputContracts:phase2.canonicalModelInputContracts(req.inputContracts,p),
    exchangeArtifactIds:["model-artifact:"+H("a")],exchangeArtifactHashes:[H("b")],
    finalIssues:[],status:"VALIDATED",compiledProgram:program,compiledProgramHash:hashJson(program),
    createdAt:"2026-10-08T13:58:00.000Z"
  };
  const record=rehash(core);
  const gets:any[]=[];
  const repository={
    gets,
    async getCompilation(scope:any,id:string){
      gets.push({scope:structuredClone(scope),id});
      if(scope.tenantId!==A.tenantId)throw new Error(`Model compilation not found for tenant ${scope.tenantId}: ${id}`);
      return structuredClone(record);
    },
    async commitCompilation(){throw new Error("unused");},
    async getModelArtifact(){throw new Error("unused");}
  };
  return {phase2,registry,p,profiles,record,repository};
}
async function putWorld(world:any){
  await world.putFact(A,{
    id:"fact:observed",entity:"risk:dist",attribute:"current",
    value:{type:{kind:"number",unit:"ratio"},value:0.2},
    validFrom:"2026-10-08T13:00:00.000Z",observedAt:"2026-10-08T13:59:30.000Z",source:"risk-engine:trusted"
  });
  await world.putFact(A,{
    id:"fact:maximum",entity:"risk:dist",attribute:"maximum",
    value:{type:{kind:"number",unit:"ratio"},value:0.3},
    validFrom:"2026-10-08T13:00:00.000Z",observedAt:"2026-10-08T13:59:31.000Z",source:"risk-policy:trusted"
  });
}

test("distributed model execution surface requires exact dispatch authority and freezes prepared identity",async()=>{
  const f=await fixture();
  assert.equal(typeof f.phase2.ModelDispatchService,"function");
  assert.equal(typeof f.phase2.DistributedModelExecutionWorker,"function");
  const dir=mkdtempSync(join(tmpdir(),"axiom-p25a-dispatch-auth-")),db=join(dir,"platform.db");
  const world=new f.phase2.WorldStateStore(db),jobs=new f.phase2.DistributedExecutionStore(db);
  try{
    await putWorld(world);
    const modelExecutor=new f.phase2.ModelExecutionService({repository:f.repository,profiles:f.profiles,registry:f.registry,plane:{execute(){throw new Error("unused");}}});
    assert.equal(typeof modelExecutor.prepareDispatch,"function");
    assert.equal(typeof modelExecutor.validatePrepared,"function");
    const dispatcher=new f.phase2.ModelDispatchService({modelExecutor,world,jobs});

    await assert.rejects(
      ()=>dispatcher.dispatch(context(f.record.compilationId,"model:execute"),f.record.compilationId,timing(),H("c"),"2026-10-08T14:00:02.000Z"),
      /model:dispatch|authorize|context/i
    );
    assert.equal(f.repository.gets.length,0);

    const queued=await dispatcher.dispatch(context(f.record.compilationId),f.record.compilationId,timing(),H("c"),"2026-10-08T14:00:02.000Z");
    assert.equal(queued.status,"QUEUED");
    assert.match(queued.jobId,/^execution-job:[0-9a-f]{64}$/);
    assert.match(queued.snapshotId,/^snapshot:[0-9a-f]{64}$/);

    const job=await jobs.get(A,queued.jobId);
    assert.equal(job.intent.compilationId,f.record.compilationId);
    assert.equal(job.intent.compilationRecordHash,f.record.recordHash);
    assert.equal(job.intent.profileHash,f.record.profileHash);
    assert.deepEqual(job.intent.compilerManifest,f.record.compilerManifest);
    assert.equal(job.intent.operationRegistryManifestHash,f.record.operationRegistryManifestHash);
    assert.deepEqual({asOf:job.intent.executionRequest.asOf,issuedAt:job.intent.executionRequest.issuedAt},timing());
    assert.equal(job.intent.snapshotId,queued.snapshotId);
    assert.match(job.intent.snapshotHash,/^[0-9a-f]{64}$/);
  }finally{
    world.close();jobs.close();rmSync(dir,{recursive:true,force:true});
  }
});

test("trusted worker executes only the frozen snapshot and never uses provider acquisition or explanation surfaces",async()=>{
  const f=await fixture();
  const dir=mkdtempSync(join(tmpdir(),"axiom-p25a-worker-")),db=join(dir,"platform.db");
  const world=new f.phase2.WorldStateStore(db),executions=new f.phase2.ExecutionStore(db),jobs=new f.phase2.DistributedExecutionStore(db);
  try{
    await putWorld(world);
    const modelExecutor=new f.phase2.ModelExecutionService({repository:f.repository,profiles:f.profiles,registry:f.registry,plane:{execute(){throw new Error("unused");}}});
    const dispatcher=new f.phase2.ModelDispatchService({modelExecutor,world,jobs});
    const queued=await dispatcher.dispatch(context(f.record.compilationId),f.record.compilationId,timing(),H("d"),"2026-10-08T14:00:02.000Z");

    await world.putFact(A,{
      id:"fact:late-conflict",entity:"risk:dist",attribute:"current",
      value:{type:{kind:"number",unit:"ratio"},value:0.9},
      validFrom:"2026-10-08T13:00:00.000Z",observedAt:"2026-10-08T13:59:59.000Z",source:"risk-engine:late"
    });

    const signer=f.phase2.createStaticSignerProvider("key:distributed",createSigner());
    let runtimeCreates=0;
    const runtimes={create(scope:any){
      runtimeCreates++;
      assert.deepEqual(scope,A);
      const plane=new f.phase2.ReasoningControlPlane({tenant:scope,world,executions,signer,registry:f.registry});
      const validator=new f.phase2.ModelExecutionService({repository:f.repository,profiles:f.profiles,registry:f.registry,plane});
      return {
        modelExecutor:validator,executions,plane,
        modelCompiler:{compile(){throw new Error("worker must not compile or call model provider");}},
        acquisitions:{acquire(){throw new Error("worker must not acquire external evidence");}},
        modelExplainer:{explain(){throw new Error("worker must not call explanation provider");}}
      };
    }};
    const worker=new f.phase2.DistributedModelExecutionWorker({jobs,runtimes,leaseMs:5000,clock:workerClock("2026-10-08T14:00:03.000Z","2026-10-08T14:00:03.100Z")});
    const outcome=await worker.runOnce("worker:one");
    assert.equal(outcome.status,"COMPLETED");
    assert.equal(outcome.jobId,queued.jobId);

    const job=await jobs.get(A,queued.jobId);
    assert.equal(job.state.status,"SUCCEEDED");
    assert.equal(job.state.attemptCount,1);
    assert.equal(runtimeCreates,1);
    const stored=await executions.getByIntent(A,queued.jobId);
    assert.ok(stored);
    assert.equal(stored.snapshotId,queued.snapshotId);
    assert.deepEqual(stored.bindings.map((x:any)=>x.factId).sort(),["fact:maximum","fact:observed"]);
    const plane=new f.phase2.ReasoningControlPlane({tenant:A,world,executions,signer,registry:f.registry});
    assert.deepEqual(await plane.replayStored(stored.id),{status:"MATCH",diagnostics:[]});
  }finally{
    world.close();executions.close();jobs.close();rmSync(dir,{recursive:true,force:true});
  }
});

test("worker maps trusted runtime drift to STALE and snapshot corruption to FAILED_INTEGRITY",async()=>{
  const f=await fixture();
  for(const mode of ["stale","integrity"] as const){
    const dir=mkdtempSync(join(tmpdir(),`axiom-p25a-${mode}-`)),db=join(dir,"platform.db");
    const world=new f.phase2.WorldStateStore(db),executions=new f.phase2.ExecutionStore(db),jobs=new f.phase2.DistributedExecutionStore(db);
    try{
      await putWorld(world);
      const submitExecutor=new f.phase2.ModelExecutionService({repository:f.repository,profiles:f.profiles,registry:f.registry,plane:{execute(){throw new Error("unused");}}});
      const queued=await new f.phase2.ModelDispatchService({modelExecutor:submitExecutor,world,jobs})
        .dispatch(context(f.record.compilationId),f.record.compilationId,timing(),mode==="stale"?H("e"):H("f"),"2026-10-08T14:00:02.000Z");

      let workerProfiles=f.profiles;
      if(mode==="stale"){
        workerProfiles=new f.phase2.ModelCompilerRegistry(f.registry,[{profile:profile({maxNodes:9}),tenantIds:[A.tenantId]}]);
      }else{
        world.close();
        const raw=new DatabaseSync(db);
        const row=raw.prepare("SELECT snapshot_json FROM world_snapshots WHERE tenant_id=? AND snapshot_id=?").get(A.tenantId,queued.snapshotId) as any;
        const snapshot=JSON.parse(String(row.snapshot_json));snapshot.facts[0].source="tampered";
        raw.prepare("UPDATE world_snapshots SET snapshot_json=? WHERE tenant_id=? AND snapshot_id=?").run(JSON.stringify(snapshot),A.tenantId,queued.snapshotId);
        raw.close();
      }

      const signer=f.phase2.createStaticSignerProvider("key:dist-failure",createSigner());
      const runtimes={create(scope:any){
        const activeWorld=mode==="integrity"?new f.phase2.WorldStateStore(db):world;
        const plane=new f.phase2.ReasoningControlPlane({tenant:scope,world:activeWorld,executions,signer,registry:f.registry});
        const modelExecutor=new f.phase2.ModelExecutionService({repository:f.repository,profiles:workerProfiles,registry:f.registry,plane});
        return {modelExecutor,executions,plane,__world:activeWorld};
      }};
      const worker=new f.phase2.DistributedModelExecutionWorker({jobs,runtimes,leaseMs:5000,clock:workerClock("2026-10-08T14:00:03.000Z","2026-10-08T14:00:03.100Z")});
      const outcome=await worker.runOnce("worker:failure");
      assert.equal(outcome.status,"TERMINAL");
      const job=await jobs.get(A,queued.jobId);
      assert.equal(job.state.status,mode==="stale"?"STALE":"FAILED_INTEGRITY");
      if(mode==="integrity"){
        const created=(runtimes as any).last;
      }
    }finally{
      try{world.close();}catch{}
      executions.close();jobs.close();rmSync(dir,{recursive:true,force:true});
    }
  }
});

test("worker releases transient failures and recovers a crash after execution persistence without creating a second execution",async()=>{
  const f=await fixture();
  const dir=mkdtempSync(join(tmpdir(),"axiom-p25a-crash-")),db=join(dir,"platform.db");
  const world=new f.phase2.WorldStateStore(db),executions=new f.phase2.ExecutionStore(db),baseJobs=new f.phase2.DistributedExecutionStore(db);
  try{
    await putWorld(world);
    const submitExecutor=new f.phase2.ModelExecutionService({repository:f.repository,profiles:f.profiles,registry:f.registry,plane:{execute(){throw new Error("unused");}}});
    const dispatcher=new f.phase2.ModelDispatchService({modelExecutor:submitExecutor,world,jobs:baseJobs});

    const transient=await dispatcher.dispatch(context(f.record.compilationId),f.record.compilationId,timing(),H("9"),"2026-10-08T14:00:02.000Z");
    const transientRuntimes={create(scope:any){
      return {
        modelExecutor:new f.phase2.ModelExecutionService({repository:f.repository,profiles:f.profiles,registry:f.registry,plane:{execute(){throw new Error("unused");}}}),
        executions,
        plane:{async executeBound(){throw new Error("transient database outage");}}
      };
    }};
    const transientWorker=new f.phase2.DistributedModelExecutionWorker({jobs:baseJobs,runtimes:transientRuntimes,leaseMs:5000,clock:workerClock("2026-10-08T14:00:03.000Z","2026-10-08T14:00:03.100Z")});
    const transientOutcome=await transientWorker.runOnce("worker:transient");
    assert.equal(transientOutcome.status,"RETRY");
    assert.equal((await baseJobs.get(A,transient.jobId)).state.status,"PENDING");

    await baseJobs.failTerminal; // keep interface exercised without mutating the pending job

    const crashTiming={asOf:"2026-10-08T14:00:00.000Z",issuedAt:"2026-10-08T14:00:02.000Z"};
    const crash=await dispatcher.dispatch(context(f.record.compilationId),f.record.compilationId,crashTiming,H("0"),"2026-10-08T14:00:04.000Z");
    const signer=f.phase2.createStaticSignerProvider("key:dist-crash",createSigner());
    const runtimes={create(scope:any){
      const plane=new f.phase2.ReasoningControlPlane({tenant:scope,world,executions,signer,registry:f.registry});
      return {
        modelExecutor:new f.phase2.ModelExecutionService({repository:f.repository,profiles:f.profiles,registry:f.registry,plane}),
        executions,plane
      };
    }};

    let failComplete=true;
    const crashJobs:any={
      create:(...args:any[])=>baseJobs.create(...args),
      get:(...args:any[])=>baseJobs.get(...args),
      claimNext:(...args:any[])=>baseJobs.claimNext(...args),
      heartbeat:(...args:any[])=>baseJobs.heartbeat(...args),
      releaseForRetry:(...args:any[])=>baseJobs.releaseForRetry(...args),
      failTerminal:(...args:any[])=>baseJobs.failTerminal(...args),
      async complete(...args:any[]){
        if(failComplete){failComplete=false;throw new Error("simulated crash after durable execution");}
        return baseJobs.complete(...args);
      }
    };

    // The older transient job is still pending; terminalize it so the crash job is the next claim.
    const oldLease=await baseJobs.claimNext("worker:cleanup","2026-10-08T14:00:04.100Z",5000);
    assert.equal(oldLease.job.intent.jobId,transient.jobId);
    await baseJobs.failTerminal(A,transient.jobId,"worker:cleanup",oldLease.leaseEpoch,"2026-10-08T14:00:04.200Z","FAILED_INTEGRITY");

    const worker1=new f.phase2.DistributedModelExecutionWorker({jobs:crashJobs,runtimes,leaseMs:5000,clock:workerClock("2026-10-08T14:00:05.000Z","2026-10-08T14:00:05.100Z","2026-10-08T14:00:05.200Z")});
    const first=await worker1.runOnce("worker:crash");
    assert.equal(first.status,"RETRY");
    assert.equal((await baseJobs.get(A,crash.jobId)).state.status,"PENDING");
    assert.ok(await executions.getByIntent(A,crash.jobId));

    const raw=new DatabaseSync(db);
    assert.equal(Number((raw.prepare("SELECT COUNT(*) AS n FROM platform_executions WHERE tenant_id=?").get(A.tenantId) as any).n),1);
    assert.equal(Number((raw.prepare("SELECT COUNT(*) AS n FROM execution_intents WHERE tenant_id=?").get(A.tenantId) as any).n),1);
    raw.close();

    const worker2=new f.phase2.DistributedModelExecutionWorker({jobs:crashJobs,runtimes,leaseMs:5000,clock:workerClock("2026-10-08T14:00:06.000Z","2026-10-08T14:00:06.100Z")});
    const second=await worker2.runOnce("worker:recovery");
    assert.equal(second.status,"COMPLETED");
    const recovered=await baseJobs.get(A,crash.jobId);
    assert.equal(recovered.state.status,"SUCCEEDED");
    assert.equal(recovered.state.attemptCount,2);

    const raw2=new DatabaseSync(db);
    assert.equal(Number((raw2.prepare("SELECT COUNT(*) AS n FROM platform_executions WHERE tenant_id=?").get(A.tenantId) as any).n),1);
    assert.equal(Number((raw2.prepare("SELECT COUNT(*) AS n FROM execution_intents WHERE tenant_id=?").get(A.tenantId) as any).n),1);
    raw2.close();
  }finally{
    world.close();executions.close();baseJobs.close();rmSync(dir,{recursive:true,force:true});
  }
});


test("distributed retry repeats the identical external signing intent after a lost signer response",async()=>{
  const f=await fixture();
  const dir=mkdtempSync(join(tmpdir(),"axiom-p25b-signer-retry-")),db=join(dir,"platform.db");
  const world=new f.phase2.WorldStateStore(db),executions=new f.phase2.ExecutionStore(db),jobs=new f.phase2.DistributedExecutionStore(db);
  try{
    await putWorld(world);
    const submitExecutor=new f.phase2.ModelExecutionService({
      repository:f.repository,profiles:f.profiles,registry:f.registry,plane:{execute(){throw new Error("unused");}}
    });
    const queued=await new f.phase2.ModelDispatchService({modelExecutor:submitExecutor,world,jobs})
      .dispatch(context(f.record.compilationId),f.record.compilationId,timing(),H("6"),"2026-10-08T14:00:02.000Z");

    const remote=createSigner(),calls:any[]=[];
    let loseFirst=true;
    const signer=f.phase2.createExternalEd25519SignerProvider({
      providerId:"kms:distributed-test",activeKeyId:"key:kms:distributed:v1",activePublicKey:remote.publicKey,
      trustedKeys:{"key:kms:distributed:v1":remote.publicKey},
      backend:{async sign(request:any){
        calls.push(structuredClone(request));
        const signatureBase64=sign(null,Buffer.from(request.payloadBase64,"base64"),remote.privateKey).toString("base64");
        if(loseFirst){loseFirst=false;throw new Error("simulated lost signer response");}
        return {
          protocolVersion:request.protocolVersion,keyId:request.keyId,algorithm:request.algorithm,
          signingIntentId:request.signingIntentId,payloadHash:request.payloadHash,signatureBase64
        };
      }}
    });
    const runtimes={create(scope:any){
      const plane=new f.phase2.ReasoningControlPlane({tenant:scope,world,executions,signer,registry:f.registry});
      return {
        modelExecutor:new f.phase2.ModelExecutionService({repository:f.repository,profiles:f.profiles,registry:f.registry,plane}),
        executions,plane
      };
    }};

    const firstWorker=new f.phase2.DistributedModelExecutionWorker({
      jobs,runtimes,leaseMs:5000,clock:workerClock("2026-10-08T14:00:03.000Z","2026-10-08T14:00:03.100Z")
    });
    assert.deepEqual(await firstWorker.runOnce("worker:signer-loss"),{status:"RETRY",jobId:queued.jobId});
    assert.equal((await jobs.get(A,queued.jobId)).state.status,"PENDING");
    assert.equal(await executions.getByIntent(A,queued.jobId),undefined);

    const secondWorker=new f.phase2.DistributedModelExecutionWorker({
      jobs,runtimes,leaseMs:5000,clock:workerClock("2026-10-08T14:00:04.000Z","2026-10-08T14:00:04.100Z")
    });
    const second=await secondWorker.runOnce("worker:signer-retry");
    assert.equal(second.status,"COMPLETED");
    assert.equal(calls.length,2);
    assert.deepEqual(calls[1],calls[0]);
    assert.match(calls[0].signingIntentId,/^[0-9a-f]{64}$/);

    const stored=await executions.getByIntent(A,queued.jobId);
    assert.ok(stored);
    assert.equal(stored.signingIntentId,calls[0].signingIntentId);
    assert.deepEqual(await new f.phase2.ReasoningControlPlane({tenant:A,world,executions,signer,registry:f.registry}).replayStored(stored.id),{
      status:"MATCH",diagnostics:[]
    });

    const raw=new DatabaseSync(db);
    assert.equal(Number((raw.prepare("SELECT COUNT(*) AS n FROM platform_executions WHERE tenant_id=?").get(A.tenantId) as any).n),1);
    assert.equal(Number((raw.prepare("SELECT COUNT(*) AS n FROM execution_intents WHERE tenant_id=?").get(A.tenantId) as any).n),1);
    raw.close();
  }finally{
    world.close();executions.close();jobs.close();rmSync(dir,{recursive:true,force:true});
  }
});
