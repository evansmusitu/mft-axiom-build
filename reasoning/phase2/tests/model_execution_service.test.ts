import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  compileProgram, compilerManifest, createDefaultRegistry, createSigner, hashJson
} from "../../phase1/src/index.ts";

const A={tenantId:"tenant:model-a"},B={tenantId:"tenant:model-b"};
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
function proposal(){
  return {
    assumptions:["Trusted values arrive only from world state at execution"],
    nodes:[{id:"decision",kind:"Decision",operation:"comparison.lte",inputs:{left:{input:"observed"},right:{input:"maximum"}}}],
    constraints:[],decisionNodeId:"decision"
  };
}
function context(compilationId:string,tenant=A,action:any="model:execute",resource:any={kind:"model_compilation",id:compilationId}){
  return {
    principal:{principalId:"principal:model",issuer:"issuer:test",subject:"subject:test"},
    credential:{issuer:"issuer:test",subject:"subject:test",keyId:"kid",jwtId:"jti",issuedAt:"2026-10-07T04:20:00.000Z",expiresAt:"2026-10-07T05:20:00.000Z",tokenHash:H("1")},
    tenant,
    authorization:{
      status:"ALLOW",principalId:"principal:model",requestedTenantId:tenant.tenantId,action,resource,
      matchedGrantIds:["grant:model-execute"],policyManifest:{id:"axiom.api-authorization",version:"1.0.0",implementationHash:H("2"),grantsHash:H("3")},
      decisionHash:H("4")
    }
  };
}
function rehashRecord(record:any){
  const core={...record};delete core.recordHash;
  record.recordHash=hashJson(core);
  return record;
}
async function fixture(){
  const phase2:any=await import("../src/index.ts");
  const registry=createDefaultRegistry(),p=profile();
  const profiles=new phase2.ModelCompilerRegistry(registry,[{profile:p,tenantIds:[A.tenantId,B.tenantId]}]);
  const resolved=profiles.resolve(A,p.profileId);
  const req=request();
  const program=compileProgram(phase2.assembleModelProgram(req,proposal(),p),registry);
  const programHash=hashJson(program);
  const compilationId="model-compilation:"+H("8");
  const core:any={
    compilationId,tenantId:A.tenantId,principalId:"principal:model",authorizationDecisionHash:H("5"),
    compilationRequestHash:H("6"),profileId:p.profileId,profileVersion:p.version,profileHash:resolved.profileHash,
    adapterManifest:{adapterId:"model:test",version:"1.0.0",implementationHash:H("7"),provider:"fixture",modelId:"fixture-model"},
    compilerManifest:compilerManifest(),operationRegistryManifestHash:hashJson(registry.manifest()),
    objective:req.objective,inputContracts:phase2.canonicalModelInputContracts(req.inputContracts,p),
    exchangeArtifactIds:["model-artifact:"+H("a")],exchangeArtifactHashes:[H("b")],
    finalIssues:[],status:"VALIDATED",compiledProgram:program,compiledProgramHash:programHash,
    createdAt:"2026-10-07T04:30:00.000Z"
  };
  const record=rehashRecord(core);
  return {phase2,registry,p,profiles,record};
}
function repository(record:any,options:any={}){
  const gets:any[]=[];
  return {
    gets,
    async getCompilation(scope:any,id:string){
      gets.push({scope:structuredClone(scope),id});
      if(options.notFound||scope.tenantId!==record.tenantId)throw new Error(`Model compilation not found for tenant ${scope.tenantId}: ${id}`);
      return structuredClone(record);
    },
    async commitCompilation(){throw new Error("unused");},
    async getModelArtifact(){throw new Error("unused");}
  };
}
function plane(){
  const calls:any[]=[];
  return {
    calls,
    async execute(input:any){
      calls.push(structuredClone(input));
      return {
        status:"APPROVED",snapshotId:"snapshot:"+H("c"),
        policyDecision:{status:"ALLOW",snapshotId:"snapshot:"+H("c"),checks:[]},
        certificateId:H("d"),executionRecordId:"platform:"+H("d")
      };
    }
  };
}
function nowTiming(){return {asOf:"2026-10-07T04:31:00.000Z",issuedAt:"2026-10-07T04:31:01.000Z"};}

