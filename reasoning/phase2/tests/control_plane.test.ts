import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { AxiomRuntime, compileProgram, createDefaultRegistry, createSigner, hashJson, issueCertificate, type AxiomProgram } from "../../phase1/src/index.ts";
import {
  WorldStateStore, ExecutionStore, ReasoningControlPlane, createStaticSignerProvider, createKeyringSignerProvider,
  type SignerProvider, type TemporalFact
} from "../src/index.ts";

const fixture=JSON.parse(readFileSync(new URL("../../phase1/fixtures/xau-risk-program.json",import.meta.url),"utf8")) as AxiomProgram;
const tenant={tenantId:"tenant:test"};

function riskFact(observedAt="2026-10-05T18:25:00.000Z",overrides:Partial<TemporalFact>={}):TemporalFact {
  return {
    id:"risk-limit-1",entity:"risk:alpha",attribute:"max_vol",
    value:{type:{kind:"number",unit:"ratio"},value:0.30},
    validFrom:"2026-10-05T18:00:00.000Z",observedAt,source:"risk-engine:test",confidence:1,...overrides
  };
}
function request(){
  return {
    asOf:"2026-10-05T18:30:00.000Z",issuedAt:"2026-10-05T18:30:01.000Z",
    program:structuredClone(fixture),
    requirements:[{id:"fresh-risk-limit",entity:"risk:alpha",attribute:"max_vol",maxAgeMs:10*60*1000}],
    bindings:[{inputName:"max_vol",entity:"risk:alpha",attribute:"max_vol"}]
  };
}
function plane(world:WorldStateStore,executions:ExecutionStore,signer=createStaticSignerProvider("key:test:v1",createSigner())){
  return new ReasoningControlPlane({tenant,world,executions,signer,registry:createDefaultRegistry()});
}

