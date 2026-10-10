import { readFileSync } from "node:fs";
import type { Pool } from "pg";
import { hashJson } from "../../phase1/src/canonical.ts";
import { assertAcquisitionFactProvenance, verifyEvidenceArtifact } from "./evidence.ts";
import type { EvidenceRepository, ExecutionRepository, IngestionReplayClaim, VerifiedFactCommit, WorldStateRepository } from "./repositories.ts";
import type {
  AcquisitionRecord, EvidenceArtifact, FactAcquisition, FactAuthentication, PlatformExecutionRecord,
  TemporalFact, TenantScope, WorldSnapshot
} from "./types.ts";

function tenantId(scope:TenantScope):string {if(!scope?.tenantId?.trim())throw new TypeError("tenantId is required");return scope.tenantId;}
function iso(value:string,label:string):string {const ms=Date.parse(value);if(!Number.isFinite(ms))throw new TypeError(`${label} must be an ISO-8601 timestamp`);return new Date(ms).toISOString();}
function jsonValue<T>(value:unknown):T {return (typeof value==="string"?JSON.parse(value):value) as T;}
function fromRow(row:any):TemporalFact {
  const fact:TemporalFact={id:String(row.id),entity:String(row.entity),attribute:String(row.attribute),value:jsonValue(row.value_json),validFrom:String(row.valid_from),observedAt:String(row.observed_at),source:String(row.source)};
  if(row.valid_until!==null)fact.validUntil=String(row.valid_until);
  if(row.confidence!==null)fact.confidence=Number(row.confidence);
  const supersedes=jsonValue<string[]>(row.supersedes_json);if(supersedes.length)fact.supersedes=supersedes;
  if(row.acquisition_json!==null)fact.acquisition=jsonValue<FactAcquisition>(row.acquisition_json);
  if(row.authentication_json!==null)fact.authentication=jsonValue<FactAuthentication>(row.authentication_json);
  return fact;
}
function verifySnapshot(scope:TenantScope,snapshot:WorldSnapshot,storedHash?:string):WorldSnapshot {
  const tenant=tenantId(scope),expected=hashJson({tenantId:tenant,asOf:snapshot.asOf,facts:snapshot.facts} as any);
  if(snapshot.tenantId!==tenant||snapshot.snapshotHash!==expected||snapshot.snapshotId!==`snapshot:${expected}`||(storedHash!==undefined&&storedHash!==expected))throw new Error("Stored world snapshot integrity mismatch");
  return snapshot;
}
function recordCore(record:PlatformExecutionRecord):Omit<PlatformExecutionRecord,"recordHash">{const {recordHash:_,...core}=record;return core;}
function acquisitionCore(record:AcquisitionRecord):Omit<AcquisitionRecord,"recordHash">{const {recordHash:_,...core}=record;return core;}
function verifyAcquisition(scope:TenantScope,record:AcquisitionRecord):AcquisitionRecord {
  const tenant=tenantId(scope),expected=hashJson(acquisitionCore(record) as any);
  if(record.tenantId!==tenant||record.recordHash!==expected)throw new Error("Acquisition record integrity mismatch");
  return record;
}
function validatedFact(fact:TemporalFact){
  if(!fact.id||!fact.entity||!fact.attribute||!fact.source)throw new TypeError("fact id, entity, attribute, and source are required");
  const validFrom=iso(fact.validFrom,"validFrom"),observedAt=iso(fact.observedAt,"observedAt"),validUntil=fact.validUntil===undefined?null:iso(fact.validUntil,"validUntil");
  if(validUntil!==null&&validUntil<=validFrom)throw new RangeError("validUntil must be after validFrom");
  if(fact.confidence!==undefined&&(!Number.isFinite(fact.confidence)||fact.confidence<0||fact.confidence>1))throw new RangeError("confidence must be between 0 and 1");
  return {validFrom,observedAt,validUntil};
}

export async function initializePostgresSchema(pool:Pool):Promise<void> {
  await pool.query(readFileSync(new URL("../sql/postgres.sql",import.meta.url),"utf8"));
}

