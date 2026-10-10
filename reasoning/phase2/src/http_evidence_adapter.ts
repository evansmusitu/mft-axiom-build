import { isIP } from "node:net";
import type { JsonValue } from "../../phase1/src/types.ts";
import type { AdapterManifest, AdapterOperationManifest, CapturedEvidence, TenantScope } from "./types.ts";
import type { AdapterAcquisitionInput, EvidenceAdapter, SecretResolver } from "./evidence.ts";

const HEX64=/^[0-9a-f]{64}$/;
const FORBIDDEN_FIXED_HEADERS=new Set(["authorization","proxy-authorization","cookie","host","content-length","transfer-encoding","connection"]);

function required(v:unknown,label:string):string {
  if(typeof v!=="string"||!v.trim())throw new TypeError(`${label} is required`);
  return v;
}
function digest(v:unknown,label:string):string {
  const s=required(v,label);
  if(!HEX64.test(s))throw new TypeError(`${label} must be a lowercase SHA-256 hex digest`);
  return s;
}
function unsafeHost(hostname:string):boolean {
  const host=hostname.replace(/^\[|\]$/g,"").toLowerCase();
  if(host==="localhost"||host.endsWith(".localhost")||host==="metadata.google.internal")return true;
  const ip=isIP(host);
  if(ip===4){
    const p=host.split(".").map(Number);
    return p[0]===0||p[0]===127||(p[0]===169&&p[1]===254)||(p[0]>=224&&p[0]<=239);
  }
  if(ip===6){
    return host==="::"||host==="::1"||/^fe[89ab][0-9a-f]:/i.test(host)||/^ff/i.test(host)||/^::ffff:127\./i.test(host)||/^::ffff:169\.254\./i.test(host);
  }
  return false;
}
export function validateEvidenceHttpsOrigin(value:string):URL {
  let url:URL;
  try{url=new URL(required(value,"origin"));}catch{throw new TypeError("Evidence adapter origin must be a valid HTTPS URL");}
  if(url.protocol!=="https:")throw new TypeError("Evidence adapter origin must use HTTPS");
  if(url.username||url.password)throw new TypeError("Evidence adapter origin cannot contain credentials");
  if(url.pathname!=="/"||url.search||url.hash)throw new TypeError("Evidence adapter origin must not contain a path, query, or fragment");
  if(unsafeHost(url.hostname))throw new TypeError("Evidence adapter origin is unsafe (loopback, link-local, metadata, unspecified, or multicast)");
  return url;
}

export class EvidenceAdapterError extends Error {
  readonly code:string;
  readonly httpStatus:number;
  constructor(code:string,message:string,httpStatus:number){super(message);this.name="EvidenceAdapterError";this.code=code;this.httpStatus=httpStatus;}
}

export interface HttpEvidenceOperationConfig {
  manifest:AdapterOperationManifest;
  validateParameters:(parameters:Readonly<Record<string,JsonValue>>)=>void;
  origin:string;
  method:"GET"|"POST";
  pathTemplate:string;
  fixedHeaders?:Record<string,string>;
  secretHeaders?:Record<string,string>;
  allowedStatus:number[];
}

export type EvidenceFetch=(input:string|URL,init?:RequestInit)=>Promise<Response>;

