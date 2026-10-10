import assert from "node:assert/strict";
import { sign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { canonicalize, createDefaultRegistry, createSigner, type AxiomProgram } from "../../phase1/src/index.ts";
import {
  AuthenticatedFactIngestor, WorldStateStore, ExecutionStore,
  ReasoningControlPlane, createIngestionKeyring, createStaticSignerProvider, createKeyringSignerProvider,
  type SignedFactEnvelope, type TemporalFact
} from "../src/index.ts";

const fixture=JSON.parse(readFileSync(new URL("../../phase1/fixtures/xau-risk-program.json",import.meta.url),"utf8")) as AxiomProgram;
const dir=mkdtempSync(join(tmpdir(),"axiom-phase21-gate-"));
const db=join(dir,"platform.db");
const tenant={tenantId:"tenant:gate"};
const otherTenant={tenantId:"tenant:other"};

const fact=(id:string,value:number,observedAt:string,source:string):TemporalFact=>({
  id,entity:"risk:alpha",attribute:"max_vol",
  value:{type:{kind:"number",unit:"ratio"},value},
  validFrom:"2026-10-05T18:00:00.000Z",observedAt,source,confidence:1
});
const request=(asOf="2026-10-05T18:30:00.000Z")=>({
  asOf,issuedAt:new Date(Date.parse(asOf)+1000).toISOString(),program:structuredClone(fixture),
  requirements:[{id:"fresh-risk-limit",entity:"risk:alpha",attribute:"max_vol",maxAgeMs:10*60*1000}],
  bindings:[{inputName:"max_vol",entity:"risk:alpha",attribute:"max_vol"}]
});

try{
  const v1=createSigner(),v2=createSigner(),feedSigner=createSigner();
  let world=new WorldStateStore(db),executions=new ExecutionStore(db);

  const feedKeyId="risk-feed:v1";
  const keyring=createIngestionKeyring({[tenant.tenantId]:{[feedKeyId]:feedSigner.publicKey}});
  const ingestor=new AuthenticatedFactIngestor({
    tenant,world,keyring,maxEnvelopeAgeMs:10*60*1000,maxFutureSkewMs:30*1000
  });
  const unsignedFact=fact("risk-1",0.30,"2026-10-05T18:25:00.000Z","risk-engine:primary");
  const envelopeBase={
    tenantId:tenant.tenantId,keyId:feedKeyId,issuedAt:"2026-10-05T18:25:30.000Z",
    nonce:"phase21-gate-nonce",fact:unsignedFact
  };
  const envelope:SignedFactEnvelope={
    ...envelopeBase,
    signature:sign(null,Buffer.from(canonicalize(envelopeBase as any)),feedSigner.privateKey).toString("base64")
  };
  const authenticated=await ingestor.ingest(envelope,"2026-10-05T18:26:00.000Z");
  assert.equal(authenticated.authentication?.keyId,feedKeyId);
  assert.match(authenticated.authentication?.envelopeHash??"",/^[0-9a-f]{64}$/);

  const issued=await new ReasoningControlPlane({
    tenant,world,executions,signer:createStaticSignerProvider("key:v1",v1),registry:createDefaultRegistry()
  }).execute(request());
  assert.equal(issued.status,"APPROVED");assert.ok(issued.executionRecordId);assert.ok(issued.certificateId);

  const record=await executions.get(tenant,issued.executionRecordId!);
  const storedSnapshot=await world.getSnapshot(tenant,record.snapshotId);
  const boundFact=storedSnapshot.facts.find(f=>f.id==="risk-1");
  assert.equal(boundFact?.authentication?.envelopeHash,authenticated.authentication?.envelopeHash);
  assert.ok(record.certificate.replay.program.assumptions.includes(`AXIOM_PLATFORM_CONTEXT_SHA256:${record.platformContextHash}`));

  const rotated=createKeyringSignerProvider("key:v2",v2,{"key:v1":v1.publicKey,"key:v2":v2.publicKey});
  let plane=new ReasoningControlPlane({tenant,world,executions,signer:rotated,registry:createDefaultRegistry()});
  assert.deepEqual(await plane.replayStored(issued.executionRecordId!),{status:"MATCH",diagnostics:[]});

  await assert.rejects(()=>world.getSnapshot(otherTenant,record.snapshotId),/not found.*tenant:other/i);
  await assert.rejects(()=>executions.get(otherTenant,issued.executionRecordId!),/not found.*tenant:other/i);
  const otherReplay=await new ReasoningControlPlane({
    tenant:otherTenant,world,executions,signer:rotated,registry:createDefaultRegistry()
  }).replayStored(issued.executionRecordId!);
  assert.equal(otherReplay.status,"MISMATCH");

  const stale=await plane.execute(request("2026-10-05T19:00:00.000Z"));
  assert.equal(stale.status,"DENIED");assert.equal(stale.policyDecision.checks[0].code,"STALE_EVIDENCE");

  await world.putFact(tenant,fact("risk-2",0.10,"2026-10-05T18:26:00.000Z","risk-engine:secondary"));
  const conflict=await plane.execute(request());
  assert.equal(conflict.status,"DENIED");assert.equal(conflict.policyDecision.checks[0].code,"CONFLICTING_EVIDENCE");

  world.close();executions.close();
  const raw=new DatabaseSync(db);
  const row=raw.prepare("SELECT snapshot_json FROM world_snapshots WHERE tenant_id = ? AND snapshot_id = ?").get(tenant.tenantId,record.snapshotId) as any;
  const snapshot=JSON.parse(String(row.snapshot_json));snapshot.facts[0].source="tampered";
  raw.prepare("UPDATE world_snapshots SET snapshot_json = ? WHERE tenant_id = ? AND snapshot_id = ?").run(JSON.stringify(snapshot),tenant.tenantId,record.snapshotId);raw.close();

  world=new WorldStateStore(db);executions=new ExecutionStore(db);
  plane=new ReasoningControlPlane({tenant,world,executions,signer:rotated,registry:createDefaultRegistry()});
  const tampered=await plane.replayStored(issued.executionRecordId!);
  assert.equal(tampered.status,"MISMATCH");assert.ok(tampered.diagnostics.some(x=>x.includes("snapshot integrity")));
  world.close();executions.close();

  console.log(JSON.stringify({
    phase:"P2.1 — Tenant Production Boundaries",status:"PASS",
    checks:[
      "verify Ed25519 authenticated fact envelope",
      "persist tenant-scoped authentication evidence",
      "enforce nonce replay protection",
      "materialize tenant-domain-separated deterministic snapshot",
      "commit authenticated snapshot into signed platform context",
      "execute Phase-1 runtime",
      "verify signer-provider output before persistence",
      "persist tenant-scoped execution record",
      "replay after signer-key rotation",
      "reject known-ID cross-tenant snapshot access",
      "reject known-ID cross-tenant execution access/replay",
      "deny stale/conflicting evidence before execution",
      "detect persisted snapshot tampering"
    ],
    tenantId:tenant.tenantId,
    executionRecordId:issued.executionRecordId,
    certificateId:issued.certificateId,
    snapshotId:issued.snapshotId,
    ingressEnvelopeHash:authenticated.authentication?.envelopeHash
  },null,2));
}finally{rmSync(dir,{recursive:true,force:true});}
