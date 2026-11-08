import test from "node:test";
import assert from "node:assert/strict";
import { createHash, sign, generateKeyPairSync } from "node:crypto";
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


test("PostgreSQL tenant capacity serializes racing dispatch and preserves replay and isolation",async()=>{
 const ax:any=await import("../src/index.ts");
 await ready();await initializePostgresSchema(pool);
 await pool.query("TRUNCATE axiom_distributed_execution_jobs, axiom_tenant_admission_quotas, axiom_tenant_admission_quota_mode");
 const repo:any=new ax.PostgresDistributedExecutionRepository(pool);
 const H=(ch:string)=>ch.repeat(64);
 const quotaA={tenantId:"tenant:quota-pg-a"},quotaB={tenantId:"tenant:quota-pg-b"};
 const core=(tenantId:string,requestHash:string)=>({
  tenantId,principalId:"principal:pg-quota",authorizationDecisionHash:H("a"),requestHash,
  compilationId:"model-compilation:"+H("b"),compilationRecordHash:H("c"),
  profileId:"profile:pg-quota",profileVersion:"1",profileHash:H("d"),
  compilerManifest:{id:"axiom.phase1-compiler",version:"1",implementationHash:H("e")},
  operationRegistryManifestHash:H("f"),
  executionRequest:{asOf:"2026-11-01T10:00:00.000Z",issuedAt:"2026-11-01T10:00:01.000Z",
   program:{irVersion:"0.1",objective:"pg capacity",assumptions:[],inputs:{},nodes:[],constraints:[],decisionNodeId:"decision"},
   requirements:[],bindings:[]},snapshotId:"snapshot:"+H("1"),snapshotHash:H("2"),
   createdAt:tenantId===quotaB.tenantId?"2026-11-01T10:00:02.200Z":"2026-11-01T10:00:02.000Z"
 });
 try{
  await repo.installTenantAdmissionQuotas([{tenantId:quotaA.tenantId,maxOutstandingJobs:1},
   {tenantId:quotaB.tenantId,maxOutstandingJobs:1},
   {tenantId:"tenant:quota-pg-repeat",maxOutstandingJobs:1}]);
  const repeating={tenantId:"tenant:quota-pg-repeat"};
  const held=await pool.connect();
  await held.query("BEGIN");
  await held.query("SELECT 1 FROM axiom_tenant_admission_quotas WHERE tenant_id=$1 FOR UPDATE",[repeating.tenantId]);
  const exact=core(repeating.tenantId,H("7"));
  const firstPending=repo.create(repeating,exact);
  const secondPending=repo.create(repeating,exact);
  await new Promise(r=>setTimeout(r,50));
  await held.query("COMMIT");
  held.release();
  const both=await Promise.all([firstPending,secondPending]);
  assert.equal(both[0].intent.jobId,both[1].intent.jobId);
  const submissions=await Promise.allSettled([
   repo.create(quotaA,core(quotaA.tenantId,H("3"))),
   repo.create(quotaA,core(quotaA.tenantId,H("4")))
  ]);
  assert.equal(submissions.filter(x=>x.status==="fulfilled").length,1);
  const denied=submissions.find(x=>x.status==="rejected") as PromiseRejectedResult;
  assert.match(String(denied.reason),/TENANT_QUOTA_EXCEEDED/);
  const admitted=(submissions.find(x=>x.status==="fulfilled") as PromiseFulfilledResult<any>).value;
  assert.equal((await repo.create(quotaA,core(quotaA.tenantId,admitted.intent.requestHash))).intent.jobId,
   admitted.intent.jobId);
  await assert.rejects(()=>repo.create({tenantId:"tenant:missing"},core("tenant:missing",H("5"))),
   /TENANT_QUOTA_UNCONFIGURED/);
  await repo.create(quotaB,core(quotaB.tenantId,H("6")));
  await assert.rejects(()=>repo.installTenantAdmissionQuotas([{tenantId:quotaA.tenantId,maxOutstandingJobs:2}]),
   /immutable|mismatch/);
  const lease=await repo.claimNext("pg-worker:capacity","2026-11-01T10:00:03.000Z",1000);
  assert.equal(lease.job.intent.jobId,admitted.intent.jobId);
  await repo.failTerminal(quotaA,admitted.intent.jobId,"pg-worker:capacity",lease.leaseEpoch,
   "2026-11-01T10:00:03.100Z","STALE");
  const another=await repo.create(quotaA,core(quotaA.tenantId,H("9")));
  assert.equal(another.state.status,"PENDING");
 }finally{
  await pool.query("TRUNCATE axiom_distributed_execution_jobs, axiom_tenant_admission_quotas, axiom_tenant_admission_quota_mode");
 }
});