function mediaType(value:string|null):string {
  return (value??"").split(";",1)[0].trim().toLowerCase();
}
function pathFor(template:string,parameters:Record<string,JsonValue>):string {
  if(typeof template!=="string"||!template.startsWith("/")||template.startsWith("//"))throw new TypeError("Evidence adapter pathTemplate must be an absolute path");
  const path=template.replace(/\{([A-Za-z0-9_]+)\}/g,(_all,name)=>{
    const value=parameters[name];
    if(typeof value!=="string"&&typeof value!=="number"&&typeof value!=="boolean")throw new TypeError(`Evidence adapter path parameter is required: ${name}`);
    return encodeURIComponent(String(value));
  });
  if(/[{}]/.test(path))throw new TypeError("Evidence adapter pathTemplate contains an invalid placeholder");
  return path;
}
function validateManifest(op:AdapterOperationManifest):AdapterOperationManifest {
  required(op?.operationId,"operationId");digest(op?.parameterSchemaHash,"parameterSchemaHash");
  if(!Array.isArray(op.responseMediaTypes)||op.responseMediaTypes.length===0)throw new TypeError("responseMediaTypes must not be empty");
  if(!Number.isInteger(op.maxResponseBytes)||op.maxResponseBytes<=0)throw new RangeError("maxResponseBytes must be positive");
  if(!Number.isInteger(op.timeoutMs)||op.timeoutMs<=0)throw new RangeError("timeoutMs must be positive");
  if(!Array.isArray(op.mappingIds)||op.mappingIds.length===0)throw new TypeError("mappingIds must not be empty");
  return structuredClone(op);
}
function normalizeHeaders(input:Record<string,string>|undefined,secret=false):Record<string,string> {
  const out:Record<string,string>={};
  for(const [rawName,rawValue] of Object.entries(input??{})){
    const name=required(rawName,"header name").toLowerCase(),value=required(rawValue,secret?"secretRef":"header value");
    if(!secret&&FORBIDDEN_FIXED_HEADERS.has(name))throw new TypeError(`Sensitive or transport header must not be fixed in adapter configuration: ${name}`);
    if(name==="host"||name==="content-length"||name==="transfer-encoding"||name==="connection")throw new TypeError(`Unsafe transport header: ${name}`);
    out[name]=value;
  }
  return out;
}

export async function captureBoundedJsonResponse(input:{
  response:Response;
  allowedStatus:number[];
  allowedMediaTypes:string[];
  maxResponseBytes:number;
  secrets?:string[];
}):Promise<CapturedEvidence> {
  const {response}=input;
  if(response.status>=300&&response.status<400)throw new EvidenceAdapterError("UPSTREAM_REDIRECT","Upstream redirects are not allowed",502);
  if(!input.allowedStatus.includes(response.status))throw new EvidenceAdapterError("UPSTREAM_BAD_STATUS","Upstream returned a disallowed status",502);
  const type=mediaType(response.headers.get("content-type"));
  if(!input.allowedMediaTypes.map(x=>x.toLowerCase()).includes(type))throw new EvidenceAdapterError("UPSTREAM_MEDIA_TYPE","Upstream media type is not allowed",415);

  const chunks:Uint8Array[]=[];let total=0;
  const reader=response.body?.getReader();
  if(reader){
    try{
      while(true){
        const next=await reader.read();
        if(next.done)break;
        const chunk=next.value;
        total+=chunk.byteLength;
        if(total>input.maxResponseBytes){
          try{await reader.cancel();}catch{}
          throw new EvidenceAdapterError("UPSTREAM_TOO_LARGE","Upstream response size exceeds configured byte limit",413);
        }
        chunks.push(chunk);
      }
    }finally{try{reader.releaseLock();}catch{}}
  }
  const bytes=Buffer.concat(chunks.map(x=>Buffer.from(x)),total);
  let body:string;
  try{body=new TextDecoder("utf-8",{fatal:true}).decode(bytes);}
  catch{throw new EvidenceAdapterError("UPSTREAM_ENCODING","Upstream JSON is not valid UTF-8",502);}
  for(const secret of input.secrets??[]){
    if(secret&&body.includes(secret))throw new EvidenceAdapterError("UPSTREAM_SECRET_ECHO","Upstream response contains secret material",502);
  }
  try{JSON.parse(body);}
  catch{throw new EvidenceAdapterError("UPSTREAM_INVALID_JSON","Upstream response is not valid JSON",502);}
  return {status:response.status,mediaType:type,bodyEncoding:"utf8",body};
}

export class HttpJsonEvidenceAdapter implements EvidenceAdapter {
  readonly manifest:AdapterManifest;
  private readonly operations=new Map<string,{manifest:AdapterOperationManifest;validateParameters:(parameters:Readonly<Record<string,JsonValue>>)=>void;origin:URL;method:"GET"|"POST";pathTemplate:string;fixedHeaders:Record<string,string>;secretHeaders:Record<string,string>;allowedStatus:number[]}>();
  private readonly secretResolver:SecretResolver;
  private readonly fetchFn:EvidenceFetch;

