import { DatabaseSync } from "node:sqlite";
import { hashJson } from "../../phase1/src/canonical.ts";
import type { ModelCompilationRepository } from "./repositories.ts";
import type { ModelCompilationRecord, ModelExchangeArtifact, TenantScope } from "./types.ts";
import { verifyModelExchangeArtifact } from "./model_adapter.ts";

const HEX64=/^[0-9a-f]{64}$/;

function required(value:unknown,label:string):string {
  if(typeof value!=="string"||!value.trim())throw new TypeError(`${label} is required`);
  return value;
}
function digest(value:unknown,label:string):string {
  const text=required(value,label);
  if(!HEX64.test(text))throw new TypeError(`${label} must be a lowercase SHA-256 hex digest`);
  return text;
}
function tenantId(scope:TenantScope):string {return required(scope?.tenantId,"tenantId");}
function recordCore(record:ModelCompilationRecord):Omit<ModelCompilationRecord,"recordHash"> {
  const {recordHash:_,...core}=record;
  return core;
}
function same(a:unknown,b:unknown):boolean {return JSON.stringify(a)===JSON.stringify(b);}

export function verifyModelCompilationRecord(scope:TenantScope,record:ModelCompilationRecord):ModelCompilationRecord {
  const tenant=tenantId(scope);
  required(record?.compilationId,"compilationId");
  if(record.tenantId!==tenant)throw new Error("Model compilation tenant mismatch");
  required(record.principalId,"principalId");
  digest(record.authorizationDecisionHash,"authorizationDecisionHash");
  digest(record.compilationRequestHash,"compilationRequestHash");
  required(record.profileId,"profileId");required(record.profileVersion,"profileVersion");digest(record.profileHash,"profileHash");
  required(record.adapterManifest?.adapterId,"adapterId");required(record.adapterManifest?.version,"adapterVersion");
  digest(record.adapterManifest?.implementationHash,"adapterImplementationHash");
  required(record.adapterManifest?.provider,"provider");required(record.adapterManifest?.modelId,"modelId");
  if(record.compilerManifest?.id!=="axiom.phase1-compiler")throw new Error("Model compilation compiler manifest is invalid");
  required(record.compilerManifest?.version,"compiler version");digest(record.compilerManifest?.implementationHash,"compiler implementationHash");
  digest(record.operationRegistryManifestHash,"operationRegistryManifestHash");
  required(record.objective,"objective");
  if(!Array.isArray(record.inputContracts)||record.inputContracts.length===0)throw new TypeError("Model compilation inputContracts must not be empty");
  if(!Array.isArray(record.exchangeArtifactIds)||record.exchangeArtifactIds.length===0)throw new TypeError("Model compilation exchange artifacts must not be empty");
  if(!Array.isArray(record.exchangeArtifactHashes)||record.exchangeArtifactHashes.length!==record.exchangeArtifactIds.length)throw new Error("Model compilation exchange artifact arrays do not match");
  for(const id of record.exchangeArtifactIds)required(id,"exchangeArtifactId");
  for(const hash of record.exchangeArtifactHashes)digest(hash,"exchangeArtifactHash");
  if(!Array.isArray(record.finalIssues))throw new TypeError("Model compilation finalIssues must be an array");
  if(record.status!=="VALIDATED"&&record.status!=="REJECTED")throw new TypeError("Model compilation status is invalid");
  required(record.createdAt,"createdAt");

  if(record.status==="VALIDATED"){
    if(record.compiledProgram===undefined||record.compiledProgramHash===undefined)throw new Error("VALIDATED model compilation requires compiled program and hash");
    const expectedProgramHash=hashJson(record.compiledProgram as any);
    if(record.compiledProgramHash!==expectedProgramHash)throw new Error("Model compilation compiled program integrity mismatch");
  }else if(record.compiledProgram!==undefined||record.compiledProgramHash!==undefined){
    throw new Error("REJECTED model compilation cannot contain compiled program material");
  }

  const expectedRecordHash=hashJson(recordCore(record) as any);
  if(record.recordHash!==expectedRecordHash)throw new Error("Model compilation record integrity mismatch");
  return structuredClone(record);
}

export function validateModelCompilationCommit(
  scope:TenantScope,artifacts:ModelExchangeArtifact[],record:ModelCompilationRecord
):{artifacts:ModelExchangeArtifact[];record:ModelCompilationRecord} {
  const verifiedRecord=verifyModelCompilationRecord(scope,record);
  if(!Array.isArray(artifacts)||artifacts.length===0)throw new TypeError("Model compilation artifacts must not be empty");
  const verifiedArtifacts=artifacts.map(a=>verifyModelExchangeArtifact(scope,a));
  const ids=verifiedArtifacts.map(a=>a.artifactId),hashes=verifiedArtifacts.map(a=>a.artifactHash);
  if(!same(ids,verifiedRecord.exchangeArtifactIds)||!same(hashes,verifiedRecord.exchangeArtifactHashes)){
    throw new Error("Model compilation exchange artifact IDs or hashes do not match terminal record");
  }
  for(let i=0;i<verifiedArtifacts.length;i++){
    const artifact=verifiedArtifacts[i];
    if(artifact.attempt!==i)throw new Error("Model compilation artifact attempt order is invalid");
    if((i===0&&artifact.mode!=="INITIAL")||(i>0&&artifact.mode!=="REPAIR"))throw new Error("Model compilation artifact mode order is invalid");
    if(
      artifact.profileId!==verifiedRecord.profileId||
      artifact.profileHash!==verifiedRecord.profileHash||
      artifact.compilationRequestHash!==verifiedRecord.compilationRequestHash||
      artifact.adapterId!==verifiedRecord.adapterManifest.adapterId||
      artifact.adapterVersion!==verifiedRecord.adapterManifest.version||
      artifact.adapterImplementationHash!==verifiedRecord.adapterManifest.implementationHash||
      artifact.provider!==verifiedRecord.adapterManifest.provider||
      artifact.modelId!==verifiedRecord.adapterManifest.modelId
    )throw new Error("Model compilation artifact identity does not match terminal record");
  }
  return {artifacts:verifiedArtifacts,record:verifiedRecord};
}