test("PostgreSQL tenant-fair claims rotate durable service order for legacy and authenticated workers",async()=>{
 const ax:any=await import("../src/index.ts");
 await ready();await initializePostgresSchema(pool);
 await pool.query("TRUNCATE axiom_distributed_execution_jobs, axiom_tenant_fair_mode, axiom_tenant_fair_cursor, axiom_tenant_fair_served");
 const repo:any=new ax.PostgresDistributedExecutionRepository(pool);
 const TA={tenantId:"tenant:fair-pg-a"},TB={tenantId:"tenant:fair-pg-b"};
 const H=(ch:string)=>ch.repeat(64);
 const core=(tenantId:string,requestHash:string,createdAt:string)=>({
  tenantId,principalId:"principal:pg-fair",authorizationDecisionHash:H("a"),requestHash,
  compilationId:"model-compilation:"+H("b"),compilationRecordHash:H("c"),profileId:"p",
  profileVersion:"1",profileHash:H("d"),compilerManifest:{id:"axiom.phase1-compiler",version:"1",implementationHash:H("e")},
  operationRegistryManifestHash:H("f"),executionRequest:{asOf:"2026-11-01T10:00:00.000Z",
  issuedAt:"2026-11-01T10:00:01.000Z",program:{irVersion:"0.1",objective:"pg fair",assumptions:[],inputs:{},
  nodes:[],constraints:[],decisionNodeId:"decision"},requirements:[],bindings:[]},
  snapshotId:"snapshot:"+H("1"),snapshotHash:H("2"),createdAt
 });
 await repo.enableTenantFairScheduling();
 await repo.enableTenantFairScheduling();
 const a1=await repo.create(TA,core(TA.tenantId,H("1"),"2026-11-01T10:00:02.000Z"));
 const a2=await repo.create(TA,core(TA.tenantId,H("2"),"2026-11-01T10:00:02.100Z"));
 const b1=await repo.create(TB,core(TB.tenantId,H("3"),"2026-11-01T10:00:02.200Z"));
 assert.equal((await repo.claimNext("fair-pg:first","2026-11-01T10:00:03.000Z",5000)).job.intent.jobId,a1.intent.jobId);
 assert.equal((await repo.claimNext("fair-pg:second","2026-11-01T10:00:03.001Z",5000)).job.intent.jobId,b1.intent.jobId);
 assert.equal((await repo.claimNext("fair-pg:third","2026-11-01T10:00:03.002Z",5000)).job.intent.jobId,a2.intent.jobId);
 const a3=await repo.create(TA,core(TA.tenantId,H("4"),"2026-11-01T10:00:02.300Z"));
 const b2=await repo.create(TB,core(TB.tenantId,H("5"),"2026-11-01T10:00:02.400Z"));
 const wk=generateKeyPairSync("ed25519"),lk=generateKeyPairSync("ed25519");
 const trust=ax.createWorkerTrustRecord({workerId:"pg-worker:fair",keyId:"wk:fair",poolId:"pool:fair",
  publicKeyPem:wk.publicKey.export({type:"spki",format:"pem"}).toString(),status:"ACTIVE",
  maxLeaseMs:5000,allowedActions:["CLAIM","HEARTBEAT","RELEASE","COMPLETE","FAIL_TERMINAL"]});
 const auth=new ax.WorkerRequestAuthenticator(new ax.StaticWorkerTrustStore([trust]),{maxAgeMs:30000,futureSkewMs:5000});
 const secure=await ax.createAuthenticatedPostgresDistributedExecutionStore(pool,auth,ax.createStaticWorkerLeaseSigner("lease:fair",lk));
 let count=0;
 const at="2026-11-01T10:00:03.100Z";
 const proof=()=>{
  const base={protocolVersion:"axiom.worker-request/v1",workerId:"pg-worker:fair",keyId:"wk:fair",
   requestId:"fair-pg-req:"+(++count),action:"CLAIM",bodyHash:hashJson({leaseMs:1000}),issuedAt:at};
  return {...base,signatureBase64:sign(null,Buffer.from(canonicalize(ax.workerRequestSigningPayload(base))),wk.privateKey).toString("base64")};
 };
 const p=proof(),first=await secure.claimNext(p,1000,at);
 assert.equal(first.job.intent.jobId,b2.intent.jobId);
 assert.deepEqual(await secure.claimNext(p,1000,"2026-11-01T10:00:03.200Z"),first);
 assert.equal((await pool.query("SELECT ordinal FROM axiom_tenant_fair_cursor WHERE singleton=TRUE")).rows[0].ordinal,"4");
 assert.equal((await secure.claimNext(proof(),1000,at)).job.intent.jobId,a3.intent.jobId);
 assert.equal((await pool.query("SELECT ordinal FROM axiom_tenant_fair_cursor WHERE singleton=TRUE")).rows[0].ordinal,"5");
 await pool.query("TRUNCATE axiom_distributed_execution_jobs, axiom_tenant_fair_mode, axiom_tenant_fair_cursor, axiom_tenant_fair_served");
});

