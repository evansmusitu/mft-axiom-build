import test from "node:test";
import assert from "node:assert/strict";
import { hashJson } from "../../phase1/src/canonical.ts";

const H=(c:string)=>c.repeat(64);
const tenant={tenantId:"tenant:explain"};
const profile={
  profileId:"profile:explain",version:"1.0.0",adapterId:"model:explain:test",
  maxPromptBytes:16384,maxResponseBytes:8192
};
const manifest={adapterId:"model:explain:test",version:"1.0.0",implementationHash:H("a"),provider:"fixture",modelId:"fixture-model"};

function context(overrides:any={}){
  return {
    principal:{principalId:"principal:alice",issuer:"issuer",subject:"alice"},
    credential:{issuer:"issuer",subject:"alice",keyId:"auth-key",jwtId:"jwt-1",issuedAt:"2026-10-07T20:00:00.000Z",expiresAt:"2026-10-07T23:00:00.000Z",tokenHash:H("b")},
    tenant,
    authorization:{
      status:"ALLOW",principalId:"principal:alice",requestedTenantId:tenant.tenantId,
      action:"model:explain",resource:{kind:"execution",id:"platform:cert-1"},matchedGrantIds:["grant:explain"],
      policyManifest:{id:"axiom.api-authorization",version:"1.0.0",implementationHash:H("c"),grantsHash:H("d")},
      decisionHash:H("e")
    },
    ...overrides
  };
}
function execution(){
  const core:any={
    id:"platform:cert-1",tenantId:tenant.tenantId,snapshotId:"snapshot:1",snapshotHash:H("1"),
    policyDecision:{status:"ALLOW",snapshotId:"snapshot:1",checks:[{requirementId:"r1",ok:true,code:"OK",factIds:["fact:1"],message:"fresh"}]},
    policyManifest:{id:"axiom.evidence-policy",version:"1.0.0",implementationHash:H("2")},
    requirements:[{id:"r1",entity:"risk:a",attribute:"current",maxAgeMs:60000}],
    bindings:[{inputName:"risk",entity:"risk:a",attribute:"current",factId:"fact:1"}],
    platformContextHash:H("3"),
    certificate:{
      certificateId:"cert-1",
      core:{certificateVersion:"0.1",decisionStatus:"APPROVED",outputs:{decision:{type:{kind:"boolean"},value:true}}},
      publicKeyPem:"PUBLIC-KEY-MUST-NOT-LEAVE",
      signature:"SIGNATURE-MUST-NOT-LEAVE",
      issuedAt:"2026-10-07T20:10:00.000Z",
      replay:{program:{irVersion:"0.1",objective:"private objective",assumptions:[],inputs:{},nodes:[],constraints:[],decisionNodeId:"decision"}}
    },
    signerKeyId:"signer:key-1"
  };
  return {...core,recordHash:hashJson(core)};
}
function normalized(content:any={summary:"The persisted proof approved the bounded decision.",keyFactors:["Evidence policy allowed the snapshot."],limitations:["This explanation is advisory and does not change the certificate."]}){
  return JSON.stringify(content);
}
function fakeAdapter(overrides:any={}){
  return {
    manifest,
    calls:[] as any[],
    async explain(input:any){
      this.calls.push(structuredClone(input));
      return {
        capturedAt:input.capturedAt,
        requestBody:JSON.stringify({prompt:input.promptBody}),
        responseBody:JSON.stringify({provider:"fixture",text:normalized()}),
        normalizedResponseBody:normalized(),
        ...overrides
      };
    }
  };
}
function deps(phase2:any,adapter:any,replayStatus:"MATCH"|"MISMATCH"="MATCH"){
  const stored=execution(),put:any[]=[];
  const executions={
    async get(scope:any,id:string){
      if(scope.tenantId!==tenant.tenantId||id!==stored.id)throw new Error("not found");
      return structuredClone(stored);
    },
    async put(){throw new Error("unused");}
  };
  const plane={async replayStored(id:string){assert.equal(id,stored.id);return {status:replayStatus,diagnostics:replayStatus==="MATCH"?[]:["forced mismatch"]};}};
  const explanations={async put(scope:any,record:any){put.push({scope:structuredClone(scope),record:structuredClone(record)});},async get(){throw new Error("unused");}};
  const profiles=new phase2.ModelExplanationRegistry([{profile,tenantIds:[tenant.tenantId]}]);
  return {stored,put,service:new phase2.ModelExplanationService({
    tenant,profiles,repository:explanations,executions,plane,adapters:[adapter],
    now:()=>new Date("2026-10-07T20:20:00.000Z")
  })};
}

test("proof-bound explanation requires exact model:explain authorization before profile or execution access",async()=>{
  const phase2:any=await import("../src/index.ts");
  assert.equal(typeof phase2.ModelExplanationService,"function");
  const adapter=fakeAdapter();
  const {service}=deps(phase2,adapter);
  for(const bad of [
    context({authorization:{...context().authorization,action:"execution:read"}}),
    context({authorization:{...context().authorization,resource:{kind:"execution",id:"platform:other"}}}),
    context({authorization:{...context().authorization,status:"DENY"}})
  ]){
    await assert.rejects(()=>service.explain(bad,"platform:cert-1",{profileId:"missing-profile"},H("9")),/authoriz/i);
    assert.equal(adapter.calls.length,0);
  }
});

