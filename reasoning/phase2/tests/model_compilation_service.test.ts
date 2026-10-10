import test from "node:test";
import assert from "node:assert/strict";
import { createDefaultRegistry, hashJson } from "../../phase1/src/index.ts";

const A={tenantId:"tenant:model-a"};
const H=(c:string)=>c.repeat(64);
function profile(overrides:any={}){
  return {
    profileId:"profile:default",version:"1.0.0",adapterId:"model:test",
    allowedOperationIds:["comparison.lte"],maxRepairAttempts:2,maxInputs:4,maxNodes:8,
    maxConstraints:4,maxAssumptions:4,maxObjectiveBytes:2048,maxModelResponseBytes:4096,...overrides
  };
}
function request(){
  return {
    profileId:"profile:default",
    objective:"Approve only when observed risk is within the configured maximum",
    inputContracts:[
      {inputName:"observed",type:{kind:"number",unit:"ratio"},entity:"risk:a",attribute:"current",requirementId:"current",maxAgeMs:60000},
      {inputName:"maximum",type:{kind:"number",unit:"ratio"},entity:"risk:a",attribute:"maximum",requirementId:"maximum",maxAgeMs:60000}
    ]
  };
}
function validProposal(overrides:any={}){
  return {
    assumptions:["Trusted values arrive only at execution"],
    nodes:[{id:"decision",kind:"Decision",operation:"comparison.lte",inputs:{left:{input:"observed"},right:{input:"maximum"}}}],
    constraints:[],decisionNodeId:"decision",...overrides
  };
}
function context(action:any="model:compile",resource:any={kind:"model_compilation"}){
  return {
    principal:{principalId:"principal:model",issuer:"issuer:test",subject:"subject:test"},
    credential:{issuer:"issuer:test",subject:"subject:test",keyId:"kid",jwtId:"jti",issuedAt:"2026-10-07T04:20:00.000Z",expiresAt:"2026-10-07T05:20:00.000Z",tokenHash:H("1")},
    tenant:A,
    authorization:{
      status:"ALLOW",principalId:"principal:model",requestedTenantId:A.tenantId,action,resource,
      matchedGrantIds:["grant:model"],policyManifest:{id:"axiom.api-authorization",version:"1.0.0",implementationHash:H("2"),grantsHash:H("3")},
      decisionHash:H("4")
    }
  };
}
function adapter(responses:any[],manifestOverrides:any={}){
  const calls:any[]=[];
  const manifest={adapterId:"model:test",version:"1.0.0",implementationHash:H("5"),provider:"fixture",modelId:"fixture-model",...manifestOverrides};
  return {
    calls,manifest,
    async invoke(input:any){
      calls.push(structuredClone(input));
      const next=responses.shift();
      if(next instanceof Error)throw next;
      const body=typeof next==="string"?next:JSON.stringify({proposal:next});
      return {capturedAt:input.capturedAt,requestBody:JSON.stringify({attempt:input.attempt,mode:input.mode}),responseBody:body,normalizedResponseBody:body};
    }
  };
}
function repository(options:any={}){
  const commits:any[]=[];
  return {
    commits,
    async commitCompilation(scope:any,artifacts:any[],record:any){
      if(options.failCommit)throw new Error("repository unavailable");
      commits.push({scope:structuredClone(scope),artifacts:structuredClone(artifacts),record:structuredClone(record)});
    },
    async getCompilation(){throw new Error("unused");},
    async getModelArtifact(){throw new Error("unused");}
  };
}
function clock(){
  let i=0;
  return ()=>`2026-10-07T04:3${Math.min(i++,9)}:00.000Z`;
}
async function service(responses:any[],profileOverrides:any={},repoOptions:any={}){
  const phase2:any=await import("../src/index.ts");
  const registry=createDefaultRegistry(),p=profile(profileOverrides);
  const profiles=new phase2.ModelCompilerRegistry(registry,[{profile:p,tenantIds:[A.tenantId]}]);
  const model=adapter(responses),repo=repository(repoOptions);
  const compiler=new phase2.ModelCompilationService({profiles,repository:repo,registry,adapter:model,now:clock()});
  return {phase2,registry,p,profiles,model,repo,compiler};
}

test("Phase-2 exposes proof-carrying bounded model compilation",async()=>{
  const phase2:any=await import("../src/index.ts");
  assert.equal(typeof phase2.ModelCompilationService,"function");
  assert.equal(typeof phase2.normalizeModelCompilationIssues,"function");
});

