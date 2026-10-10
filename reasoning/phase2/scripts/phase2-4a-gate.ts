import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDefaultRegistry, createSigner, hashJson } from "../../phase1/src/index.ts";
import {
  AxiomApiService, DeterministicAuthorizer, Ed25519JwtAuthenticator, ExecutionStore,
  HttpStructuredModelAdapter, ModelCompilationService, ModelCompilationStore,
  ModelCompilerRegistry, ModelExecutionError, ModelExecutionService, ReasoningControlPlane,
  SecurityStore, StaticSecretResolver, WorldStateStore, createAuthorizedTenantContext,
  createAxiomHttpServer, createJwtTrustStore, createStaticSignerProvider,
  type ModelCompilerProfile, type TenantScope
} from "../src/index.ts";

const NOW="2026-10-06T10:00:00.000Z";
const tenantA={tenantId:"tenant:phase24a-gate"};
const tenantB={tenantId:"tenant:phase24a-other"};
const H=(c:string)=>c.repeat(64);
const modelSecret="phase24a-model-provider-secret";

function b64url(value:string|Buffer):string{return Buffer.from(value).toString("base64url");}
function compactJwt(privateKey:any,payload:Record<string,unknown>):string {
  const header=b64url(JSON.stringify({alg:"EdDSA",typ:"at+jwt",kid:"api-key:v1"}));
  const encoded=b64url(JSON.stringify(payload));
  const input=`${header}.${encoded}`;
  return `${input}.${sign(null,Buffer.from(input),privateKey).toString("base64url")}`;
}
async function listen(server:any):Promise<number>{
  await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",()=>resolve());});
  const address=server.address();assert.ok(address&&typeof address==="object");return address.port;
}
async function close(server:any):Promise<void>{await new Promise<void>(resolve=>server.close(()=>resolve()));}

const profile:ModelCompilerProfile={
  profileId:"profile:phase24a",version:"1.0.0",adapterId:"model:http:gate",
  allowedOperationIds:["comparison.lte"],maxRepairAttempts:2,maxInputs:4,maxNodes:8,
  maxConstraints:4,maxAssumptions:4,maxObjectiveBytes:2048,maxModelResponseBytes:8192
};
const inputContracts=[
  {inputName:"observed",type:{kind:"number" as const,unit:"ratio"},entity:"risk:alpha",attribute:"current",requirementId:"observed-risk",maxAgeMs:10*60*1000},
  {inputName:"maximum",type:{kind:"number" as const,unit:"ratio"},entity:"risk:alpha",attribute:"maximum",requirementId:"maximum-risk",maxAgeMs:10*60*1000}
];
const invalidProposal={
  assumptions:[],
  nodes:[{id:"decision",kind:"Decision",operation:"arithmetic.add",inputs:{left:{input:"observed"},right:{input:"maximum"}}}],
  constraints:[],decisionNodeId:"decision"
};
const validProposal={
  assumptions:["World-state evidence is authoritative at execution"],
  nodes:[{id:"decision",kind:"Decision",operation:"comparison.lte",inputs:{left:{input:"observed"},right:{input:"maximum"}}}],
  constraints:[],decisionNodeId:"decision"
};

const dir=mkdtempSync(join(tmpdir(),"axiom-phase24a-gate-")),db=join(dir,"platform.db");
const world=new WorldStateStore(db);
const executions=new ExecutionStore(db);
const security=new SecurityStore(db);
const modelStore=new ModelCompilationStore(db);
const registry=createDefaultRegistry();
const profiles=new ModelCompilerRegistry(registry,[{profile,tenantIds:[tenantA.tenantId]}]);
const apiSigner=generateKeyPairSync("ed25519");
const reasoningSigner=createSigner();
const jwtTrust=createJwtTrustStore({"https://issuer.axiom.example":{"api-key:v1":apiSigner.publicKey}});
const authenticator=new Ed25519JwtAuthenticator({
  trustStore:jwtTrust,audience:"axiom-api",maxTokenAgeMs:5*60*1000,
  maxTokenLifetimeMs:10*60*1000,maxClockSkewMs:30*1000
});
const authorizer=new DeterministicAuthorizer(security);
const signerProvider=createStaticSignerProvider("reasoning-key:phase24a",reasoningSigner);
const secretResolver=new StaticSecretResolver({"secret:model":modelSecret});