test("PostgreSQL authenticated workers enforce signed claim, durable receipt replay and lease fencing",async()=>{
  const ax:any=await import("../src/index.ts");
  assert.equal(typeof ax.AuthenticatedPostgresDistributedExecutionStore,"function");
  await ready();await initializePostgresSchema(pool);
  await pool.query("TRUNCATE axiom_distributed_execution_jobs, axiom_worker_operation_receipts");
  const original=new ax.PostgresDistributedExecutionRepository(pool);
  const H=(x:string)=>x.repeat(64);
  const intent={tenantId:A.tenantId,principalId:"p:pg-secure",authorizationDecisionHash:H("a"),requestHash:H("b"),
    compilationId:"model-compilation:"+H("c"),compilationRecordHash:H("d"),profileId:"p",
    profileVersion:"1",profileHash:H("e"),compilerManifest:{id:"axiom.phase1-compiler",version:"1",implementationHash:H("f")},
    operationRegistryManifestHash:H("1"),executionRequest:{asOf:"2026-10-09T16:00:00.000Z",
    issuedAt:"2026-10-09T16:00:01.000Z",program:{irVersion:"0.1",objective:"pg worker test",assumptions:[],inputs:{},
    nodes:[],constraints:[],decisionNodeId:"decision"},requirements:[],bindings:[]},
    snapshotId:"snapshot:"+H("2"),snapshotHash:H("3"),createdAt:"2026-10-09T16:00:02.000Z"};
  const created=await original.create(A,intent);
  const wk=generateKeyPairSync("ed25519"),lk=generateKeyPairSync("ed25519");
  const record=ax.createWorkerTrustRecord({workerId:"pg-worker:one",keyId:"wk:one",poolId:"pool:one",
    publicKeyPem:wk.publicKey.export({type:"spki",format:"pem"}).toString(),
    status:"ACTIVE",maxLeaseMs:5000,allowedActions:["CLAIM","HEARTBEAT","RELEASE","COMPLETE","FAIL_TERMINAL"]});
  const auth=new ax.WorkerRequestAuthenticator(new ax.StaticWorkerTrustStore([record]),{maxAgeMs:30000,futureSkewMs:5000});
  const signer=ax.createStaticWorkerLeaseSigner("lease:pg",lk);
  const secure=await ax.createAuthenticatedPostgresDistributedExecutionStore(pool,auth,signer);
  await assert.rejects(()=>original.claimNext("raw:early","2026-10-09T16:00:02.500Z",1000),/WORKER_AUTH_REQUIRED/);
  let n=0;
  function proof(action:string,body:any,targetJobId?:string,issuedAt="2026-10-09T16:00:03.000Z"){
    const base={protocolVersion:"axiom.worker-request/v1",workerId:"pg-worker:one",keyId:"wk:one",
      requestId:"pg-req:"+(++n),action,bodyHash:hashJson(body),issuedAt,...targetJobId?{targetJobId}:{}};
    return {...base,signatureBase64:sign(null,Buffer.from(canonicalize(ax.workerRequestSigningPayload(base))),wk.privateKey).toString("base64")};
  }
  const claimProof=proof("CLAIM",{leaseMs:1000});
  const claim=await secure.claimNext(claimProof,1000,"2026-10-09T16:00:03.000Z");
  assert.equal(claim.job.intent.jobId,created.intent.jobId);
  assert.equal(claim.job.state.leaseWorkerKeyId,"wk:one");
  const retry=await secure.claimNext(claimProof,1000,"2026-10-09T16:00:03.100Z");
  assert.deepEqual(retry,claim);
  const cid=claim.capability.capabilityId;
  const changed=await secure.heartbeat(
    proof("HEARTBEAT",{leaseMs:2000,capabilityId:cid},created.intent.jobId),
    claim.capability,2000,"2026-10-09T16:00:03.300Z");
  assert.notEqual(changed.capability.capabilityId,cid);
  await assert.rejects(()=>secure.releaseForRetry(
    proof("RELEASE",{capabilityId:cid},created.intent.jobId),claim.capability,"2026-10-09T16:00:03.400Z"));
  const done=await secure.releaseForRetry(
    proof("RELEASE",{capabilityId:changed.capability.capabilityId},created.intent.jobId),
    changed.capability,"2026-10-09T16:00:03.500Z");
  assert.equal(done.state.status,"PENDING");
  await assert.rejects(()=>original.claimNext("raw-id","2026-10-09T16:00:04.000Z",1000),/WORKER_AUTH_REQUIRED/);
});

