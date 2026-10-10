import { compilerManifest } from "../../phase1/src/compiler.ts";
import { hashJson } from "../../phase1/src/canonical.ts";
import type { OperationRegistry } from "../../phase1/src/registry.ts";
import type { ModelCompilationRepository } from "./repositories.ts";
import type {
  AuthorizedTenantContext, ControlPlaneResult, ExecutionRequest, ModelExecuteRequest,
  PreparedModelExecution, TenantScope
} from "./types.ts";
import {
  ModelCompilerRegistry, canonicalModelInputContracts, modelContractHash, modelContractsToExecution
} from "./model_compiler.ts";
import { verifyModelCompilationRecord } from "./model_store.ts";

const PLATFORM_CONTEXT_PREFIX="AXIOM_PLATFORM_CONTEXT_SHA256:";
const TIMING_KEYS=new Set(["asOf","issuedAt"]);

function required(value:unknown,label:string):string {
  if(typeof value!=="string"||!value.trim())throw new TypeError(`${label} is required`);
  return value;
}
function assertContext(context:AuthorizedTenantContext,compilationId:string,action:"model:execute"|"model:dispatch"):void {
  const tenantId=required(context?.tenant?.tenantId,"authorized tenantId");
  const principalId=required(context?.principal?.principalId,"authorized principalId");
  const id=required(compilationId,"compilationId");
  const auth=context?.authorization;
  if(
    auth?.status!=="ALLOW"||
    auth.principalId!==principalId||
    auth.requestedTenantId!==tenantId||
    auth.action!==action||
    auth.resource?.kind!=="model_compilation"||
    auth.resource.id!==id
  )throw new Error(`Authorized context does not permit exact ${action} compilation resource`);
}
function timing(input:ModelExecuteRequest):ModelExecuteRequest {
  if(!input||typeof input!=="object"||Array.isArray(input))throw new TypeError("model execute timing must be an object");
  for(const key of Object.keys(input as any))if(!TIMING_KEYS.has(key))throw new TypeError(`model execute timing contains forbidden or unknown field: ${key}`);
  const asOf=required(input.asOf,"asOf"),issuedAt=required(input.issuedAt,"issuedAt");
  if(!Number.isFinite(Date.parse(asOf)))throw new TypeError("asOf must be an ISO-8601 timestamp");
  if(!Number.isFinite(Date.parse(issuedAt)))throw new TypeError("issuedAt must be an ISO-8601 timestamp");
  return {asOf:new Date(Date.parse(asOf)).toISOString(),issuedAt:new Date(Date.parse(issuedAt)).toISOString()};
}
function same(a:unknown,b:unknown):boolean {return hashJson(a as any)===hashJson(b as any);}
function sortedKeys(value:Record<string,unknown>):string[]{return Object.keys(value).sort();}
function equalStrings(a:string[],b:string[]):boolean{return a.length===b.length&&a.every((x,i)=>x===b[i]);}
function checkedScope(scope:TenantScope):TenantScope {
  return {tenantId:required(scope?.tenantId,"tenantId")};
}

export class ModelExecutionError extends Error {
  readonly code:string;
  readonly httpStatus:number;
  constructor(code:string,message:string,httpStatus:number){
    super(message);this.name="ModelExecutionError";this.code=code;this.httpStatus=httpStatus;
  }
}

export interface ModelExecutionServiceOptions {
  repository:ModelCompilationRepository;
  profiles:ModelCompilerRegistry;
  registry:OperationRegistry;
  plane:{execute(request:ExecutionRequest):Promise<ControlPlaneResult>};
}

export class ModelExecutionService {
  private readonly repository:ModelCompilationRepository;
  private readonly profiles:ModelCompilerRegistry;
  private readonly registry:OperationRegistry;
  private readonly plane:{execute(request:ExecutionRequest):Promise<ControlPlaneResult>};

  constructor(options:ModelExecutionServiceOptions){
    if(!options?.repository||typeof options.repository.getCompilation!=="function")throw new TypeError("model compilation repository is required");
    if(!options?.profiles||typeof options.profiles.resolve!=="function")throw new TypeError("model compiler profile registry is required");
    if(!options?.registry||typeof options.registry.manifest!=="function")throw new TypeError("operation registry is required");
    if(!options?.plane||typeof options.plane.execute!=="function")throw new TypeError("reasoning control plane is required");
    this.repository=options.repository;this.profiles=options.profiles;this.registry=options.registry;this.plane=options.plane;
  }

