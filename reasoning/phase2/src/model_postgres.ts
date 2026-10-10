import type { Pool } from "pg";
import type { ModelCompilationRepository } from "./repositories.ts";
import type { ModelCompilationRecord, ModelExchangeArtifact, TenantScope } from "./types.ts";
import { validateModelCompilationCommit, verifyModelCompilationRecord } from "./model_store.ts";
import { verifyModelExchangeArtifact } from "./model_adapter.ts";

function required(value:unknown,label:string):string {
  if(typeof value!=="string"||!value.trim())throw new TypeError(`${label} is required`);
  return value;
}
function tenantId(scope:TenantScope):string {return required(scope?.tenantId,"tenantId");}
function jsonValue<T>(value:unknown):T {return (typeof value==="string"?JSON.parse(value):value) as T;}

export class PostgresModelCompilationRepository implements ModelCompilationRepository {
  private readonly pool:Pool;
  constructor(pool:Pool){this.pool=pool;}

  async commitCompilation(scope:TenantScope,artifacts:ModelExchangeArtifact[],record:ModelCompilationRecord):Promise<void> {
    const tenant=tenantId(scope),verified=validateModelCompilationCommit(scope,artifacts,record),client=await this.pool.connect();
    try{
      await client.query("BEGIN");
      for(const artifact of verified.artifacts){
        await client.query(
          `INSERT INTO axiom_model_exchange_artifacts(
             tenant_id,artifact_id,artifact_hash,request_body_hash,response_body_hash,request_body,response_body,artifact_json
           ) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
          [tenant,artifact.artifactId,artifact.artifactHash,artifact.requestBodyHash,artifact.responseBodyHash,artifact.requestBody,artifact.responseBody,JSON.stringify(artifact)]
        );
      }
      await client.query(
        `INSERT INTO axiom_model_compilations(tenant_id,compilation_id,record_hash,compiled_program_hash,record_json)
         VALUES($1,$2,$3,$4,$5::jsonb)`,
        [tenant,verified.record.compilationId,verified.record.recordHash,verified.record.compiledProgramHash??null,JSON.stringify(verified.record)]
      );
      await client.query("COMMIT");
    }catch(error){try{await client.query("ROLLBACK");}catch{}throw error;}
    finally{client.release();}
  }

  async getCompilation(scope:TenantScope,compilationId:string):Promise<ModelCompilationRecord> {
    const tenant=tenantId(scope),id=required(compilationId,"compilationId");
    const result=await this.pool.query(
      `SELECT record_hash,compiled_program_hash,record_json FROM axiom_model_compilations
       WHERE tenant_id=$1 AND compilation_id=$2`,[tenant,id]
    );
    if(result.rowCount!==1)throw new Error(`Model compilation not found for tenant ${tenant}: ${id}`);
    const row=result.rows[0],record=jsonValue<ModelCompilationRecord>(row.record_json);
    if(record.recordHash!==String(row.record_hash))throw new Error("Stored model compilation record integrity mismatch");
    const storedProgramHash=row.compiled_program_hash===null?undefined:String(row.compiled_program_hash);
    if(record.compiledProgramHash!==storedProgramHash)throw new Error("Stored model compilation program hash integrity mismatch");
    return structuredClone(verifyModelCompilationRecord(scope,record));
  }

  async getModelArtifact(scope:TenantScope,artifactId:string):Promise<ModelExchangeArtifact> {
    const tenant=tenantId(scope),id=required(artifactId,"artifactId");
    const result=await this.pool.query(
      `SELECT artifact_hash,request_body_hash,response_body_hash,request_body,response_body,artifact_json
       FROM axiom_model_exchange_artifacts WHERE tenant_id=$1 AND artifact_id=$2`,[tenant,id]
    );
    if(result.rowCount!==1)throw new Error(`Model exchange artifact not found for tenant ${tenant}: ${id}`);
    const row=result.rows[0],artifact=jsonValue<ModelExchangeArtifact>(row.artifact_json);
    if(
      artifact.artifactHash!==String(row.artifact_hash)||
      artifact.requestBodyHash!==String(row.request_body_hash)||
      artifact.responseBodyHash!==String(row.response_body_hash)||
      artifact.requestBody!==String(row.request_body)||
      artifact.responseBody!==String(row.response_body)
    )throw new Error("Stored model exchange artifact integrity mismatch");
    return structuredClone(verifyModelExchangeArtifact(scope,artifact));
  }
}
