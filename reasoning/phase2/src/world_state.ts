import { DatabaseSync } from "node:sqlite";
import { hashJson } from "../../phase1/src/canonical.ts";
import { assertAcquisitionFactProvenance, verifyEvidenceArtifact } from "./evidence.ts";
import type { EvidenceRepository, IngestionReplayClaim, VerifiedFactCommit, WorldStateRepository } from "./repositories.ts";
import type {
  AcquisitionRecord, EvidenceArtifact, FactAcquisition, FactAuthentication, TemporalFact, TenantScope, WorldSnapshot
} from "./types.ts";

function tenantId(scope:TenantScope):string {
  if(!scope?.tenantId?.trim())throw new TypeError("tenantId is required");
  return scope.tenantId;
}
function required(value:unknown,label:string):string {
  if(typeof value!=="string"||!value.trim())throw new TypeError(`${label} is required`);
  return value;
}
function iso(value:string,label:string):string {
  const ms=Date.parse(value);
  if(!Number.isFinite(ms))throw new TypeError(`${label} must be an ISO-8601 timestamp`);
  return new Date(ms).toISOString();
}
function tableExists(db:DatabaseSync,name:string):boolean {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name));
}
function columns(db:DatabaseSync,name:string):string[] {
  return (db.prepare(`PRAGMA table_info(${name})`).all() as any[]).map(row=>String(row.name));
}
function requireTenantSchema(db:DatabaseSync,name:string):void {
  if(tableExists(db,name)&&!columns(db,name).includes("tenant_id")){
    throw new Error(`Legacy Phase-2 SQLite schema detected: ${name} has no tenant_id; archive or migrate this database before Phase 2.1`);
  }
}
function fromRow(row:any):TemporalFact {
  const fact:TemporalFact={
    id:String(row.id),entity:String(row.entity),attribute:String(row.attribute),
    value:JSON.parse(String(row.value_json)),validFrom:String(row.valid_from),
    observedAt:String(row.observed_at),source:String(row.source)
  };
  if(row.valid_until!==null)fact.validUntil=String(row.valid_until);
  if(row.confidence!==null)fact.confidence=Number(row.confidence);
  const supersedes=JSON.parse(String(row.supersedes_json));if(supersedes.length)fact.supersedes=supersedes;
  if(row.acquisition_json!==null)fact.acquisition=JSON.parse(String(row.acquisition_json)) as FactAcquisition;
  if(row.authentication_json!==null)fact.authentication=JSON.parse(String(row.authentication_json)) as FactAuthentication;
  return fact;
}
function verifySnapshot(scope:TenantScope,snapshot:WorldSnapshot,storedHash?:string):WorldSnapshot {
  const tenant=tenantId(scope),expected=hashJson({tenantId:tenant,asOf:snapshot.asOf,facts:snapshot.facts} as any);
  if(snapshot.tenantId!==tenant||snapshot.snapshotHash!==expected||snapshot.snapshotId!==`snapshot:${expected}`||(storedHash!==undefined&&storedHash!==expected)){
    throw new Error("Stored world snapshot integrity mismatch");
  }
  return snapshot;
}
function acquisitionCore(record:AcquisitionRecord):Omit<AcquisitionRecord,"recordHash"> {
  const {recordHash:_,...core}=record;return core;
}
function verifyRecord(scope:TenantScope,record:AcquisitionRecord):AcquisitionRecord {
  const tenant=tenantId(scope);
  if(record.tenantId!==tenant)throw new Error("Acquisition record tenant mismatch");
  const expected=hashJson(acquisitionCore(record) as any);
  if(record.recordHash!==expected)throw new Error("Acquisition record integrity mismatch");
  return record;
}