  private async prepare(scopeInput:TenantScope,compilationId:string,timingInput:ModelExecuteRequest):Promise<PreparedModelExecution> {
    const scope=checkedScope(scopeInput),id=required(compilationId,"compilationId"),requestedTiming=timing(timingInput);
    const loaded=await this.repository.getCompilation(scope,id);
    const record=verifyModelCompilationRecord(scope,loaded);
    if(record.compilationId!==id)throw new Error("Stored model compilation ID integrity mismatch");
    if(record.status==="REJECTED"){
      throw new ModelExecutionError("COMPILATION_REJECTED","Model compilation is rejected and cannot execute",422);
    }
    let resolved;
    try{resolved=this.profiles.resolve(scope,record.profileId);}
    catch{
      throw new ModelExecutionError("COMPILATION_STALE","Model compilation profile is no longer available",409);
    }
    if(
      resolved.profileHash!==record.profileHash||
      resolved.profile.version!==record.profileVersion
    )throw new ModelExecutionError("COMPILATION_STALE","Model compilation profile identity has changed",409);

    if(!same(compilerManifest(),record.compilerManifest)){
      throw new ModelExecutionError("COMPILATION_STALE","Model compiler identity has changed",409);
    }
    const registryHash=hashJson(this.registry.manifest() as any);
    if(registryHash!==record.operationRegistryManifestHash){
      throw new ModelExecutionError("COMPILATION_STALE","Operation registry identity has changed",409);
    }

    if(!record.compiledProgram||!record.compiledProgramHash)throw new Error("Validated model compilation has no executable template");
    if(hashJson(record.compiledProgram as any)!==record.compiledProgramHash)throw new Error("Stored model compilation program integrity mismatch");
    if(record.compiledProgram.objective!==record.objective)throw new Error("Stored model compilation objective integrity mismatch");
    if(record.compiledProgram.assumptions.some(x=>x.startsWith(PLATFORM_CONTEXT_PREFIX))){
      throw new Error("Stored model compilation contains reserved platform context");
    }

    const contracts=canonicalModelInputContracts(record.inputContracts,resolved.profile);
    if(!same(contracts,record.inputContracts))throw new Error("Stored model input contract canonical integrity mismatch");
    const contractNames=contracts.map(x=>x.inputName).sort(),inputNames=sortedKeys(record.compiledProgram.inputs);
    if(!equalStrings(contractNames,inputNames))throw new Error("Stored model template input set does not match input contracts");
    for(const contract of contracts){
      const input=record.compiledProgram.inputs[contract.inputName];
      if(!input)throw new Error(`Stored model template input missing: ${contract.inputName}`);
      if(!same(input.type,contract.type))throw new Error(`Stored model template input type does not match contract: ${contract.inputName}`);
      const expectedSource=`model-compile-contract:${modelContractHash(contract)}:${contract.inputName}`;
      if(input.provenance?.source!==expectedSource||input.provenance?.contentHash!==hashJson(input.value as any)||input.provenance?.observedAt!==undefined){
        throw new Error(`Stored model template placeholder integrity mismatch: ${contract.inputName}`);
      }
    }

    const derived=modelContractsToExecution(contracts);
    return {
      compilationId:id,
      compilationRecordHash:record.recordHash,
      profileId:record.profileId,
      profileVersion:record.profileVersion,
      profileHash:record.profileHash,
      compilerManifest:structuredClone(record.compilerManifest),
      operationRegistryManifestHash:record.operationRegistryManifestHash,
      executionRequest:{
        asOf:requestedTiming.asOf,
        issuedAt:requestedTiming.issuedAt,
        program:structuredClone(record.compiledProgram),
        requirements:derived.requirements,
        bindings:derived.bindings
      }
    };
  }

  async execute(context:AuthorizedTenantContext,compilationId:string,timingInput:ModelExecuteRequest):Promise<ControlPlaneResult> {
    assertContext(context,compilationId,"model:execute");
    const prepared=await this.prepare(context.tenant,compilationId,timingInput);
    return this.plane.execute(prepared.executionRequest);
  }

  async prepareDispatch(
    context:AuthorizedTenantContext,compilationId:string,timingInput:ModelExecuteRequest
  ):Promise<PreparedModelExecution> {
    assertContext(context,compilationId,"model:dispatch");
    return this.prepare(context.tenant,compilationId,timingInput);
  }

  async validatePrepared(scope:TenantScope,prepared:PreparedModelExecution):Promise<PreparedModelExecution> {
    checkedScope(scope);
    if(!prepared||typeof prepared!=="object")throw new TypeError("prepared model execution is required");
    const id=required(prepared.compilationId,"prepared compilationId");
    if(!prepared.executionRequest||typeof prepared.executionRequest!=="object")throw new TypeError("prepared execution request is required");
    const current=await this.prepare(scope,id,{
      asOf:prepared.executionRequest.asOf,
      issuedAt:prepared.executionRequest.issuedAt
    });
    if(hashJson(current as any)!==hashJson(prepared as any)){
      throw new Error("Prepared model execution integrity mismatch");
    }
    return current;
  }
}
