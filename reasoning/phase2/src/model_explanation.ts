import { canonicalize, hashJson, sha256Hex } from "../../phase1/src/canonical.ts";
import type { ExecutionRepository, ModelExplanationRepository } from "./repositories.ts";
import type {
  AuthorizedTenantContext, ModelAdapterManifest, ModelExplainRequest, ModelExplainResult,
  ModelExplanationContent, ModelExplanationProfile, ModelExplanationRecord, TenantScope
} from "./types.ts";

const HEX64=/^[0-9a-f]{64}$/;
const MAX_EXPLANATION_ITEMS=8;
const MAX_SUMMARY_BYTES=4096;
const MAX_ITEM_BYTES=2048;

function required(value:unknown,label:string):string{
  if(typeof value!=="string"||!value.trim())throw new TypeError(`${label} is required`);
  return value;
}
function digest(value:unknown,label:string):string{
  const text=required(value,label);
  if(!HEX64.test(text))throw new TypeError(`${label} must be a lowercase SHA-256 hex digest`);
  return text;
}
function positiveInteger(value:unknown,label:string):number{
  if(!Number.isInteger(value)||Number(value)<=0)throw new TypeError(`${label} must be a positive integer`);
  return Number(value);
}
function byteLimit(text:string,limit:number,label:string):void{
  if(Buffer.byteLength(text,"utf8")>limit)throw new ModelExplanationError("MODEL_EXPLANATION_UPSTREAM_FAILED",`${label} exceeds configured byte limit`,502);
}
function canonicalNow(value:Date|string):string{
  const text=value instanceof Date?value.toISOString():required(value,"capturedAt");
  const ms=Date.parse(text);
  if(!Number.isFinite(ms)||new Date(ms).toISOString()!==text)throw new TypeError("capturedAt must use canonical ISO-8601 UTC format");
  return text;
}
function cloneManifest(input:ModelAdapterManifest):ModelAdapterManifest{
  const out={
    adapterId:required(input?.adapterId,"adapterId"),version:required(input?.version,"adapter version"),
    implementationHash:digest(input?.implementationHash,"adapter implementationHash"),
    provider:required(input?.provider,"provider"),modelId:required(input?.modelId,"modelId")
  };
  return out;
}
function canonicalProfile(input:ModelExplanationProfile):ModelExplanationProfile{
  return {
    profileId:required(input?.profileId,"profileId"),version:required(input?.version,"profile version"),
    adapterId:required(input?.adapterId,"profile adapterId"),
    maxPromptBytes:positiveInteger(input?.maxPromptBytes,"maxPromptBytes"),
    maxResponseBytes:positiveInteger(input?.maxResponseBytes,"maxResponseBytes")
  };
}
function exactObject(value:unknown,keys:string[],label:string):Record<string,any>{
  if(!value||typeof value!=="object"||Array.isArray(value))throw new ModelExplanationError("MODEL_EXPLANATION_UPSTREAM_FAILED",`${label} must be an object`,502);
  const obj=value as Record<string,any>,allowed=new Set(keys);
  if(Object.keys(obj).some(k=>!allowed.has(k))||keys.some(k=>!(k in obj)))throw new ModelExplanationError("MODEL_EXPLANATION_UPSTREAM_FAILED",`${label} has an invalid shape`,502);
  return obj;
}
function contentFrom(body:string):{content:ModelExplanationContent;canonical:string}{
  let value:any;
  try{value=JSON.parse(required(body,"normalized explanation body"));}catch(error){
    if(error instanceof ModelExplanationError)throw error;
    throw new ModelExplanationError("MODEL_EXPLANATION_UPSTREAM_FAILED","Normalized explanation is not valid JSON",502);
  }
  const obj=exactObject(value,["summary","keyFactors","limitations"],"explanation content");
  if(typeof obj.summary!=="string"||!obj.summary.trim())throw new ModelExplanationError("MODEL_EXPLANATION_UPSTREAM_FAILED","explanation summary is required",502);
  const summary=obj.summary;
  byteLimit(summary,MAX_SUMMARY_BYTES,"explanation summary");
  const array=(raw:unknown,label:string):string[]=>{
    if(!Array.isArray(raw)||raw.length>MAX_EXPLANATION_ITEMS)throw new ModelExplanationError("MODEL_EXPLANATION_UPSTREAM_FAILED",`${label} has an invalid item count`,502);
    return raw.map((item,index)=>{
      if(typeof item!=="string"||!item.trim())throw new ModelExplanationError("MODEL_EXPLANATION_UPSTREAM_FAILED",`${label}[${index}] is required`,502);
      byteLimit(item,MAX_ITEM_BYTES,`${label}[${index}]`);return item;
    });
  };
  const content={summary,keyFactors:array(obj.keyFactors,"keyFactors"),limitations:array(obj.limitations,"limitations")};
  return {content,canonical:canonicalize(content as any)};
}
function sha(text:string):string{return sha256Hex(Buffer.from(text,"utf8"));}