function parseArtifact(row:any,scope:TenantScope):ModelExchangeArtifact {
  const artifact=JSON.parse(String(row.artifact_json)) as ModelExchangeArtifact;
  if(
    artifact.artifactHash!==String(row.artifact_hash)||
    artifact.requestBodyHash!==String(row.request_body_hash)||
    artifact.responseBodyHash!==String(row.response_body_hash)||
    artifact.requestBody!==String(row.request_body)||
    artifact.responseBody!==String(row.response_body)
  )throw new Error("Stored model exchange artifact integrity mismatch");
  return verifyModelExchangeArtifact(scope,artifact);
}
function parseCompilation(row:any,scope:TenantScope):ModelCompilationRecord {
  const record=JSON.parse(String(row.record_json)) as ModelCompilationRecord;
  if(record.recordHash!==String(row.record_hash))throw new Error("Stored model compilation record integrity mismatch");
  const storedProgramHash=row.compiled_program_hash===null?undefined:String(row.compiled_program_hash);
  if(record.compiledProgramHash!==storedProgramHash)throw new Error("Stored model compilation program hash integrity mismatch");
  return verifyModelCompilationRecord(scope,record);
}

export class ModelCompilationStore implements ModelCompilationRepository {
  private readonly db:DatabaseSync;
  constructor(databasePath:string){
    this.db=new DatabaseSync(databasePath);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS axiom_model_exchange_artifacts(
        tenant_id TEXT NOT NULL,
        artifact_id TEXT NOT NULL,
        artifact_hash TEXT NOT NULL,
        request_body_hash TEXT NOT NULL,
        response_body_hash TEXT NOT NULL,
        request_body TEXT NOT NULL,
        response_body TEXT NOT NULL,
        artifact_json TEXT NOT NULL,
        PRIMARY KEY(tenant_id,artifact_id)
      );
      CREATE TABLE IF NOT EXISTS axiom_model_compilations(
        tenant_id TEXT NOT NULL,
        compilation_id TEXT NOT NULL,
        record_hash TEXT NOT NULL,
        compiled_program_hash TEXT,
        record_json TEXT NOT NULL,
        PRIMARY KEY(tenant_id,compilation_id)
      );
    `);
  }
  close():void {this.db.close();}

  async commitCompilation(scope:TenantScope,artifacts:ModelExchangeArtifact[],record:ModelCompilationRecord):Promise<void> {
    const tenant=tenantId(scope),verified=validateModelCompilationCommit(scope,artifacts,record);
    this.db.exec("BEGIN IMMEDIATE");
    try{
      const artifactInsert=this.db.prepare(`
        INSERT INTO axiom_model_exchange_artifacts(
          tenant_id,artifact_id,artifact_hash,request_body_hash,response_body_hash,request_body,response_body,artifact_json
        ) VALUES(?,?,?,?,?,?,?,?)
      `);
      for(const artifact of verified.artifacts){
        artifactInsert.run(
          tenant,artifact.artifactId,artifact.artifactHash,artifact.requestBodyHash,artifact.responseBodyHash,
          artifact.requestBody,artifact.responseBody,JSON.stringify(artifact)
        );
      }
      this.db.prepare(`
        INSERT INTO axiom_model_compilations(tenant_id,compilation_id,record_hash,compiled_program_hash,record_json)
        VALUES(?,?,?,?,?)
      `).run(
        tenant,verified.record.compilationId,verified.record.recordHash,verified.record.compiledProgramHash??null,
        JSON.stringify(verified.record)
      );
      this.db.exec("COMMIT");
    }catch(error){try{this.db.exec("ROLLBACK");}catch{}throw error;}
  }

  async getCompilation(scope:TenantScope,compilationId:string):Promise<ModelCompilationRecord> {
    const tenant=tenantId(scope),id=required(compilationId,"compilationId");
    const row=this.db.prepare(`
      SELECT record_hash,compiled_program_hash,record_json
      FROM axiom_model_compilations WHERE tenant_id=? AND compilation_id=?
    `).get(tenant,id) as any;
    if(!row)throw new Error(`Model compilation not found for tenant ${tenant}: ${id}`);
    return structuredClone(parseCompilation(row,scope));
  }

  async getModelArtifact(scope:TenantScope,artifactId:string):Promise<ModelExchangeArtifact> {
    const tenant=tenantId(scope),id=required(artifactId,"artifactId");
    const row=this.db.prepare(`
      SELECT artifact_hash,request_body_hash,response_body_hash,request_body,response_body,artifact_json
      FROM axiom_model_exchange_artifacts WHERE tenant_id=? AND artifact_id=?
    `).get(tenant,id) as any;
    if(!row)throw new Error(`Model exchange artifact not found for tenant ${tenant}: ${id}`);
    return structuredClone(parseArtifact(row,scope));
  }
}
