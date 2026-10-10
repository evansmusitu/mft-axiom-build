import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDefaultRegistry, createSigner, hashJson } from "../../phase1/src/index.ts";
import {
  AxiomApiService, DeterministicAuthorizer, DistributedExecutionStore,
  DistributedModelExecutionWorker, ExecutionStore, HttpStructuredModelAdapter,
  ModelCompilationService, ModelCompilationStore, ModelCompilerRegistry,
  ModelDispatchService, ModelExecutionService, ReasoningControlPlane, SecurityStore,
  StaticSecretResolver, WorldStateStore, createAuthorizedTenantContext,
  createAxiomHttpServer, createStaticSignerProvider,
  type ApiAction, type ApiResource, type ModelCompilerProfile, type TenantScope
} from "../src/index.ts";

const AS_OF="2026-10-08T14:00:00.000Z";
const ISSUED="2026-10-08T14:00:01.000Z";
const DISPATCHED_AT="2026-10-08T14:00:02.000Z";
const tenantA={tenantId:"tenant:phase25a-gate"};
const tenantB={tenantId:"tenant:phase25a-other"};
const H=(c:string)=>c.repeat(64);
const providerSecret="phase25a-compile-only-secret";
function workerClock(...times:string[]){
  let index=0;
  return ()=>{
    const value=times[Math.min(index,times.length-1)];
    index++;
    if(!value)throw new Error("worker clock has no timestamp");
    return value;
  };
}

async function listen(server:any):Promise<number>{
  await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",()=>resolve());});
  const address=server.address();assert.ok(address&&typeof address==="object");return address.port;
}
async function close(server:any):Promise<void>{await new Promise<void>(resolve=>server.close(()=>resolve()));}

const profile:ModelCompilerProfile={
  profileId:"profile:phase25a",version:"1.0.0",adapterId:"model:http:phase25a",
  allowedOperationIds:["comparison.lte"],maxRepairAttempts:0,maxInputs:4,maxNodes:8,
  maxConstraints:4,maxAssumptions:4,maxObjectiveBytes:2048,maxModelResponseBytes:8192
};
const inputContracts=[
  {inputName:"observed",type:{kind:"number" as const,unit:"ratio"},entity:"risk:phase25a",attribute:"current",requirementId:"observed-risk",maxAgeMs:10*60*1000},
  {inputName:"maximum",type:{kind:"number" as const,unit:"ratio"},entity:"risk:phase25a",attribute:"maximum",requirementId:"maximum-risk",maxAgeMs:10*60*1000}
];
const proposal={
  assumptions:["Frozen tenant evidence remains authoritative for this distributed intent"],
  nodes:[{id:"decision",kind:"Decision",operation:"comparison.lte",inputs:{left:{input:"observed"},right:{input:"maximum"}}}],
  constraints:[],decisionNodeId:"decision"
};

const dir=mkdtempSync(join(tmpdir(),"axiom-phase25a-gate-")),db=join(dir,"platform.db");
const world=new WorldStateStore(db);
const executions=new ExecutionStore(db);
const jobs=new DistributedExecutionStore(db);
const security=new SecurityStore(db);
const modelStore=new ModelCompilationStore(db);
const registry=createDefaultRegistry();
const profiles=new ModelCompilerRegistry(registry,[{profile,tenantIds:[tenantA.tenantId]}]);
const signer=createStaticSignerProvider("reasoning-key:phase25a",createSigner());

let modelProviderCalls=0;
const modelAdapter=new HttpStructuredModelAdapter({
  manifest:{adapterId:profile.adapterId,version:"1.0.0",implementationHash:H("a"),provider:"fixture-provider",modelId:"fixture-model"},
  origin:"https://models.example",compilePath:"/v1/compile",repairPath:"/v1/repair",
  timeoutMs:1000,maxResponseBytes:8192,allowedStatus:[200],
  fixedHeaders:{"x-axiom-profile":"phase25a"},secretHeaders:{authorization:"secret:model"},
  secretResolver:new StaticSecretResolver({"secret:model":providerSecret}),
  fetchFn:async(_url,init)=>{
    modelProviderCalls++;
    assert.equal((init?.headers as any).authorization,providerSecret);
    assert.equal(String(init?.body??"").includes(providerSecret),false);
    return new Response(JSON.stringify({proposal}),{status:200,headers:{"content-type":"application/json"}});
  }
});
const compiler=new ModelCompilationService({
  profiles,repository:modelStore,registry,adapter:modelAdapter,
  now:()=>"2026-10-08T13:59:50.000Z"
});

