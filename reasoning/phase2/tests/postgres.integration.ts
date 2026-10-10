import test from "node:test";
import assert from "node:assert/strict";
import { createHash, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { canonicalize, createDefaultRegistry, createSigner, hashJson, type AxiomProgram } from "../../phase1/src/index.ts";
import {
  AuthenticatedFactIngestor, ReasoningControlPlane, createEvidenceArtifact, createIngestionKeyring,
  createStaticSignerProvider, mapEvidenceArtifact, verifyEvidenceArtifact,
  type SignedFactEnvelope, type TemporalFact
} from "../src/index.ts";
import {
  initializePostgresSchema, PostgresExecutionRepository, PostgresWorldStateRepository
} from "../src/postgres.ts";

const {Pool}=pg;
const A={tenantId:"tenant-pg-a"},B={tenantId:"tenant-pg-b"};
const fixture=JSON.parse(readFileSync(new URL("../../phase1/fixtures/xau-risk-program.json",import.meta.url),"utf8")) as AxiomProgram;
const pool=new Pool({host:process.env.PGHOST??"postgres",port:Number(process.env.PGPORT??5432),database:process.env.PGDATABASE??"axiom_test",user:process.env.PGUSER??"axiom",password:process.env.PGPASSWORD??"axiom-test-password",max:4});

async function ready():Promise<void>{let last:unknown;for(let i=0;i<20;i++){try{await pool.query("SELECT 1");return;}catch(err){last=err;await new Promise(r=>setTimeout(r,250));}}throw last;}
function riskFact(id:string,value:number):TemporalFact {return {id,entity:"risk:alpha",attribute:"max_vol",value:{type:{kind:"number",unit:"ratio"},value},validFrom:"2026-10-06T03:00:00.000Z",observedAt:"2026-10-06T03:25:00.000Z",source:"risk-engine:postgres",confidence:1};}
function request(){return {asOf:"2026-10-06T03:30:00.000Z",issuedAt:"2026-10-06T03:30:01.000Z",program:structuredClone(fixture),requirements:[{id:"fresh-risk",entity:"risk:alpha",attribute:"max_vol",maxAgeMs:10*60*1000}],bindings:[{inputName:"max_vol",entity:"risk:alpha",attribute:"max_vol"}]};}

test("PostgreSQL repositories preserve tenant isolation and Phase-2 execution/replay semantics",async()=>{
  await ready();await initializePostgresSchema(pool);
  await pool.query("TRUNCATE axiom_ingestion_nonces, axiom_platform_executions, axiom_world_snapshots, axiom_temporal_facts");
  const world=new PostgresWorldStateRepository(pool),executions=new PostgresExecutionRepository(pool);
  await world.putFact(A,riskFact("shared-risk",0.30));await world.putFact(B,riskFact("shared-risk",0.10));
  const snapA=await world.snapshot(A,"2026-10-06T03:30:00.000Z"),snapB=await world.snapshot(B,"2026-10-06T03:30:00.000Z");
  assert.equal(snapA.tenantId,A.tenantId);assert.equal(snapB.tenantId,B.tenantId);assert.notEqual(snapA.snapshotHash,snapB.snapshotHash);
  assert.equal(snapA.facts[0].value.value,0.30);assert.equal(snapB.facts[0].value.value,0.10);
  await assert.rejects(()=>world.getSnapshot(B,snapA.snapshotId),/not found.*tenant-pg-b/i);
  const signer=createStaticSignerProvider("key:pg:test",createSigner()),planeA=new ReasoningControlPlane({tenant:A,world,executions,signer,registry:createDefaultRegistry()});
  const issued=await planeA.execute(request());assert.equal(issued.status,"APPROVED");assert.ok(issued.executionRecordId);
  assert.deepEqual(await planeA.replayStored(issued.executionRecordId!),{status:"MATCH",diagnostics:[]});
  await assert.rejects(()=>executions.get(B,issued.executionRecordId!),/not found.*tenant-pg-b/i);
});

test("PostgreSQL persists authenticated ingress evidence and enforces nonce uniqueness",async()=>{
  await initializePostgresSchema(pool);
  await pool.query("TRUNCATE axiom_ingestion_nonces, axiom_platform_executions, axiom_world_snapshots, axiom_temporal_facts");
  const world=new PostgresWorldStateRepository(pool),signer=createSigner();
  const keyring=createIngestionKeyring({[A.tenantId]:{"feed-key":signer.publicKey}});
  const ingestor=new AuthenticatedFactIngestor({tenant:A,world,keyring,maxEnvelopeAgeMs:300000,maxFutureSkewMs:30000});
  const fact:TemporalFact={id:"feed-xau",entity:"market:xauusd",attribute:"price",value:{type:{kind:"number",unit:"USD/oz"},value:2400},validFrom:"2026-10-06T03:59:00.000Z",observedAt:"2026-10-06T03:59:00.000Z",source:"feed:postgres",confidence:1};
  const base={tenantId:A.tenantId,keyId:"feed-key",issuedAt:"2026-10-06T03:59:30.000Z",nonce:"pg-nonce-1",fact};
  const envelope:SignedFactEnvelope={...base,signature:sign(null,Buffer.from(canonicalize(base as any)),signer.privateKey).toString("base64")};
  const accepted=await ingestor.ingest(envelope,"2026-10-06T04:00:00.000Z");
  assert.match(accepted.authentication?.envelopeHash??"",/^[0-9a-f]{64}$/);
  const snap=await world.snapshot(A,"2026-10-06T04:00:00.000Z");
  assert.equal(snap.facts[0].authentication?.nonce,"pg-nonce-1");
  await assert.rejects(()=>ingestor.ingest(envelope,"2026-10-06T04:00:00.000Z"),/nonce.*replay/i);
});


test("PostgreSQL rolls back nonce reservation when authenticated fact persistence fails",async()=>{
  await initializePostgresSchema(pool);
  await pool.query("TRUNCATE axiom_ingestion_nonces, axiom_platform_executions, axiom_world_snapshots, axiom_temporal_facts");
  const world=new PostgresWorldStateRepository(pool),signer=createSigner();
  const keyring=createIngestionKeyring({[A.tenantId]:{"feed-key":signer.publicKey}});
  const ingestor=new AuthenticatedFactIngestor({tenant:A,world,keyring,maxEnvelopeAgeMs:300000,maxFutureSkewMs:30000});
  const baseFact:TemporalFact={id:"base",entity:"market:xauusd",attribute:"price",value:{type:{kind:"number",unit:"USD/oz"},value:2400},validFrom:"2026-10-06T03:59:00.000Z",observedAt:"2026-10-06T03:59:00.000Z",source:"feed:postgres",confidence:1};
  const signed=(id:string):SignedFactEnvelope=>{
    const fact={...baseFact,id};
    const base={tenantId:A.tenantId,keyId:"feed-key",issuedAt:"2026-10-06T03:59:30.000Z",nonce:"pg-atomic-nonce",fact};
    return {...base,signature:sign(null,Buffer.from(canonicalize(base as any)),signer.privateKey).toString("base64")};
  };
  await world.putFact(A,{...baseFact,id:"duplicate-fact"});
  await assert.rejects(()=>ingestor.ingest(signed("duplicate-fact"),"2026-10-06T04:00:00.000Z"),/duplicate|unique|constraint/i);
  const accepted=await ingestor.ingest(signed("retry-fact"),"2026-10-06T04:00:00.000Z");
  assert.equal(accepted.id,"retry-fact");
});


test("PostgreSQL security persistence enforces grants idempotency and tamper-evident audit",async()=>{
  const phase2:any=await import("../src/index.ts");
  assert.equal(typeof phase2.PostgresSecurityRepository,"function");
  await initializePostgresSchema(pool);
  await pool.query("TRUNCATE axiom_audit_records, axiom_audit_heads, axiom_idempotency_records, axiom_authorization_grants");
  const security=new phase2.PostgresSecurityRepository(pool);
  const grant={grantId:"pg-grant",principalId:"principal:pg",tenantId:A.tenantId,action:"execution:create"};
  await security.putGrant(grant);
  assert.deepEqual(await security.listApplicable("principal:pg",A.tenantId),[grant]);
  assert.deepEqual(await security.listApplicable("principal:pg",B.tenantId),[]);

  const rawKey="pg-raw-idempotency-secret";
  const hashed=(v:string)=>createHash("sha256").update(v).digest("hex");
  const claim={
    principalId:"principal:pg",tenantId:A.tenantId,action:"execution:create",
    idempotencyKeyHash:hashed(rawKey),requestHash:hashed("pg-request"),
    createdAt:"2026-10-06T10:00:00.000Z"
  };
  assert.deepEqual(await security.claim(claim),{status:"CLAIMED"});
  assert.deepEqual(await security.claim(claim),{status:"IN_PROGRESS"});
  assert.deepEqual(await security.claim({...claim,requestHash:hashed("changed")}),{status:"CONFLICT"});
  const outcome={statusCode:200,bodyJson:'{"ok":true}',contentType:"application/json"};
  await security.complete({...claim,completedAt:"2026-10-06T10:00:01.000Z"},outcome);
  assert.deepEqual(await security.claim(claim),{status:"REPLAY",outcome});
  const persisted=await pool.query("SELECT * FROM axiom_idempotency_records WHERE tenant_id=$1",[A.tenantId]);
  assert.equal(JSON.stringify(persisted.rows).includes(rawKey),false);

  const audit=(requestId:string)=>({
    requestedTenantId:A.tenantId,requestId,principalId:"principal:pg",action:"execution:create",
    resource:{kind:"execution"},credentialTokenHash:"c".repeat(64),
    authorizationDecisionHash:"d".repeat(64),requestHash:hashed(requestId),
    idempotencyKeyHash:hashed("idem:"+requestId),outcome:"SUCCESS",timestamp:"2026-10-06T10:00:00.000Z"
  });
  await security.append(audit("pg-r1"));await security.append(audit("pg-r2"));
  assert.deepEqual(await security.verifyStream(A.tenantId),{status:"MATCH",diagnostics:[]});
  await pool.query("UPDATE axiom_audit_records SET outcome='TAMPERED' WHERE tenant_id=$1 AND sequence=1",[A.tenantId]);
  assert.equal((await security.verifyStream(A.tenantId)).status,"MISMATCH");

  await security.append({...audit("pg-tail-1"),requestedTenantId:B.tenantId});
  await security.append({...audit("pg-tail-2"),requestedTenantId:B.tenantId});
  await pool.query("DELETE FROM axiom_audit_records WHERE tenant_id=$1 AND sequence=2",[B.tenantId]);
  assert.equal((await security.verifyStream(B.tenantId)).status,"MISMATCH");
});


test("PostgreSQL atomically persists and verifies external evidence acquisitions",async()=>{
  await ready();await initializePostgresSchema(pool);
  const world:any=new PostgresWorldStateRepository(pool);
  assert.equal(typeof world.commitAcquisition,"function","PostgreSQL world repository must implement evidence acquisition persistence");

  await pool.query("TRUNCATE axiom_evidence_acquisitions, axiom_evidence_artifacts, axiom_ingestion_nonces, axiom_platform_executions, axiom_world_snapshots, axiom_temporal_facts");
  const signer=createSigner();
  const ingestor=new AuthenticatedFactIngestor({
    tenant:A,world,keyring:createIngestionKeyring({[A.tenantId]:{"adapter:pg:v1":signer.publicKey}}),
    maxEnvelopeAgeMs:300000,maxFutureSkewMs:30000
  });
  const adapterHash="a".repeat(64),mappingHash="c".repeat(64),requestHash="d".repeat(64),decisionHash="e".repeat(64);
  const mapper={
    manifest:{mappingId:"map:pg:v1",version:"1.0.0",implementationHash:mappingHash},
    map(){
      return [{
        entity:"market:xauusd",attribute:"price",
        value:{type:{kind:"number",unit:"USD/oz"},value:2400},
        validFrom:"2026-10-06T03:59:00.000Z",observedAt:"2026-10-06T03:59:30.000Z",
        source:"adapter:postgres",confidence:1
      }];
    }
  };
  const artifact=createEvidenceArtifact({
    tenantId:A.tenantId,adapterId:"adapter:pg",adapterVersion:"1.0.0",adapterImplementationHash:adapterHash,
    operationId:"read",mappingId:"map:pg:v1",canonicalRequestHash:requestHash,
    capturedAt:"2026-10-06T04:00:00.000Z",upstreamStatus:200,mediaType:"application/json",
    bodyEncoding:"utf8",body:'{"price":2400}'
  });
  const fact=mapEvidenceArtifact(A,verifyEvidenceArtifact(A,artifact),mapper as any)[0];
  const base={tenantId:A.tenantId,keyId:"adapter:pg:v1",issuedAt:"2026-10-06T04:00:00.000Z",nonce:"pg-evidence-nonce",fact};
  const envelope:SignedFactEnvelope={...base,signature:sign(null,Buffer.from(canonicalize(base as any)),signer.privateKey).toString("base64")};
  const verified=await ingestor.authenticate(envelope,"2026-10-06T04:00:01.000Z");
  const core={
    acquisitionId:"acquisition:"+"f".repeat(64),tenantId:A.tenantId,principalId:"principal:pg",
    authorizationDecisionHash:decisionHash,adapterId:artifact.adapterId,adapterVersion:artifact.adapterVersion,
    adapterImplementationHash:artifact.adapterImplementationHash,operationId:artifact.operationId,mappingId:artifact.mappingId,
    mappingVersion:"1.0.0",mappingImplementationHash:mappingHash,canonicalRequestHash:artifact.canonicalRequestHash,
    artifactId:artifact.artifactId,artifactHash:artifact.artifactHash,factIds:[fact.id],capturedAt:artifact.capturedAt,
    status:"COMMITTED" as const
  };
  const record={...core,recordHash:hashJson(core as any)};

  const forgedFact=structuredClone(fact);
  forgedFact.acquisition!.mappingImplementationHash="9".repeat(64);
  const forgedBase={tenantId:A.tenantId,keyId:"adapter:pg:v1",issuedAt:"2026-10-06T04:00:00.000Z",nonce:"pg-evidence-forged-provenance",fact:forgedFact};
  const forgedEnvelope:SignedFactEnvelope={...forgedBase,signature:sign(null,Buffer.from(canonicalize(forgedBase as any)),signer.privateKey).toString("base64")};
  const forgedVerified=await ingestor.authenticate(forgedEnvelope,"2026-10-06T04:00:01.000Z");
  await assert.rejects(()=>world.commitAcquisition(A,artifact,record,[forgedVerified]),/provenance|mapping|fact identity/i);

  await world.commitAcquisition(A,artifact,record,[verified]);
  assert.deepEqual(await world.getEvidenceArtifact(A,artifact.artifactId),artifact);
  assert.deepEqual(await world.getAcquisition(A,record.acquisitionId),record);
  await assert.rejects(()=>world.getEvidenceArtifact(B,artifact.artifactId),/not found.*tenant|tenant.*not found/i);
  const snap=await world.snapshot(A,"2026-10-06T04:00:01.000Z");
  assert.equal(snap.facts[0].acquisition?.artifactHash,artifact.artifactHash);
  assert.equal(snap.facts[0].authentication?.nonce,"pg-evidence-nonce");

  await pool.query("UPDATE axiom_evidence_artifacts SET body=$1 WHERE tenant_id=$2 AND artifact_id=$3",['{"price":1}',A.tenantId,artifact.artifactId]);
  await assert.rejects(()=>world.getEvidenceArtifact(A,artifact.artifactId),/integrity|hash/i);
});


test("PostgreSQL evidence acquisition rolls back artifact, acquisition, nonce, and earlier mapped fact on late conflict",async()=>{
  await ready();await initializePostgresSchema(pool);
  await pool.query("TRUNCATE axiom_evidence_acquisitions, axiom_evidence_artifacts, axiom_ingestion_nonces, axiom_platform_executions, axiom_world_snapshots, axiom_temporal_facts");
  const world:any=new PostgresWorldStateRepository(pool),signer=createSigner();
  const ingestor=new AuthenticatedFactIngestor({
    tenant:A,world,keyring:createIngestionKeyring({[A.tenantId]:{"adapter:pg:v1":signer.publicKey}}),
    maxEnvelopeAgeMs:300000,maxFutureSkewMs:30000
  });
  const adapterHash="1".repeat(64),mappingHash="2".repeat(64),requestHash="3".repeat(64),decisionHash="4".repeat(64);
  const mapper={
    manifest:{mappingId:"map:pg:rollback",version:"1.0.0",implementationHash:mappingHash},
    map(){
      return [
        {
          entity:"market:xauusd",attribute:"bid",
          value:{type:{kind:"number",unit:"USD/oz"},value:2399},
          validFrom:"2026-10-06T04:09:00.000Z",observedAt:"2026-10-06T04:09:30.000Z",
          source:"adapter:postgres",confidence:1
        },
        {
          entity:"market:xauusd",attribute:"ask",
          value:{type:{kind:"number",unit:"USD/oz"},value:2401},
          validFrom:"2026-10-06T04:09:00.000Z",observedAt:"2026-10-06T04:09:30.000Z",
          source:"adapter:postgres",confidence:1
        }
      ];
    }
  };
  const artifact=createEvidenceArtifact({
    tenantId:A.tenantId,adapterId:"adapter:pg",adapterVersion:"1.0.0",adapterImplementationHash:adapterHash,
    operationId:"read-book",mappingId:"map:pg:rollback",canonicalRequestHash:requestHash,
    capturedAt:"2026-10-06T04:10:00.000Z",upstreamStatus:200,mediaType:"application/json",
    bodyEncoding:"utf8",body:'{"bid":2399,"ask":2401}'
  });
  const facts=mapEvidenceArtifact(A,verifyEvidenceArtifact(A,artifact),mapper as any);
  await world.putFact(A,facts[1]);

  const verified=[] as any[];
  for(let i=0;i<facts.length;i++){
    const base={tenantId:A.tenantId,keyId:"adapter:pg:v1",issuedAt:"2026-10-06T04:10:00.000Z",nonce:`pg-rollback-nonce-${i+1}`,fact:facts[i]};
    const envelope:SignedFactEnvelope={...base,signature:sign(null,Buffer.from(canonicalize(base as any)),signer.privateKey).toString("base64")};
    verified.push(await ingestor.authenticate(envelope,"2026-10-06T04:10:01.000Z"));
  }
  const core={
    acquisitionId:"acquisition:"+"5".repeat(64),tenantId:A.tenantId,principalId:"principal:pg",
    authorizationDecisionHash:decisionHash,adapterId:artifact.adapterId,adapterVersion:artifact.adapterVersion,
    adapterImplementationHash:artifact.adapterImplementationHash,operationId:artifact.operationId,mappingId:artifact.mappingId,
    mappingVersion:"1.0.0",mappingImplementationHash:mappingHash,canonicalRequestHash:artifact.canonicalRequestHash,
    artifactId:artifact.artifactId,artifactHash:artifact.artifactHash,factIds:facts.map((x:any)=>x.id),
    capturedAt:artifact.capturedAt,status:"COMMITTED" as const
  };
  const record={...core,recordHash:hashJson(core as any)};

  await assert.rejects(()=>world.commitAcquisition(A,artifact,record,verified),/duplicate|unique|constraint/i);
  await assert.rejects(()=>world.getEvidenceArtifact(A,artifact.artifactId),/not found/i);
  await assert.rejects(()=>world.getAcquisition(A,record.acquisitionId),/not found/i);
  const snap=await world.snapshot(A,"2026-10-06T04:10:01.000Z");
  assert.deepEqual(snap.facts.map((x:any)=>x.id),[facts[1].id]);

  const retryFact:TemporalFact={
    id:"pg-nonce-rollback-proof",entity:"market:xauusd",attribute:"last",
    value:{type:{kind:"number",unit:"USD/oz"},value:2400},
    validFrom:"2026-10-06T04:09:00.000Z",observedAt:"2026-10-06T04:09:30.000Z",
    source:"adapter:postgres",confidence:1
  };
  const retryBase={tenantId:A.tenantId,keyId:"adapter:pg:v1",issuedAt:"2026-10-06T04:10:00.000Z",nonce:"pg-rollback-nonce-1",fact:retryFact};
  const retryEnvelope:SignedFactEnvelope={...retryBase,signature:sign(null,Buffer.from(canonicalize(retryBase as any)),signer.privateKey).toString("base64")};
  assert.equal((await ingestor.ingest(retryEnvelope,"2026-10-06T04:10:01.000Z")).id,retryFact.id);
});



test("PostgreSQL model compilation persistence is atomic tenant-isolated and tamper-evident",async()=>{
  const phase2:any=await import("../src/index.ts");
  assert.equal(typeof phase2.PostgresModelCompilationRepository,"function");
  await ready();await initializePostgresSchema(pool);
  await pool.query("TRUNCATE axiom_model_compilations, axiom_model_exchange_artifacts");
  const repo=new phase2.PostgresModelCompilationRepository(pool);
  const H=(ch:string)=>ch.repeat(64);
  const adapterManifest={adapterId:"model:http",version:"1.0.0",implementationHash:H("a"),provider:"fixture-pg",modelId:"fixture-model"};
  const profileId="profile:pg",profileHash=H("b"),compilationRequestHash=H("c");
  const inputContracts=[{inputName:"observed",type:{kind:"number",unit:"ratio"},entity:"risk:pg",attribute:"current",requirementId:"current-risk",maxAgeMs:60000}];
  const program:any={
    irVersion:"0.1",objective:"Approve only from trusted PostgreSQL evidence",assumptions:[],
    inputs:{observed:{type:{kind:"number",unit:"ratio"},value:0,provenance:{source:"model-compile-contract:"+H("1")+":observed",contentHash:hashJson(0)}}},
    nodes:[{id:"decision",kind:"Decision",operation:"comparison.lte",inputs:{left:{input:"observed"},right:{literal:{type:{kind:"number",unit:"ratio"},value:1}}}}],
    constraints:[],decisionNodeId:"decision"
  };
  const makeArtifact=(salt:string)=>phase2.createModelExchangeArtifact({
    tenantId:A.tenantId,manifest:adapterManifest,profileId,profileHash,compilationRequestHash,
    attempt:0,mode:"INITIAL",
    captured:{
      capturedAt:"2026-10-07T04:20:00.000Z",
      requestBody:JSON.stringify({request:"safe",salt}),
      responseBody:JSON.stringify({proposal:{assumptions:[],nodes:[],constraints:[],decisionNodeId:"decision"},salt})
    }
  });
  const makeRecord=(artifact:any,compilationId:string,status:"VALIDATED"|"REJECTED"="VALIDATED")=>{
    const core:any={
      compilationId,tenantId:A.tenantId,principalId:"principal:pg-model",authorizationDecisionHash:H("d"),
      compilationRequestHash,profileId,profileVersion:"1.0.0",profileHash,adapterManifest,
      compilerManifest:{id:"axiom.phase1-compiler",version:"1.0.0",implementationHash:H("e")},
      operationRegistryManifestHash:H("f"),objective:program.objective,inputContracts,
      exchangeArtifactIds:[artifact.artifactId],exchangeArtifactHashes:[artifact.artifactHash],
      finalIssues:status==="REJECTED"?[{code:"MODEL_PROPOSAL_SCHEMA",message:"invalid proposal"}]:[],
      status,createdAt:"2026-10-07T04:21:00.000Z"
    };
    if(status==="VALIDATED"){core.compiledProgram=structuredClone(program);core.compiledProgramHash=hashJson(core.compiledProgram);}
    return {...core,recordHash:hashJson(core)};
  };

  const artifact=makeArtifact("primary"),record=makeRecord(artifact,"model-compilation:"+H("2"));
  await repo.commitCompilation(A,[artifact],record);
  assert.deepEqual(await repo.getModelArtifact(A,artifact.artifactId),artifact);
  assert.deepEqual(await repo.getCompilation(A,record.compilationId),record);
  await assert.rejects(()=>repo.getModelArtifact(B,artifact.artifactId),/not found/i);
  await assert.rejects(()=>repo.getCompilation(B,record.compilationId),/not found/i);

  const lateArtifact=makeArtifact("late-conflict"),conflicting=makeRecord(lateArtifact,record.compilationId);
  await assert.rejects(()=>repo.commitCompilation(A,[lateArtifact],conflicting),/duplicate|unique|constraint/i);
  await assert.rejects(()=>repo.getModelArtifact(A,lateArtifact.artifactId),/not found/i);

  const persisted=await pool.query("SELECT artifact_json,request_body,response_body FROM axiom_model_exchange_artifacts WHERE tenant_id=$1",[A.tenantId]);
  assert.equal(JSON.stringify(persisted.rows).includes("pg-provider-secret"),false);

  await pool.query("UPDATE axiom_model_exchange_artifacts SET request_body='tampered' WHERE tenant_id=$1 AND artifact_id=$2",[A.tenantId,artifact.artifactId]);
  await assert.rejects(()=>repo.getModelArtifact(A,artifact.artifactId),/integrity|hash/i);

  await pool.query("TRUNCATE axiom_model_compilations, axiom_model_exchange_artifacts");
  const cleanArtifact=makeArtifact("record-tamper"),cleanRecord=makeRecord(cleanArtifact,"model-compilation:"+H("3"));
  await repo.commitCompilation(A,[cleanArtifact],cleanRecord);
  await pool.query("UPDATE axiom_model_compilations SET compiled_program_hash=$1 WHERE tenant_id=$2 AND compilation_id=$3",[H("9"),A.tenantId,cleanRecord.compilationId]);
  await assert.rejects(()=>repo.getCompilation(A,cleanRecord.compilationId),/integrity|hash|program/i);

  await pool.query("TRUNCATE axiom_model_compilations, axiom_model_exchange_artifacts");
  const rejectedArtifact=makeArtifact("rejected"),rejected=makeRecord(rejectedArtifact,"model-compilation:"+H("4"),"REJECTED");
  await repo.commitCompilation(A,[rejectedArtifact],rejected);
  const loadedRejected:any=await repo.getCompilation(A,rejected.compilationId);
  assert.equal(loadedRejected.status,"REJECTED");
  assert.equal("compiledProgram" in loadedRejected,false);
  assert.equal("compiledProgramHash" in loadedRejected,false);
});


test("PostgreSQL advisory explanation persistence is tenant-isolated exact and tamper-evident",async()=>{
  const phase2:any=await import("../src/index.ts");
  assert.equal(typeof phase2.PostgresModelExplanationRepository,"function");
  await ready();await initializePostgresSchema(pool);
  await pool.query("TRUNCATE axiom_model_explanations");
  const repo=new phase2.PostgresModelExplanationRepository(pool),H=(c:string)=>c.repeat(64);
  const requestBody='{"providerRequest":"pg-explain"}',responseBody='{"raw":"pg-explain"}';
  const normalizedResponseBody='{"keyFactors":["Replay matched"],"limitations":["Advisory only"],"summary":"Stored proof replayed exactly."}';
  const sh=(s:string)=>createHash("sha256").update(s).digest("hex");
  const base:any={
    tenantId:A.tenantId,executionId:"platform:"+H("1"),executionRecordHash:H("2"),
    principalId:"principal:pg-explain",authorizationDecisionHash:H("3"),explanationRequestHash:H("4"),
    profileId:"profile:pg-explain",profileVersion:"1.0.0",profileHash:H("5"),
    adapterManifest:{adapterId:"model:pg-explain",version:"1.0.0",implementationHash:H("6"),provider:"fixture",modelId:"fixture-model"},
    capturedAt:"2026-10-07T21:00:00.000Z",
    requestBody,requestBodyHash:sh(requestBody),responseBody,responseBodyHash:sh(responseBody),
    normalizedResponseBody,normalizedResponseBodyHash:sh(normalizedResponseBody),
    authority:"ADVISORY_ONLY",
    content:{summary:"Stored proof replayed exactly.",keyFactors:["Replay matched"],limitations:["Advisory only"]}
  };
  const explanationId="model-explanation:"+hashJson(base),core={explanationId,...base},record={...core,recordHash:hashJson(core)};
  await repo.put(A,record);
  assert.deepEqual(await repo.get(A,record.explanationId),record);
  await assert.rejects(()=>repo.get(B,record.explanationId),/not found|tenant/i);
  await assert.rejects(()=>repo.put(B,record),/tenant/i);

  const persisted=await pool.query("SELECT request_body,response_body,normalized_response_body,record_json FROM axiom_model_explanations WHERE tenant_id=$1",[A.tenantId]);
  assert.equal(persisted.rows[0].request_body,requestBody);
  assert.equal(persisted.rows[0].response_body,responseBody);
  assert.equal(persisted.rows[0].normalized_response_body,normalizedResponseBody);
  assert.equal(JSON.stringify(persisted.rows).includes("pg-explanation-provider-secret"),false);

  await pool.query("UPDATE axiom_model_explanations SET normalized_response_body_hash=$1 WHERE tenant_id=$2 AND explanation_id=$3",[H("9"),A.tenantId,record.explanationId]);
  await assert.rejects(()=>repo.get(A,record.explanationId),/integrity|hash/i);

  await pool.query("TRUNCATE axiom_model_explanations");
  await repo.put(A,record);
  const forged=structuredClone(record);forged.content.summary="mutated";
  await assert.rejects(()=>repo.put(A,forged),/integrity|hash/i);
  assert.deepEqual(await repo.get(A,record.explanationId),record);
});

test.after(async()=>{await pool.end();});


test("PostgreSQL execution-intent mapping is tenant-scoped and exact-idempotent",async()=>{
  await ready();await initializePostgresSchema(pool);
  const executions:any=new PostgresExecutionRepository(pool);
  assert.equal(typeof executions.getByIntent,"function");
  assert.equal(typeof executions.putForIntent,"function");

  await pool.query("TRUNCATE axiom_execution_intents, axiom_platform_executions, axiom_world_snapshots, axiom_temporal_facts");
  const world=new PostgresWorldStateRepository(pool);
  await world.putFact(A,riskFact("pg-intent-risk",0.30));
  const frozen=await world.snapshot(A,request().asOf);
  const control:any=new ReasoningControlPlane({
    tenant:A,world,executions,
    signer:createStaticSignerProvider("key:pg:intent",createSigner()),
    registry:createDefaultRegistry()
  });
  const intentId="execution-job:"+"9".repeat(64);
  const first=await control.executeBound(request(),frozen.snapshotId,intentId);
  assert.equal(first.status,"APPROVED");
  const stored=await executions.getByIntent(A,intentId);
  assert.equal(stored.executionIntentId,intentId);
  assert.equal(stored.snapshotId,frozen.snapshotId);
  assert.deepEqual(await control.executeBound(request(),frozen.snapshotId,intentId),first);
  assert.equal(await executions.getByIntent(B,intentId),undefined);

  const rows=await pool.query("SELECT COUNT(*)::int AS n FROM axiom_execution_intents WHERE tenant_id=$1",[A.tenantId]);
  assert.equal(rows.rows[0].n,1);
});


test("PostgreSQL distributed execution jobs provide SKIP LOCKED fencing parity",async()=>{
  const phase2:any=await import("../src/index.ts");
  assert.equal(typeof phase2.PostgresDistributedExecutionRepository,"function");
  await ready();await initializePostgresSchema(pool);
  await pool.query("TRUNCATE axiom_distributed_execution_jobs");

  const repo:any=new phase2.PostgresDistributedExecutionRepository(pool);
  const H=(ch:string)=>ch.repeat(64);
  const core={
    tenantId:A.tenantId,principalId:"principal:pg-worker",authorizationDecisionHash:H("a"),requestHash:H("b"),
    compilationId:"model-compilation:"+H("c"),compilationRecordHash:H("d"),
    profileId:"profile:pg-worker",profileVersion:"1.0.0",profileHash:H("e"),
    compilerManifest:{id:"axiom.phase1-compiler",version:"1.0.0",implementationHash:H("f")},
    operationRegistryManifestHash:H("1"),
    executionRequest:{
      asOf:"2026-10-08T13:00:00.000Z",issuedAt:"2026-10-08T13:00:01.000Z",
      program:{irVersion:"0.1",objective:"pg job",assumptions:[],inputs:{},nodes:[{id:"decision",kind:"Decision",operation:"boolean.and",inputs:{values:{literal:{type:{kind:"array",items:{kind:"boolean"}},value:[true]}}}}],constraints:[],decisionNodeId:"decision"},
      requirements:[],bindings:[]
    },
    snapshotId:"snapshot:"+H("2"),snapshotHash:H("2"),createdAt:"2026-10-08T13:00:02.000Z"
  };
  const created=await repo.create(A,core);
  assert.equal((await repo.get(A,created.intent.jobId)).state.status,"PENDING");
  await assert.rejects(()=>repo.get(B,created.intent.jobId),/not found.*tenant/i);

  const claims=await Promise.all([
    repo.claimNext("pg-worker:a","2026-10-08T13:00:03.000Z",1000),
    repo.claimNext("pg-worker:b","2026-10-08T13:00:03.000Z",1000)
  ]);
  const owned=claims.filter(Boolean);
  assert.equal(owned.length,1);
  const first=owned[0];
  assert.equal(first.leaseEpoch,1);
  assert.equal(first.job.state.attemptCount,1);
  assert.equal(await repo.claimNext("pg-worker:c","2026-10-08T13:00:03.500Z",1000),undefined);

  const reclaimed=await repo.claimNext("pg-worker:c","2026-10-08T13:00:04.000Z",1000);
  assert.ok(reclaimed);
  assert.equal(reclaimed.leaseEpoch,2);
  assert.equal(reclaimed.job.state.attemptCount,2);
  await assert.rejects(
    ()=>repo.complete(A,created.intent.jobId,first.workerId,1,"2026-10-08T13:00:04.100Z",{
      status:"APPROVED",snapshotId:created.intent.snapshotId,
      policyDecision:{status:"ALLOW",snapshotId:created.intent.snapshotId,checks:[]},
      certificateId:"cert:stale",executionRecordId:"platform:stale"
    }),
    /stale lease/i
  );

  const released=await repo.releaseForRetry(A,created.intent.jobId,"pg-worker:c",2,"2026-10-08T13:00:04.200Z");
  assert.equal(released.state.status,"PENDING");
  const finalLease=await repo.claimNext("pg-worker:d","2026-10-08T13:00:04.300Z",1000);
  assert.equal(finalLease.leaseEpoch,3);
  const result={
    status:"APPROVED",snapshotId:created.intent.snapshotId,
    policyDecision:{status:"ALLOW",snapshotId:created.intent.snapshotId,checks:[]},
    certificateId:"cert:pg",executionRecordId:"platform:pg"
  };
  const done=await repo.complete(A,created.intent.jobId,"pg-worker:d",3,"2026-10-08T13:00:04.400Z",result);
  assert.equal(done.state.status,"SUCCEEDED");
  assert.equal(await repo.claimNext("pg-worker:e","2026-10-08T13:00:10.000Z",1000),undefined);
  await assert.rejects(()=>repo.failTerminal(A,created.intent.jobId,"pg-worker:d",3,"2026-10-08T13:00:04.500Z","FAILED_INTEGRITY"),/stale lease|terminal/i);

  const tamperCore={...core,requestHash:H("9"),compilationId:"model-compilation:"+H("9")};
  const tampered=await repo.create(A,tamperCore);
  await pool.query("UPDATE axiom_distributed_execution_jobs SET attempt_count=77 WHERE tenant_id=$1 AND job_id=$2",[A.tenantId,tampered.intent.jobId]);
  await assert.rejects(()=>repo.get(A,tampered.intent.jobId),/state.*integrity|integrity.*state/i);
});