test("compile requires exact authorized model:compile context before profile resolution or model access",async()=>{
  const phase2:any=await import("../src/index.ts");
  const registry=createDefaultRegistry();
  let resolves=0,calls=0,commits=0;
  const profiles={resolve(){resolves++;throw new Error("must not resolve");}};
  const model={manifest:{adapterId:"model:test",version:"1.0.0",implementationHash:H("5"),provider:"fixture",modelId:"fixture"},async invoke(){calls++;throw new Error("must not invoke");}};
  const repo={async commitCompilation(){commits++;},async getCompilation(){throw 0;},async getModelArtifact(){throw 0;}};
  const compiler=new phase2.ModelCompilationService({profiles,repository:repo,registry,adapter:model,now:clock()});
  await assert.rejects(()=>compiler.compile(context("execution:create",{kind:"execution"}),request(),H("6")),/authorize|model:compile|context/i);
  await assert.rejects(()=>compiler.compile({...context(),tenant:{tenantId:"tenant:forged"}},request(),H("6")),/tenant|context|authorize/i);
  assert.deepEqual({resolves,calls,commits},{resolves:0,calls:0,commits:0});
});

test("initial valid proposal performs one model call and commits one fully identity-bound VALIDATED record",async()=>{
  const {compiler,model,repo,registry,p}=await service([validProposal()]);
  const result=await compiler.compile(context(),request(),H("6"));
  assert.equal(result.status,"VALIDATED");
  assert.equal(result.attemptCount,1);
  assert.match(result.compilationId,/^model-compilation:[0-9a-f]{64}$/);
  assert.match(result.compiledProgramHash,/^[0-9a-f]{64}$/);
  assert.equal(model.calls.length,1);
  assert.equal(repo.commits.length,1);
  const commit=repo.commits[0],record=commit.record;
  assert.equal(commit.artifacts.length,1);
  assert.equal(record.status,"VALIDATED");
  assert.equal(record.tenantId,A.tenantId);
  assert.equal(record.principalId,"principal:model");
  assert.equal(record.authorizationDecisionHash,H("4"));
  assert.equal(record.profileHash,model.calls[0].profileHash);
  assert.equal(record.profileId,p.profileId);
  assert.equal(record.adapterManifest.adapterId,model.manifest.adapterId);
  assert.equal(record.operationRegistryManifestHash,hashJson(registry.manifest()));
  assert.equal(record.compiledProgramHash,hashJson(record.compiledProgram));
  assert.deepEqual(Object.keys(record.compiledProgram.inputs).sort(),["maximum","observed"]);
  for(const [name,value] of Object.entries(record.compiledProgram.inputs) as any){
    assert.match(value.provenance.source,new RegExp(`^model-compile-contract:[0-9a-f]{64}:${name}$`));
  }
  assert.deepEqual(record.exchangeArtifactIds,commit.artifacts.map((x:any)=>x.artifactId));
  assert.deepEqual(record.exchangeArtifactHashes,commit.artifacts.map((x:any)=>x.artifactHash));
  const core={...record};delete core.recordHash;
  assert.equal(record.recordHash,hashJson(core));
});

test("invalid proposal is repaired with exact prior response and deterministically sorted issues",async()=>{
  const invalid=validProposal({
    nodes:[{id:"decision",kind:"Decision",operation:"comparison.lte",inputs:{left:{input:"missing"},right:{input:"maximum"}}}]
  });
  const {compiler,model,repo}=await service([invalid,validProposal()]);
  const result=await compiler.compile(context(),request(),H("6"));
  assert.equal(result.status,"VALIDATED");
  assert.equal(result.attemptCount,2);
  assert.equal(model.calls.length,2);
  assert.equal(model.calls[1].mode,"REPAIR");
  assert.equal(model.calls[1].attempt,1);
  assert.equal(model.calls[1].previousResponseBody,JSON.stringify({proposal:invalid}));
  assert.equal(model.calls[1].remainingRepairAttempts,1);
  assert.deepEqual(model.calls[1].issues,[...model.calls[1].issues].sort((a:any,b:any)=>
    (a.nodeId??"").localeCompare(b.nodeId??"")||a.code.localeCompare(b.code)||a.message.localeCompare(b.message)
  ));
  assert.equal(model.calls[1].objective,model.calls[0].objective);
  assert.deepEqual(model.calls[1].inputContracts,model.calls[0].inputContracts);
  assert.equal(model.calls[1].profileHash,model.calls[0].profileHash);
  assert.deepEqual(model.calls[1].operationRegistryManifest,model.calls[0].operationRegistryManifest);
  assert.equal(repo.commits.length,1);
  assert.equal(repo.commits[0].artifacts.length,2);
});