test("control plane binds trusted world state, persists a certificate, and replays after reopen",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"axiom-p2-control-")); const db=join(dir,"platform.db");
  try{
    const signer=createStaticSignerProvider("key:test:v1",createSigner());
    let world=new WorldStateStore(db),executions=new ExecutionStore(db);
    await world.putFact(tenant,riskFact());
    let control=plane(world,executions,signer);
    const result=await control.execute(request());
    assert.equal(result.status,"APPROVED"); assert.match(result.certificateId??"",/^[0-9a-f]{64}$/); assert.ok(result.executionRecordId);

    world.close();executions.close();
    world=new WorldStateStore(db);executions=new ExecutionStore(db);control=plane(world,executions,signer);
    assert.deepEqual(await control.replayStored(result.executionRecordId!),{status:"MATCH",diagnostics:[]});

    const stored=await executions.get(tenant,result.executionRecordId!);
    assert.equal(stored.tenantId,tenant.tenantId);
    assert.equal(stored.signerKeyId,"key:test:v1");
    assert.equal(stored.bindings[0].factId,"risk-limit-1");
    assert.equal(stored.snapshotId,result.snapshotId);
    assert.match(stored.platformContextHash,/^[0-9a-f]{64}$/);
    assert.ok(stored.certificate.replay.program.assumptions.includes(`AXIOM_PLATFORM_CONTEXT_SHA256:${stored.platformContextHash}`));
    world.close();executions.close();
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test("new execution records cryptographically identify the signer boundary and signing intent",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"axiom-p2-signer-context-")); const db=join(dir,"platform.db");
  try{
    const signer=createStaticSignerProvider("key:context:v1",createSigner());
    const world=new WorldStateStore(db),executions=new ExecutionStore(db);
    await world.putFact(tenant,riskFact());
    const issued=await new ReasoningControlPlane({tenant,world,executions,signer,registry:createDefaultRegistry()}).execute(request());
    const stored:any=await executions.get(tenant,issued.executionRecordId!);
    assert.equal(stored.platformContextVersion,"2");
    assert.deepEqual(stored.signerIdentity,signer.identity);
    assert.equal(stored.signerKeyId,signer.identity.keyId);
    assert.match(stored.signingIntentId,/^[0-9a-f]{64}$/);
    world.close();executions.close();
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test("control plane denies stale evidence before Phase-1 execution and certificate persistence",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"axiom-p2-deny-")); const db=join(dir,"platform.db");
  try{
    const world=new WorldStateStore(db),executions=new ExecutionStore(db);
    await world.putFact(tenant,riskFact("2026-10-05T18:00:00.000Z"));
    const result=await plane(world,executions).execute(request());
    assert.equal(result.status,"DENIED"); assert.equal(result.policyDecision.checks[0].code,"STALE_EVIDENCE");
    assert.equal(result.certificateId,undefined); assert.equal(result.executionRecordId,undefined);
    world.close();executions.close();
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test("control plane denies unresolved conflicting evidence before certificate issuance",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"axiom-p2-conflict-")); const db=join(dir,"platform.db");
  try{
    const world=new WorldStateStore(db),executions=new ExecutionStore(db);
    await world.putFact(tenant,riskFact());
    await world.putFact(tenant,riskFact("2026-10-05T18:26:00.000Z",{id:"risk-limit-2",source:"risk-engine:secondary",value:{type:{kind:"number",unit:"ratio"},value:0.10}}));
    const result=await plane(world,executions).execute(request());
    assert.equal(result.status,"DENIED"); assert.equal(result.policyDecision.checks[0].code,"CONFLICTING_EVIDENCE"); assert.equal(result.certificateId,undefined);
    world.close();executions.close();
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test("historical certificate replay survives active signer rotation when the old trust key remains in the keyring",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"axiom-p2-rotate-")); const db=join(dir,"platform.db");
  try{
    const v1=createSigner(),v2=createSigner(),world=new WorldStateStore(db),executions=new ExecutionStore(db);
    await world.putFact(tenant,riskFact());
    const issued=await new ReasoningControlPlane({tenant,world,executions,signer:createStaticSignerProvider("key:v1",v1),registry:createDefaultRegistry()}).execute(request());
    assert.ok(issued.executionRecordId);

    const rotated=createKeyringSignerProvider("key:v2",v2,{"key:v1":v1.publicKey,"key:v2":v2.publicKey});
    const replay=await new ReasoningControlPlane({tenant,world,executions,signer:rotated,registry:createDefaultRegistry()}).replayStored(issued.executionRecordId!);
    assert.deepEqual(replay,{status:"MATCH",diagnostics:[]});

    const missingOld=createKeyringSignerProvider("key:v2",v2,{"key:v2":v2.publicKey});
    const rejected=await new ReasoningControlPlane({tenant,world,executions,signer:missingOld,registry:createDefaultRegistry()}).replayStored(issued.executionRecordId!);
    assert.equal(rejected.status,"MISMATCH"); assert.ok(rejected.diagnostics.some(x=>x.includes("unknown signer key")));
    world.close();executions.close();
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test("replay rejects tampering with a persisted world snapshot",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"axiom-p2-snapshot-tamper-")); const db=join(dir,"platform.db");
  try{
    const signer=createStaticSignerProvider("key:test:v1",createSigner());
    let world=new WorldStateStore(db),executions=new ExecutionStore(db);
    await world.putFact(tenant,riskFact());
    const issued=await plane(world,executions,signer).execute(request());
    const stored=await executions.get(tenant,issued.executionRecordId!);
    world.close();executions.close();

    const raw=new DatabaseSync(db);
    const row=raw.prepare("SELECT snapshot_json FROM world_snapshots WHERE tenant_id = ? AND snapshot_id = ?").get(tenant.tenantId,stored.snapshotId) as any;
    const snapshot=JSON.parse(String(row.snapshot_json)); snapshot.facts[0].source="tampered-source";
    raw.prepare("UPDATE world_snapshots SET snapshot_json = ? WHERE tenant_id = ? AND snapshot_id = ?").run(JSON.stringify(snapshot),tenant.tenantId,stored.snapshotId);
    raw.close();

    world=new WorldStateStore(db);executions=new ExecutionStore(db);
    const replay=await plane(world,executions,signer).replayStored(issued.executionRecordId!);
    assert.equal(replay.status,"MISMATCH"); assert.ok(replay.diagnostics.some(x=>x.includes("snapshot integrity")));
    world.close();executions.close();
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test("execution store rejects tampering with a persisted platform record",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"axiom-p2-record-tamper-")); const db=join(dir,"platform.db");
  try{
    const world=new WorldStateStore(db); let executions=new ExecutionStore(db);
    await world.putFact(tenant,riskFact());
    const issued=await plane(world,executions).execute(request()); const id=issued.executionRecordId!;
    world.close();executions.close();

    const raw=new DatabaseSync(db);
    const row=raw.prepare("SELECT record_json FROM platform_executions WHERE tenant_id = ? AND id = ?").get(tenant.tenantId,id) as any;
    const record=JSON.parse(String(row.record_json)); record.signerKeyId="key:attacker";
    raw.prepare("UPDATE platform_executions SET record_json = ? WHERE tenant_id = ? AND id = ?").run(JSON.stringify(record),tenant.tenantId,id);
    raw.close();

    executions=new ExecutionStore(db);
    await assert.rejects(()=>executions.get(tenant,id),/record integrity mismatch/i);
    executions.close();
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test("replay rejects policy-context rewriting even if an attacker recomputes the unkeyed record hash",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"axiom-p2-context-tamper-")); const db=join(dir,"platform.db");
  try{
    const signer=createStaticSignerProvider("key:test:v1",createSigner());
    let world=new WorldStateStore(db),executions=new ExecutionStore(db);
    await world.putFact(tenant,riskFact());
    const issued=await plane(world,executions,signer).execute(request()); const id=issued.executionRecordId!;
    world.close();executions.close();

    const raw=new DatabaseSync(db);
    const row=raw.prepare("SELECT record_json FROM platform_executions WHERE tenant_id = ? AND id = ?").get(tenant.tenantId,id) as any;
    const record=JSON.parse(String(row.record_json)); record.requirements[0].maxAgeMs=24*60*60*1000;
    const forgedContext={tenantId:record.tenantId,snapshotId:record.snapshotId,snapshotHash:record.snapshotHash,policyDecision:record.policyDecision,policyManifest:record.policyManifest,requirements:record.requirements,bindings:record.bindings};
    record.platformContextHash=hashJson(forgedContext);
    const {recordHash:_,...core}=record; record.recordHash=hashJson(core);
    raw.prepare("UPDATE platform_executions SET record_hash = ?, record_json = ? WHERE tenant_id = ? AND id = ?").run(record.recordHash,JSON.stringify(record),tenant.tenantId,id);
    raw.close();

    world=new WorldStateStore(db);executions=new ExecutionStore(db);
    const replay=await plane(world,executions,signer).replayStored(id);
    assert.equal(replay.status,"MISMATCH"); assert.ok(replay.diagnostics.some(x=>x.includes("platform context")));
    world.close();executions.close();
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test("control plane rejects a signer provider that returns a certificate outside its declared trust anchor",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"axiom-p2-hostile-signer-")); const db=join(dir,"platform.db");
  try{
    const trusted=createSigner(),attacker=createSigner();
    const declared=createStaticSignerProvider("key:trusted",trusted);
    const hostile:SignerProvider={
      ...declared,
      issue:async(program,execution,issuedAt)=>issueCertificate(program,execution,attacker,issuedAt)
    };
    const world=new WorldStateStore(db),executions=new ExecutionStore(db);
    await world.putFact(tenant,riskFact());
    await assert.rejects(()=>new ReasoningControlPlane({tenant,world,executions,signer:hostile,registry:createDefaultRegistry()}).execute(request()),/signer provider issued invalid certificate/i);
    world.close();executions.close();
  }finally{rmSync(dir,{recursive:true,force:true});}
});


