import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { hashJson } from "../../phase1/src/canonical.ts";

const A={tenantId:"tenant:model-a"},B={tenantId:"tenant:model-b"};
const H=(c:string)=>c.repeat(64);
const adapterManifest={adapterId:"model:http",version:"1.0.0",implementationHash:H("a"),provider:"fixture",modelId:"fixture-model"};
const profileId="profile:default",profileHash=H("b"),requestHash=H("c");
const inputContracts=[{inputName:"observed",type:{kind:"number",unit:"ratio"},entity:"risk:a",attribute:"current",requirementId:"current-risk",maxAgeMs:60000}];
const program={
  irVersion:"0.1",objective:"Approve only when observed risk is acceptable",assumptions:[],
  inputs:{observed:{type:{kind:"number",unit:"ratio"},value:0,provenance:{source:"model-compile-contract:"+H("1")+":observed",contentHash:hashJson(0)}}},
  nodes:[{id:"decision",kind:"Decision",operation:"comparison.lte",inputs:{left:{input:"observed"},right:{literal:{type:{kind:"number",unit:"ratio"},value:1}}}}],
  constraints:[],decisionNodeId:"decision"
};

function tempDb(){
  const dir=mkdtempSync(join(tmpdir(),"axiom-model-store-"));
  return {dir,db:join(dir,"model.sqlite")};
}
async function artifact(attempt=0,tenantId=A.tenantId,salt=""){
  const phase2:any=await import("../src/index.ts");
  return phase2.createModelExchangeArtifact({
    tenantId,manifest:adapterManifest,profileId,profileHash,compilationRequestHash:requestHash,
    attempt,mode:attempt===0?"INITIAL":"REPAIR",
    captured:{
      capturedAt:`2026-10-07T04:10:0${attempt}.000Z`,
      requestBody:JSON.stringify({attempt,request:"safe",salt}),
      responseBody:JSON.stringify({proposal:{assumptions:[],nodes:[],constraints:[],decisionNodeId:"decision"},attempt,salt})
    }
  });
}
function record(artifacts:any[],overrides:any={}){
  const status=overrides.status??"VALIDATED";
  const core:any={
    compilationId:overrides.compilationId??("model-compilation:"+H("d")),
    tenantId:overrides.tenantId??A.tenantId,
    principalId:"principal:model",
    authorizationDecisionHash:H("e"),
    compilationRequestHash:requestHash,
    profileId,profileVersion:"1.0.0",profileHash,
    adapterManifest,
    compilerManifest:{id:"axiom.phase1-compiler",version:"1.0.0",implementationHash:H("f")},
    operationRegistryManifestHash:H("9"),
    objective:program.objective,
    inputContracts,
    exchangeArtifactIds:artifacts.map(x=>x.artifactId),
    exchangeArtifactHashes:artifacts.map(x=>x.artifactHash),
    finalIssues:status==="REJECTED"?[{code:"MODEL_PROPOSAL_SCHEMA",message:"invalid proposal"}]:[],
    status,
    createdAt:"2026-10-07T04:11:00.000Z"
  };
  if(status==="VALIDATED"){
    core.compiledProgram=structuredClone(program);
    core.compiledProgramHash=hashJson(core.compiledProgram);
  }
  Object.assign(core,overrides);
  delete core.recordHash;
  return {...core,recordHash:hashJson(core)};
}

test("Phase-2 exposes a tenant-scoped immutable model compilation repository",async()=>{
  const phase2:any=await import("../src/index.ts");
  assert.equal(typeof phase2.ModelCompilationStore,"function");
});