test("repair budget is hard-capped at two repairs and exhausted invalid proposals commit REJECTED with no executable program",async()=>{
  const bad=validProposal({decisionNodeId:"missing"});
  const {compiler,model,repo}=await service([bad,bad,bad,bad]);
  const result=await compiler.compile(context(),request(),H("6"));
  assert.equal(result.status,"REJECTED");
  assert.equal(result.attemptCount,3);
  assert.equal(model.calls.length,3);
  assert.equal(repo.commits.length,1);
  const record=repo.commits[0].record;
  assert.equal(record.status,"REJECTED");
  assert.equal("compiledProgram" in record,false);
  assert.equal("compiledProgramHash" in record,false);
  assert.ok(record.finalIssues.length>0);
  assert.deepEqual(result.issues,record.finalIssues);
});

test("forbidden authority-bearing model fields can never produce a VALIDATED compilation",async()=>{
  const forged={...validProposal(),tenantId:"tenant:forged",inputs:{observed:{value:999}},signer:{keyId:"forged"}};
  const {compiler,repo}=await service([forged],{maxRepairAttempts:0});
  const result=await compiler.compile(context(),request(),H("6"));
  assert.equal(result.status,"REJECTED");
  assert.equal(repo.commits[0].record.status,"REJECTED");
  assert.match(repo.commits[0].record.finalIssues.map((x:any)=>x.code).join(","),/MODEL_/);
});

test("compilation identity changes when profile or registry commitment changes",async()=>{
  const first=await service([validProposal()]);
  const firstResult=await first.compiler.compile(context(),request(),H("6"));
  const second=await service([validProposal()],{maxNodes:9});
  const secondResult=await second.compiler.compile(context(),request(),H("6"));
  assert.notEqual(firstResult.compilationId,secondResult.compilationId);
});

test("provider failure causes no terminal repository commit and persistence failure propagates after provider work",async()=>{
  const provider=await service([new Error("provider unavailable")]);
  await assert.rejects(()=>provider.compiler.compile(context(),request(),H("6")),/provider unavailable/);
  assert.equal(provider.repo.commits.length,0);
  assert.equal(provider.model.calls.length,1);

  const persistence=await service([validProposal()],{}, {failCommit:true});
  await assert.rejects(()=>persistence.compiler.compile(context(),request(),H("6")),/repository unavailable/);
  assert.equal(persistence.model.calls.length,1);
  assert.equal(persistence.repo.commits.length,0);
});


test("compiler consumes normalized proposal while preserving raw provider response artifacts",async()=>{
  const {phase2,registry,p,profiles,repo}=await service([]);
  const rawProviderBody=JSON.stringify({id:"resp_fixture",output:[{type:"message",content:[{type:"output_text",text:"provider envelope"}]}]});
  const normalized=JSON.stringify({proposal:validProposal()});
  const model={
    manifest:{adapterId:"model:test",version:"1.0.0",implementationHash:H("5"),provider:"fixture",modelId:"fixture-model"},
    calls:[] as any[],
    async invoke(input:any){
      this.calls.push(structuredClone(input));
      return {capturedAt:input.capturedAt,requestBody:'{"providerRequest":true}',responseBody:rawProviderBody,normalizedResponseBody:normalized};
    }
  };
  const compiler=new phase2.ModelCompilationService({profiles,repository:repo,registry,adapter:model,now:clock()});
  const result=await compiler.compile(context(),request(),H("6"));
  assert.equal(result.status,"VALIDATED");
  assert.equal(repo.commits[0].artifacts[0].responseBody,rawProviderBody);
  assert.equal(repo.commits[0].artifacts[0].normalizedResponseBody,normalized);
});

test("repair state uses previous normalized proposal instead of raw provider envelope",async()=>{
  const {phase2,registry,p,profiles,repo}=await service([]);
  const badNormalized=JSON.stringify({proposal:validProposal({decisionNodeId:"missing"})});
  const goodNormalized=JSON.stringify({proposal:validProposal()});
  const calls:any[]=[];
  const model={
    manifest:{adapterId:"model:test",version:"1.0.0",implementationHash:H("5"),provider:"fixture",modelId:"fixture-model"},
    async invoke(input:any){
      calls.push(structuredClone(input));
      if(input.attempt===0)return {capturedAt:input.capturedAt,requestBody:'{"attempt":0}',responseBody:'{"raw":"first"}',normalizedResponseBody:badNormalized};
      return {capturedAt:input.capturedAt,requestBody:'{"attempt":1}',responseBody:'{"raw":"second"}',normalizedResponseBody:goodNormalized};
    }
  };
  const compiler=new phase2.ModelCompilationService({profiles,repository:repo,registry,adapter:model,now:clock()});
  const result=await compiler.compile(context(),request(),H("6"));
  assert.equal(result.status,"VALIDATED");
  assert.equal(calls[1].previousResponseBody,badNormalized);
});