test("bound distributed execution uses the frozen snapshot and one stable execution intent",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"axiom-p2-bound-intent-")); const db=join(dir,"platform.db");
  try{
    const signer=createStaticSignerProvider("key:bound:v1",createSigner());
    const world=new WorldStateStore(db),executions=new ExecutionStore(db),control=plane(world,executions,signer);
    await world.putFact(tenant,riskFact());
    const frozen=await world.snapshot(tenant,request().asOf);

    await world.putFact(tenant,riskFact("2026-10-05T18:26:00.000Z",{
      id:"late-conflicting-risk",source:"risk-engine:late",
      value:{type:{kind:"number",unit:"ratio"},value:0.10}
    }));

    const intentId="execution-job:"+"a".repeat(64);
    const first=await (control as any).executeBound(request(),frozen.snapshotId,intentId);
    assert.equal(first.status,"APPROVED");
    assert.equal(first.snapshotId,frozen.snapshotId);

    const stored=await (executions as any).getByIntent(tenant,intentId);
    assert.equal(stored.executionIntentId,intentId);
    assert.equal(stored.snapshotId,frozen.snapshotId);
    assert.equal(stored.bindings[0].factId,"risk-limit-1");

    const replay=await (control as any).executeBound(request(),frozen.snapshotId,intentId);
    assert.deepEqual(replay,first);

    const raw=new DatabaseSync(db);
    assert.equal(Number((raw.prepare("SELECT COUNT(*) AS n FROM platform_executions WHERE tenant_id=?").get(tenant.tenantId) as any).n),1);
    assert.equal(Number((raw.prepare("SELECT COUNT(*) AS n FROM execution_intents WHERE tenant_id=?").get(tenant.tenantId) as any).n),1);
    raw.close();

    const changed=structuredClone(request());
    changed.issuedAt="2026-10-05T18:30:02.000Z";
    await assert.rejects(
      ()=>(control as any).executeBound(changed,frozen.snapshotId,intentId),
      /intent|request|mismatch|different/i
    );

    world.close();executions.close();
  }finally{rmSync(dir,{recursive:true,force:true});}
});


