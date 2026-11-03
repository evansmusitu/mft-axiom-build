import type {Pool,PoolClient} from "pg";
import {hashJson} from "../../phase1/src/canonical.ts";
import type {JsonValue} from "../../phase1/src/types.ts";
import type {AdapterManifest,AdapterOperationManifest,CapturedEvidence} from "./types.ts";
import type {AdapterAcquisitionInput,EvidenceAdapter} from "./evidence.ts";

const IDENTIFIER=/^[a-z_][a-z0-9_]{0,62}$/;
const MAX_BYTES=1_048_576;
const MAX_ROWS=1000;
function required(value:unknown,label:string):string{
 if(typeof value!=="string"||!value||value.trim()!==value)
  throw new TypeError("Invalid PostgreSQL evidence "+label);
 return value;
}
function identifier(name:unknown,label:string):string{
 if(typeof name!=="string"||!IDENTIFIER.test(name))
  throw new TypeError("Invalid PostgreSQL evidence identifier "+label);
 return name;
}
function quote(name:string):string{return '"'+identifier(name,"identifier")+'"';}
function manifest(input:AdapterOperationManifest):AdapterOperationManifest{
 required(input?.operationId,"operationId");
 if(typeof input.parameterSchemaHash!=="string"||!/^[0-9a-f]{64}$/.test(input.parameterSchemaHash))
  throw new TypeError("Invalid PostgreSQL evidence parameter schema hash");
 if(!Array.isArray(input.mappingIds)||!input.mappingIds.length)
  throw new TypeError("PostgreSQL evidence requires registered mappings");
 if(!Array.isArray(input.responseMediaTypes)||!input.responseMediaTypes.includes("application/json"))
  throw new TypeError("PostgreSQL evidence operation requires JSON");
 if(!Number.isSafeInteger(input.maxResponseBytes)||input.maxResponseBytes<1||input.maxResponseBytes>MAX_BYTES)
  throw new RangeError("Invalid PostgreSQL evidence maxResponseBytes");
 if(!Number.isSafeInteger(input.timeoutMs)||input.timeoutMs<1||input.timeoutMs>120000)
  throw new RangeError("Invalid PostgreSQL evidence timeoutMs");
 return structuredClone(input);
}
export interface PostgresViewOperation {
 manifest:AdapterOperationManifest;
 schemaName:string;viewName:string;tenantColumn:string;
 columns:string[];orderColumn:string;maxRows:number;
}
interface BoundView {
 manifest:AdapterOperationManifest;schemaName:string;viewName:string;tenantColumn:string;
 columns:string[];orderColumn:string;maxRows:number;sql:string;
}
function configure(raw:PostgresViewOperation):BoundView{
 const op=manifest(raw.manifest),schemaName=identifier(raw.schemaName,"schema"),
  viewName=identifier(raw.viewName,"view"),tenantColumn=identifier(raw.tenantColumn,"tenant column"),
  orderColumn=identifier(raw.orderColumn,"order column");
 if(!Array.isArray(raw.columns)||raw.columns.length<1||raw.columns.length>32)
  throw new TypeError("PostgreSQL evidence columns must be a bounded nonempty list");
 const columns=raw.columns.map((x,i)=>identifier(x,"column "+i));
 if(new Set(columns).size!==columns.length)
  throw new TypeError("Duplicate PostgreSQL evidence column");
 if(!columns.includes(orderColumn))throw new TypeError("PostgreSQL evidence order column must be selected");
 if(!Number.isSafeInteger(raw.maxRows)||raw.maxRows<1||raw.maxRows>MAX_ROWS)
  throw new RangeError("Invalid PostgreSQL evidence maxRows");
 const selected=columns.map(quote).join(",");
 // These are only quoted, operator-configured identifiers. No user SQL is interpolated.
 const sql=`WITH bounded AS MATERIALIZED (
 SELECT ${selected} FROM ${quote(schemaName)}.${quote(viewName)}
 WHERE ${quote(tenantColumn)}=$1
 ORDER BY ${quote(orderColumn)} ASC LIMIT $2
), payload AS (
 SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.${quote(orderColumn)}),'[]'::jsonb) AS body_json,
  COUNT(*) AS row_count
 FROM bounded r
)
SELECT CASE WHEN row_count<=$3 AND octet_length(body_json::text)<=$4
 THEN body_json::text ELSE NULL END AS body,
 row_count::text AS row_count
FROM payload`;
 return {manifest:op,schemaName,viewName,tenantColumn,orderColumn,columns,maxRows:raw.maxRows,sql};
}
function parseRows(value:unknown,count:unknown,op:BoundView):string{
 if(typeof count!=="string"||!/^(0|[1-9][0-9]*)$/.test(count))
  throw new Error("PostgreSQL evidence invalid row count");
 const rowCount=Number(count);
 if(!Number.isSafeInteger(rowCount)||rowCount>op.maxRows)
  throw new RangeError("PostgreSQL evidence row limit exceeded");
 if(typeof value!=="string")throw new RangeError("PostgreSQL evidence byte limit exceeded");
 if(Buffer.byteLength(value,"utf8")>op.manifest.maxResponseBytes)
  throw new RangeError("PostgreSQL evidence byte limit exceeded");
 let rows:unknown;
 try{rows=JSON.parse(value);}catch{throw new TypeError("PostgreSQL evidence invalid JSON response");}
 if(!Array.isArray(rows))throw new TypeError("PostgreSQL evidence JSON must be a row array");
 if(rows.length!==rowCount||rowCount===0)
  throw new TypeError("PostgreSQL evidence empty or mismatched rows");
 for(const entry of rows){
  if(!entry||typeof entry!=="object"||Array.isArray(entry))
   throw new TypeError("PostgreSQL evidence invalid row object");
  const keys=Object.keys(entry);
  if(keys.some(k=>!op.columns.includes(k)))
   throw new TypeError("PostgreSQL evidence unexpected column");
  for(const val of Object.values(entry)){
   if(typeof val==="number"&&!Number.isFinite(val))
    throw new TypeError("PostgreSQL evidence invalid numeric data");
  }
 }
 return value;
}
export class PostgresViewEvidenceAdapter implements EvidenceAdapter{
 readonly manifest:AdapterManifest;
 private readonly pool:Pick<Pool,"connect">;
 private readonly operations=new Map<string,BoundView>();
 constructor(config:{
  adapterId:string;version:string;implementationHash:string;
  pool:Pick<Pool,"connect">;operations:PostgresViewOperation[];
 }){
  const adapterId=required(config?.adapterId,"adapterId"),
   version=required(config?.version,"version");
  if(typeof config.implementationHash!=="string"||!/^[0-9a-f]{64}$/.test(config.implementationHash))
   throw new TypeError("Invalid PostgreSQL evidence implementation hash");
  if(!config.pool||typeof config.pool.connect!=="function")
   throw new TypeError("PostgreSQL evidence requires an operator-owned pool");
  if(!Array.isArray(config.operations)||config.operations.length<1)
   throw new TypeError("PostgreSQL evidence requires operations");
  this.pool=config.pool;
  for(const raw of config.operations){
   const op=configure(raw);
   if(this.operations.has(op.manifest.operationId))
    throw new TypeError("Duplicate PostgreSQL evidence operation");
   this.operations.set(op.manifest.operationId,op);
  }
  this.manifest={adapterId,version,implementationHash:config.implementationHash,capability:"READ",
   operations:[...this.operations.values()].map(op=>structuredClone(op.manifest))};
 }
 validateParameters(input:AdapterAcquisitionInput):void{
  const op=this.operations.get(input?.operation?.operationId);
  if(!op||hashJson(input.operation as any)!==hashJson(op.manifest as any))
   throw new Error("Unknown or mismatched PostgreSQL evidence operation");
  required(input.tenant?.tenantId,"tenantId");
  if(!input.parameters||typeof input.parameters!=="object"||Array.isArray(input.parameters))
   throw new TypeError("PostgreSQL evidence parameters must be an object");
  if(Object.keys(input.parameters).length)
   throw new TypeError("Unexpected PostgreSQL evidence parameters");
 }
 async acquire(input:AdapterAcquisitionInput):Promise<CapturedEvidence>{
  this.validateParameters(input);
  const op=this.operations.get(input.operation.operationId)!;
  let client:PoolClient|undefined;
  let rolledBack=false;
  try{
   try{client=await this.pool.connect();}catch{throw new Error("PostgreSQL evidence source unavailable");}
   const query=async(sql:string,params?:unknown[])=>{
    try{return await client!.query(sql,params);}catch{throw new Error("PostgreSQL evidence source unavailable");}
   };
   await query("BEGIN READ ONLY");
   await query(`SET LOCAL statement_timeout = ${op.manifest.timeoutMs}`);
   await query(`SET LOCAL lock_timeout = ${Math.min(op.manifest.timeoutMs,1000)}`);
   const response=await query(op.sql,[input.tenant.tenantId,op.maxRows+1,op.maxRows,op.manifest.maxResponseBytes]);
   if(response.rowCount!==1||!Array.isArray(response.rows)||response.rows.length!==1)
    throw new Error("PostgreSQL evidence invalid bounded query outcome");
   const body=parseRows(response.rows[0].body,response.rows[0].row_count,op);
   await query("ROLLBACK");
   rolledBack=true;
   return {status:200,mediaType:"application/json",bodyEncoding:"utf8",body};
  }finally{
   if(client){
    if(!rolledBack)try{await client.query("ROLLBACK");}catch{}
    try{client.release();}catch{throw new Error("PostgreSQL evidence source unavailable");}
   }
  }
 }
}