test("explanation provider access occurs only after tenant-scoped stored replay MATCH",async()=>{
  const phase2:any=await import("../src/index.ts");
  const adapter=fakeAdapter();
  const {service}=deps(phase2,adapter,"MISMATCH");
  await assert.rejects(
    ()=>service.explain(context(),"platform:cert-1",{profileId:profile.profileId},H("9")),
    (e:any)=>e?.code==="MODEL_EXPLANATION_PROOF_REJECTED"&&e?.httpStatus===422
  );
  assert.equal(adapter.calls.length,0);
});

test("explanation prompt is a sanitized proof envelope and persisted output is advisory only",async()=>{
  const phase2:any=await import("../src/index.ts");
  const adapter=fakeAdapter();
  const {service,stored,put}=deps(phase2,adapter);
  const result=await service.explain(context(),stored.id,{profileId:profile.profileId},H("9"));
  assert.equal(result.status,"CREATED");
  assert.equal(result.authority,"ADVISORY_ONLY");
  assert.equal(result.provider,"fixture");
  assert.equal(result.modelId,"fixture-model");
  assert.equal(adapter.calls.length,1);

  const proof=JSON.parse(adapter.calls[0].promptBody);
  assert.equal(proof.schemaVersion,"axiom.explanation-proof.v1");
  assert.equal(proof.execution.id,stored.id);
  assert.equal(proof.execution.recordHash,stored.recordHash);
  assert.equal(proof.execution.snapshotId,stored.snapshotId);
  assert.equal(proof.execution.snapshotHash,stored.snapshotHash);
  assert.deepEqual(proof.execution.policyDecision,stored.policyDecision);
  assert.equal(proof.execution.certificateId,stored.certificate.certificateId);
  assert.equal(proof.execution.certificateIssuedAt,stored.certificate.issuedAt);
  assert.deepEqual(proof.execution.certificateCore,stored.certificate.core);
  assert.equal(proof.execution.signerKeyId,stored.signerKeyId);
  const promptText=adapter.calls[0].promptBody;
  for(const forbidden of [stored.certificate.publicKeyPem,stored.certificate.signature,"private objective","grant:explain",context().credential.tokenHash]){
    assert.equal(promptText.includes(forbidden),false);
  }

  assert.equal(put.length,1);
  const record=put[0].record;
  assert.equal(record.tenantId,tenant.tenantId);
  assert.equal(record.executionId,stored.id);
  assert.equal(record.executionRecordHash,stored.recordHash);
  assert.equal(record.authority,"ADVISORY_ONLY");
  assert.equal(record.principalId,"principal:alice");
  assert.equal(record.authorizationDecisionHash,H("e"));
  assert.equal(record.explanationRequestHash,H("9"));
  assert.match(record.requestBodyHash,/^[0-9a-f]{64}$/);
  assert.match(record.responseBodyHash,/^[0-9a-f]{64}$/);
  assert.match(record.normalizedResponseBodyHash,/^[0-9a-f]{64}$/);
  assert.match(record.recordHash,/^[0-9a-f]{64}$/);
  assert.ok(record.explanationId.startsWith("model-explanation:"));
  assert.equal(result.explanationId,record.explanationId);
});

test("explanation profile tenant eligibility and exact content bounds fail closed",async()=>{
  const phase2:any=await import("../src/index.ts");
  const ineligibleProfiles=new phase2.ModelExplanationRegistry([{profile,tenantIds:["tenant:other"]}]);
  const adapter=fakeAdapter();
  const stored=execution();
  const service=new phase2.ModelExplanationService({
    tenant,profiles:ineligibleProfiles,
    repository:{async put(){throw new Error("must not persist");},async get(){throw new Error("unused");}},
    executions:{async get(){return structuredClone(stored);},async put(){}},
    plane:{async replayStored(){return {status:"MATCH",diagnostics:[]};}},
    adapters:[adapter],now:()=>new Date("2026-10-07T20:20:00.000Z")
  });
  await assert.rejects(()=>service.explain(context(),stored.id,{profileId:profile.profileId},H("9")),(e:any)=>e?.httpStatus===403);
  assert.equal(adapter.calls.length,0);

  const badContents=[
    {summary:"",keyFactors:[],limitations:[]},
    {summary:"ok",keyFactors:"bad",limitations:[]},
    {summary:"ok",keyFactors:[],limitations:[],extra:true},
    {summary:"ok",keyFactors:Array(9).fill("x"),limitations:[]}
  ];
  for(const content of badContents){
    const badAdapter=fakeAdapter({normalizedResponseBody:normalized(content)});
    const {service:badService}=deps(phase2,badAdapter);
    await assert.rejects(()=>badService.explain(context(),stored.id,{profileId:profile.profileId},H("9")),(e:any)=>e?.httpStatus===502);
  }
});

test("provider receives immutable proof text only and cannot mutate trusted execution state",async()=>{
  const phase2:any=await import("../src/index.ts");
  const adapter:any={manifest,async explain(input:any){
    const parsed=JSON.parse(input.promptBody);parsed.execution.snapshotHash="attacker";
    return {capturedAt:input.capturedAt,requestBody:"{}",responseBody:"{}",normalizedResponseBody:normalized()};
  }};
  const {service,stored,put}=deps(phase2,adapter);
  await service.explain(context(),stored.id,{profileId:profile.profileId},H("9"));
  assert.equal(stored.snapshotHash,H("1"));
  assert.equal(put[0].record.executionRecordHash,stored.recordHash);
});