test("bound execution recovery replay-verifies an existing intent before returning its outcome",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"axiom-p2-bound-proof-recovery-")); const db=join(dir,"platform.db");
  try{
    const signer=createStaticSignerProvider("key:bound-proof:v1",createSigner());
    let world=new WorldStateStore(db),executions=new ExecutionStore(db);
    await world.putFact(tenant,riskFact());
    const frozen=await world.snapshot(tenant,request().asOf);
    let control=plane(world,executions,signer);
    const intentId="execution-job:"+"b".repeat(64);
    const issued=await (control as any).executeBound(request(),frozen.snapshotId,intentId);
    assert.equal(issued.status,"APPROVED");
    world.close();executions.close();

    const raw=new DatabaseSync(db);
    const row=raw.prepare("SELECT id,record_json FROM platform_executions WHERE tenant_id=?").get(tenant.tenantId) as any;
    const record=JSON.parse(String(row.record_json));
    record.certificate.core.decisionStatus="DENIED";
    const {recordHash:_,...core}=record;
    record.recordHash=hashJson(core);
    raw.prepare("UPDATE platform_executions SET record_hash=?,record_json=? WHERE tenant_id=? AND id=?")
      .run(record.recordHash,JSON.stringify(record),tenant.tenantId,String(row.id));
    raw.prepare("UPDATE execution_intents SET record_hash=? WHERE tenant_id=? AND intent_id=?")
      .run(record.recordHash,tenant.tenantId,intentId);
    raw.close();

    world=new WorldStateStore(db);executions=new ExecutionStore(db);control=plane(world,executions,signer);
    await assert.rejects(
      ()=>(control as any).executeBound(request(),frozen.snapshotId,intentId),
      /proof|replay|certificate|signature|mismatch/i
    );
    world.close();executions.close();
  }finally{rmSync(dir,{recursive:true,force:true});}
});


test("v2 replay rejects signer identity or signing-intent rewriting after unkeyed record hashes are recomputed",async()=>{
  for(const field of ["identity","intent"] as const){
    const dir=mkdtempSync(join(tmpdir(),`axiom-p2-signer-tamper-${field}-`)); const db=join(dir,"platform.db");
    try{
      const key=createSigner(),signer=createStaticSignerProvider("key:tamper:v1",key);
      let world=new WorldStateStore(db),executions=new ExecutionStore(db);
      await world.putFact(tenant,riskFact());
      const issued=await new ReasoningControlPlane({tenant,world,executions,signer,registry:createDefaultRegistry()}).execute(request());
      const id=issued.executionRecordId!;
      world.close();executions.close();

      const raw=new DatabaseSync(db);
      const row=raw.prepare("SELECT record_json FROM platform_executions WHERE tenant_id=? AND id=?").get(tenant.tenantId,id) as any;
      const record=JSON.parse(String(row.record_json));
      if(field==="identity")record.signerIdentity.providerId="forged-provider";
      else record.signingIntentId="f".repeat(64);
      const {recordHash:_,...core}=record;record.recordHash=hashJson(core);
      raw.prepare("UPDATE platform_executions SET record_hash=?, record_json=? WHERE tenant_id=? AND id=?")
        .run(record.recordHash,JSON.stringify(record),tenant.tenantId,id);
      raw.close();

      world=new WorldStateStore(db);executions=new ExecutionStore(db);
      const replay=await new ReasoningControlPlane({tenant,world,executions,signer,registry:createDefaultRegistry()}).replayStored(id);
      assert.equal(replay.status,"MISMATCH");
      assert.ok(replay.diagnostics.some(x=>/platform context|signing intent|signer identity/i.test(x)),replay.diagnostics.join("; "));
      world.close();executions.close();
    }finally{rmSync(dir,{recursive:true,force:true});}
  }
});

