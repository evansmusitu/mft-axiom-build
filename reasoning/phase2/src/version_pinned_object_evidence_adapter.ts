import {createHash} from "node:crypto";
import {hashJson} from "../../phase1/src/canonical.ts";
import type {AdapterManifest,AdapterOperationManifest,CapturedEvidence} from "./types.ts";
import type {AdapterAcquisitionInput,EvidenceAdapter} from "./evidence.ts";

const HEX=/^[0-9a-f]{64}$/;
const BUCKET=/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const PART=/^[A-Za-z0-9_.-]{1,128}$/;
const VERSION=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
function required(value:unknown,label:string):string{
 if(typeof value!=="string"||value!==value.trim()||!value||value.length>256)
  throw new TypeError("Invalid object "+label);
 return value;
}
function maxNumber(value:unknown,label:string,ceiling:number):number{
 if(!Number.isSafeInteger(value)||Number(value)<1||Number(value)>ceiling)
  throw new TypeError("Invalid object "+label);
 return Number(value);
}
function safeKey(value:unknown):string{
 const key=required(value,"key");
 if(key.startsWith("/")||key.endsWith("/")||key.includes("\\")||key.length>512)
  throw new TypeError("Unsafe object key path");
 const segments=key.split("/");
 if(segments.some(s=>!PART.test(s)||s==="."||s===".."))
  throw new TypeError("Unsafe object key path");
 return key;
}
export interface ImmutableObjectRead{
 versionId:string;
 mediaType:string;
 body:Uint8Array;
}
export interface ImmutableObjectReader{
 readVersion(input:{bucket:string;key:string;versionId:string;signal:AbortSignal}):Promise<ImmutableObjectRead>;
}
export interface VersionPinnedObjectOperation{
 manifest:AdapterOperationManifest;
 bucket:string;key:string;versionId:string;expectedSha256:string;
 tenantIds:string[];
}
interface RegisteredOperation {
 manifest:AdapterOperationManifest;
 manifestHash:string;
 bucket:string;key:string;versionId:string;expectedSha256:string;
 tenants:Set<string>;
}
export class VersionPinnedObjectEvidenceAdapter implements EvidenceAdapter {
 readonly manifest:AdapterManifest;
 private readonly reader:ImmutableObjectReader;
 private readonly operations:Map<string,RegisteredOperation>;
 constructor(config:{adapterId:string;version:string;implementationHash:string;
  reader:ImmutableObjectReader;operations:VersionPinnedObjectOperation[]}){
  const adapterId=required(config?.adapterId,"adapterId"),version=required(config.version,"version");
  if(!HEX.test(config.implementationHash))throw new TypeError("Invalid object implementation hash");
  if(!config.reader||typeof config.reader.readVersion!=="function")
   throw new TypeError("Versioned object read-only client required");
  if(!Array.isArray(config.operations)||!config.operations.length)
   throw new TypeError("At least one pinned object operation required");
  this.reader=config.reader;
  this.operations=new Map();
  for(const raw of config.operations){
   const op=structuredClone(raw.manifest);
   const id=required(op?.operationId,"operationId");
   if(this.operations.has(id))throw new TypeError("Duplicate object operation");
   if(!HEX.test(op.parameterSchemaHash)||!Array.isArray(op.responseMediaTypes)
    ||op.responseMediaTypes.length!==1||op.responseMediaTypes[0]!=="application/json"
    ||!Array.isArray(op.mappingIds)||op.mappingIds.length===0
    ||new Set(op.mappingIds).size!==op.mappingIds.length)
    throw new TypeError("Invalid object operation media or mapping manifest");
   maxNumber(op.maxResponseBytes,"maxResponseBytes",1024*1024);
   maxNumber(op.timeoutMs,"timeoutMs",30000);
   if(typeof raw.bucket!=="string"||!BUCKET.test(raw.bucket)||raw.bucket.includes(".."))
    throw new TypeError("Invalid object bucket");
   const key=safeKey(raw.key);
   const versionId=required(raw.versionId,"versionId");
   if(!VERSION.test(versionId)||/^(?:latest|head|current)$/i.test(versionId))
    throw new TypeError("Unsafe object version identity");
   if(typeof raw.expectedSha256!=="string"||!HEX.test(raw.expectedSha256))
    throw new TypeError("Invalid pinned object SHA-256 hash");
   if(!Array.isArray(raw.tenantIds)||raw.tenantIds.length===0||raw.tenantIds.length>100)
    throw new TypeError("Invalid object tenant allowlist");
   const tenants=raw.tenantIds.map(t=>required(t,"tenantId"));
   if(new Set(tenants).size!==tenants.length)throw new TypeError("Duplicate object tenant");
   this.operations.set(id,{
    manifest:op,manifestHash:hashJson(op as any),
    bucket:raw.bucket,key,versionId,expectedSha256:raw.expectedSha256,tenants:new Set(tenants)
   });
  }
  this.manifest={adapterId,version,implementationHash:config.implementationHash,
   capability:"READ",operations:[...this.operations.values()].map(x=>structuredClone(x.manifest))};
 }
 private checked(input:AdapterAcquisitionInput):{op:RegisteredOperation}{
  const op=this.operations.get(input?.operation?.operationId);
  if(!op||hashJson(input.operation as any)!==op.manifestHash)
   throw new TypeError("Invalid or unknown object operation manifest");
  const tenant=required(input.tenant?.tenantId,"tenantId");
  if(!op.tenants.has(tenant))throw new Error("Object tenant is forbidden");
  const parameters=input.parameters;
  if(!parameters||typeof parameters!=="object"||Array.isArray(parameters)
    ||Object.keys(parameters).length!==0)
   throw new TypeError("Unexpected object acquisition parameters");
  return {op};
 }
 validateParameters(input:AdapterAcquisitionInput):void{this.checked(input);}
 async acquire(input:AdapterAcquisitionInput):Promise<CapturedEvidence>{
  const {op}=this.checked(input);
  const controller=new AbortController();
  let timer:ReturnType<typeof setTimeout>|undefined;
  const deadline=new Promise<never>((_resolve,reject)=>{
   timer=setTimeout(()=>{controller.abort();reject(new Error("OBJECT_READ_TIMEOUT"));},op.manifest.timeoutMs);
  });
  let result:ImmutableObjectRead;
  try{
   result=await Promise.race([
    this.reader.readVersion({bucket:op.bucket,key:op.key,versionId:op.versionId,signal:controller.signal}),
    deadline
   ]);
  }finally{if(timer!==undefined)clearTimeout(timer);}
  if(!result||result.versionId!==op.versionId)throw new Error("Object version identity mismatch");
  if(result.mediaType!=="application/json")throw new Error("Object media type mismatch");
  if(!(result.body instanceof Uint8Array))throw new TypeError("Invalid object bytes");
  if(result.body.byteLength>op.manifest.maxResponseBytes)
   throw new RangeError("Object response size exceeds configured bytes");
  const bytes=Buffer.from(result.body);
  let body:string;
  try{body=new TextDecoder("utf-8",{fatal:true}).decode(bytes);}
  catch{throw new Error("Object UTF-8 encoding is invalid");}
  try{JSON.parse(body);}
  catch{throw new Error("Object JSON is invalid");}
  if(createHash("sha256").update(bytes).digest("hex")!==op.expectedSha256)
   throw new Error("Object content SHA-256 hash mismatch");
  return {status:200,mediaType:"application/json",bodyEncoding:"utf8",body};
 }
}