let modelProviderCalls=0;
const providerBodies:string[]=[];
const modelAdapter=new HttpStructuredModelAdapter({
  manifest:{adapterId:profile.adapterId,version:"1.0.0",implementationHash:H("a"),provider:"fixture-provider",modelId:"fixture-model"},
  origin:"https://models.example",compilePath:"/v1/compile",repairPath:"/v1/repair",
  timeoutMs:1000,maxResponseBytes:8192,allowedStatus:[200],
  fixedHeaders:{"x-axiom-profile":"phase24a"},
  secretHeaders:{authorization:"secret:model"},
  secretResolver,
  fetchFn:async(url,init)=>{
    modelProviderCalls++;
    assert.equal(init?.redirect,"manual");
    assert.equal((init?.headers as any).authorization,modelSecret);
    assert.ok(String(url)==="https://models.example/v1/compile"||String(url)==="https://models.example/v1/repair");
    const body=String(init?.body??"");providerBodies.push(body);
    assert.equal(body.includes(modelSecret),false);
    const request=JSON.parse(body);
    const alwaysReject=request.objective==="always reject";
    const proposal=alwaysReject||request.repair===undefined?invalidProposal:validProposal;
    return new Response(JSON.stringify({proposal}),{status:200,headers:{"content-type":"application/json"}});
  }
});
let captureIndex=0;
const compiler=new ModelCompilationService({
  profiles,repository:modelStore,registry,adapter:modelAdapter,
  now:()=>`2026-10-06T10:00:0${Math.min(captureIndex++,9)}.000Z`
});

const runtimeCreates:string[]=[];
let reasoningExecutions=0;
const runtimeFactory={
  create(scope:TenantScope){
    runtimeCreates.push(scope.tenantId);
    const plane=new ReasoningControlPlane({tenant:scope,world,executions,signer:signerProvider,registry});
    const guardedPlane={
      execute:async(request:any)=>{reasoningExecutions++;return plane.execute(request);}
    };
    return {
      modelCompiler:compiler,
      modelExecutor:new ModelExecutionService({repository:modelStore,profiles,registry,plane:guardedPlane}),
      acquisitions:{async acquire(){throw new Error("evidence acquisition is outside the Phase-2.4A gate path");}},
      ingestor:{async ingest(){throw new Error("fact ingestion is outside the Phase-2.4A gate path");}},
      executions,
      plane
    };
  }
};
const service=new AxiomApiService({authenticator,authorizer,idempotency:security,audit:security,runtimes:runtimeFactory});
const server=createAxiomHttpServer({service,clock:()=>NOW});