test("SQLite atomically persists model exchange artifacts and a terminal validated compilation",async()=>{
  const phase2:any=await import("../src/index.ts");
  const {dir,db}=tempDb(),store=new phase2.ModelCompilationStore(db);
  try{
    const artifacts=[await artifact(0),await artifact(1)],compiled=record(artifacts);
    await store.commitCompilation(A,artifacts,compiled);
    assert.deepEqual(await store.getModelArtifact(A,artifacts[0].artifactId),artifacts[0]);
    assert.deepEqual(await store.getModelArtifact(A,artifacts[1].artifactId),artifacts[1]);
    assert.deepEqual(await store.getCompilation(A,compiled.compilationId),compiled);
    await assert.rejects(()=>store.getCompilation(B,compiled.compilationId),/not found/i);
    await assert.rejects(()=>store.getModelArtifact(B,artifacts[0].artifactId),/not found/i);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test("SQLite rolls back newly inserted model artifacts when terminal compilation insert fails late",async()=>{
  const phase2:any=await import("../src/index.ts");
  const {dir,db}=tempDb(),store=new phase2.ModelCompilationStore(db);
  try{
    const firstArtifact=await artifact(0),first=record([firstArtifact]);
    await store.commitCompilation(A,[firstArtifact],first);
    const newArtifact=await artifact(0,A.tenantId,"late-conflict");
    const conflicting=record([newArtifact],{compilationId:first.compilationId});
    await assert.rejects(()=>store.commitCompilation(A,[newArtifact],conflicting),/unique|constraint|duplicate/i);
    await assert.rejects(()=>store.getModelArtifact(A,newArtifact.artifactId),/not found/i);
    assert.deepEqual(await store.getCompilation(A,first.compilationId),first);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test("model compilation persistence rejects status-shape and artifact-record relationship violations before commit",async()=>{
  const phase2:any=await import("../src/index.ts");
  const {dir,db}=tempDb(),store=new phase2.ModelCompilationStore(db);
  try{
    const a=await artifact(0);
    const validated=record([a]);
    const missingProgram=structuredClone(validated);delete missingProgram.compiledProgram;delete missingProgram.compiledProgramHash;
    const missingCore={...missingProgram};delete missingCore.recordHash;missingProgram.recordHash=hashJson(missingCore);
    await assert.rejects(()=>store.commitCompilation(A,[a],missingProgram),/validated|program/i);

    const rejectedWithProgram=record([a],{status:"REJECTED",compiledProgram:structuredClone(program),compiledProgramHash:hashJson(program)});
    await assert.rejects(()=>store.commitCompilation(A,[a],rejectedWithProgram),/rejected|program/i);

    const wrongArtifacts=record([a],{exchangeArtifactHashes:[H("8")]});
    const wrongCore={...wrongArtifacts};delete wrongCore.recordHash;wrongArtifacts.recordHash=hashJson(wrongCore);
    await assert.rejects(()=>store.commitCompilation(A,[a],wrongArtifacts),/artifact|exchange|hash/i);

    await assert.rejects(()=>store.getCompilation(A,validated.compilationId),/not found/i);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test("SQLite model reads detect request response artifact program and record tampering",async()=>{
  const phase2:any=await import("../src/index.ts");
  const mutations=[
    {sql:"UPDATE axiom_model_exchange_artifacts SET request_body='tampered' WHERE tenant_id=? AND artifact_id=?",artifact:true},
    {sql:"UPDATE axiom_model_exchange_artifacts SET response_body='tampered' WHERE tenant_id=? AND artifact_id=?",artifact:true},
    {sql:"UPDATE axiom_model_exchange_artifacts SET artifact_hash=? WHERE tenant_id=? AND artifact_id=?",artifact:true,hash:true},
    {sql:"UPDATE axiom_model_compilations SET compiled_program_hash=? WHERE tenant_id=? AND compilation_id=?",artifact:false,hash:true},
    {sql:"UPDATE axiom_model_compilations SET record_hash=? WHERE tenant_id=? AND compilation_id=?",artifact:false,hash:true}
  ];
  for(const [i,mutation] of mutations.entries()){
    const {dir,db}=tempDb(),store=new phase2.ModelCompilationStore(db);
    try{
      const a=await artifact(0),compiled=record([a],{compilationId:`model-compilation:${String(i).padStart(64,"0")}`});
      const fixed={...compiled};delete fixed.recordHash;compiled.recordHash=hashJson(fixed);
      await store.commitCompilation(A,[a],compiled);
      const direct=new DatabaseSync(db);
      try{
        if(mutation.artifact){
          if(mutation.hash)direct.prepare(mutation.sql).run(H("7"),A.tenantId,a.artifactId);
          else direct.prepare(mutation.sql).run(A.tenantId,a.artifactId);
        }else{
          direct.prepare(mutation.sql).run(H("7"),A.tenantId,compiled.compilationId);
        }
      }finally{direct.close();}
      if(mutation.artifact)await assert.rejects(()=>store.getModelArtifact(A,a.artifactId),/integrity|hash/i);
      else await assert.rejects(()=>store.getCompilation(A,compiled.compilationId),/integrity|hash|program/i);
    }finally{store.close();rmSync(dir,{recursive:true,force:true});}
  }
});

test("SQLite persists rejected terminal compilations without executable program material",async()=>{
  const phase2:any=await import("../src/index.ts");
  const {dir,db}=tempDb(),store=new phase2.ModelCompilationStore(db);
  try{
    const a=await artifact(0),rejected=record([a],{status:"REJECTED",compilationId:"model-compilation:"+H("6")});
    await store.commitCompilation(A,[a],rejected);
    const loaded=await store.getCompilation(A,rejected.compilationId);
    assert.equal(loaded.status,"REJECTED");
    assert.equal("compiledProgram" in loaded,false);
    assert.equal("compiledProgramHash" in loaded,false);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