test("PostgreSQL view evidence enforces tenant predicate, read-only bounded rows and rollback",async()=>{
 await ready();
 const ax:any=await import("../src/index.ts");
 await pool.query(`CREATE TABLE IF NOT EXISTS axiom_p28b_source(
  tenant_id TEXT NOT NULL,id TEXT NOT NULL,risk DOUBLE PRECISION NOT NULL)`);
 await pool.query("TRUNCATE axiom_p28b_source");
 await pool.query("INSERT INTO axiom_p28b_source(tenant_id,id,risk) VALUES($1,$2,$3),($4,$5,$6),($7,$8,$9)",
  [A.tenantId,"row:a1",0.2,B.tenantId,"row:b1",0.8,A.tenantId,"row:a2",0.3]);
 await pool.query("CREATE OR REPLACE VIEW axiom_p28b_view AS SELECT tenant_id,id,risk FROM axiom_p28b_source");
 const op={operationId:"risk:pg:read",parameterSchemaHash:"a".repeat(64),
  responseMediaTypes:["application/json"],maxResponseBytes:1024,timeoutMs:3000,mappingIds:["risk:pg:map"]};
 const make=(maxRows:number,maxResponseBytes=1024)=>new ax.PostgresViewEvidenceAdapter({
  adapterId:"adapter:pg-view",version:"1",implementationHash:"b".repeat(64),pool,
  operations:[{manifest:{...op,maxResponseBytes},schemaName:"public",
   viewName:"axiom_p28b_view",tenantColumn:"tenant_id",columns:["id","risk"],orderColumn:"id",maxRows}]
 });
 try{
  const adapter=make(3);
  const actual=await adapter.acquire({tenant:A,operation:op,parameters:{}});
  const rows=JSON.parse(actual.body);
  assert.deepEqual(rows,[{id:"row:a1",risk:0.2},{id:"row:a2",risk:0.3}]);
  const isolated=await adapter.acquire({tenant:B,operation:op,parameters:{}});
  assert.deepEqual(JSON.parse(isolated.body),[{id:"row:b1",risk:0.8}]);
  await assert.rejects(()=>make(1).acquire({tenant:A,operation:op,parameters:{}}),/row limit/i);
  const tiny=make(3,12);
  await assert.rejects(()=>tiny.acquire({tenant:A,operation:{...op,maxResponseBytes:12},parameters:{}}),/byte limit/i);
  await assert.rejects(()=>adapter.acquire({tenant:A,operation:op,parameters:{query:"DELETE FROM axiom_p28b_source"}}),/parameters/i);
  assert.equal(Number((await pool.query("SELECT COUNT(*) AS n FROM axiom_p28b_source")).rows[0].n),3);
 }finally{
  await pool.query("DROP VIEW IF EXISTS axiom_p28b_view");
  await pool.query("DROP TABLE IF EXISTS axiom_p28b_source");
 }
});


test("PostgreSQL remote worker HTTP control preserves signed durable claim receipts and release fencing",async()=>{
 const ax:any=await import("../src/index.ts");
 const {createAxiomWorkerControlHttpServer}=await import("../src/worker_control_http.ts");
 await ready();await initializePostgresSchema(pool);
 await pool.query("TRUNCATE axiom_distributed_execution_jobs, axiom_worker_operation_receipts");
 const original=new ax.PostgresDistributedExecutionRepository(pool);
 const H=(x:string)=>x.repeat(64),tenant={tenantId:"tenant:pg-remote-control"};
 const created=await original.create(tenant,{
  tenantId:tenant.tenantId,principalId:"principal:pg-http",authorizationDecisionHash:H("a"),requestHash:H("b"),
  compilationId:"model-compilation:"+H("c"),compilationRecordHash:H("d"),profileId:"profile",
  profileVersion:"1",profileHash:H("e"),compilerManifest:{id:"axiom.phase1-compiler",version:"1",implementationHash:H("f")},
  operationRegistryManifestHash:H("1"),executionRequest:{asOf:"2026-11-02T08:00:00.000Z",
   issuedAt:"2026-11-02T08:00:01.000Z",program:{irVersion:"0.1",objective:"pg remote",
   assumptions:[],inputs:{},nodes:[],constraints:[],decisionNodeId:"decision"},requirements:[],bindings:[]},
  snapshotId:"snapshot:"+H("2"),snapshotHash:H("3"),createdAt:"2026-11-02T08:00:02.000Z"});
 const wk=generateKeyPairSync("ed25519"),lk=generateKeyPairSync("ed25519");
 const trust=ax.createWorkerTrustRecord({workerId:"worker:pg-remote",keyId:"wk:pg-remote",poolId:"pool:pg-remote",
  publicKeyPem:wk.publicKey.export({type:"spki",format:"pem"}).toString(),status:"ACTIVE",
  maxLeaseMs:5000,allowedActions:["CLAIM","HEARTBEAT","RELEASE","COMPLETE","FAIL_TERMINAL"]});
 const auth=new ax.WorkerRequestAuthenticator(new ax.StaticWorkerTrustStore([trust]),
  {maxAgeMs:30000,futureSkewMs:5000});
 const secure=await ax.createAuthenticatedPostgresDistributedExecutionStore(pool,auth,
  ax.createStaticWorkerLeaseSigner("lease:pg-http",lk));
 const now="2026-11-02T08:00:03.000Z";
 const signProof=(action:string,body:any,targetJobId?:string)=>{
  const core={protocolVersion:"axiom.worker-request/v1",workerId:"worker:pg-remote",keyId:"wk:pg-remote",
   requestId:"pg-http-"+Math.random().toString(36).slice(2),action,bodyHash:hashJson(body),issuedAt:now,
   ...targetJobId?{targetJobId}:{}};
  return {...core,signatureBase64:sign(null,Buffer.from(canonicalize(ax.workerRequestSigningPayload(core))),wk.privateKey).toString("base64")};
 };
 const server=createAxiomWorkerControlHttpServer({jobs:secure,clock:()=>now,trustedIngress:()=>true});
 await new Promise<void>((resolve,reject)=>server.once("error",reject).listen(0,"127.0.0.1",resolve));
 try{
  const addr=server.address() as {port:number},base="http://127.0.0.1:"+addr.port;
  async function request(path:string,data:unknown){
   const res=await fetch(base+path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(data)});
   return {status:res.status,data:await res.json()};
  }
  const proof=signProof("CLAIM",{leaseMs:1000});
  const claim=await request("/v1/worker/claims",{proof,leaseMs:1000});
  assert.equal(claim.status,200);assert.equal(claim.data.status,"LEASED");
  assert.equal(claim.data.lease.job.intent.jobId,created.intent.jobId);
  assert.deepEqual(await request("/v1/worker/claims",{proof,leaseMs:1000}),claim);
  const cap=claim.data.lease.capability;
  const releaseProof=signProof("RELEASE",{capabilityId:cap.capabilityId},created.intent.jobId);
  const route="/v1/worker/jobs/"+encodeURIComponent(created.intent.jobId)+"/release";
  const released=await request(route,{proof:releaseProof,capability:cap});
  assert.deepEqual(released,{status:200,data:{status:"RELEASED",jobStatus:"PENDING"}});
  assert.deepEqual(await request(route,{proof:releaseProof,capability:cap}),released);
  assert.equal((await original.get(tenant,created.intent.jobId)).state.status,"PENDING");
  assert.equal((await request("/v1/worker/jobs/"+encodeURIComponent(created.intent.jobId)+"/complete",
   {proof:signProof("COMPLETE",{})})).status,404);
 }finally{
  await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  await pool.query("TRUNCATE axiom_distributed_execution_jobs, axiom_worker_operation_receipts");
 }
});


