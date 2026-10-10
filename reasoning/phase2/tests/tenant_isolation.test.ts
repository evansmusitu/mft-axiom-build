import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { createDefaultRegistry, createSigner, type AxiomProgram } from "../../phase1/src/index.ts";
import {
  WorldStateStore, ExecutionStore, ReasoningControlPlane, createStaticSignerProvider, type TemporalFact
} from "../src/index.ts";

const A={tenantId:"tenant-a"}; const B={tenantId:"tenant-b"};
const fixture=JSON.parse(readFileSync(new URL("../../phase1/fixtures/xau-risk-program.json",import.meta.url),"utf8")) as AxiomProgram;

function fact(value:string):TemporalFact {
  return {id:"shared-fact",entity:"portfolio:alpha",attribute:"equity",value:{type:{kind:"decimal",unit:"USD",scale:2},value},validFrom:"2026-10-06T03:00:00.000Z",observedAt:"2026-10-06T03:00:00.000Z",source:"custodian:test",confidence:1};
}
function riskFact():TemporalFact {
  return {id:"risk-limit",entity:"risk:alpha",attribute:"max_vol",value:{type:{kind:"number",unit:"ratio"},value:0.30},validFrom:"2026-10-06T03:00:00.000Z",observedAt:"2026-10-06T03:25:00.000Z",source:"risk-engine:test",confidence:1};
}
function request(){
  return {asOf:"2026-10-06T03:30:00.000Z",issuedAt:"2026-10-06T03:30:01.000Z",program:structuredClone(fixture),requirements:[{id:"fresh-risk-limit",entity:"risk:alpha",attribute:"max_vol",maxAgeMs:10*60*1000}],bindings:[{inputName:"max_vol",entity:"risk:alpha",attribute:"max_vol"}]};
}

test("world state isolates identical object IDs by tenant and domain-separates snapshots",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"axiom-p21-tenant-")); const db=join(dir,"world.db"); const world=new WorldStateStore(db);
  try{
    await world.putFact(A,fact("100000.00")); await world.putFact(B,fact("200000.00"));
    const a=await world.snapshot(A,"2026-10-06T03:30:00.000Z");
    const b=await world.snapshot(B,"2026-10-06T03:30:00.000Z");
    assert.equal(a.tenantId,"tenant-a"); assert.equal(b.tenantId,"tenant-b");
    assert.equal(a.facts[0].value.value,"100000.00"); assert.equal(b.facts[0].value.value,"200000.00");
    assert.notEqual(a.snapshotHash,b.snapshotHash);
    await assert.rejects(()=>world.getSnapshot(B,a.snapshotId),/not found|tenant/i);
  }finally{world.close();rmSync(dir,{recursive:true,force:true});}
});

test("known execution IDs cannot cross tenant repository or replay boundaries",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"axiom-p21-exec-")); const db=join(dir,"platform.db");
  const world=new WorldStateStore(db),executions=new ExecutionStore(db),signer=createStaticSignerProvider("key:test",createSigner());
  try{
    await world.putFact(A,riskFact());
    const planeA=new ReasoningControlPlane({tenant:A,world,executions,signer,registry:createDefaultRegistry()});
    const issued=await planeA.execute(request());
    assert.equal(issued.status,"APPROVED"); assert.ok(issued.executionRecordId);
    await assert.rejects(()=>executions.get(B,issued.executionRecordId!),/not found.*tenant-b/i);
    const planeB=new ReasoningControlPlane({tenant:B,world,executions,signer,registry:createDefaultRegistry()});
    const replay=await planeB.replayStored(issued.executionRecordId!);
    assert.equal(replay.status,"MISMATCH"); assert.ok(replay.diagnostics.some(x=>x.includes("tenant-b")));
  }finally{world.close();executions.close();rmSync(dir,{recursive:true,force:true});}
});

test("tenant-aware stores fail closed on the legacy global SQLite schema",()=>{
  const dir=mkdtempSync(join(tmpdir(),"axiom-p21-legacy-")); const db=join(dir,"legacy.db");
  try{
    const raw=new DatabaseSync(db);
    raw.exec(`
      CREATE TABLE temporal_facts (
        id TEXT PRIMARY KEY, entity TEXT NOT NULL, attribute TEXT NOT NULL, value_json TEXT NOT NULL,
        valid_from TEXT NOT NULL, valid_until TEXT, observed_at TEXT NOT NULL, source TEXT NOT NULL,
        confidence REAL, supersedes_json TEXT NOT NULL DEFAULT '[]'
      );
      CREATE TABLE world_snapshots (
        snapshot_id TEXT PRIMARY KEY, as_of TEXT NOT NULL, snapshot_hash TEXT NOT NULL, snapshot_json TEXT NOT NULL
      );
      CREATE TABLE platform_executions (
        id TEXT PRIMARY KEY, record_hash TEXT NOT NULL, record_json TEXT NOT NULL
      );
    `);
    raw.close();

    assert.throws(()=>new WorldStateStore(db),/legacy.*sqlite.*tenant_id|tenant_id.*migration/i);
    assert.throws(()=>new ExecutionStore(db),/legacy.*sqlite.*tenant_id|tenant_id.*migration/i);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
