import { DatabaseSync } from "node:sqlite";
import { canonicalize, hashJson, sha256Hex } from "../../phase1/src/canonical.ts";
import type { ModelExplanationRepository } from "./repositories.ts";
import type { ModelExplanationContent, ModelExplanationRecord, TenantScope } from "./types.ts";

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
function tenantId(scope:TenantScope):string{return required(scope?.tenantId,"tenantId");}
function sha(text:string):string{return sha256Hex(Buffer.from(text,"utf8"));}
function canonicalIso(value:unknown,label:string):string{
  const text=required(value,label),ms=Date.parse(text);
  if(!Number.isFinite(ms)||new Date(ms).toISOString()!==text)throw new TypeError(`${label} must use canonical ISO-8601 UTC format`);
  return text;
}
function content(value:unknown):ModelExplanationContent{
  if(!value||typeof value!=="object"||Array.isArray(value))throw new TypeError("Model explanation content must be an object");
  const x=value as any;
  if(Object.keys(x).sort().join(",")!=="keyFactors,limitations,summary")throw new Error("Model explanation content shape is invalid");
  if(typeof x.summary!=="string"||!x.summary.trim())throw new TypeError("Model explanation summary is required");
  for(const key of ["keyFactors","limitations"] as const){
    if(!Array.isArray(x[key])||x[key].some((v:unknown)=>typeof v!=="string"||!v.trim()))throw new TypeError(`Model explanation ${key} is invalid`);
  }
  return {summary:x.summary,keyFactors:[...x.keyFactors],limitations:[...x.limitations]};
}

export function verifyModelExplanationRecord(scope:TenantScope,record:ModelExplanationRecord):ModelExplanationRecord{
  const tenant=tenantId(scope);
  required(record?.explanationId,"explanationId");
  if(record.tenantId!==tenant)throw new Error("Model explanation tenant mismatch");
  required(record.executionId,"executionId");digest(record.executionRecordHash,"executionRecordHash");
  required(record.principalId,"principalId");digest(record.authorizationDecisionHash,"authorizationDecisionHash");
  digest(record.explanationRequestHash,"explanationRequestHash");
  required(record.profileId,"profileId");required(record.profileVersion,"profileVersion");digest(record.profileHash,"profileHash");
  required(record.adapterManifest?.adapterId,"adapterId");required(record.adapterManifest?.version,"adapterVersion");
  digest(record.adapterManifest?.implementationHash,"adapterImplementationHash");
  required(record.adapterManifest?.provider,"provider");required(record.adapterManifest?.modelId,"modelId");
  canonicalIso(record.capturedAt,"capturedAt");
  required(record.requestBody,"requestBody");digest(record.requestBodyHash,"requestBodyHash");
  required(record.responseBody,"responseBody");digest(record.responseBodyHash,"responseBodyHash");
  required(record.normalizedResponseBody,"normalizedResponseBody");digest(record.normalizedResponseBodyHash,"normalizedResponseBodyHash");
  if(sha(record.requestBody)!==record.requestBodyHash)throw new Error("Model explanation request body integrity mismatch");
  if(sha(record.responseBody)!==record.responseBodyHash)throw new Error("Model explanation response body integrity mismatch");
  if(sha(record.normalizedResponseBody)!==record.normalizedResponseBodyHash)throw new Error("Model explanation normalized response body integrity mismatch");
  if(record.authority!=="ADVISORY_ONLY")throw new Error("Model explanation authority must be ADVISORY_ONLY");
  const verifiedContent=content(record.content);
  let normalized:any;
  try{normalized=JSON.parse(record.normalizedResponseBody);}catch{throw new Error("Model explanation normalized response JSON integrity mismatch");}
  if(canonicalize(normalized)!==canonicalize(verifiedContent as any))throw new Error("Model explanation normalized response/content integrity mismatch");

  const {recordHash,explanationId,...base}=record;
  const expectedId=`model-explanation:${hashJson(base as any)}`;
  if(explanationId!==expectedId)throw new Error("Model explanation identity integrity mismatch");
  const expectedRecordHash=hashJson({explanationId,...base} as any);
  if(recordHash!==expectedRecordHash)throw new Error("Model explanation record integrity mismatch");
  return structuredClone(record);
}
function parseRow(scope:TenantScope,row:any):ModelExplanationRecord{
  const record=JSON.parse(String(row.record_json)) as ModelExplanationRecord;
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

export class ModelExplanationStore implements ModelExplanationRepository{
  private readonly db:DatabaseSync;
  constructor(databasePath:string){
    this.db=new DatabaseSync(databasePath);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS axiom_model_explanations(
        tenant_id TEXT NOT NULL,
        explanation_id TEXT NOT NULL,
        record_hash TEXT NOT NULL,
        request_body_hash TEXT NOT NULL,
        response_body_hash TEXT NOT NULL,
        normalized_response_body_hash TEXT NOT NULL,
        request_body TEXT NOT NULL,
        response_body TEXT NOT NULL,
        normalized_response_body TEXT NOT NULL,
        record_json TEXT NOT NULL,
        PRIMARY KEY(tenant_id,explanation_id)
      );
    `);
  }
  close():void{this.db.close();}

  async put(scope:TenantScope,record:ModelExplanationRecord):Promise<void>{
    const tenant=tenantId(scope),verified=verifyModelExplanationRecord(scope,record);
    this.db.prepare(`
      INSERT INTO axiom_model_explanations(
        tenant_id,explanation_id,record_hash,request_body_hash,response_body_hash,normalized_response_body_hash,
        request_body,response_body,normalized_response_body,record_json
      ) VALUES(?,?,?,?,?,?,?,?,?,?)
    `).run(
      tenant,verified.explanationId,verified.recordHash,verified.requestBodyHash,verified.responseBodyHash,
      verified.normalizedResponseBodyHash,verified.requestBody,verified.responseBody,verified.normalizedResponseBody,
      JSON.stringify(verified)
    );
  }

  async get(scope:TenantScope,explanationId:string):Promise<ModelExplanationRecord>{
    const tenant=tenantId(scope),id=required(explanationId,"explanationId");
    const row=this.db.prepare(`
      SELECT record_hash,request_body_hash,response_body_hash,normalized_response_body_hash,
             request_body,response_body,normalized_response_body,record_json
      FROM axiom_model_explanations WHERE tenant_id=? AND explanation_id=?
    `).get(tenant,id) as any;
    if(!row)throw new Error(`Model explanation not found for tenant ${tenant}: ${id}`);
    return structuredClone(parseRow(scope,row));
  }
}
