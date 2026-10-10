import { canonicalize, hashJson, sha256Hex } from "../../phase1/src/canonical.ts";
import type { ModelAdapterManifest, ModelCompilationIssue, ModelCompilerProfile, ModelExchangeArtifact, ModelInputContract, TenantScope } from "./types.ts";
import type { SecretResolver } from "./evidence.ts";
import { captureBoundedJsonResponse, EvidenceAdapterError, validateEvidenceHttpsOrigin, type EvidenceFetch } from "./http_evidence_adapter.ts";
import { canonicalModelInputContracts, modelProfileHash } from "./model_compiler.ts";

const HEX64=/^[0-9a-f]{64}$/;
const FORBIDDEN_FIXED_HEADERS=new Set(["authorization","proxy-authorization","cookie","host","content-length","transfer-encoding","connection"]);
const FORBIDDEN_SECRET_HEADERS=new Set(["host","content-length","transfer-encoding","connection"]);
const PROPOSAL_SCHEMA_VERSION="axiom.model-proposal.v1";

function required(value:unknown,label:string):string {
  if(typeof value!=="string"||!value.trim())throw new TypeError(`${label} is required`);
  return value;
}
function digest(value:unknown,label:string):string {
  const text=required(value,label);
  if(!HEX64.test(text))throw new TypeError(`${label} must be a lowercase SHA-256 hex digest`);
  return text;
}
function canonicalIso(value:unknown,label:string):string {
  const text=required(value,label),ms=Date.parse(text);
  if(!Number.isFinite(ms)||new Date(ms).toISOString()!==text)throw new TypeError(`${label} must use canonical ISO-8601 UTC format`);
  return text;
}
function nonNegativeInteger(value:unknown,label:string):number {
  if(!Number.isInteger(value)||(value as number)<0)throw new TypeError(`${label} must be a non-negative integer`);
  return value as number;
}
function fixedPath(value:unknown,label:string):string {
  const path=required(value,label);
  if(!path.startsWith("/")||path.startsWith("//"))throw new TypeError(`${label} must be an absolute path`);
  const parsed=new URL(path,"https://axiom.invalid");
  if(parsed.origin!=="https://axiom.invalid"||parsed.pathname!==path||parsed.search||parsed.hash)throw new TypeError(`${label} must not contain origin, query, or fragment`);
  return path;
}
function normalizeHeaders(input:Record<string,string>|undefined,secret=false):Record<string,string> {
  const out:Record<string,string>={};
  for(const [rawName,rawValue] of Object.entries(input??{})){
    const name=required(rawName,"header name").toLowerCase(),value=required(rawValue,secret?"secretRef":"header value");
    if(!secret&&FORBIDDEN_FIXED_HEADERS.has(name))throw new TypeError(`Sensitive or transport header must not be fixed in model adapter configuration: ${name}`);
    if(secret&&FORBIDDEN_SECRET_HEADERS.has(name))throw new TypeError(`Unsafe transport header in model adapter configuration: ${name}`);
    out[name]=value;
  }
  return out;
}
function validateManifest(input:ModelAdapterManifest):ModelAdapterManifest {
  return {
    adapterId:required(input?.adapterId,"adapterId"),
    version:required(input?.version,"adapter version"),
    implementationHash:digest(input?.implementationHash,"adapter implementationHash"),
    provider:required(input?.provider,"provider"),
    modelId:required(input?.modelId,"modelId")
  };
}
function sortedIssues(input:ModelCompilationIssue[]|undefined):ModelCompilationIssue[] {
  if(!Array.isArray(input))return [];
  return input.map((issue,index)=>{
    if(!issue||typeof issue!=="object")throw new TypeError(`issues[${index}] must be an object`);
    const code=required(issue.code,`issues[${index}].code`),message=required(issue.message,`issues[${index}].message`);
    const out:ModelCompilationIssue={code,message};
    if(issue.nodeId!==undefined)out.nodeId=required(issue.nodeId,`issues[${index}].nodeId`);
    return out;
  }).sort((a,b)=>(a.nodeId??"").localeCompare(b.nodeId??"")||a.code.localeCompare(b.code)||a.message.localeCompare(b.message));
}
function operationIdentity(value:any,index:number){
  if(!value||typeof value!=="object"||Array.isArray(value))throw new TypeError(`operationRegistryManifest[${index}] must be an object`);
  return {
    id:required(value.id,`operationRegistryManifest[${index}].id`),
    version:required(value.version,`operationRegistryManifest[${index}].version`),
    implementationHash:digest(value.implementationHash,`operationRegistryManifest[${index}].implementationHash`),
    moduleHash:digest(value.moduleHash,`operationRegistryManifest[${index}].moduleHash`)
  };
}