export class ModelExplanationError extends Error{
  readonly code:string;readonly httpStatus:number;
  constructor(code:string,message:string,httpStatus:number){super(message);this.name="ModelExplanationError";this.code=code;this.httpStatus=httpStatus;}
}

export interface CapturedModelExplanationExchange {
  capturedAt:string;
  requestBody:string;
  responseBody:string;
  normalizedResponseBody:string;
}
export interface ModelExplanationAdapterInput {
  capturedAt:string;
  promptBody:string;
  maxResponseBytes:number;
}
export interface ModelExplanationAdapter {
  readonly manifest:ModelAdapterManifest;
  explain(input:ModelExplanationAdapterInput):Promise<CapturedModelExplanationExchange>;
}

export class ModelExplanationRegistry {
  private readonly profiles=new Map<string,{profile:ModelExplanationProfile;profileHash:string;tenantIds?:Set<string>}>();
  constructor(entries:{profile:ModelExplanationProfile;tenantIds?:string[]}[]){
    if(!Array.isArray(entries)||entries.length===0)throw new TypeError("At least one model explanation profile is required");
    for(const entry of entries){
      const profile=canonicalProfile(entry.profile);
      if(this.profiles.has(profile.profileId))throw new TypeError(`Duplicate model explanation profile: ${profile.profileId}`);
      const tenantIds=entry.tenantIds===undefined?undefined:new Set(entry.tenantIds.map(x=>required(x,"tenantId")));
      if(tenantIds&&tenantIds.size!==entry.tenantIds!.length)throw new TypeError("Duplicate model explanation tenant eligibility");
      this.profiles.set(profile.profileId,{profile,profileHash:hashJson(profile as any),tenantIds});
    }
  }
  resolve(scope:TenantScope,profileId:string):{profile:ModelExplanationProfile;profileHash:string}{
    const tenantId=required(scope?.tenantId,"tenantId"),id=required(profileId,"profileId");
    const found=this.profiles.get(id);
    if(!found)throw new ModelExplanationError("MODEL_EXPLANATION_PROFILE_FORBIDDEN","Model explanation profile is not available",403);
    if(found.tenantIds&&!found.tenantIds.has(tenantId))throw new ModelExplanationError("MODEL_EXPLANATION_PROFILE_FORBIDDEN","Model explanation profile is not eligible for tenant",403);
    return {profile:structuredClone(found.profile),profileHash:found.profileHash};
  }
}

function authorized(context:AuthorizedTenantContext,tenantId:string,executionId:string):void{
  const a=context?.authorization;
  if(!context?.principal?.principalId||!context?.tenant?.tenantId||!a||
    a.status!=="ALLOW"||a.principalId!==context.principal.principalId||
    context.tenant.tenantId!==tenantId||a.requestedTenantId!==tenantId||
    a.action!=="model:explain"||a.resource?.kind!=="execution"||a.resource.id!==executionId){
    throw new ModelExplanationError("MODEL_EXPLANATION_AUTHORIZATION","Exact model:explain authorization is required",403);
  }
}
function proofBody(record:any):string{
  return canonicalize({
    schemaVersion:"axiom.explanation-proof.v1",
    authority:"ADVISORY_ONLY",
    execution:{
      id:record.id,recordHash:record.recordHash,
      snapshotId:record.snapshotId,snapshotHash:record.snapshotHash,
      policyDecision:record.policyDecision,
      certificateId:record.certificate.certificateId,
      certificateIssuedAt:record.certificate.issuedAt,
      certificateCore:record.certificate.core,
      signerKeyId:record.signerKeyId
    }
  } as any);
}

export class ModelExplanationService {
  private readonly tenant:TenantScope;
  private readonly profiles:ModelExplanationRegistry;
  private readonly repository:ModelExplanationRepository;
  private readonly executions:ExecutionRepository;
  private readonly plane:{replayStored(id:string):Promise<{status:"MATCH"|"MISMATCH";diagnostics:string[]}>};
  private readonly adapters:Map<string,ModelExplanationAdapter>;
  private readonly now:()=>Date|string;

