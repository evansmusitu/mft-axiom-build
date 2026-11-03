import {constants, lstatSync, realpathSync, type Stats} from "node:fs";
import {open, lstat} from "node:fs/promises";
import {join, resolve} from "node:path";
import {hashJson} from "../../phase1/src/canonical.ts";
import type {JsonValue} from "../../phase1/src/types.ts";
import type {AdapterManifest,AdapterOperationManifest,CapturedEvidence} from "./types.ts";
import type {AdapterAcquisitionInput,EvidenceAdapter} from "./evidence.ts";

const MAX_FILE_BYTES=8*1024*1024;
function required(v:unknown,name:string):string{
 if(typeof v!=="string"||v.length===0||v.trim()!==v)throw new TypeError("Invalid "+name);
 return v;
}
function checkRoot(path:string):Stats{
 const stat=lstatSync(path);
 if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o022)!==0)
  throw new TypeError("File evidence root must be a trusted non-writable directory");
 return stat;
}
function checkFilename(name:string):string{
 if(typeof name!=="string"||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}\.json$/.test(name)||name.includes(".."))
  throw new TypeError("Invalid file evidence filename: expected flat .json basename");
 return name;
}
function checkManifest(op:AdapterOperationManifest):AdapterOperationManifest{
 required(op?.operationId,"operationId");
 if(typeof op.parameterSchemaHash!=="string"||!/^[0-9a-f]{64}$/.test(op.parameterSchemaHash))
  throw new TypeError("File evidence parameter schema hash is invalid");
 if(!Array.isArray(op.mappingIds)||op.mappingIds.length===0)
  throw new TypeError("File evidence operation needs mapping IDs");
 if(!Array.isArray(op.responseMediaTypes)||!op.responseMediaTypes.includes("application/json"))
  throw new TypeError("File evidence operations require application/json");
 if(!Number.isSafeInteger(op.maxResponseBytes)||op.maxResponseBytes<1||op.maxResponseBytes>MAX_FILE_BYTES)
  throw new RangeError("File evidence response size limit is invalid");
 if(!Number.isSafeInteger(op.timeoutMs)||op.timeoutMs<1||op.timeoutMs>120_000)
  throw new RangeError("File evidence timeout is invalid");
 return structuredClone(op);
}
function inspectJson(value:unknown):void{
 const stack:[unknown,number][]=[[value,0]];
 while(stack.length){
  const [item,depth]=stack.pop()!;
  if(depth>128)throw new TypeError("File evidence JSON nesting exceeds limit");
  if(typeof item==="number"&&!Number.isFinite(item))
   throw new TypeError("File evidence JSON contains non-finite numeric values");
  if(!item||typeof item!=="object")continue;
  for(const [key,child] of Object.entries(item)){
   if(key==="__proto__"||key==="constructor"||key==="prototype")
    throw new TypeError("File evidence JSON contains dangerous property");
   stack.push([child,depth+1]);
  }
 }
}
interface RegisteredFileOperation {
 manifest:AdapterOperationManifest;
 fileName:string;
 validateParameters:(parameters:Readonly<Record<string,JsonValue>>)=>void;
}
export interface FileJsonEvidenceOperationConfig {
 manifest:AdapterOperationManifest;
 fileName:string;
 validateParameters?:(parameters:Readonly<Record<string,JsonValue>>)=>void;
}
export class FileJsonEvidenceAdapter implements EvidenceAdapter{
 readonly manifest:AdapterManifest;
 private readonly root:string;
 private readonly rootIdentity:{dev:number;ino:number};
 private readonly operations=new Map<string,RegisteredFileOperation>();
 constructor(config:{
  adapterId:string;version:string;implementationHash:string;
  rootDirectory:string;operations:FileJsonEvidenceOperationConfig[];
 }){
  const adapterId=required(config?.adapterId,"adapterId"),version=required(config?.version,"version");
  if(typeof config.implementationHash!=="string"||!/^[0-9a-f]{64}$/.test(config.implementationHash))
   throw new TypeError("File evidence implementation hash is invalid");
  const root=resolve(required(config.rootDirectory,"rootDirectory"));
  const initial=checkRoot(root);
  this.root=realpathSync(root);
  this.rootIdentity={dev:initial.dev,ino:initial.ino};
  if(!Array.isArray(config.operations)||config.operations.length===0)
   throw new TypeError("At least one file evidence operation is required");
  const bound=new Set<string>();
  for(const item of config.operations){
   const manifest=checkManifest(item.manifest),fileName=checkFilename(item.fileName);
   if(this.operations.has(manifest.operationId)||bound.has(fileName))
    throw new TypeError("Duplicate file evidence operation or filename binding");
   if(item.validateParameters!==undefined&&typeof item.validateParameters!=="function")
    throw new TypeError("Invalid file evidence parameter validator");
   this.operations.set(manifest.operationId,{
    manifest,fileName,
    validateParameters:item.validateParameters??((params)=>{
     if(Object.keys(params).length)throw new TypeError("Unexpected file evidence parameters");
    })
   });
   bound.add(fileName);
  }
  this.manifest=Object.freeze({adapterId,version,implementationHash:config.implementationHash,
   capability:"READ" as const,operations:[...this.operations.values()].map(v=>structuredClone(v.manifest))});
 }
 validateParameters(input:AdapterAcquisitionInput):void{
  const op=this.operations.get(input?.operation?.operationId);
  if(!op||hashJson(input.operation as any)!==hashJson(op.manifest as any))
   throw new Error("Unregistered or mismatched file evidence operation");
  if(!input.tenant||typeof input.tenant.tenantId!=="string"||!input.tenant.tenantId.trim())
   throw new TypeError("File evidence tenant is required");
  if(!input.parameters||typeof input.parameters!=="object"||Array.isArray(input.parameters))
   throw new TypeError("File evidence parameters must be an object");
  op.validateParameters(structuredClone(input.parameters));
 }
 async acquire(input:AdapterAcquisitionInput):Promise<CapturedEvidence>{
  this.validateParameters(input);
  const op=this.operations.get(input.operation.operationId)!;
  const filePath=join(this.root,op.fileName);
  let source;
  try{
   const currentRoot=checkRoot(this.root);
   if(currentRoot.dev!==this.rootIdentity.dev||currentRoot.ino!==this.rootIdentity.ino)
    throw new Error("File evidence trusted root changed");
   const before=await lstat(filePath);
   if(!before.isFile()||before.isSymbolicLink())
    throw new Error("File evidence source must be a regular file without symlinks");
   if(before.size>op.manifest.maxResponseBytes)
    throw new RangeError("File evidence response size limit exceeded");
   source=await open(filePath,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
   const opened=await source.stat();
   if(!opened.isFile()||opened.ino!==before.ino||opened.dev!==before.dev)
    throw new Error("File evidence source changed during open");
   const chunks:Buffer[]=[];
   let total=0;
   const started=Date.now();
   while(true){
    if(Date.now()-started>op.manifest.timeoutMs)
     throw new Error("File evidence read timeout");
    const buffer=Buffer.alloc(Math.min(65536,op.manifest.maxResponseBytes+1-total));
    const {bytesRead}=await source.read(buffer,0,buffer.length,null);
    if(bytesRead===0)break;
    total+=bytesRead;
    if(total>op.manifest.maxResponseBytes)
     throw new RangeError("File evidence response size limit exceeded");
    chunks.push(buffer.subarray(0,bytesRead));
   }
   const finished=await source.stat();
   if(finished.size!==opened.size||finished.mtimeMs!==opened.mtimeMs
    ||finished.ctimeMs!==opened.ctimeMs||finished.ino!==opened.ino)
    throw new Error("File evidence source changed during read");
   const lastRoot=checkRoot(this.root);
   if(lastRoot.ino!==this.rootIdentity.ino||lastRoot.dev!==this.rootIdentity.dev)
    throw new Error("File evidence trusted root changed");
   const bytes=Buffer.concat(chunks,total);
   const body=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes);
   if(!Buffer.from(body,"utf8").equals(bytes))throw new TypeError("File evidence is not exact UTF-8");
   let parsed:unknown;
   try{parsed=JSON.parse(body);}catch{throw new TypeError("File evidence source must contain valid JSON");}
   inspectJson(parsed);
   return {status:200,mediaType:"application/json",bodyEncoding:"utf8",body};
  }catch(error){
   // Native filesystem errors contain absolute paths. Never expose them to API callers.
   if(error&&typeof error==="object"&&"errno" in error
    &&typeof error.errno==="number")
    throw new Error("File evidence source unavailable");
   throw error;
  }finally{await source?.close();}
 }
}