export interface ModelOperationIdentity {
  id:string;
  version:string;
  implementationHash:string;
  moduleHash:string;
}
export interface ModelAdapterInput {
  tenant:TenantScope;
  profile:ModelCompilerProfile;
  profileHash:string;
  compilationRequestHash:string;
  attempt:number;
  mode:"INITIAL"|"REPAIR";
  objective:string;
  inputContracts:ModelInputContract[];
  operationRegistryManifest:ModelOperationIdentity[];
  remainingRepairAttempts:number;
  previousResponseBody?:string;
  issues?:ModelCompilationIssue[];
  capturedAt:string;
}
export interface CapturedModelExchange {
  capturedAt:string;
  requestBody:string;
  responseBody:string;
  normalizedResponseBody?:string;
}
export interface ModelAdapter {
  readonly manifest:ModelAdapterManifest;
  invoke(input:ModelAdapterInput):Promise<CapturedModelExchange>;
}
export class ModelAdapterError extends Error {
  readonly code:string;
  readonly httpStatus:number;
  constructor(code:string,message:string,httpStatus:number){super(message);this.name="ModelAdapterError";this.code=code;this.httpStatus=httpStatus;}
}

function translate(error:unknown):never {
  if(error instanceof ModelAdapterError)throw error;
  if(error instanceof EvidenceAdapterError)throw new ModelAdapterError(error.code,error.message,error.httpStatus);
  throw error;
}

export function canonicalModelAdapterRequestBody(input:ModelAdapterInput,manifestInput:ModelAdapterManifest):string {
  const manifest=validateManifest(manifestInput);
  if(!input?.tenant?.tenantId?.trim())throw new TypeError("tenantId is required");
  const profileHash=digest(input.profileHash,"profileHash");
  if(profileHash!==modelProfileHash(input.profile))throw new Error("Model adapter profile hash mismatch");
  if(input.profile.adapterId!==manifest.adapterId)throw new Error("Model adapter does not match compiler profile");
  digest(input.compilationRequestHash,"compilationRequestHash");
  const attempt=nonNegativeInteger(input.attempt,"attempt");
  const remainingRepairAttempts=nonNegativeInteger(input.remainingRepairAttempts,"remainingRepairAttempts");
  if(remainingRepairAttempts>input.profile.maxRepairAttempts)throw new TypeError("remainingRepairAttempts exceeds profile repair limit");
  if(input.mode!=="INITIAL"&&input.mode!=="REPAIR")throw new TypeError("mode must be INITIAL or REPAIR");
  if((input.mode==="INITIAL"&&attempt!==0)||(input.mode==="REPAIR"&&attempt===0))throw new TypeError("attempt does not match model request mode");
  const objective=required(input.objective,"objective");
  if(Buffer.byteLength(objective,"utf8")>input.profile.maxObjectiveBytes)throw new RangeError("objective exceeds profile byte limit");
  const inputContracts=canonicalModelInputContracts(input.inputContracts,input.profile);
  if(!Array.isArray(input.operationRegistryManifest))throw new TypeError("operationRegistryManifest must be an array");
  const allowedOperations=input.operationRegistryManifest.map(operationIdentity).sort((a,b)=>a.id.localeCompare(b.id));
  const expected=[...input.profile.allowedOperationIds].sort();
  if(JSON.stringify(allowedOperations.map(x=>x.id))!==JSON.stringify(expected))throw new Error("Model adapter operation identities do not match compiler profile");
  const envelope:any={
    schemaVersion:PROPOSAL_SCHEMA_VERSION,
    objective,
    inputContracts,
    profile:{
      profileId:input.profile.profileId,profileVersion:input.profile.version,profileHash,
      maxNodes:input.profile.maxNodes,maxConstraints:input.profile.maxConstraints,
      maxAssumptions:input.profile.maxAssumptions,maxModelResponseBytes:input.profile.maxModelResponseBytes
    },
    allowedOperations
  };
  if(input.mode==="REPAIR"){
    const previousResponseBody=required(input.previousResponseBody,"previousResponseBody");
    if(Buffer.byteLength(previousResponseBody,"utf8")>input.profile.maxModelResponseBytes)throw new RangeError("previousResponseBody exceeds profile response limit");
    envelope.repair={previousResponseBody,issues:sortedIssues(input.issues),remainingRepairAttempts};
  }else if(input.previousResponseBody!==undefined||input.issues!==undefined){
    throw new TypeError("Initial model request cannot contain repair state");
  }
  return canonicalize(envelope);
}


function canonicalCapturedAt(value:unknown):string { return canonicalIso(value,"capturedAt"); }