  constructor(deps:{
    tenant:TenantScope;profiles:ModelExplanationRegistry;repository:ModelExplanationRepository;
    executions:ExecutionRepository;plane:{replayStored(id:string):Promise<{status:"MATCH"|"MISMATCH";diagnostics:string[]}>};
    adapters:ModelExplanationAdapter[];now?:()=>Date|string;
  }){
    this.tenant={tenantId:required(deps.tenant?.tenantId,"tenantId")};
    this.profiles=deps.profiles;this.repository=deps.repository;this.executions=deps.executions;this.plane=deps.plane;this.now=deps.now??(()=>new Date());
    this.adapters=new Map();
    if(!Array.isArray(deps.adapters)||deps.adapters.length===0)throw new TypeError("At least one model explanation adapter is required");
    for(const adapter of deps.adapters){
      const manifest=cloneManifest(adapter?.manifest);
      if(typeof adapter?.explain!=="function")throw new TypeError("Model explanation adapter must implement explain");
      if(this.adapters.has(manifest.adapterId))throw new TypeError(`Duplicate model explanation adapter: ${manifest.adapterId}`);
      this.adapters.set(manifest.adapterId,adapter);
    }
  }

  async explain(context:AuthorizedTenantContext,executionIdInput:string,request:ModelExplainRequest,requestHashInput:string):Promise<ModelExplainResult>{
    const executionId=required(executionIdInput,"executionId");
    authorized(context,this.tenant.tenantId,executionId);
    const requestHash=digest(requestHashInput,"requestHash");
    if(!request||typeof request!=="object"||Array.isArray(request)||Object.keys(request).some(k=>k!=="profileId"))throw new TypeError("Model explain request must contain only profileId");
    const {profile,profileHash}=this.profiles.resolve(this.tenant,request.profileId);

    let execution:any;
    try{execution=await this.executions.get(this.tenant,executionId);}
    catch{throw new ModelExplanationError("MODEL_EXPLANATION_NOT_FOUND","Execution not found",404);}
    if(execution?.tenantId!==this.tenant.tenantId||execution?.id!==executionId)throw new ModelExplanationError("MODEL_EXPLANATION_NOT_FOUND","Execution not found",404);

    const replay=await this.plane.replayStored(executionId);
    if(replay.status!=="MATCH")throw new ModelExplanationError("MODEL_EXPLANATION_PROOF_REJECTED","Stored execution did not replay exactly",422);

    const promptBody=proofBody(execution);
    if(Buffer.byteLength(promptBody,"utf8")>profile.maxPromptBytes)throw new ModelExplanationError("MODEL_EXPLANATION_PROOF_REJECTED","Explanation proof prompt exceeds profile limit",422);
    const adapter=this.adapters.get(profile.adapterId);
    if(!adapter)throw new ModelExplanationError("MODEL_EXPLANATION_PROFILE_FORBIDDEN","Explanation profile adapter is unavailable",403);
    const adapterManifest=cloneManifest(adapter.manifest);
    if(adapterManifest.adapterId!==profile.adapterId)throw new ModelExplanationError("MODEL_EXPLANATION_PROFILE_FORBIDDEN","Explanation profile adapter mismatch",403);

    const capturedAt=canonicalNow(this.now());
    let captured:CapturedModelExplanationExchange;
    try{captured=await adapter.explain({capturedAt,promptBody,maxResponseBytes:profile.maxResponseBytes});}
    catch(error){throw error;}
    if(canonicalNow(captured?.capturedAt)!==capturedAt)throw new ModelExplanationError("MODEL_EXPLANATION_UPSTREAM_FAILED","Explanation adapter capture time mismatch",502);
    const requestBody=required(captured?.requestBody,"provider requestBody"),responseBody=required(captured?.responseBody,"provider responseBody");
    byteLimit(responseBody,profile.maxResponseBytes,"provider responseBody");
    const {content,canonical:normalizedResponseBody}=contentFrom(captured?.normalizedResponseBody);
    byteLimit(normalizedResponseBody,profile.maxResponseBytes,"normalized explanation body");

    const base={
      tenantId:this.tenant.tenantId,executionId,executionRecordHash:digest(execution.recordHash,"execution recordHash"),
      principalId:context.principal.principalId,authorizationDecisionHash:digest(context.authorization.decisionHash,"authorization decisionHash"),
      explanationRequestHash:requestHash,
      profileId:profile.profileId,profileVersion:profile.version,profileHash,
      adapterManifest,capturedAt,
      requestBody,requestBodyHash:sha(requestBody),
      responseBody,responseBodyHash:sha(responseBody),
      normalizedResponseBody,normalizedResponseBodyHash:sha(normalizedResponseBody),
      authority:"ADVISORY_ONLY" as const,content
    };
    const explanationId=`model-explanation:${hashJson(base as any)}`;
    const core={explanationId,...base};
    const record:ModelExplanationRecord={...core,recordHash:hashJson(core as any)};
    await this.repository.put(this.tenant,record);
    return {status:"CREATED",explanationId,authority:"ADVISORY_ONLY",content:structuredClone(content),provider:adapterManifest.provider,modelId:adapterManifest.modelId};
  }
}