export class PostgresWorldStateRepository implements WorldStateRepository,EvidenceRepository {
  private readonly pool:Pool;
  constructor(pool:Pool){this.pool=pool;}
  async putFact(scope:TenantScope,fact:TemporalFact):Promise<void> {
    const tenant=tenantId(scope);
    const {validFrom,observedAt,validUntil}=validatedFact(fact);
    await this.pool.query(
      `INSERT INTO axiom_temporal_facts
       (tenant_id,id,entity,attribute,value_json,valid_from,valid_until,observed_at,source,confidence,supersedes_json,acquisition_json,authentication_json)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb)`,
      [tenant,fact.id,fact.entity,fact.attribute,JSON.stringify(fact.value),validFrom,validUntil,observedAt,fact.source,fact.confidence??null,JSON.stringify([...(fact.supersedes??[])].sort()),fact.acquisition?JSON.stringify(fact.acquisition):null,fact.authentication?JSON.stringify(fact.authentication):null]
    );
  }
  async putAuthenticatedFact(scope:TenantScope,fact:TemporalFact,claim:IngestionReplayClaim):Promise<boolean> {
    const tenant=tenantId(scope);
    if(!claim.keyId?.trim()||!claim.nonce?.trim())throw new TypeError("keyId and nonce are required");
    const issuedAt=iso(claim.issuedAt,"issuedAt");
    const {validFrom,observedAt,validUntil}=validatedFact(fact);
    const client=await this.pool.connect();
    try{
      await client.query("BEGIN");
      const nonceResult=await client.query(
        `INSERT INTO axiom_ingestion_nonces(tenant_id,key_id,nonce,issued_at)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (tenant_id,key_id,nonce) DO NOTHING
         RETURNING nonce`,
        [tenant,claim.keyId,claim.nonce,issuedAt]
      );
      if(nonceResult.rowCount!==1){
        await client.query("ROLLBACK");
        return false;
      }
      await client.query(
        `INSERT INTO axiom_temporal_facts
         (tenant_id,id,entity,attribute,value_json,valid_from,valid_until,observed_at,source,confidence,supersedes_json,acquisition_json,authentication_json)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb)`,
        [tenant,fact.id,fact.entity,fact.attribute,JSON.stringify(fact.value),validFrom,validUntil,observedAt,fact.source,fact.confidence??null,JSON.stringify([...(fact.supersedes??[])].sort()),fact.acquisition?JSON.stringify(fact.acquisition):null,fact.authentication?JSON.stringify(fact.authentication):null]
      );
      await client.query("COMMIT");
      return true;
    }catch(err){
      try{await client.query("ROLLBACK");}catch{}
      throw err;
    }finally{
      client.release();
    }
  }

  async commitAcquisition(scope:TenantScope,artifact:EvidenceArtifact,record:AcquisitionRecord,facts:VerifiedFactCommit[]):Promise<void> {
    const tenant=tenantId(scope),verifiedArtifact=verifyEvidenceArtifact(scope,artifact),verifiedRecord=verifyAcquisition(scope,record);
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
      if(auth.keyId!==item.claim.keyId||auth.nonce!==item.claim.nonce||auth.issuedAt!==item.claim.issuedAt)throw new Error("Acquisition fact authentication does not match nonce claim");
      assertAcquisitionFactProvenance(scope,verifiedArtifact,verifiedRecord,item.fact,index);
    }