  constructor(config:{
    adapterId:string;version:string;implementationHash:string;capability?:"READ"|"COMPUTE";
    operations:HttpEvidenceOperationConfig[];
    secretResolver:SecretResolver;
    fetchFn?:EvidenceFetch;
  }){
    const adapterId=required(config.adapterId,"adapterId"),version=required(config.version,"adapter version"),implementationHash=digest(config.implementationHash,"adapter implementationHash");
    if(!Array.isArray(config.operations)||config.operations.length===0)throw new TypeError("HTTP evidence operations must not be empty");
    for(const item of config.operations){
      const op=validateManifest(item.manifest);
      if(this.operations.has(op.operationId))throw new TypeError(`Duplicate HTTP evidence operation: ${op.operationId}`);
      if(typeof item.validateParameters!=="function")throw new TypeError(`HTTP evidence operation requires a parameter validator: ${op.operationId}`);
      if(item.method!=="GET"&&item.method!=="POST")throw new TypeError("HTTP evidence method must be GET or POST");
      if(!Array.isArray(item.allowedStatus)||item.allowedStatus.length===0||item.allowedStatus.some(x=>!Number.isInteger(x)||x<200||x>299))throw new TypeError("allowedStatus must contain successful HTTP status codes");
      this.operations.set(op.operationId,{
        manifest:op,validateParameters:item.validateParameters,origin:validateEvidenceHttpsOrigin(item.origin),method:item.method,
        pathTemplate:required(item.pathTemplate,"pathTemplate"),
        fixedHeaders:normalizeHeaders(item.fixedHeaders),secretHeaders:normalizeHeaders(item.secretHeaders,true),
        allowedStatus:[...new Set(item.allowedStatus)]
      });
    }
    const capability=config.capability??"READ";
    if(capability!=="READ"&&capability!=="COMPUTE")throw new TypeError("adapter capability must be READ or COMPUTE");
    this.manifest={adapterId,version,implementationHash,capability,operations:[...this.operations.values()].map(x=>structuredClone(x.manifest))};
    this.secretResolver=config.secretResolver;
    this.fetchFn=config.fetchFn??fetch;
  }

  validateParameters(input:AdapterAcquisitionInput):void {
    const op=this.operations.get(input.operation?.operationId);
    if(!op)throw new Error("Unknown or unregistered HTTP evidence operation");
    if(!input.parameters||typeof input.parameters!=="object"||Array.isArray(input.parameters))throw new TypeError("Evidence parameters must be an object");
    op.validateParameters(structuredClone(input.parameters));
  }

  async acquire(input:AdapterAcquisitionInput):Promise<CapturedEvidence> {
    this.validateParameters(input);
    const op=this.operations.get(input.operation.operationId)!;
    const url=new URL(pathFor(op.pathTemplate,input.parameters),op.origin);
    if(url.origin!==op.origin.origin)throw new Error("Evidence adapter path escaped configured origin");
    const headers:Record<string,string>={...op.fixedHeaders,accept:"application/json"};
    const secrets:string[]=[];
    for(const [name,ref] of Object.entries(op.secretHeaders)){
      const value=await this.secretResolver.resolve(ref);
      headers[name]=value;secrets.push(value);
    }
    let body:string|undefined;
    if(op.method==="POST"){
      headers["content-type"]="application/json";
      body=JSON.stringify(input.parameters);
    }
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),op.manifest.timeoutMs);
    let response:Response;
    try{
      response=await this.fetchFn(url,{method:op.method,headers,body,redirect:"manual",signal:controller.signal});
    }catch(error){
      if(controller.signal.aborted)throw new EvidenceAdapterError("UPSTREAM_TIMEOUT","Upstream request timed out",504);
      throw new EvidenceAdapterError("UPSTREAM_NETWORK","Upstream request failed",502);
    }finally{clearTimeout(timer);}
    return captureBoundedJsonResponse({
      response,allowedStatus:op.allowedStatus,allowedMediaTypes:op.manifest.responseMediaTypes,
      maxResponseBytes:op.manifest.maxResponseBytes,secrets
    });
  }
}