const principal={principalId:"principal:phase25a",issuer:"https://issuer.axiom.example",subject:"service:phase25a"};
const authenticated={
  principal,
  credential:{
    issuer:principal.issuer,subject:principal.subject,keyId:"api-key:v1",jwtId:"jwt-phase25a",
    issuedAt:"2026-10-08T13:55:00.000Z",expiresAt:"2026-10-08T14:10:00.000Z",tokenHash:H("b")
  }
};
const authorizer=new DeterministicAuthorizer(security);
async function contextFor(action:ApiAction,resource:ApiResource){
  const target={requestedTenantId:tenantA.tenantId,action,resource};
  const decision=await authorizer.authorize(authenticated,target);
  assert.equal(decision.status,"ALLOW",`${action} grant must be configured`);
  return createAuthorizedTenantContext(authenticated,target,decision);
}

let runtimeCreates=0;
const runtimes={
  create(scope:TenantScope){
    runtimeCreates++;
    assert.equal(scope.tenantId,tenantA.tenantId,"cross-tenant denial must happen before runtime creation");
    const plane=new ReasoningControlPlane({tenant:scope,world,executions,signer,registry});
    const modelExecutor=new ModelExecutionService({repository:modelStore,profiles,registry,plane});
    return {
      modelCompiler:compiler,
      modelExecutor,
      modelDispatcher:new ModelDispatchService({modelExecutor,world,jobs}),
      executionJobs:jobs,
      modelExplainer:{async explain(){throw new Error("worker/API gate never calls explanation provider");}},
      acquisitions:{async acquire(){throw new Error("worker/API gate never calls external evidence");}},
      ingestor:{async ingest(){throw new Error("unused");}},
      executions,
      plane
    };
  }
};
const api=new AxiomApiService({
  authenticator:{async authenticate(token:string){if(token!=="phase25a-token")throw new Error("bad token");return structuredClone(authenticated);}},
  authorizer,idempotency:security,audit:security,runtimes
});
const server=createAxiomHttpServer({service:api,clock:()=>DISPATCHED_AT});