test("v2 control plane still replays a correctly signed legacy v1 execution record",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"axiom-p2-legacy-signer-context-")); const db=join(dir,"platform.db");
  try{
    const signingKey=createSigner(),signer=createStaticSignerProvider("key:legacy:v1",signingKey);
    const registry=createDefaultRegistry();
    const world=new WorldStateStore(db),executions=new ExecutionStore(db);
    await world.putFact(tenant,riskFact());
    const issued=await new ReasoningControlPlane({tenant,world,executions,signer,registry}).execute(request());
    const current:any=await executions.get(tenant,issued.executionRecordId!);

    const legacyContext:any={
      tenantId:current.tenantId,snapshotId:current.snapshotId,snapshotHash:current.snapshotHash,
      policyDecision:current.policyDecision,policyManifest:current.policyManifest,
      requirements:current.requirements,bindings:current.bindings
    };
    if(current.executionIntentId){
      legacyContext.executionIntentId=current.executionIntentId;
      legacyContext.executionRequestHash=current.executionRequestHash;
    }
    const legacyContextHash=hashJson(legacyContext);
    const legacyProgram=structuredClone(current.certificate.replay.program);
    legacyProgram.assumptions=legacyProgram.assumptions.map((value:string)=>
      value.startsWith("AXIOM_PLATFORM_CONTEXT_SHA256:")?`AXIOM_PLATFORM_CONTEXT_SHA256:${legacyContextHash}`:value
    );
    const compiled=compileProgram(legacyProgram,registry);
    const execution=new AxiomRuntime(registry).execute(compiled);
    const certificate=issueCertificate(compiled,execution,signingKey,current.certificate.issuedAt);
    const legacyCore:any={
      id:`platform:${certificate.certificateId}`,tenantId:current.tenantId,
      snapshotId:current.snapshotId,snapshotHash:current.snapshotHash,
      policyDecision:current.policyDecision,policyManifest:current.policyManifest,
      requirements:current.requirements,bindings:current.bindings,
      platformContextHash:legacyContextHash,certificate,signerKeyId:current.signerKeyId,
      ...(current.executionIntentId?{executionIntentId:current.executionIntentId,executionRequestHash:current.executionRequestHash}:{})
    };
    const legacy={...legacyCore,recordHash:hashJson(legacyCore)};
    await executions.put(tenant,legacy);
    assert.deepEqual(
      await new ReasoningControlPlane({tenant,world,executions,signer,registry}).replayStored(legacy.id),
      {status:"MATCH",diagnostics:[]}
    );
    world.close();executions.close();
  }finally{rmSync(dir,{recursive:true,force:true});}
});


test("control plane refuses signer identity or signing-intent inconsistency before persistence",async()=>{
  for(const mode of ["identity","intent"] as const){
    const dir=mkdtempSync(join(tmpdir(),`axiom-p25b-signer-consistency-${mode}-`)); const db=join(dir,"platform.db");
    try{
      const base=createStaticSignerProvider("key:consistency:v1",createSigner());
      const signer:SignerProvider=mode==="identity"
        ? {...base,identity:{...base.identity,publicKeySha256:"f".repeat(64)}}
        : {...base,signingIntentId:()=> "e".repeat(64)};
      const world=new WorldStateStore(db),executions=new ExecutionStore(db);
      await world.putFact(tenant,riskFact());
      await assert.rejects(
        ()=>new ReasoningControlPlane({tenant,world,executions,signer,registry:createDefaultRegistry()}).execute(request()),
        /signer identity|signing intent|trusted public key/i
      );
      const raw=new DatabaseSync(db);
      assert.equal(Number((raw.prepare("SELECT COUNT(*) AS n FROM platform_executions WHERE tenant_id=?").get(tenant.tenantId) as any).n),0);
      raw.close();world.close();executions.close();
    }finally{rmSync(dir,{recursive:true,force:true});}
  }
});