export class HttpStructuredModelAdapter implements ModelAdapter {
  readonly manifest:ModelAdapterManifest;
  private readonly origin:URL;
  private readonly compilePath:string;
  private readonly repairPath:string;
  private readonly timeoutMs:number;
  private readonly maxResponseBytes:number;
  private readonly allowedStatus:number[];
  private readonly fixedHeaders:Record<string,string>;
  private readonly secretHeaders:Record<string,string>;
  private readonly secretResolver:SecretResolver;
  private readonly fetchFn:EvidenceFetch;

  constructor(config:{
    manifest:ModelAdapterManifest;
    origin:string;
    compilePath:string;
    repairPath?:string;
    timeoutMs:number;
    maxResponseBytes:number;
    allowedStatus:number[];
    fixedHeaders?:Record<string,string>;
    secretHeaders?:Record<string,string>;
    secretResolver:SecretResolver;
    fetchFn?:EvidenceFetch;
  }){
    this.manifest=validateManifest(config.manifest);
    this.origin=validateEvidenceHttpsOrigin(config.origin);
    this.compilePath=fixedPath(config.compilePath,"compilePath");
    this.repairPath=fixedPath(config.repairPath??config.compilePath,"repairPath");
    if(!Number.isInteger(config.timeoutMs)||config.timeoutMs<=0)throw new TypeError("timeoutMs must be a positive integer");
    if(!Number.isInteger(config.maxResponseBytes)||config.maxResponseBytes<=0)throw new TypeError("maxResponseBytes must be a positive integer");
    if(!Array.isArray(config.allowedStatus)||config.allowedStatus.length===0||config.allowedStatus.some(x=>!Number.isInteger(x)||x<200||x>299)){
      throw new TypeError("allowedStatus must contain successful HTTP status codes");
    }
    this.timeoutMs=config.timeoutMs;
    this.maxResponseBytes=config.maxResponseBytes;
    this.allowedStatus=[...new Set(config.allowedStatus)].sort((a,b)=>a-b);
    this.fixedHeaders=normalizeHeaders(config.fixedHeaders);
    this.secretHeaders=normalizeHeaders(config.secretHeaders,true);
    this.secretResolver=config.secretResolver;
    this.fetchFn=config.fetchFn??fetch;
  }

  async invoke(input:ModelAdapterInput):Promise<CapturedModelExchange> {
    const capturedAt=canonicalCapturedAt(input?.capturedAt),requestBody=canonicalModelAdapterRequestBody(input,this.manifest);
    const headers:Record<string,string>={...this.fixedHeaders,accept:"application/json","content-type":"application/json"};
    const secrets:string[]=[];
    for(const [name,secretRef] of Object.entries(this.secretHeaders)){
      const value=await this.secretResolver.resolve(secretRef);
      if(typeof value!=="string"||!value)throw new Error("Resolved model provider secret must be a non-empty string");
      headers[name]=value;secrets.push(value);
    }
    for(const secret of secrets){
      if(secret&&requestBody.includes(secret))throw new ModelAdapterError("MODEL_SECRET_IN_REQUEST","Sanitized model request contains secret material",500);
    }
    const path=input.mode==="REPAIR"?this.repairPath:this.compilePath,url=new URL(path,this.origin);
    if(url.origin!==this.origin.origin)throw new Error("Model adapter path escaped configured origin");
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.timeoutMs);
    let response:Response;
    try{
      response=await this.fetchFn(url,{method:"POST",headers,body:requestBody,redirect:"manual",signal:controller.signal});
    }catch(error){
      if(controller.signal.aborted)throw new ModelAdapterError("MODEL_UPSTREAM_TIMEOUT","Model provider request timed out",504);
      throw new ModelAdapterError("MODEL_UPSTREAM_NETWORK","Model provider request failed",502);
    }finally{clearTimeout(timer);}
    let captured;
    try{
      captured=await captureBoundedJsonResponse({
        response,allowedStatus:this.allowedStatus,allowedMediaTypes:["application/json"],
        maxResponseBytes:Math.min(this.maxResponseBytes,input.profile.maxModelResponseBytes),secrets
      });
    }catch(error){translate(error);}
    let parsed:any;
    try{parsed=JSON.parse(captured!.body);}catch{throw new ModelAdapterError("MODEL_UPSTREAM_INVALID_JSON","Model provider response is not valid JSON",502);}
    if(!parsed||typeof parsed!=="object"||Array.isArray(parsed)||Object.keys(parsed).length!==1||!("proposal" in parsed)||!parsed.proposal||typeof parsed.proposal!=="object"||Array.isArray(parsed.proposal)){
      throw new ModelAdapterError("MODEL_GATEWAY_SCHEMA","Model provider response does not match gateway schema",502);
    }
    return {capturedAt,requestBody,responseBody:captured!.body,normalizedResponseBody:captured!.body};
  }
}