test("PostgreSQL provider spend reservations serialize across competing workers and isolate tenants",async()=>{
 await ready();await initializePostgresSchema(pool);
 const ax:any=await import("../src/index.ts");
 assert.equal(typeof ax.PostgresProviderSpendLedger,"function");
 const ledger=new ax.PostgresProviderSpendLedger(pool);
 const tenant={tenantId:"tenant:pg-cost-concurrent"},other={tenantId:"tenant:pg-cost-other"};
 const provider="model:pg-cost",modelId="billing:test-model";
 await pool.query("DELETE FROM axiom_provider_spend_requests WHERE provider=$1 AND model_id=$2",[provider,modelId]);
 await pool.query("DELETE FROM axiom_provider_spend_budgets WHERE provider=$1 AND model_id=$2",[provider,modelId]);
 await ledger.provisionOrganization("openai",100000);
 await ledger.provision(tenant,provider,modelId,1000,"openai");
 await ledger.provision(other,provider,modelId,1000,"openai");
 const reservation=(id:string,tenantId=tenant.tenantId)=>({
  tenantId,provider,modelId,billingProvider:"openai",requestId:id,requestHash:"a".repeat(64),reserveMicroUsd:700
 });
 const [first,second]=await Promise.allSettled([
  ledger.reserve(reservation("pg-cost-1")),ledger.reserve(reservation("pg-cost-2"))
 ]);
 assert.equal([first,second].filter(x=>x.status==="fulfilled").length,1);
 assert.equal([first,second].filter(x=>x.status==="rejected").length,1);
 const winner=first.status==="fulfilled"?"pg-cost-1":"pg-cost-2";
 const loser=winner==="pg-cost-1"?"pg-cost-2":"pg-cost-1";
 assert.deepEqual(await ledger.status(tenant,provider,modelId),{
  limitMicroUsd:1000,chargedMicroUsd:0,reservedMicroUsd:700,availableMicroUsd:300
 });
 assert.deepEqual(await ledger.status(other,provider,modelId),{
  limitMicroUsd:1000,chargedMicroUsd:0,reservedMicroUsd:0,availableMicroUsd:1000
 });
 await assert.rejects(()=>ledger.reserve(reservation(winner)),/reserved|duplicate|reconciliation/i);
 await assert.rejects(()=>ledger.reserve(reservation(loser)),/budget|limit/i);
 await ledger.reserve(reservation("pg-cost-other",other.tenantId));
 await ledger.settle({...reservation(winner),chargeMicroUsd:200,responseHash:"b".repeat(64)});
 assert.deepEqual(await ledger.status(tenant,provider,modelId),{
  limitMicroUsd:1000,chargedMicroUsd:200,reservedMicroUsd:0,availableMicroUsd:800
 });
 await assert.rejects(()=>ledger.settle({...reservation(winner),chargeMicroUsd:200,responseHash:"b".repeat(64)}),/already|settle|reservation|matching/i);
 await ledger.reserve(reservation(loser));
 assert.equal((await ledger.status(tenant,provider,modelId)).reservedMicroUsd,700);
});