export class WorldStateStore implements WorldStateRepository,EvidenceRepository {
  private readonly db:DatabaseSync;
  constructor(databasePath:string){
    this.db=new DatabaseSync(databasePath);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    requireTenantSchema(this.db,"temporal_facts");
    requireTenantSchema(this.db,"world_snapshots");
    requireTenantSchema(this.db,"ingestion_nonces");
    requireTenantSchema(this.db,"evidence_artifacts");
    requireTenantSchema(this.db,"evidence_acquisitions");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS temporal_facts (
        tenant_id TEXT NOT NULL,id TEXT NOT NULL,entity TEXT NOT NULL,attribute TEXT NOT NULL,value_json TEXT NOT NULL,
        valid_from TEXT NOT NULL,valid_until TEXT,observed_at TEXT NOT NULL,source TEXT NOT NULL,confidence REAL,
        supersedes_json TEXT NOT NULL DEFAULT '[]',acquisition_json TEXT,authentication_json TEXT,PRIMARY KEY (tenant_id, id)
      );
      CREATE TABLE IF NOT EXISTS world_snapshots (
        tenant_id TEXT NOT NULL,snapshot_id TEXT NOT NULL,as_of TEXT NOT NULL,snapshot_hash TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,PRIMARY KEY (tenant_id, snapshot_id)
      );
      CREATE TABLE IF NOT EXISTS ingestion_nonces (
        tenant_id TEXT NOT NULL,key_id TEXT NOT NULL,nonce TEXT NOT NULL,issued_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, key_id, nonce)
      );
      CREATE TABLE IF NOT EXISTS evidence_artifacts (
        tenant_id TEXT NOT NULL,artifact_id TEXT NOT NULL,artifact_hash TEXT NOT NULL,body_hash TEXT NOT NULL,
        body TEXT NOT NULL,artifact_json TEXT NOT NULL,PRIMARY KEY (tenant_id,artifact_id)
      );
      CREATE TABLE IF NOT EXISTS evidence_acquisitions (
        tenant_id TEXT NOT NULL,acquisition_id TEXT NOT NULL,record_hash TEXT NOT NULL,record_json TEXT NOT NULL,
        PRIMARY KEY (tenant_id,acquisition_id)
      );
    `);
    const factColumns=columns(this.db,"temporal_facts");
    if(!factColumns.includes("acquisition_json"))this.db.exec("ALTER TABLE temporal_facts ADD COLUMN acquisition_json TEXT");
    if(!factColumns.includes("authentication_json"))this.db.exec("ALTER TABLE temporal_facts ADD COLUMN authentication_json TEXT");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_temporal_lookup ON temporal_facts(tenant_id, entity, attribute, valid_from, valid_until);");
  }

  close():void { this.db.close(); }

  private putFactSync(tenant:string,fact:TemporalFact):void {
    if(!fact.id||!fact.entity||!fact.attribute||!fact.source)throw new TypeError("fact id, entity, attribute, and source are required");
    const validFrom=iso(fact.validFrom,"validFrom"),observedAt=iso(fact.observedAt,"observedAt");
    const validUntil=fact.validUntil===undefined?null:iso(fact.validUntil,"validUntil");
    if(validUntil!==null&&validUntil<=validFrom)throw new RangeError("validUntil must be after validFrom");
    if(fact.confidence!==undefined&&(!Number.isFinite(fact.confidence)||fact.confidence<0||fact.confidence>1))throw new RangeError("confidence must be between 0 and 1");
    this.db.prepare(`
      INSERT INTO temporal_facts
        (tenant_id,id,entity,attribute,value_json,valid_from,valid_until,observed_at,source,confidence,supersedes_json,acquisition_json,authentication_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      tenant,fact.id,fact.entity,fact.attribute,JSON.stringify(fact.value),validFrom,validUntil,observedAt,fact.source,
      fact.confidence??null,JSON.stringify([...(fact.supersedes??[])].sort()),
      fact.acquisition?JSON.stringify(fact.acquisition):null,fact.authentication?JSON.stringify(fact.authentication):null
    );
  }

  async putFact(scope:TenantScope,fact:TemporalFact):Promise<void> {
    this.putFactSync(tenantId(scope),fact);
  }

  async putAuthenticatedFact(scope:TenantScope,fact:TemporalFact,claim:IngestionReplayClaim):Promise<boolean> {
    const tenant=tenantId(scope);
    if(!claim.keyId?.trim()||!claim.nonce?.trim())throw new TypeError("keyId and nonce are required");
    const issuedAt=iso(claim.issuedAt,"issuedAt");
    this.db.exec("BEGIN IMMEDIATE");
    try{
      const nonceResult=this.db.prepare(`
        INSERT OR IGNORE INTO ingestion_nonces(tenant_id,key_id,nonce,issued_at)
        VALUES (?,?,?,?)
      `).run(tenant,claim.keyId,claim.nonce,issuedAt);
      if(Number(nonceResult.changes)!==1){
        this.db.exec("ROLLBACK");
        return false;
      }
      this.putFactSync(tenant,fact);
      this.db.exec("COMMIT");
      return true;
    }catch(err){
      try{this.db.exec("ROLLBACK");}catch{}
      throw err;
    }
  }

  async commitAcquisition(scope:TenantScope,artifact:EvidenceArtifact,record:AcquisitionRecord,facts:VerifiedFactCommit[]):Promise<void> {
    const tenant=tenantId(scope),verifiedArtifact=verifyEvidenceArtifact(scope,artifact),verifiedRecord=verifyRecord(scope,record);
    if(!Array.isArray(facts)||facts.length===0)throw new TypeError("Acquisition must contain at least one authenticated fact");
    if(
      verifiedRecord.artifactId!==verifiedArtifact.artifactId||
      verifiedRecord.artifactHash!==verifiedArtifact.artifactHash||
      verifiedRecord.adapterId!==verifiedArtifact.adapterId||
      verifiedRecord.adapterVersion!==verifiedArtifact.adapterVersion||
      verifiedRecord.adapterImplementationHash!==verifiedArtifact.adapterImplementationHash||
      verifiedRecord.operationId!==verifiedArtifact.operationId||
      verifiedRecord.mappingId!==verifiedArtifact.mappingId||
      verifiedRecord.canonicalRequestHash!==verifiedArtifact.canonicalRequestHash||
      verifiedRecord.capturedAt!==verifiedArtifact.capturedAt
    )throw new Error("Acquisition record does not match evidence artifact");
    const factIds=facts.map(x=>x.fact.id);
    if(JSON.stringify(verifiedRecord.factIds)!==JSON.stringify(factIds))throw new Error("Acquisition record fact IDs do not match authenticated facts");
    for(let index=0;index<facts.length;index++){
      const item=facts[index];
      const auth=item.fact.authentication;
      if(!auth)throw new Error("Acquisition fact is missing authentication evidence");
      if(auth.keyId!==item.claim.keyId||auth.nonce!==item.claim.nonce||auth.issuedAt!==item.claim.issuedAt){
        throw new Error("Acquisition fact authentication does not match nonce claim");
      }
      assertAcquisitionFactProvenance(scope,verifiedArtifact,verifiedRecord,item.fact,index);
    }

    this.db.exec("BEGIN IMMEDIATE");
    try{
      this.db.prepare(`
        INSERT INTO evidence_artifacts(tenant_id,artifact_id,artifact_hash,body_hash,body,artifact_json)
        VALUES(?,?,?,?,?,?)
      `).run(tenant,verifiedArtifact.artifactId,verifiedArtifact.artifactHash,verifiedArtifact.bodyHash,verifiedArtifact.body,JSON.stringify(verifiedArtifact));
      this.db.prepare(`
        INSERT INTO evidence_acquisitions(tenant_id,acquisition_id,record_hash,record_json)
        VALUES(?,?,?,?)
      `).run(tenant,verifiedRecord.acquisitionId,verifiedRecord.recordHash,JSON.stringify(verifiedRecord));
      for(const item of facts){
        const issuedAt=iso(item.claim.issuedAt,"issuedAt");
        const nonceResult=this.db.prepare(`
          INSERT OR IGNORE INTO ingestion_nonces(tenant_id,key_id,nonce,issued_at) VALUES(?,?,?,?)
        `).run(tenant,required(item.claim.keyId,"keyId"),required(item.claim.nonce,"nonce"),issuedAt);
        if(Number(nonceResult.changes)!==1)throw new Error("Evidence ingestion nonce conflict");
        this.putFactSync(tenant,item.fact);
      }
      this.db.exec("COMMIT");
    }catch(err){
      try{this.db.exec("ROLLBACK");}catch{}
      throw err;
    }
  }

  async getEvidenceArtifact(scope:TenantScope,artifactId:string):Promise<EvidenceArtifact> {
    const tenant=tenantId(scope),id=required(artifactId,"artifactId");
    const row=this.db.prepare(`
      SELECT artifact_hash,body_hash,body,artifact_json FROM evidence_artifacts WHERE tenant_id=? AND artifact_id=?
    `).get(tenant,id) as any;
    if(!row)throw new Error(`Evidence artifact not found for tenant ${tenant}: ${id}`);
    const artifact=JSON.parse(String(row.artifact_json)) as EvidenceArtifact;
    artifact.artifactHash=String(row.artifact_hash);artifact.bodyHash=String(row.body_hash);artifact.body=String(row.body);
    return verifyEvidenceArtifact(scope,artifact);
  }

  async getAcquisition(scope:TenantScope,acquisitionId:string):Promise<AcquisitionRecord> {
    const tenant=tenantId(scope),id=required(acquisitionId,"acquisitionId");
    const row=this.db.prepare(`
      SELECT record_hash,record_json FROM evidence_acquisitions WHERE tenant_id=? AND acquisition_id=?
    `).get(tenant,id) as any;
    if(!row)throw new Error(`Evidence acquisition not found for tenant ${tenant}: ${id}`);
    const record=JSON.parse(String(row.record_json)) as AcquisitionRecord;
    record.recordHash=String(row.record_hash);
    return structuredClone(verifyRecord(scope,record));
  }

  async snapshot(scope:TenantScope,asOf:string):Promise<WorldSnapshot> {
    const tenant=tenantId(scope),normalizedAsOf=iso(asOf,"asOf");
    const rows=this.db.prepare(`
      SELECT id,entity,attribute,value_json,valid_from,valid_until,observed_at,source,confidence,supersedes_json,acquisition_json,authentication_json
      FROM temporal_facts
      WHERE tenant_id = ? AND valid_from <= ? AND (valid_until IS NULL OR valid_until > ?)
      ORDER BY entity ASC, attribute ASC, valid_from ASC, observed_at ASC, id ASC
    `).all(tenant,normalizedAsOf,normalizedAsOf);
    const facts=rows.map(fromRow),snapshotHash=hashJson({tenantId:tenant,asOf:normalizedAsOf,facts} as any);
    const snapshot:WorldSnapshot={tenantId:tenant,snapshotId:`snapshot:${snapshotHash}`,asOf:normalizedAsOf,facts,snapshotHash};
    this.db.prepare("INSERT OR IGNORE INTO world_snapshots(tenant_id,snapshot_id,as_of,snapshot_hash,snapshot_json) VALUES (?,?,?,?,?)")
      .run(tenant,snapshot.snapshotId,snapshot.asOf,snapshot.snapshotHash,JSON.stringify(snapshot));
    return snapshot;
  }

  async getSnapshot(scope:TenantScope,snapshotId:string):Promise<WorldSnapshot> {
    const tenant=tenantId(scope);
    const row=this.db.prepare("SELECT snapshot_hash,snapshot_json FROM world_snapshots WHERE tenant_id = ? AND snapshot_id = ?").get(tenant,snapshotId) as any;
    if(!row)throw new Error(`World snapshot not found for tenant ${tenant}: ${snapshotId}`);
    return verifySnapshot(scope,JSON.parse(String(row.snapshot_json)) as WorldSnapshot,String(row.snapshot_hash));
  }
}
