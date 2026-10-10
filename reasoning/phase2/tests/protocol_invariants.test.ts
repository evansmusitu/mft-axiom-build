import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDefaultRegistry, createSigner, type AxiomProgram } from "../../phase1/src/index.ts";
import {
  WorldStateStore, ExecutionStore, ReasoningControlPlane, createStaticSignerProvider,
  evidencePolicyManifest, type ExecutionRequest, type TemporalFact
} from "../src/index.ts";

const fixture=JSON.parse(readFileSync(new URL("../../phase1/fixtures/xau-risk-program.json",import.meta.url),"utf8")) as AxiomProgram;
const tenant={tenantId:"tenant:test"};
function fact():TemporalFact {return {id:"risk-limit-1",entity:"risk:alpha",attribute:"max_vol",value:{type:{kind:"number",unit:"ratio"},value:0.30},validFrom:"2026-10-05T18:00:00.000Z",observedAt:"2026-10-05T18:25:00.000Z",source:"risk-engine:test",confidence:1};}
function request():ExecutionRequest {return {asOf:"2026-10-05T18:30:00.000Z",issuedAt:"2026-10-05T18:30:01.000Z",program:structuredClone(fixture),requirements:[{id:"fresh-risk-limit",entity:"risk:alpha",attribute:"max_vol",maxAgeMs:10*60*1000}],bindings:[{inputName:"max_vol",entity:"risk:alpha",attribute:"max_vol"}]};}

async function withPlane(run:(ctx:{plane:ReasoningControlPlane;executions:ExecutionStore})=>Promise<void>){
  const dir=mkdtempSync(join(tmpdir(),"axiom-p2-invariants-")); const db=join(dir,"platform.db");
  const world=new WorldStateStore(db),executions=new ExecutionStore(db);
  try{
    await world.putFact(tenant,fact());
    const plane=new ReasoningControlPlane({tenant,world,executions,signer:createStaticSignerProvider("key:test:v1",createSigner()),registry:createDefaultRegistry()});
    await run({plane,executions});
  }finally{world.close();executions.close();rmSync(dir,{recursive:true,force:true});}
}

test("control plane rejects duplicate requirement IDs and duplicate binding input names",async()=>{
  await withPlane(async({plane})=>{
    const duplicateRequirement=request(); duplicateRequirement.requirements.push({...duplicateRequirement.requirements[0],maxAgeMs:20*60*1000});
    await assert.rejects(()=>plane.execute(duplicateRequirement),/duplicate evidence requirement id/i);
    const duplicateBinding=request(); duplicateBinding.bindings.push({...duplicateBinding.bindings[0]});
    await assert.rejects(()=>plane.execute(duplicateBinding),/duplicate binding input name/i);
  });
});

test("certificate issuance time cannot predate the world-state snapshot",async()=>{
  await withPlane(async({plane})=>{const r=request();r.issuedAt="2026-10-05T18:29:59.000Z";await assert.rejects(()=>plane.execute(r),/issuedAt.*before.*snapshot/i);});
});

test("execution record and signed context commit to the policy-engine implementation manifest",async()=>{
  await withPlane(async({plane,executions})=>{
    const result=await plane.execute(request()); assert.ok(result.executionRecordId);
    const record=await executions.get(tenant,result.executionRecordId!); const current=evidencePolicyManifest();
    assert.deepEqual(record.policyManifest,current); assert.equal(record.tenantId,tenant.tenantId);
    assert.equal(record.policyManifest.id,"axiom.evidence-policy"); assert.match(record.policyManifest.implementationHash,/^[0-9a-f]{64}$/);
    assert.ok(record.certificate.replay.program.assumptions.includes(`AXIOM_PLATFORM_CONTEXT_SHA256:${record.platformContextHash}`));
  });
});
