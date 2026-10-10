import type { Pool } from "pg";
import type { ModelExplanationRepository } from "./repositories.ts";
import type { ModelExplanationRecord, TenantScope } from "./types.ts";
import { verifyModelExplanationRecord } from "./model_explanation_store.ts";

function required(value:unknown,label:string):string{
  if(typeof value!=="string"||!value.trim())throw new TypeError(`${label} is required`);
  return value;
}
function tenantId(scope:TenantScope):string{return required(scope?.tenantId,"tenantId");}
function jsonValue<T>(value:unknown):T{return (typeof value==="string"?JSON.parse(value):value) as T;}
function verifyRow(scope:TenantScope,row:any):ModelExplanationRecord{
  const record=jsonValue<ModelExplanationRecord>(row.record_json);
  if(
    record.recordHash!==String(row.record_hash)||
    record.requestBodyHash!==String(row.request_body_hash)||
    record.responseBodyHash!==String(row.response_body_hash)||
    record.normalizedResponseBodyHash!==String(row.normalized_response_body_hash)||
    record.requestBody!==String(row.request_body)||
    record.responseBody!==String(row.response_body)||
    record.normalizedResponseBody!==String(row.normalized_response_body)
  )throw new Error("Stored model explanation integrity mismatch");
  return verifyModelExplanationRecord(scope,record);
}

export class PostgresModelExplanationRepository implements ModelExplanationRepository{
  private readonly pool:Pool;
  constructor(pool:Pool){this.pool=pool;}

  async put(scope:TenantScope,record:ModelExplanationRecord):Promise<void>{
    const tenant=tenantId(scope),verified=verifyModelExplanationRecord(scope,record);
    await this.pool.query(
      `INSERT INTO axiom_model_explanations(
         tenant_id,explanation_id,record_hash,request_body_hash,response_body_hash,normalized_response_body_hash,
         request_body,response_body,normalized_response_body,record_json
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
      [tenant,verified.explanationId,verified.recordHash,verified.requestBodyHash,verified.responseBodyHash,
       verified.normalizedResponseBodyHash,verified.requestBody,verified.responseBody,verified.normalizedResponseBody,
       JSON.stringify(verified)]
    );
  }

  async get(scope:TenantScope,explanationId:string):Promise<ModelExplanationRecord>{
    const tenant=tenantId(scope),id=required(explanationId,"explanationId");
    const result=await this.pool.query(
      `SELECT record_hash,request_body_hash,response_body_hash,normalized_response_body_hash,
              request_body,response_body,normalized_response_body,record_json
       FROM axiom_model_explanations WHERE tenant_id=$1 AND explanation_id=$2`,[tenant,id]
    );
    if(result.rowCount!==1)throw new Error(`Model explanation not found for tenant ${tenant}: ${id}`);
    return structuredClone(verifyRow(scope,result.rows[0]));
  }
}