test("PostgreSQL billing records overages, suspends further calls and fails closed on unknown receipts",async()=>{
 await ready();await initializePostgresSchema(pool);
 const ax:any=await import("../src/index.ts");
 const ledger=new ax.PostgresProviderSpendLedger(pool);
 const tenant={tenantId:"tenant:pg-cost-overage"},provider="model:pg-cost",modelId="billing:test-model";
 await pool.query("DELETE FROM axiom_provider_spend_requests WHERE tenant_id=$1",[tenant.tenantId]);
 await pool.query("DELETE FROM axiom_provider_spend_budgets WHERE tenant_id=$1",[tenant.tenantId]);
 await ledger.provisionOrganization("openai",100000);
 await ledger.provision(tenant,provider,modelId,1000,"openai");
 const reservation={tenantId:tenant.tenantId,provider,modelId,billingProvider:"openai",requestId:"pg-overage",
  requestHash:"e".repeat(64),reserveMicroUsd:100};
 await ledger.reserve(reservation);
 await assert.rejects(()=>ledger.settle({...reservation,requestHash:"f".repeat(64),chargeMicroUsd:600,responseHash:"b".repeat(64)}),/matching|reservation|forbidden/i);
 assert.equal((await ledger.status(tenant,provider,modelId)).reservedMicroUsd,100);
 await assert.rejects(()=>ledger.settle({...reservation,chargeMicroUsd:600,responseHash:"c".repeat(64)}),/overage|reserved/i);
 assert.deepEqual(await ledger.status(tenant,provider,modelId),{
  limitMicroUsd:1000,chargedMicroUsd:600,reservedMicroUsd:0,availableMicroUsd:400
 });
 await assert.rejects(()=>ledger.reserve({...reservation,requestId:"pg-new",requestHash:"d".repeat(64)}),/suspended|overage/i);
 await assert.rejects(()=>ledger.provision(tenant,provider,modelId,999,"openai"),/immutable|existing|differs/i);
});


test("PostgreSQL denies vendor reservations when the shared organization spending cap is not provisioned",async()=>{
 await ready();await initializePostgresSchema(pool);
 const ax:any=await import("../src/index.ts");
 const ledger=new ax.PostgresProviderSpendLedger(pool);
 const tenant={tenantId:"tenant:pg-organization-unprovisioned"};
 const provider="adapter:pg-organization-unprovisioned",modelId="billing:model-unprovisioned";
 await pool.query("DELETE FROM axiom_provider_spend_requests WHERE tenant_id=$1",[tenant.tenantId]);
 await pool.query("DELETE FROM axiom_provider_spend_budgets WHERE tenant_id=$1",[tenant.tenantId]);
 // The operator may provision a tenant limit without having approved the
 // separate upstream vendor's aggregate organization spending authority.
 await ledger.provision(tenant,provider,modelId,1000,"anthropic");
 const reservation={tenantId:tenant.tenantId,provider,modelId,
  billingProvider:"anthropic",requestId:"org-not-provisioned",
  requestHash:"7".repeat(64),reserveMicroUsd:700};
 await assert.rejects(()=>ledger.reserve(reservation),
  (error:any)=>error?.code==="BUDGET_ORGANIZATION_NOT_PROVISIONED");
 assert.deepEqual(await ledger.status(tenant,provider,modelId),{
  limitMicroUsd:1000,chargedMicroUsd:0,reservedMicroUsd:0,availableMicroUsd:1000
 });
});


test("PostgreSQL vendor-wide cap serializes competing tenant reservations and suspends after overage",async()=>{
 await ready();await initializePostgresSchema(pool);
 const ax:any=await import("../src/index.ts");
 const ledger=new ax.PostgresProviderSpendLedger(pool),vendor="anthropic";
 const tenantA={tenantId:"tenant:pg-organization-a"},tenantB={tenantId:"tenant:pg-organization-b"};
 const first={tenantId:tenantA.tenantId,provider:"adapter:org-a",modelId:"org:model-a",
  billingProvider:vendor,requestId:"org-a-1",requestHash:"8".repeat(64),reserveMicroUsd:700};
 const second={tenantId:tenantB.tenantId,provider:"adapter:org-b",modelId:"org:model-b",
  billingProvider:vendor,requestId:"org-b-1",requestHash:"9".repeat(64),reserveMicroUsd:700};
 await pool.query("DELETE FROM axiom_provider_spend_requests WHERE tenant_id=ANY($1::text[])",[[tenantA.tenantId,tenantB.tenantId]]);
 await pool.query("DELETE FROM axiom_provider_spend_budgets WHERE tenant_id=ANY($1::text[])",[[tenantA.tenantId,tenantB.tenantId]]);
 await ledger.provisionOrganization(vendor,1000);
 await ledger.provision(tenantA,first.provider,first.modelId,1000,vendor);
 await ledger.provision(tenantB,second.provider,second.modelId,1000,vendor);
 // Simulate two independent workers with separate TCP pools. This verifies
 // database row locking, not just scheduling inside a single Node.js pg Pool.
 const workerPool=new Pool({host:process.env.PGHOST??"postgres",
  port:Number(process.env.PGPORT??5432),database:process.env.PGDATABASE??"axiom_test",
  user:process.env.PGUSER??"axiom",password:process.env.PGPASSWORD??"axiom-test-password",
  max:2,connectionTimeoutMillis:2000});
 let a:PromiseSettledResult<void>,b:PromiseSettledResult<void>;
 try{
  const otherWorker=new ax.PostgresProviderSpendLedger(workerPool);
  [a,b]=await Promise.allSettled([ledger.reserve(first),otherWorker.reserve(second)]);
 }finally{await workerPool.end();}
 assert.equal([a,b].filter(result=>result.status==="fulfilled").length,1);
 const winner=a.status==="fulfilled"?first:second,loser=winner===first?second:first;
 assert.deepEqual(await ledger.organizationStatus(vendor),{
  limitMicroUsd:1000,chargedMicroUsd:0,reservedMicroUsd:700,availableMicroUsd:300
 });
 await ledger.settle({...winner,chargeMicroUsd:200,responseHash:"a".repeat(64)});
 await ledger.reserve(loser);
 assert.deepEqual(await ledger.organizationStatus(vendor),{
  limitMicroUsd:1000,chargedMicroUsd:200,reservedMicroUsd:700,availableMicroUsd:100
 });
 await assert.rejects(()=>ledger.settle({...loser,chargeMicroUsd:900,responseHash:"b".repeat(64)}),
  (error:any)=>error?.code==="BUDGET_PROVIDER_OVERAGE");
 assert.deepEqual(await ledger.organizationStatus(vendor),{
  limitMicroUsd:1000,chargedMicroUsd:1100,reservedMicroUsd:0,availableMicroUsd:0
 });
 await assert.rejects(()=>ledger.reserve({...winner,requestId:"after-org-overage",requestHash:"c".repeat(64),reserveMicroUsd:100}),
  (error:any)=>error?.code==="BUDGET_ORGANIZATION_SUSPENDED");
});