function artifactCore(artifact:Omit<ModelExchangeArtifact,"artifactId"|"artifactHash">){
  const core:any={
    tenantId:artifact.tenantId,adapterId:artifact.adapterId,adapterVersion:artifact.adapterVersion,
    adapterImplementationHash:artifact.adapterImplementationHash,provider:artifact.provider,modelId:artifact.modelId,
    profileId:artifact.profileId,profileHash:artifact.profileHash,compilationRequestHash:artifact.compilationRequestHash,
    attempt:artifact.attempt,mode:artifact.mode,capturedAt:artifact.capturedAt,
    requestBody:artifact.requestBody,requestBodyHash:artifact.requestBodyHash,
    responseBody:artifact.responseBody,responseBodyHash:artifact.responseBodyHash
  };
  if(artifact.normalizedResponseBody!==undefined||artifact.normalizedResponseBodyHash!==undefined){
    core.normalizedResponseBody=artifact.normalizedResponseBody;
    core.normalizedResponseBodyHash=artifact.normalizedResponseBodyHash;
  }
  return core;
}

export function createModelExchangeArtifact(input:{
  tenantId:string;
  manifest:ModelAdapterManifest;
  profileId:string;
  profileHash:string;
  compilationRequestHash:string;
  attempt:number;
  mode:"INITIAL"|"REPAIR";
  captured:CapturedModelExchange;
}):ModelExchangeArtifact {
  const manifest=validateManifest(input.manifest);
  const normalized=input.captured?.normalizedResponseBody;
  const core:any={
    tenantId:required(input.tenantId,"tenantId"),
    adapterId:manifest.adapterId,adapterVersion:manifest.version,adapterImplementationHash:manifest.implementationHash,
    provider:manifest.provider,modelId:manifest.modelId,
    profileId:required(input.profileId,"profileId"),profileHash:digest(input.profileHash,"profileHash"),
    compilationRequestHash:digest(input.compilationRequestHash,"compilationRequestHash"),
    attempt:nonNegativeInteger(input.attempt,"attempt"),mode:input.mode,
    capturedAt:canonicalIso(input.captured?.capturedAt,"capturedAt"),
    requestBody:required(input.captured?.requestBody,"requestBody"),
    requestBodyHash:sha256Hex(Buffer.from(required(input.captured?.requestBody,"requestBody"),"utf8")),
    responseBody:required(input.captured?.responseBody,"responseBody"),
    responseBodyHash:sha256Hex(Buffer.from(required(input.captured?.responseBody,"responseBody"),"utf8"))
  };
  if(normalized!==undefined){
    core.normalizedResponseBody=required(normalized,"normalizedResponseBody");
    core.normalizedResponseBodyHash=sha256Hex(Buffer.from(core.normalizedResponseBody,"utf8"));
  }
  if(core.mode!=="INITIAL"&&core.mode!=="REPAIR")throw new TypeError("artifact mode is invalid");
  const artifactHash=hashJson(core as any);
  return {...core,artifactId:`model-artifact:${artifactHash}`,artifactHash};
}

export function verifyModelExchangeArtifact(scope:TenantScope,artifact:ModelExchangeArtifact):ModelExchangeArtifact {
  const tenantId=required(scope?.tenantId,"tenantId");
  if(artifact?.tenantId!==tenantId)throw new Error("Model exchange artifact tenant mismatch");
  if(sha256Hex(Buffer.from(artifact.requestBody,"utf8"))!==artifact.requestBodyHash)throw new Error("Model exchange request body integrity mismatch");
  if(sha256Hex(Buffer.from(artifact.responseBody,"utf8"))!==artifact.responseBodyHash)throw new Error("Model exchange response body integrity mismatch");
  const hasNormalizedBody=artifact.normalizedResponseBody!==undefined,hasNormalizedHash=artifact.normalizedResponseBodyHash!==undefined;
  if(hasNormalizedBody!==hasNormalizedHash)throw new Error("Model exchange normalized response integrity metadata is incomplete");
  if(hasNormalizedBody&&sha256Hex(Buffer.from(artifact.normalizedResponseBody!,"utf8"))!==artifact.normalizedResponseBodyHash){
    throw new Error("Model exchange normalized response body integrity mismatch");
  }
  const {artifactId,artifactHash,...rest}=artifact;
  const expected=hashJson(artifactCore(rest) as any);
  if(artifactHash!==expected||artifactId!==`model-artifact:${expected}`)throw new Error("Model exchange artifact integrity hash mismatch");
  return structuredClone(artifact);
}