test("Phase-2 exposes immutable model compilation execution with typed stale errors",async()=>{
  const phase2:any=await import("../src/index.ts");
  assert.equal(typeof phase2.ModelExecutionService,"function");
  assert.equal(typeof phase2.ModelExecutionError,"function");
});

test("model execution requires exact model:execute context and matching compilation resource before repository access",async()=>{
  const {phase2,registry,profiles,record}=await fixture();
  const repo=repository(record),cp=plane();
  const svc=new phase2.ModelExecutionService({repository:repo,profiles,registry,plane:cp});
  await assert.rejects(()=>svc.execute(context(record.compilationId,A,"execution:create",{kind:"execution"}),record.compilationId,nowTiming()),/model:execute|authorize|context/i);
  await assert.rejects(()=>svc.execute(context(record.compilationId,A,"model:execute",{kind:"model_compilation",id:"model-compilation:"+H("9")}),record.compilationId,nowTiming()),/resource|compilation|context/i);
  assert.equal(repo.gets.length,0);
  assert.equal(cp.calls.length,0);
});

test("VALIDATED immutable compilation derives exact requirements/bindings and passes only stored template plus timing to control plane",async()=>{
  const {phase2,registry,profiles,record}=await fixture();
  const repo=repository(record),cp=plane();
  const svc=new phase2.ModelExecutionService({repository:repo,profiles,registry,plane:cp});
  const result=await svc.execute(context(record.compilationId),record.compilationId,nowTiming());
  assert.equal(result.status,"APPROVED");
  assert.equal(cp.calls.length,1);
  assert.equal(repo.gets.length,1);
  const input=cp.calls[0];
  assert.deepEqual({asOf:input.asOf,issuedAt:input.issuedAt},nowTiming());
  assert.deepEqual(input.program,record.compiledProgram);
  assert.deepEqual(input.requirements,[
    {id:"current",entity:"risk:a",attribute:"current",maxAgeMs:60000},
    {id:"maximum",entity:"risk:a",attribute:"maximum",maxAgeMs:60000}
  ]);
  assert.deepEqual(input.bindings,[
    {inputName:"maximum",entity:"risk:a",attribute:"maximum"},
    {inputName:"observed",entity:"risk:a",attribute:"current"}
  ]);
  for(const [name,value] of Object.entries(input.program.inputs) as any){
    assert.match(value.provenance.source,new RegExp(`^model-compile-contract:[0-9a-f]{64}:${name}$`));
  }
});

test("REJECTED compilation cannot reach the reasoning control plane",async()=>{
  const {phase2,registry,profiles,record}=await fixture();
  const rejected:any=structuredClone(record);
  rejected.status="REJECTED";rejected.finalIssues=[{code:"MODEL_PROPOSAL_SCHEMA",message:"invalid"}];
  delete rejected.compiledProgram;delete rejected.compiledProgramHash;rehashRecord(rejected);
  const repo=repository(rejected),cp=plane();
  const svc=new phase2.ModelExecutionService({repository:repo,profiles,registry,plane:cp});
  await assert.rejects(()=>svc.execute(context(rejected.compilationId),rejected.compilationId,nowTiming()),(e:any)=>e?.code==="COMPILATION_REJECTED"&&e?.httpStatus===422);
  assert.equal(cp.calls.length,0);
});

test("compiler profile and registry semantic drift return COMPILATION_STALE before reasoning execution",async()=>{
  const base=await fixture();
  for(const mutate of [
    (record:any)=>{record.profileHash=H("e");},
    (record:any)=>{record.compilerManifest={...record.compilerManifest,implementationHash:H("f")};},
    (record:any)=>{record.operationRegistryManifestHash=H("0");}
  ]){
    const record=structuredClone(base.record);mutate(record);rehashRecord(record);
    const repo=repository(record),cp=plane();
    const svc=new base.phase2.ModelExecutionService({repository:repo,profiles:base.profiles,registry:base.registry,plane:cp});
    await assert.rejects(()=>svc.execute(context(record.compilationId),record.compilationId,nowTiming()),(e:any)=>e?.code==="COMPILATION_STALE"&&e?.httpStatus===409);
    assert.equal(cp.calls.length,0);
  }
});

