import {hashJson} from "../../phase1/src/canonical.ts";
import type {AdapterManifest,AdapterOperationManifest,CapturedEvidence} from "./types.ts";
import type {AdapterAcquisitionInput,EvidenceAdapter,SecretResolver} from "./evidence.ts";
import {captureBoundedJsonResponse,validateEvidenceHttpsOrigin,type EvidenceFetch} from "./http_evidence_adapter.ts";

const HEX=/^[0-9a-f]{64}$/;
const SAFE=/^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/;
const BAD=/(^|[._:-])(trade|trading|order|place|send|publish|submit|execute|payment|payments|checkout|transfer|withdraw|deposit|delete|remove|terminate|liquidate|close|revoke|admin|broker|write|update|insert|create|patch|mutate|swap|purchase|buy|sell|list|discover)([._:-]|$)/i;
function required(v:unknown,label:string):string{
 if(typeof v!=="string"||!v||v!==v.trim()||v.length>256)throw new TypeError("Invalid MCP "+label);
 return v;
}
function allowTool(name:string):string{
 if(!SAFE.test(name)||BAD.test(name)||name.length>128)throw new TypeError("Unsafe or invalid MCP tool name");
 return name;
}
function exact(value:unknown,fields:string[]):boolean{
 return !!value&&typeof value==="object"&&!Array.isArray(value)
  &&Object.keys(value).sort().join(",")===fields.slice().sort().join(",");
}
function positive(n:unknown,label:string,max:number):number{
 if(!Number.isSafeInteger(n)||Number(n)<1||Number(n)>max)throw new TypeError("Invalid MCP "+label);
 return Number(n);
}
export interface FixedMcpEvidenceOperationConfig {
 manifest:AdapterOperationManifest;
 origin:string;
 toolName:string;
 parameterName:string;
 tenantIds:string[];
 secretRef?:string;
}
interface Registered{
 manifest:AdapterOperationManifest;hash:string;origin:URL;toolName:string;
 parameterName:string;tenants:Set<string>;secretRef?:string;
}
export class FixedMcpEvidenceAdapter implements EvidenceAdapter {
 readonly manifest:AdapterManifest;
 private readonly secretResolver:SecretResolver;
 private readonly fetchFn:EvidenceFetch;
 private readonly operations:Map<string,Registered>;
 constructor(config:{adapterId:string;version:string;implementationHash:string;
  secretResolver:SecretResolver;fetchFn?:EvidenceFetch;operations:FixedMcpEvidenceOperationConfig[]}){
  const adapterId=required(config?.adapterId,"adapterId"),version=required(config.version,"version");
  if(typeof config.implementationHash!=="string"||!HEX.test(config.implementationHash))
   throw new TypeError("Invalid MCP implementation hash");
  if(!config.secretResolver||typeof config.secretResolver.resolve!=="function")
   throw new TypeError("Invalid MCP secret resolver");
  if(!Array.isArray(config.operations)||config.operations.length<1||config.operations.length>100)
   throw new TypeError("Invalid MCP operation registrations");
  this.secretResolver=config.secretResolver;
  this.fetchFn=config.fetchFn??fetch;
  this.operations=new Map();
  for(const raw of config.operations){
   const manifest=structuredClone(raw.manifest);
   const id=required(manifest?.operationId,"operationId");
   if(this.operations.has(id))throw new TypeError("Duplicate MCP operation");
   if(typeof manifest.parameterSchemaHash!=="string"||!HEX.test(manifest.parameterSchemaHash)
    ||!Array.isArray(manifest.responseMediaTypes)||manifest.responseMediaTypes.length!==1
    ||manifest.responseMediaTypes[0]!=="application/json"
    ||!Array.isArray(manifest.mappingIds)||manifest.mappingIds.length===0
    ||new Set(manifest.mappingIds).size!==manifest.mappingIds.length)
    throw new TypeError("Invalid MCP operation manifest");
   positive(manifest.maxResponseBytes,"maxResponseBytes",1_048_576);
   positive(manifest.timeoutMs,"timeoutMs",30_000);
   const origin=validateEvidenceHttpsOrigin(raw.origin);
   const toolName=allowTool(required(raw.toolName,"toolName"));
   const parameterName=required(raw.parameterName,"parameterName");
   if(!/^[a-z][a-z0-9_]*$/.test(parameterName)||parameterName==="constructor"||parameterName==="prototype")
    throw new TypeError("Invalid MCP parameter name");
   if(!Array.isArray(raw.tenantIds)||raw.tenantIds.length===0||raw.tenantIds.length>100)
    throw new TypeError("Invalid MCP tenant allowlist");
   const tenants=raw.tenantIds.map(x=>required(x,"tenantId"));
   if(new Set(tenants).size!==tenants.length)throw new TypeError("Duplicate MCP tenants");
   const secretRef=raw.secretRef===undefined?undefined:required(raw.secretRef,"secretRef");
   this.operations.set(id,{
    manifest,hash:hashJson(manifest as any),origin,toolName,parameterName,
    tenants:new Set(tenants),...(secretRef===undefined?{}:{secretRef})
   });
  }
  this.manifest={adapterId,version,implementationHash:config.implementationHash,
   capability:"READ",operations:[...this.operations.values()].map(x=>structuredClone(x.manifest))};
 }
 private checked(input:AdapterAcquisitionInput):{op:Registered;tenantId:string;value:string}{
  const op=this.operations.get(input?.operation?.operationId);
  if(!op||!exact(input.operation,[
   "operationId","parameterSchemaHash","responseMediaTypes","maxResponseBytes","timeoutMs","mappingIds"
  ])||hashJson(input.operation as any)!==op.hash)
   throw new TypeError("Invalid MCP operation manifest");
  const tenantId=required(input.tenant?.tenantId,"tenant");
  if(!op.tenants.has(tenantId))throw new Error("MCP tenant forbidden");
  const params=input.parameters;
  if(!exact(params,[op.parameterName]))throw new TypeError("Unexpected MCP parameters");
  const value=params[op.parameterName];
  if(typeof value!=="string"||value.length===0||value.length>256||value!==value.trim())
   throw new TypeError("Invalid MCP parameter value");
  return {op,tenantId,value};
 }
 validateParameters(input:AdapterAcquisitionInput):void{this.checked(input);}
 async acquire(input:AdapterAcquisitionInput):Promise<CapturedEvidence>{
  const {op,tenantId,value}=this.checked(input);
  const args={[op.parameterName]:value};
  const id="axiom-mcp:"+hashJson({
   domain:"AXIOM_MCP_READ_ONLY_TOOL_REQUEST_V1",tenantId,operationId:op.manifest.operationId,
   toolName:op.toolName,args
  } as any);
  const payload={jsonrpc:"2.0",id,method:"tools/call",
   params:{name:op.toolName,arguments:args}};
  const body=JSON.stringify(payload);
  if(Buffer.byteLength(body,"utf8")>4096)throw new RangeError("MCP request too large");
  const headers:Record<string,string>={"accept":"application/json","content-type":"application/json"};
  const secrets:string[]=[];
  if(op.secretRef){
   const token=await this.secretResolver.resolve(op.secretRef);
   if(typeof token!=="string"||token.length<1||token.length>8192)
    throw new TypeError("Invalid server MCP credential");
   headers.authorization=token;secrets.push(token);
  }
  const controller=new AbortController();
  let timer:ReturnType<typeof setTimeout>|undefined;
  const deadline=new Promise<never>((_resolve,reject)=>{
   timer=setTimeout(()=>{
    controller.abort();
    reject(new Error("MCP upstream timeout"));
   },op.manifest.timeoutMs);
  });
  let envelope:CapturedEvidence;
  try{
   envelope=await Promise.race([
    (async()=>{
     let response:Response;
     try{
      response=await this.fetchFn(new URL("/mcp",op.origin),{
       method:"POST",headers,body,redirect:"manual",signal:controller.signal
      });
     }catch{throw new Error("MCP upstream network failure");}
     return captureBoundedJsonResponse({
      response,allowedStatus:[200],allowedMediaTypes:["application/json"],
      maxResponseBytes:op.manifest.maxResponseBytes+1024,secrets
     });
    })(),
    deadline
   ]);
  }catch(error){
   if(controller.signal.aborted)throw new Error("MCP upstream timeout");
   throw error;
  }finally{
   if(timer!==undefined)clearTimeout(timer);
  }
  let parsed:any;
  try{parsed=JSON.parse(envelope.body);}catch{throw new Error("MCP JSON-RPC response invalid");}
  if(!exact(parsed,["jsonrpc","id","result"])||parsed.jsonrpc!=="2.0"||parsed.id!==id)
   throw new Error("MCP JSON-RPC response identity/protocol mismatch");
  const result=parsed.result;
  if(!exact(result,["isError","content"])||result.isError!==false
   ||!Array.isArray(result.content)||result.content.length!==1)
   throw new Error("MCP tool result is invalid or error");
  const block=result.content[0];
  if(!exact(block,["type","text"])||block.type!=="text"||typeof block.text!=="string")
   throw new Error("MCP tool response content invalid");
  if(Buffer.byteLength(block.text,"utf8")>op.manifest.maxResponseBytes)
   throw new Error("MCP tool content size limit exceeded");
  if(secrets.some(s=>block.text.includes(s)))throw new Error("MCP tool secret echo");
  try{JSON.parse(block.text);}
  catch{throw new Error("MCP tool content invalid JSON");}
  return {status:200,mediaType:"application/json",bodyEncoding:"utf8",body:block.text};
 }
}
