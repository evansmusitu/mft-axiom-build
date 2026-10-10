import test from "node:test";
import assert from "node:assert/strict";
import { sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { canonicalize, createSigner, hashJson } from "../../phase1/src/index.ts";

const A={tenantId:"tenant:evidence-a"},B={tenantId:"tenant:evidence-b"};
const NOW="2026-10-06T10:00:00.000Z";
const H=(c:string)=>c.repeat(64);

function dirDb(prefix:string){const dir=mkdtempSync(join(tmpdir(),prefix));return {dir,db:join(dir,"platform.db")};}
function mapper(){
  return {
    manifest:{mappingId:"map:v1",version:"1.0.0",implementationHash:H("c")},
    map(){
      return [{
        entity:"market:xauusd",attribute:"price",
        value:{type:{kind:"number",unit:"USD/oz"},value:2400},
        validFrom:"2026-10-06T09:59:00.000Z",observedAt:"2026-10-06T09:59:30.000Z",
        source:"adapter:test",confidence:1
      }];
    }
  };
}
function artifact(phase2:any){
  return phase2.createEvidenceArtifact({
    tenantId:A.tenantId,adapterId:"adapter:test",adapterVersion:"1.0.0",adapterImplementationHash:H("a"),
    operationId:"read",mappingId:"map:v1",canonicalRequestHash:H("d"),capturedAt:NOW,
    upstreamStatus:200,mediaType:"application/json",bodyEncoding:"utf8",body:'{"price":2400}'
  });
}
function signed(phase2:any,signer:any,fact:any,nonce:string){
  const base={tenantId:A.tenantId,keyId:"adapter:test:v1",issuedAt:"2026-10-06T09:59:50.000Z",nonce,fact};
  return {...base,signature:sign(null,Buffer.from(canonicalize(base as any)),signer.privateKey).toString("base64")};
}
function recordFor(artifact:any,factIds:string[]){
  const core={
    acquisitionId:`acquisition:${H("f")}`,tenantId:A.tenantId,principalId:"principal:test",
    authorizationDecisionHash:H("e"),adapterId:artifact.adapterId,adapterVersion:artifact.adapterVersion,
    adapterImplementationHash:artifact.adapterImplementationHash,operationId:artifact.operationId,mappingId:"map:v1",
    mappingVersion:"1.0.0",mappingImplementationHash:H("c"),canonicalRequestHash:artifact.canonicalRequestHash,
    artifactId:artifact.artifactId,artifactHash:artifact.artifactHash,factIds:[...factIds],capturedAt:artifact.capturedAt,
    status:"COMMITTED" as const
  };
  return {...core,recordHash:hashJson(core as any)};
}

test("authenticated ingestion can verify an envelope without persisting it",async()=>{
  const phase2:any=await import("../src/index.ts");
  const {dir,db}=dirDb("axiom-evidence-auth-");
  const world=new phase2.WorldStateStore(db),signer=createSigner();
  const ingestor=new phase2.AuthenticatedFactIngestor({
    tenant:A,world,keyring:phase2.createIngestionKeyring({[A.tenantId]:{"adapter:test:v1":signer.publicKey}}),
    maxEnvelopeAgeMs:300000,maxFutureSkewMs:30000
  });
  try{
    const a=artifact(phase2),fact=phase2.mapEvidenceArtifact(A,phase2.verifyEvidenceArtifact(A,a),mapper())[0];
    const verified=await ingestor.authenticate(signed(phase2,signer,fact,"adapter-nonce-1"),NOW);
    assert.equal(verified.fact.id,fact.id);
    assert.equal(verified.fact.authentication.keyId,"adapter:test:v1");
    assert.deepEqual(verified.claim,{keyId:"adapter:test:v1",nonce:"adapter-nonce-1",issuedAt:"2026-10-06T09:59:50.000Z"});
    assert.equal((await world.snapshot(A,NOW)).facts.length,0);
  }finally{world.close();rmSync(dir,{recursive:true,force:true});}
});

test("SQLite evidence commit atomically persists artifact, acquisition, nonce, and authenticated facts",async()=>{
  const phase2:any=await import("../src/index.ts");
  const {dir,db}=dirDb("axiom-evidence-commit-");
  const world=new phase2.WorldStateStore(db),signer=createSigner();
  const ingestor=new phase2.AuthenticatedFactIngestor({
    tenant:A,world,keyring:phase2.createIngestionKeyring({[A.tenantId]:{"adapter:test:v1":signer.publicKey}}),
    maxEnvelopeAgeMs:300000,maxFutureSkewMs:30000
  });
  try{
    const a=artifact(phase2),fact=phase2.mapEvidenceArtifact(A,phase2.verifyEvidenceArtifact(A,a),mapper())[0];
    const verified=await ingestor.authenticate(signed(phase2,signer,fact,"adapter-nonce-commit"),NOW);
    const record=recordFor(a,[fact.id]);
    await world.commitAcquisition(A,a,record,[verified]);

    assert.deepEqual(await world.getEvidenceArtifact(A,a.artifactId),a);
    assert.deepEqual(await world.getAcquisition(A,record.acquisitionId),record);
    const snap=await world.snapshot(A,NOW);
    assert.equal(snap.facts.length,1);
    assert.equal(snap.facts[0].acquisition?.artifactHash,a.artifactHash);
    assert.equal(snap.facts[0].authentication?.nonce,"adapter-nonce-commit");
    await assert.rejects(()=>world.getEvidenceArtifact(B,a.artifactId),/not found.*tenant|tenant.*not found/i);
    await assert.rejects(()=>world.getAcquisition(B,record.acquisitionId),/not found.*tenant|tenant.*not found/i);
  }finally{world.close();rmSync(dir,{recursive:true,force:true});}
});

test("SQLite evidence commit rolls back every new write when any mapped fact conflicts",async()=>{
  const phase2:any=await import("../src/index.ts");
  const {dir,db}=dirDb("axiom-evidence-rollback-");
  const world=new phase2.WorldStateStore(db),signer=createSigner();
  const ingestor=new phase2.AuthenticatedFactIngestor({
    tenant:A,world,keyring:phase2.createIngestionKeyring({[A.tenantId]:{"adapter:test:v1":signer.publicKey}}),
    maxEnvelopeAgeMs:300000,maxFutureSkewMs:30000
  });
  try{
    const a=artifact(phase2),baseMapper=mapper();
    const conflictMapper={
      manifest:baseMapper.manifest,
      map(){
        const [base]=baseMapper.map();
        return [
          base,
          {...base,attribute:"price_secondary",value:{type:{kind:"number",unit:"USD/oz"},value:2401}}
        ];
      }
    };
    const [first,conflict]=phase2.mapEvidenceArtifact(A,phase2.verifyEvidenceArtifact(A,a),conflictMapper);
    await world.putFact(A,{...conflict,acquisition:undefined,authentication:undefined});
    const v1=await ingestor.authenticate(signed(phase2,signer,first,"nonce-first"),NOW);
    const v2=await ingestor.authenticate(signed(phase2,signer,conflict,"nonce-conflict"),NOW);
    const record=recordFor(a,[first.id,conflict.id]);
    await assert.rejects(()=>world.commitAcquisition(A,a,record,[v1,v2]),/unique|constraint|duplicate|conflict/i);
    await assert.rejects(()=>world.getEvidenceArtifact(A,a.artifactId),/not found/i);
    await assert.rejects(()=>world.getAcquisition(A,record.acquisitionId),/not found/i);
    const snap=await world.snapshot(A,NOW);
    assert.deepEqual(snap.facts.map((x:any)=>x.id),[conflict.id]);

    const a2=phase2.createEvidenceArtifact({
      tenantId:A.tenantId,adapterId:"adapter:test",adapterVersion:"1.0.0",adapterImplementationHash:H("a"),
      operationId:"read",mappingId:"map:v1",canonicalRequestHash:H("d"),capturedAt:"2026-10-06T10:00:01.000Z",
      upstreamStatus:200,mediaType:"application/json",bodyEncoding:"utf8",body:'{"price":2400}'
    });
    const retryFact=phase2.mapEvidenceArtifact(A,phase2.verifyEvidenceArtifact(A,a2),mapper())[0];
    const retry=await ingestor.authenticate(signed(phase2,signer,retryFact,"nonce-first"),NOW);
    const retryRecord=recordFor(a2,[retryFact.id]);
    await world.commitAcquisition(A,a2,retryRecord,[retry]);
    assert.equal((await world.snapshot(A,NOW)).facts.some((x:any)=>x.id===retryFact.id),true);
  }finally{world.close();rmSync(dir,{recursive:true,force:true});}
});

test("SQLite evidence artifact reads detect persisted body tampering",async()=>{
  const phase2:any=await import("../src/index.ts");
  const {dir,db}=dirDb("axiom-evidence-tamper-");
  let world=new phase2.WorldStateStore(db);
  const signer=createSigner();
  try{
    const ingestor=new phase2.AuthenticatedFactIngestor({
      tenant:A,world,keyring:phase2.createIngestionKeyring({[A.tenantId]:{"adapter:test:v1":signer.publicKey}}),
      maxEnvelopeAgeMs:300000,maxFutureSkewMs:30000
    });
    const a=artifact(phase2),fact=phase2.mapEvidenceArtifact(A,phase2.verifyEvidenceArtifact(A,a),mapper())[0];
    const verified=await ingestor.authenticate(signed(phase2,signer,fact,"nonce-tamper"),NOW);
    await world.commitAcquisition(A,a,recordFor(a,[fact.id]),[verified]);
    world.close();
    const raw=new DatabaseSync(db);
    try{raw.prepare("UPDATE evidence_artifacts SET body=? WHERE tenant_id=? AND artifact_id=?").run('{"price":1}',A.tenantId,a.artifactId);}
    finally{raw.close();}
    world=new phase2.WorldStateStore(db);
    await assert.rejects(()=>world.getEvidenceArtifact(A,a.artifactId),/integrity|hash/i);
  }finally{try{world.close();}catch{}rmSync(dir,{recursive:true,force:true});}
});


test("SQLite evidence commit rejects a signed fact whose full acquisition provenance does not match the acquisition record",async()=>{
  const phase2:any=await import("../src/index.ts");
  const {dir,db}=dirDb("axiom-evidence-provenance-");
  const world=new phase2.WorldStateStore(db),signer=createSigner();
  const ingestor=new phase2.AuthenticatedFactIngestor({
    tenant:A,world,keyring:phase2.createIngestionKeyring({[A.tenantId]:{"adapter:test:v1":signer.publicKey}}),
    maxEnvelopeAgeMs:300000,maxFutureSkewMs:30000
  });
  try{
    const a=artifact(phase2),fact=phase2.mapEvidenceArtifact(A,phase2.verifyEvidenceArtifact(A,a),mapper())[0];
    const forged=structuredClone(fact);
    forged.acquisition.mappingImplementationHash=H("9");
    const verified=await ingestor.authenticate(signed(phase2,signer,forged,"nonce-provenance-forgery"),NOW);
    const record=recordFor(a,[forged.id]);
    await assert.rejects(()=>world.commitAcquisition(A,a,record,[verified]),/provenance|mapping|fact identity/i);
    await assert.rejects(()=>world.getEvidenceArtifact(A,a.artifactId),/not found/i);
  }finally{world.close();rmSync(dir,{recursive:true,force:true});}
});