    const client=await this.pool.connect();
    try{
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO axiom_evidence_artifacts(tenant_id,artifact_id,artifact_hash,body_hash,body,artifact_json)
         VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
        [tenant,verifiedArtifact.artifactId,verifiedArtifact.artifactHash,verifiedArtifact.bodyHash,verifiedArtifact.body,JSON.stringify(verifiedArtifact)]
      );
      await client.query(
        `INSERT INTO axiom_evidence_acquisitions(tenant_id,acquisition_id,record_hash,record_json)
         VALUES($1,$2,$3,$4::jsonb)`,
        [tenant,verifiedRecord.acquisitionId,verifiedRecord.recordHash,JSON.stringify(verifiedRecord)]
      );
      for(const item of facts){
        const {validFrom,observedAt,validUntil}=validatedFact(item.fact);
        const issuedAt=iso(item.claim.issuedAt,"issuedAt");
        const nonce=await client.query(
          `INSERT INTO axiom_ingestion_nonces(tenant_id,key_id,nonce,issued_at)
           VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING nonce`,
          [tenant,item.claim.keyId,item.claim.nonce,issuedAt]
        );
        if(nonce.rowCount!==1)throw new Error("Evidence ingestion nonce conflict");
        await client.query(
          `INSERT INTO axiom_temporal_facts
           (tenant_id,id,entity,attribute,value_json,valid_from,valid_until,observed_at,source,confidence,supersedes_json,acquisition_json,authentication_json)
           VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb)`,
          [tenant,item.fact.id,item.fact.entity,item.fact.attribute,JSON.stringify(item.fact.value),validFrom,validUntil,observedAt,item.fact.source,item.fact.confidence??null,JSON.stringify([...(item.fact.supersedes??[])].sort()),item.fact.acquisition?JSON.stringify(item.fact.acquisition):null,item.fact.authentication?JSON.stringify(item.fact.authentication):null]
        );
      }
      await client.query("COMMIT");
    }catch(err){
      try{await client.query("ROLLBACK");}catch{}
      throw err;
    }finally{client.release();}
  }

  async getEvidenceArtifact(scope:TenantScope,artifactId:string):Promise<EvidenceArtifact> {
    const tenant=tenantId(scope);
    if(!artifactId?.trim())throw new TypeError("artifactId is required");
    const result=await this.pool.query(
      `SELECT artifact_hash,body_hash,body,artifact_json FROM axiom_evidence_artifacts WHERE tenant_id=$1 AND artifact_id=$2`,
      [tenant,artifactId]
    );
    if(result.rowCount!==1)throw new Error(`Evidence artifact not found for tenant ${tenant}: ${artifactId}`);
    const row=result.rows[0],artifact=jsonValue<EvidenceArtifact>(row.artifact_json);
    artifact.artifactHash=String(row.artifact_hash);artifact.bodyHash=String(row.body_hash);artifact.body=String(row.body);
    return verifyEvidenceArtifact(scope,artifact);
  }

  async getAcquisition(scope:TenantScope,acquisitionId:string):Promise<AcquisitionRecord> {
    const tenant=tenantId(scope);
    if(!acquisitionId?.trim())throw new TypeError("acquisitionId is required");
    const result=await this.pool.query(
      `SELECT record_hash,record_json FROM axiom_evidence_acquisitions WHERE tenant_id=$1 AND acquisition_id=$2`,
      [tenant,acquisitionId]
    );
    if(result.rowCount!==1)throw new Error(`Evidence acquisition not found for tenant ${tenant}: ${acquisitionId}`);
    const row=result.rows[0],record=jsonValue<AcquisitionRecord>(row.record_json);
    record.recordHash=String(row.record_hash);
    return structuredClone(verifyAcquisition(scope,record));
  }

  async snapshot(scope:TenantScope,asOf:string):Promise<WorldSnapshot> {
    const tenant=tenantId(scope),normalizedAsOf=iso(asOf,"asOf");
    const result=await this.pool.query(
      `SELECT id,entity,attribute,value_json,valid_from,valid_until,observed_at,source,confidence,supersedes_json,acquisition_json,authentication_json
       FROM axiom_temporal_facts
       WHERE tenant_id=$1 AND valid_from <= $2 AND (valid_until IS NULL OR valid_until > $2)
       ORDER BY entity ASC,attribute ASC,valid_from ASC,observed_at ASC,id ASC`,
      [tenant,normalizedAsOf]
    );
    const facts=result.rows.map(fromRow),snapshotHash=hashJson({tenantId:tenant,asOf:normalizedAsOf,facts} as any);
    const snapshot:WorldSnapshot={tenantId:tenant,snapshotId:`snapshot:${snapshotHash}`,asOf:normalizedAsOf,facts,snapshotHash};
    await this.pool.query(
      `INSERT INTO axiom_world_snapshots(tenant_id,snapshot_id,as_of,snapshot_hash,snapshot_json)
       VALUES ($1,$2,$3,$4,$5::jsonb) ON CONFLICT (tenant_id,snapshot_id) DO NOTHING`,
      [tenant,snapshot.snapshotId,snapshot.asOf,snapshot.snapshotHash,JSON.stringify(snapshot)]
    );
    return snapshot;
  }
  async getSnapshot(scope:TenantScope,snapshotId:string):Promise<WorldSnapshot> {
    const tenant=tenantId(scope),result=await this.pool.query("SELECT snapshot_hash,snapshot_json FROM axiom_world_snapshots WHERE tenant_id=$1 AND snapshot_id=$2",[tenant,snapshotId]);
    if(result.rowCount!==1)throw new Error(`World snapshot not found for tenant ${tenant}: ${snapshotId}`);
    return verifySnapshot(scope,jsonValue<WorldSnapshot>(result.rows[0].snapshot_json),String(result.rows[0].snapshot_hash));
  }
}

export class PostgresExecutionRepository implements ExecutionRepository {
  private readonly pool:Pool;
  constructor(pool:Pool){this.pool=pool;}

  private verified(scope:TenantScope,row:any):PlatformExecutionRecord {
    const tenant=tenantId(scope),record=jsonValue<PlatformExecutionRecord>(row.record_json),expected=hashJson(recordCore(record) as any);
    if(record.tenantId!==tenant||expected!==String(row.record_hash)||record.recordHash!==expected)throw new Error("Stored execution record integrity mismatch");
    return record;
  }