test("stored template must have exact contract input set and untouched compile-only placeholder provenance",async()=>{
  const base=await fixture();
  for(const mutate of [
    (record:any)=>{delete record.compiledProgram.inputs.maximum;record.compiledProgramHash=hashJson(record.compiledProgram);},
    (record:any)=>{record.compiledProgram.inputs.observed.provenance.source="world-state:forged";record.compiledProgramHash=hashJson(record.compiledProgram);},
    (record:any)=>{record.compiledProgram.inputs.observed.type={kind:"number",unit:"USD"};record.compiledProgramHash=hashJson(record.compiledProgram);}
  ]){
    const record=structuredClone(base.record);mutate(record);rehashRecord(record);
    const repo=repository(record),cp=plane();
    const svc=new base.phase2.ModelExecutionService({repository:repo,profiles:base.profiles,registry:base.registry,plane:cp});
    await assert.rejects(()=>svc.execute(context(record.compilationId),record.compilationId,nowTiming()),/integrity|contract|placeholder|template|type/i);
    assert.equal(cp.calls.length,0);
  }
});

test("known compilation IDs remain tenant-scoped and inaccessible across tenants",async()=>{
  const {phase2,registry,profiles,record}=await fixture();
  const repo=repository(record),cp=plane();
  const svc=new phase2.ModelExecutionService({repository:repo,profiles,registry,plane:cp});
  await assert.rejects(()=>svc.execute(context(record.compilationId,B),record.compilationId,nowTiming()),/not found.*tenant:model-b/i);
  assert.deepEqual(repo.gets,[{scope:B,id:record.compilationId}]);
  assert.equal(cp.calls.length,0);
});


test("real control plane overwrites every compile placeholder with fresh trusted world-state provenance before signing",async()=>{
  const base=await fixture();
  const dir=mkdtempSync(join(tmpdir(),"axiom-model-exec-real-")),db=join(dir,"platform.db");
  const world=new base.phase2.WorldStateStore(db),executions=new base.phase2.ExecutionStore(db);
  try{
    await world.putFact(A,{
      id:"fact:observed",entity:"risk:a",attribute:"current",
      value:{type:{kind:"number",unit:"ratio"},value:0.2},
      validFrom:"2026-10-07T04:00:00.000Z",observedAt:"2026-10-07T04:30:30.000Z",source:"risk-engine:trusted"
    });
    await world.putFact(A,{
      id:"fact:maximum",entity:"risk:a",attribute:"maximum",
      value:{type:{kind:"number",unit:"ratio"},value:0.3},
      validFrom:"2026-10-07T04:00:00.000Z",observedAt:"2026-10-07T04:30:31.000Z",source:"risk-policy:trusted"
    });
    const signer=base.phase2.createStaticSignerProvider("key:model-exec",createSigner());
    const realPlane=new base.phase2.ReasoningControlPlane({tenant:A,world,executions,signer,registry:base.registry});
    const repo=repository(base.record);
    const svc=new base.phase2.ModelExecutionService({repository:repo,profiles:base.profiles,registry:base.registry,plane:realPlane});
    const result=await svc.execute(context(base.record.compilationId),base.record.compilationId,nowTiming());
    assert.equal(result.status,"APPROVED");
    const stored=await executions.get(A,result.executionRecordId);
    const signedInputs=stored.certificate.replay.program.inputs;
    assert.equal(signedInputs.observed.value,0.2);
    assert.equal(signedInputs.maximum.value,0.3);
    for(const value of Object.values(signedInputs) as any[]){
      assert.match(value.provenance.source,/^world-state:tenant:model-a:/);
      assert.equal(value.provenance.source.includes("model-compile-contract"),false);
      assert.ok(value.provenance.observedAt);
    }
    assert.deepEqual(await realPlane.replayStored(result.executionRecordId),{status:"MATCH",diagnostics:[]});
  }finally{
    world.close();executions.close();rmSync(dir,{recursive:true,force:true});
  }
});


test("an independently authorized model:execute principal may execute a tenant compilation without inheriting compiler identity",async()=>{
  const base=await fixture();
  const repo=repository(base.record),cp=plane();
  const svc=new base.phase2.ModelExecutionService({repository:repo,profiles:base.profiles,registry:base.registry,plane:cp});
  const executor=structuredClone(context(base.record.compilationId));
  executor.principal.principalId="principal:executor";
  executor.authorization.principalId="principal:executor";
  executor.authorization.decisionHash=H("9");
  const result=await svc.execute(executor,base.record.compilationId,nowTiming());
  assert.equal(result.status,"APPROVED");
  assert.equal(cp.calls.length,1);
});