try{
  await world.putFact(tenantA,{
    id:"fact:observed",entity:"risk:alpha",attribute:"current",
    value:{type:{kind:"number",unit:"ratio"},value:0.20},
    validFrom:"2026-10-06T09:50:00.000Z",observedAt:"2026-10-06T09:59:40.000Z",source:"risk-engine:trusted"
  });
  await world.putFact(tenantA,{
    id:"fact:maximum",entity:"risk:alpha",attribute:"maximum",
    value:{type:{kind:"number",unit:"ratio"},value:0.30},
    validFrom:"2026-10-06T09:50:00.000Z",observedAt:"2026-10-06T09:59:41.000Z",source:"risk-policy:trusted"
  });

  const token=compactJwt(apiSigner.privateKey,{
    iss:"https://issuer.axiom.example",sub:"service:phase24a",aud:"axiom-api",jti:"jwt-phase24a",
    iat:1791280770,exp:1791281100,tenantId:tenantB.tenantId,roles:["admin"],scope:"*"
  });
  const authenticated=await authenticator.authenticate(token,NOW);
  for(const action of ["model:compile","model:execute","execution:replay"] as const){
    await security.putGrant({grantId:`gate:${action}`,principalId:authenticated.principal.principalId,tenantId:tenantA.tenantId,action});
  }

  const port=await listen(server);
  const base=`http://127.0.0.1:${port}/v1/tenants/${encodeURIComponent(tenantA.tenantId)}`;
  const headers={Authorization:`Bearer ${token}`,"Content-Type":"application/json"};
  const compileBody={profileId:profile.profileId,objective:"approve only within maximum",inputContracts};

  const compileResponse=await fetch(base+"/model/compilations",{
    method:"POST",headers:{...headers,"Idempotency-Key":"idem:model:compile:1"},body:JSON.stringify(compileBody)
  });
  assert.equal(compileResponse.status,201);
  const compileText=await compileResponse.text();
  const compiled=JSON.parse(compileText);
  assert.equal(compiled.status,"VALIDATED");
  assert.equal(compiled.attemptCount,2);
  assert.match(compiled.compilationId,/^model-compilation:[0-9a-f]{64}$/);
  assert.equal(modelProviderCalls,2);

  const compileReplay=await fetch(base+"/model/compilations",{
    method:"POST",headers:{...headers,"Idempotency-Key":"idem:model:compile:1"},body:JSON.stringify(compileBody)
  });
  assert.equal(compileReplay.status,201);
  assert.equal(await compileReplay.text(),compileText);
  assert.equal(modelProviderCalls,2,"completed model compilation retry must not refetch provider");

  const otherBase=`http://127.0.0.1:${port}/v1/tenants/${encodeURIComponent(tenantB.tenantId)}`;
  const crossTenant=await fetch(otherBase+"/model/compilations",{
    method:"POST",headers:{...headers,"Idempotency-Key":"idem:model:cross"},body:JSON.stringify(compileBody)
  });
  assert.equal(crossTenant.status,403);
  assert.equal(modelProviderCalls,2,"cross-tenant authorization denial must precede model provider access");
  assert.equal(runtimeCreates.includes(tenantB.tenantId),false);

  const record=await modelStore.getCompilation(tenantA,compiled.compilationId);
  assert.equal(record.status,"VALIDATED");
  assert.equal(record.exchangeArtifactIds.length,2);
  const artifacts=[];
  for(const id of record.exchangeArtifactIds)artifacts.push(await modelStore.getModelArtifact(tenantA,id));
  assert.deepEqual(artifacts.map(x=>x.mode),["INITIAL","REPAIR"]);
  assert.deepEqual(artifacts.map(x=>x.attempt),[0,1]);
  assert.equal(artifacts.some(x=>x.requestBody.includes(modelSecret)||x.responseBody.includes(modelSecret)),false);
  assert.equal(JSON.parse(artifacts[1].requestBody).repair.previousResponseBody,artifacts[0].responseBody,"repair must carry exact prior bounded response");

  const executeBody={asOf:NOW,issuedAt:"2026-10-06T10:00:01.000Z"};
  const executeResponse=await fetch(base+`/model/compilations/${encodeURIComponent(compiled.compilationId)}/executions`,{
    method:"POST",headers:{...headers,"Idempotency-Key":"idem:model:execute:1"},body:JSON.stringify(executeBody)
  });
  assert.equal(executeResponse.status,200);
  const executeText=await executeResponse.text(),issued=JSON.parse(executeText);
  assert.equal(issued.status,"APPROVED");
  assert.ok(issued.executionRecordId);
  assert.equal(reasoningExecutions,1);
  assert.equal(modelProviderCalls,2,"model provider must not be called during immutable compilation execution");

  const executeReplay=await fetch(base+`/model/compilations/${encodeURIComponent(compiled.compilationId)}/executions`,{
    method:"POST",headers:{...headers,"Idempotency-Key":"idem:model:execute:1"},body:JSON.stringify(executeBody)
  });
  assert.equal(executeReplay.status,200);
  assert.equal(await executeReplay.text(),executeText);
  assert.equal(reasoningExecutions,1,"completed model execution retry must not rerun reasoning");
  assert.equal(modelProviderCalls,2);

  const platformRecord=await executions.get(tenantA,issued.executionRecordId);
  const signedInputs=platformRecord.certificate.replay.program.inputs;
  assert.equal(signedInputs.observed.value,0.20);
  assert.equal(signedInputs.maximum.value,0.30);
  for(const input of Object.values(signedInputs)){
    assert.match(input.provenance?.source??"",/^world-state:tenant:phase24a-gate:/);
    assert.equal((input.provenance?.source??"").includes("model-compile-contract"),false);
  }

  const replayBefore=modelProviderCalls;
  const replay=await fetch(base+`/executions/${encodeURIComponent(issued.executionRecordId)}/replay`,{
    method:"POST",headers,body:"{}"
  });
  assert.equal(replay.status,200);
  assert.deepEqual(await replay.json(),{status:"MATCH",diagnostics:[]});
  assert.equal(modelProviderCalls,replayBefore,"stored reasoning replay must never call model provider");

  const executionDecision=await authorizer.authorize(authenticated,{
    requestedTenantId:tenantA.tenantId,action:"model:execute",resource:{kind:"model_compilation",id:compiled.compilationId}
  });
  const executionContext=createAuthorizedTenantContext(authenticated,{
    requestedTenantId:tenantA.tenantId,action:"model:execute",resource:{kind:"model_compilation",id:compiled.compilationId}
  },executionDecision);
  const driftedProfiles=new ModelCompilerRegistry(registry,[{
    profile:{...profile,maxNodes:profile.maxNodes+1},tenantIds:[tenantA.tenantId]
  }]);
  let staleReasoningCalls=0;
  const staleService=new ModelExecutionService({
    repository:modelStore,profiles:driftedProfiles,registry,
    plane:{async execute(){staleReasoningCalls++;throw new Error("must not execute stale compilation");}}
  });
  await assert.rejects(
    ()=>staleService.execute(executionContext,compiled.compilationId,executeBody),
    (error:any)=>error instanceof ModelExecutionError&&error.code==="COMPILATION_STALE"&&error.httpStatus===409
  );
  assert.equal(staleReasoningCalls,0);

  const rehashCompilation=(source:any)=>{
    const core=structuredClone(source);
    delete core.recordHash;
    return {...core,recordHash:hashJson(core)};
  };
  for(const [label,staleRecord] of [
    ["compiler",rehashCompilation({...record,compilerManifest:{...record.compilerManifest,implementationHash:H("e")}})],
    ["registry",rehashCompilation({...record,operationRegistryManifestHash:H("d")})]
  ] as const){
    let semanticDriftReasoningCalls=0;
    const driftRepository={
      async getCompilation(scope:any,id:string){
        assert.equal(scope.tenantId,tenantA.tenantId);
        assert.equal(id,compiled.compilationId);
        return structuredClone(staleRecord);
      }
    } as any;
    const semanticDriftService=new ModelExecutionService({
      repository:driftRepository,profiles,registry,
      plane:{async execute(){semanticDriftReasoningCalls++;throw new Error("stale compilation reached control plane");}}
    });
    await assert.rejects(
      ()=>semanticDriftService.execute(executionContext,compiled.compilationId,executeBody),
      (error:any)=>error instanceof ModelExecutionError&&error.code==="COMPILATION_STALE"&&error.httpStatus===409,
      `${label} drift must be classified as compilation staleness`
    );
    assert.equal(semanticDriftReasoningCalls,0,`${label} drift must reject before control-plane execution`);
  }

  const rejectBeforeReasoning=reasoningExecutions;
  const rejectedResponse=await fetch(base+"/model/compilations",{
    method:"POST",headers:{...headers,"Idempotency-Key":"idem:model:reject"},
    body:JSON.stringify({...compileBody,objective:"always reject"})
  });
  assert.equal(rejectedResponse.status,422);
  const rejected=await rejectedResponse.json() as any;
  assert.equal(rejected.status,"REJECTED");
  assert.equal(rejected.attemptCount,3);
  assert.equal(modelProviderCalls,5);
  const rejectedExecute=await fetch(base+`/model/compilations/${encodeURIComponent(rejected.compilationId)}/executions`,{
    method:"POST",headers:{...headers,"Idempotency-Key":"idem:model:reject:execute"},body:JSON.stringify(executeBody)
  });
  assert.equal(rejectedExecute.status,422);
  assert.equal((await rejectedExecute.json() as any).error.code,"COMPILATION_REJECTED");
  assert.equal(reasoningExecutions,rejectBeforeReasoning,"rejected compilation must not reach reasoning control plane");

  assert.deepEqual(await security.verifyStream(tenantA.tenantId),{status:"MATCH",diagnostics:[]});
  assert.deepEqual(await security.verifyStream(tenantB.tenantId),{status:"MATCH",diagnostics:[]});

  const inspect=new DatabaseSync(db);
  try{
    const persisted={
      modelArtifacts:inspect.prepare("SELECT * FROM axiom_model_exchange_artifacts").all(),
      modelCompilations:inspect.prepare("SELECT * FROM axiom_model_compilations").all(),
      idempotency:inspect.prepare("SELECT * FROM axiom_idempotency_records").all(),
      audit:inspect.prepare("SELECT * FROM axiom_audit_records").all(),
      executions:inspect.prepare("SELECT * FROM platform_executions").all()
    };
    assert.equal(JSON.stringify(persisted).includes(modelSecret),false,"model provider secret must never persist");

    inspect.prepare("UPDATE axiom_model_exchange_artifacts SET request_body=? WHERE tenant_id=? AND artifact_id=?")
      .run('{"tampered":true}',tenantA.tenantId,record.exchangeArtifactIds[0]);
  }finally{inspect.close();}
  await assert.rejects(()=>modelStore.getModelArtifact(tenantA,record.exchangeArtifactIds[0]),/integrity|hash/i);

  const inspectCompilation=new DatabaseSync(db);
  try{
    inspectCompilation.prepare("UPDATE axiom_model_compilations SET compiled_program_hash=? WHERE tenant_id=? AND compilation_id=?")
      .run(H("f"),tenantA.tenantId,compiled.compilationId);
  }finally{inspectCompilation.close();}
  await assert.rejects(()=>modelStore.getCompilation(tenantA,compiled.compilationId),/integrity|hash|program/i);

  assert.equal(providerBodies.some(x=>x.includes(modelSecret)),false);
  console.log(JSON.stringify({
    phase:"P2.4A — Proof-Carrying Model Compiler",
    status:"PASS",
    checks:[
      "authenticate and authorize exact model:compile before provider/runtime access",
      "capture bounded secret-free model exchanges through fixed HTTPS model adapter",
      "reject initial untrusted proposal and perform one deterministic bounded repair",
      "compile repaired proposal through authoritative Phase-1 compiler without executing it",
      "persist model exchanges plus terminal validated compilation atomically",
      "replay completed compile response without provider refetch",
      "deny cross-tenant compilation before provider/runtime access",
      "execute only immutable validated compilation through existing control plane",
      "replace every compile placeholder with fresh world-state provenance before signing",
      "replay completed model execution without reasoning re-execution",
      "replay stored reasoning without model provider access",
      "reject profile/compiler/registry drift before control-plane execution",
      "reject terminal rejected compilation before reasoning execution",
      "exclude model provider secret from persistence and API outcomes",
      "detect direct model artifact and compilation tampering"
    ],
    tenantId:tenantA.tenantId,
    principalId:authenticated.principal.principalId,
    compilationId:compiled.compilationId,
    executionRecordId:issued.executionRecordId,
    modelProviderCalls,
    reasoningExecutions
  },null,2));
}finally{
  await close(server).catch(()=>{});
  modelStore.close();security.close();executions.close();world.close();
  rmSync(dir,{recursive:true,force:true});
}