try{
  await world.putFact(tenantA,{
    id:"fact:observed:frozen",entity:"risk:phase25a",attribute:"current",
    value:{type:{kind:"number",unit:"ratio"},value:0.20},
    validFrom:"2026-10-08T13:50:00.000Z",observedAt:"2026-10-08T13:59:40.000Z",source:"risk-engine:trusted"
  });
  await world.putFact(tenantA,{
    id:"fact:maximum:frozen",entity:"risk:phase25a",attribute:"maximum",
    value:{type:{kind:"number",unit:"ratio"},value:0.30},
    validFrom:"2026-10-08T13:50:00.000Z",observedAt:"2026-10-08T13:59:41.000Z",source:"risk-policy:trusted"
  });

  for(const action of ["model:compile","model:dispatch","execution:job:read"] as const){
    await security.putGrant({grantId:`gate:${action}`,principalId:principal.principalId,tenantId:tenantA.tenantId,action});
  }

  const compileRequest={
    profileId:profile.profileId,
    objective:"Approve only when frozen observed risk is within the trusted maximum",
    inputContracts
  };
  const compileContext=await contextFor("model:compile",{kind:"model_compilation"});
  const compiled=await compiler.compile(compileContext,compileRequest,hashJson(compileRequest as any));
  assert.equal(compiled.status,"VALIDATED");
  assert.equal(modelProviderCalls,1);

  const port=await listen(server);
  const base=`http://127.0.0.1:${port}/v1/tenants/${encodeURIComponent(tenantA.tenantId)}`;
  const dispatchResponse=await fetch(
    base+`/model/compilations/${encodeURIComponent(compiled.compilationId)}/execution-jobs`,
    {
      method:"POST",
      headers:{Authorization:"Bearer phase25a-token","Content-Type":"application/json","Idempotency-Key":"idem:phase25a:dispatch"},
      body:JSON.stringify({asOf:AS_OF,issuedAt:ISSUED})
    }
  );
  assert.equal(dispatchResponse.status,202);
  const queued=await dispatchResponse.json() as any;
  assert.equal(queued.status,"QUEUED");
  assert.match(queued.jobId,/^execution-job:[0-9a-f]{64}$/);
  assert.match(queued.snapshotId,/^snapshot:[0-9a-f]{64}$/);
  const frozen=await world.getSnapshot(tenantA,queued.snapshotId);
  assert.deepEqual(frozen.facts.map(x=>x.id).sort(),["fact:maximum:frozen","fact:observed:frozen"]);

  await world.putFact(tenantA,{
    id:"fact:observed:late-conflict",entity:"risk:phase25a",attribute:"current",
    value:{type:{kind:"number",unit:"ratio"},value:0.90},
    validFrom:"2026-10-08T13:50:00.000Z",observedAt:"2026-10-08T13:59:59.000Z",source:"risk-engine:late"
  });

  const leaseA=await jobs.claimNext("worker:a","2026-10-08T14:00:03.000Z",1000);
  assert.ok(leaseA);assert.equal(leaseA.leaseEpoch,1);
  const leaseB=await jobs.claimNext("worker:b","2026-10-08T14:00:04.000Z",5000);
  assert.ok(leaseB);assert.equal(leaseB.leaseEpoch,2);
  assert.equal(leaseB.job.state.attemptCount,2);

  await assert.rejects(
    ()=>jobs.complete(tenantA,queued.jobId,"worker:a",1,"2026-10-08T14:00:04.100Z",{
      status:"APPROVED",snapshotId:queued.snapshotId,
      policyDecision:{status:"ALLOW",snapshotId:queued.snapshotId,checks:[]},
      certificateId:"stale",executionRecordId:"platform:stale"
    }),
    /stale lease/i
  );

  const workerRuntimes={
    create(scope:TenantScope){
      assert.equal(scope.tenantId,tenantA.tenantId);
      const plane=new ReasoningControlPlane({tenant:scope,world,executions,signer,registry});
      return {
        modelExecutor:new ModelExecutionService({repository:modelStore,profiles,registry,plane}),
        executions,plane
      };
    }
  };

  let returnPreclaimed=true,crashBeforeJobCompletion=true;
  const crashJobs:any={
    get:(...args:any[])=>(jobs as any).get(...args),
    create:(...args:any[])=>(jobs as any).create(...args),
    heartbeat:(...args:any[])=>(jobs as any).heartbeat(...args),
    releaseForRetry:(...args:any[])=>(jobs as any).releaseForRetry(...args),
    failTerminal:(...args:any[])=>(jobs as any).failTerminal(...args),
    async claimNext(workerId:string,_now:string,_leaseMs:number){
      if(returnPreclaimed){
        returnPreclaimed=false;
        assert.equal(workerId,"worker:b");
        return structuredClone(leaseB);
      }
      return jobs.claimNext(workerId,_now,_leaseMs);
    },
    async complete(...args:any[]){
      if(crashBeforeJobCompletion){
        crashBeforeJobCompletion=false;
        throw new Error("simulated crash after durable execution persistence");
      }
      return (jobs as any).complete(...args);
    }
  };

  const workerB=new DistributedModelExecutionWorker({jobs:crashJobs,runtimes:workerRuntimes,leaseMs:5000,clock:workerClock("2026-10-08T14:00:04.100Z","2026-10-08T14:00:04.200Z","2026-10-08T14:00:04.300Z")});
  const crashed=await workerB.runOnce("worker:b");
  assert.deepEqual(crashed,{status:"RETRY",jobId:queued.jobId});
  assert.equal((await jobs.get(tenantA,queued.jobId)).state.status,"PENDING");
  const committed=await executions.getByIntent(tenantA,queued.jobId);
  assert.ok(committed,"execution must survive the post-persistence worker crash");
  assert.equal(committed.snapshotId,queued.snapshotId);
  assert.deepEqual(committed.bindings.map(x=>x.factId).sort(),["fact:maximum:frozen","fact:observed:frozen"]);
  assert.equal(modelProviderCalls,1,"distributed worker must never call the model provider");

  const inspect=new DatabaseSync(db);
  try{
    assert.equal(Number((inspect.prepare("SELECT COUNT(*) AS n FROM platform_executions WHERE tenant_id=?").get(tenantA.tenantId) as any).n),1);
    assert.equal(Number((inspect.prepare("SELECT COUNT(*) AS n FROM execution_intents WHERE tenant_id=?").get(tenantA.tenantId) as any).n),1);
  }finally{inspect.close();}

  const workerC=new DistributedModelExecutionWorker({jobs,runtimes:workerRuntimes,leaseMs:5000,clock:workerClock("2026-10-08T14:00:05.000Z","2026-10-08T14:00:05.100Z")});
  const recovered=await workerC.runOnce("worker:c");
  assert.deepEqual(recovered,{status:"COMPLETED",jobId:queued.jobId,jobStatus:"SUCCEEDED"});
  const terminal=await jobs.get(tenantA,queued.jobId);
  assert.equal(terminal.state.status,"SUCCEEDED");
  assert.equal(terminal.state.attemptCount,3);

  const inspectAfter=new DatabaseSync(db);
  try{
    assert.equal(Number((inspectAfter.prepare("SELECT COUNT(*) AS n FROM platform_executions WHERE tenant_id=?").get(tenantA.tenantId) as any).n),1);
    assert.equal(Number((inspectAfter.prepare("SELECT COUNT(*) AS n FROM execution_intents WHERE tenant_id=?").get(tenantA.tenantId) as any).n),1);
  }finally{inspectAfter.close();}

  const replayPlane=new ReasoningControlPlane({tenant:tenantA,world,executions,signer,registry});
  assert.deepEqual(await replayPlane.replayStored(committed.id),{status:"MATCH",diagnostics:[]});

  const read=await fetch(base+`/execution-jobs/${encodeURIComponent(queued.jobId)}`,{
    headers:{Authorization:"Bearer phase25a-token"}
  });
  assert.equal(read.status,200);
  const publicJob=await read.json() as any;
  assert.equal(publicJob.jobId,queued.jobId);
  assert.equal(publicJob.status,"SUCCEEDED");
  assert.equal(publicJob.snapshotId,queued.snapshotId);
  assert.equal(publicJob.attemptCount,3);
  assert.equal(JSON.stringify(publicJob).includes("worker:"),false);
  assert.equal(JSON.stringify(publicJob).includes("profile:phase25a"),false);
  assert.equal(JSON.stringify(publicJob).includes(providerSecret),false);

  const runtimeCreatesBeforeCrossTenant=runtimeCreates;
  const crossTenant=await fetch(
    `http://127.0.0.1:${port}/v1/tenants/${encodeURIComponent(tenantB.tenantId)}/execution-jobs/${encodeURIComponent(queued.jobId)}`,
    {headers:{Authorization:"Bearer phase25a-token"}}
  );
  assert.equal(crossTenant.status,403);
  assert.equal(runtimeCreates,runtimeCreatesBeforeCrossTenant,"cross-tenant known job ID must fail before runtime/repository access");

  assert.deepEqual(await security.verifyStream(tenantA.tenantId),{status:"MATCH",diagnostics:[]});
  assert.deepEqual(await security.verifyStream(tenantB.tenantId),{status:"MATCH",diagnostics:[]});

  console.log(JSON.stringify({
    phase:"P2.5A — Fenced Distributed Model Execution",
    status:"PASS",
    checks:[
      "compile one validated immutable model program before distributed execution",
      "authorize exact model:dispatch independently from synchronous model execution",
      "freeze tenant world-state snapshot before the job becomes claimable",
      "reclaim an expired lease with a strictly higher fencing epoch",
      "reject stale lease completion after reclamation",
      "execute worker reasoning only against the frozen snapshot",
      "persist one stable execution-intent mapping before simulated worker crash",
      "release ambiguous worker infrastructure failure for deterministic retry",
      "recover the same durable execution after the crash without a second execution",
      "terminalize the recovered job under a newer fenced lease",
      "replay the resulting signed execution network-free with MATCH",
      "return only bounded public job status",
      "reject a known job ID across tenant authorization before runtime access",
      "keep model provider calls outside the distributed worker path"
    ],
    tenantId:tenantA.tenantId,
    compilationId:compiled.compilationId,
    jobId:queued.jobId,
    snapshotId:queued.snapshotId,
    executionRecordId:committed.id,
    finalLeaseEpoch:terminal.state.leaseEpoch,
    finalAttemptCount:terminal.state.attemptCount,
    modelProviderCalls
  },null,2));
}finally{
  await close(server).catch(()=>{});
  modelStore.close();security.close();jobs.close();executions.close();world.close();
  rmSync(dir,{recursive:true,force:true});
}