// Phase 2.10C: a restricted runtime must not own or directly mutate the
// accounting rows. Only narrow, operator-granted SQL RPCs can spend.
test('protected PostgreSQL reserve and settle enforce limits without runtime table DML',async()=>{
  await ready();
  await pool.query('CREATE DATABASE axiom_spend_isolated_ci');
  const admin=new Pool({host:process.env.PGHOST??'postgres',port:Number(process.env.PGPORT??5432),
    database:'axiom_spend_isolated_ci',user:process.env.PGUSER??'axiom',
    password:process.env.PGPASSWORD??'axiom-test-password',max:3});
  try{
    await initializePostgresSchema(admin);
    // Privileged SQL functions are a separate, explicit migration; ordinary
    // schema initialization must not implicitly create SECURITY DEFINER code.
    await admin.query(readFileSync(new URL('../sql/provider_spend_protected.sql',import.meta.url),'utf8'));
  const signatures=await admin.query(`SELECT
    to_regprocedure('axiom_spend.reserve(text,text,text,text,text,bigint,text)')::text AS reserve_rpc,
    to_regprocedure('axiom_spend.settle(text,text,text,text,text,bigint,text,text)')::text AS settle_rpc`);
  assert.ok(signatures.rows[0].reserve_rpc,'protected reserve SQL RPC must exist');
  assert.ok(signatures.rows[0].settle_rpc,'protected settle SQL RPC must exist');
  const migrationOwner=(await admin.query("SELECT current_user AS name")).rows[0].name;
  assert.notEqual(migrationOwner,'axiom_spend_runtime_ci');
  const ax:any=await import('../src/index.ts');
  const operator=new ax.PostgresProviderSpendLedger(admin);
  const tenant={tenantId:'tenant:pg-protected-rpc'},provider='adapter:protected-rpc',modelId='model:protected-rpc';
  await admin.query('DELETE FROM public.axiom_provider_spend_requests WHERE tenant_id=$1',[tenant.tenantId]);
  await admin.query('DELETE FROM public.axiom_provider_spend_budgets WHERE tenant_id=$1',[tenant.tenantId]);
  await operator.provisionOrganization('openai',100000);
  await operator.provision(tenant,provider,modelId,500,'openai');
  // A temporary CI-only identity: no table ownership, no role inheritance,
  // no schema CREATE, and only explicit RPC execution rights.
  await admin.query("CREATE ROLE axiom_spend_runtime_ci LOGIN PASSWORD 'ci-disposable-not-production' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT");
  let caller:InstanceType<typeof Pool>|undefined;
  try{
    await admin.query('GRANT USAGE ON SCHEMA axiom_spend TO axiom_spend_runtime_ci');
    await admin.query(`GRANT EXECUTE ON FUNCTION axiom_spend.reserve(text,text,text,text,text,bigint,text),
      axiom_spend.settle(text,text,text,text,text,bigint,text,text) TO axiom_spend_runtime_ci`);
    caller=new Pool({host:process.env.PGHOST??'postgres',port:Number(process.env.PGPORT??5432),
      database:'axiom_spend_isolated_ci',user:'axiom_spend_runtime_ci',
      password:'ci-disposable-not-production',max:2,connectionTimeoutMillis:2000});
    assert.equal(typeof ax.ProtectedPostgresProviderSpendLedger,'function',
      'restricted runtime must have a trusted SQL-RPC-only ledger implementation');
    const protectedLedger=new ax.ProtectedPostgresProviderSpendLedger(caller);
    assert.equal(ax.ProtectedPostgresProviderSpendLedger.isAuthenticLedger(protectedLedger),true);
    assert.throws(()=>new ax.ProtectedPostgresProviderSpendLedger({connect:async()=>{}}),/PostgreSQL Pool/i);
    const grants=await caller.query(`SELECT
      has_table_privilege(current_user,'public.axiom_provider_spend_budgets','UPDATE,INSERT,DELETE,TRUNCATE') AS budget_dml,
      has_table_privilege(current_user,'public.axiom_provider_spend_organizations','UPDATE,INSERT,DELETE,TRUNCATE') AS org_dml,
      has_table_privilege(current_user,'public.axiom_provider_spend_requests','UPDATE,INSERT,DELETE,TRUNCATE') AS receipt_dml,
      has_schema_privilege(current_user,'public','CREATE') AS can_create_public,
      has_schema_privilege(current_user,'axiom_spend','CREATE') AS can_create_rpc`);
    assert.deepEqual(grants.rows,[{budget_dml:false,org_dml:false,receipt_dml:false,can_create_public:false,can_create_rpc:false}]);
    await assert.rejects(()=>caller!.query('UPDATE public.axiom_provider_spend_budgets SET limit_micro_usd=1000000 WHERE tenant_id=$1',[tenant.tenantId]),(e:any)=>e.code==='42501');
    await assert.rejects(()=>caller!.query('SET ROLE '+migrationOwner),(e:any)=>e.code==='42501');
    const args=[tenant.tenantId,provider,modelId,'protected-1','a'.repeat(64),350,'openai'];
    const reserve=await caller.query('SELECT axiom_spend.reserve($1,$2,$3,$4,$5,$6::bigint,$7) AS verdict',args);
    assert.equal(reserve.rows[0].verdict,'OK');
    const denied=await caller.query('SELECT axiom_spend.reserve($1,$2,$3,$4,$5,$6::bigint,$7) AS verdict',
      [tenant.tenantId,provider,modelId,'protected-2','b'.repeat(64),350,'openai']);
    assert.equal(denied.rows[0].verdict,'BUDGET_EXCEEDED');
    assert.equal((await operator.status(tenant,provider,modelId)).reservedMicroUsd,350);
    const settle=await caller.query('SELECT axiom_spend.settle($1,$2,$3,$4,$5,$6::bigint,$7,$8) AS verdict',
      [tenant.tenantId,provider,modelId,'protected-1','a'.repeat(64),200,'b'.repeat(64),'openai']);
    assert.equal(settle.rows[0].verdict,'OK');
    assert.deepEqual(await operator.status(tenant,provider,modelId),{
      limitMicroUsd:500,chargedMicroUsd:200,reservedMicroUsd:0,availableMicroUsd:300
    });
    const repeat=await caller.query('SELECT axiom_spend.reserve($1,$2,$3,$4,$5,$6::bigint,$7) AS verdict',args);
    assert.equal(repeat.rows[0].verdict,'BUDGET_ALREADY_SETTLED');
    await protectedLedger.reserve({tenantId:tenant.tenantId,provider,modelId,
      billingProvider:'openai',requestId:'protected-ledger',requestHash:'c'.repeat(64),reserveMicroUsd:100});
    await protectedLedger.settle({tenantId:tenant.tenantId,provider,modelId,
      billingProvider:'openai',requestId:'protected-ledger',requestHash:'c'.repeat(64),
      chargeMicroUsd:25,responseHash:'d'.repeat(64)});
    assert.equal((await operator.status(tenant,provider,modelId)).chargedMicroUsd,225);
    // Exercise the real trusted decorator with a synthetic provider: no vendor or
    // credential is contacted, and the runtime database role still has no DML.
    let providerCalls=0;
    const fakeAdapter={
      manifest:{adapterId:provider,modelId,provider:'openai',version:'1.0.0',
        implementationHash:'f'.repeat(64)},
      async invoke(){
        providerCalls++;
        return {capturedAt:'2026-11-08T00:00:00.000Z',requestBody:'{}',
          responseBody:JSON.stringify({id:'test-response',usage:{
            input_tokens:100,output_tokens:50,total_tokens:150}}),
          normalizedResponseBody:'{}'};
      },
      async explain(){throw new Error('explanation not requested');}
    };
    const priced={inputMicrosPerMillionTokens:1000000,outputMicrosPerMillionTokens:2000000,
      cacheReadMicrosPerMillionTokens:0,cacheWriteMicrosPerMillionTokens:0};
    const budgeted=new ax.BudgetedModelProviderAdapter({
      adapter:fakeAdapter,ledger:protectedLedger,tenantId:tenant.tenantId,
      prices:priced,requestReserveMicroUsd:260});
    await budgeted.invoke({tenant,compilationRequestHash:'e'.repeat(64),attempt:0,mode:'INITIAL'});
    assert.equal(providerCalls,1);
    assert.equal((await operator.status(tenant,provider,modelId)).chargedMicroUsd,425);
    await assert.rejects(
      ()=>budgeted.invoke({tenant,compilationRequestHash:'f'.repeat(64),attempt:0,mode:'INITIAL'}),
      (e:any)=>e?.code==='BUDGET_EXCEEDED');
    assert.equal(providerCalls,1,'an exhausted budget must deny before provider network access');
    await assert.rejects(()=>caller!.query(
      'SELECT charged_micro_usd FROM public.axiom_provider_spend_budgets LIMIT 1'),
      (e:any)=>e.code==='42501');
  }finally{
    if(caller)await caller.end();
    await admin.query('DROP OWNED BY axiom_spend_runtime_ci');
    await admin.query('DROP ROLE axiom_spend_runtime_ci');
  }
  }finally{
    await admin.end();
    await pool.query('DROP DATABASE axiom_spend_isolated_ci WITH (FORCE)');
  }
});