  async put(scope:TenantScope,record:PlatformExecutionRecord):Promise<void> {
    const tenant=tenantId(scope);if(!record.id)throw new TypeError("execution record id is required");if(record.tenantId!==tenant)throw new Error("Execution record tenant mismatch");
    const expected=hashJson(recordCore(record) as any);if(record.recordHash!==expected)throw new Error("Execution record hash mismatch");
    await this.pool.query("INSERT INTO axiom_platform_executions(tenant_id,id,record_hash,record_json) VALUES ($1,$2,$3,$4::jsonb)",[tenant,record.id,record.recordHash,JSON.stringify(record)]);
  }

  async get(scope:TenantScope,id:string):Promise<PlatformExecutionRecord> {
    const tenant=tenantId(scope),result=await this.pool.query("SELECT record_hash,record_json FROM axiom_platform_executions WHERE tenant_id=$1 AND id=$2",[tenant,id]);
    if(result.rowCount!==1)throw new Error(`Execution record not found for tenant ${tenant}: ${id}`);
    return this.verified(scope,result.rows[0]);
  }

  async getByIntent(scope:TenantScope,executionIntentId:string):Promise<PlatformExecutionRecord|undefined> {
    const tenant=tenantId(scope);
    if(!executionIntentId?.trim())throw new TypeError("executionIntentId is required");
    const result=await this.pool.query(
      `SELECT i.record_hash AS intent_record_hash,e.record_hash,e.record_json
       FROM axiom_execution_intents i
       JOIN axiom_platform_executions e ON e.tenant_id=i.tenant_id AND e.id=i.execution_id
       WHERE i.tenant_id=$1 AND i.intent_id=$2`,
      [tenant,executionIntentId]
    );
    if(result.rowCount===0)return undefined;
    if(result.rowCount!==1)throw new Error("Execution intent mapping is ambiguous");
    const row=result.rows[0],record=this.verified(scope,row);
    if(record.executionIntentId!==executionIntentId||String(row.intent_record_hash)!==record.recordHash)throw new Error("Stored execution intent mapping integrity mismatch");
    return record;
  }

  async putForIntent(scope:TenantScope,executionIntentId:string,record:PlatformExecutionRecord):Promise<PlatformExecutionRecord> {
    const tenant=tenantId(scope);
    if(!executionIntentId?.trim())throw new TypeError("executionIntentId is required");
    if(record.tenantId!==tenant||record.executionIntentId!==executionIntentId)throw new Error("Execution record intent mismatch");
    if(!record.executionRequestHash?.trim())throw new Error("Execution record request hash is required for an execution intent");
    const expected=hashJson(recordCore(record) as any);if(record.recordHash!==expected)throw new Error("Execution record hash mismatch");
    const client=await this.pool.connect();
    try{
      await client.query("BEGIN");
      const mapping=await client.query(
        "SELECT execution_id,record_hash FROM axiom_execution_intents WHERE tenant_id=$1 AND intent_id=$2 FOR UPDATE",
        [tenant,executionIntentId]
      );
      if(mapping.rowCount===1){
        const existingRow=await client.query("SELECT record_hash,record_json FROM axiom_platform_executions WHERE tenant_id=$1 AND id=$2",[tenant,mapping.rows[0].execution_id]);
        if(existingRow.rowCount!==1)throw new Error("Execution intent mapping references a missing execution");
        const existing=this.verified(scope,existingRow.rows[0]);
        if(existing.executionIntentId!==executionIntentId||String(mapping.rows[0].record_hash)!==existing.recordHash)throw new Error("Stored execution intent mapping integrity mismatch");
        if(existing.recordHash!==record.recordHash)throw new Error("Execution intent is already bound to a different execution record");
        await client.query("COMMIT");
        return existing;
      }

      await client.query(
        `INSERT INTO axiom_platform_executions(tenant_id,id,record_hash,record_json)
         VALUES ($1,$2,$3,$4::jsonb)
         ON CONFLICT (tenant_id,id) DO NOTHING`,
        [tenant,record.id,record.recordHash,JSON.stringify(record)]
      );
      const inserted=await client.query("SELECT record_hash,record_json FROM axiom_platform_executions WHERE tenant_id=$1 AND id=$2",[tenant,record.id]);
      if(inserted.rowCount!==1)throw new Error("Execution persistence failed");
      const stored=this.verified(scope,inserted.rows[0]);
      if(stored.recordHash!==record.recordHash)throw new Error("Execution record ID is already bound to different content");
      await client.query(
        "INSERT INTO axiom_execution_intents(tenant_id,intent_id,execution_id,record_hash) VALUES ($1,$2,$3,$4)",
        [tenant,executionIntentId,record.id,record.recordHash]
      );
      await client.query("COMMIT");
      return record;
    }catch(error){
      try{await client.query("ROLLBACK");}catch{}
      throw error;
    }finally{client.release();}
  }
}
