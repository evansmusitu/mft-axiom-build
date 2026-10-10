import { compilerManifest, compileProgram, ProgramValidationError } from "../../phase1/src/compiler.ts";
import { hashJson } from "../../phase1/src/canonical.ts";
import type { OperationRegistry } from "../../phase1/src/registry.ts";
import type { AxiomProgram } from "../../phase1/src/types.ts";
import type { ModelCompilationRepository } from "./repositories.ts";
import type {
  AuthorizedTenantContext, ModelCompilationIssue, ModelCompilationRecord, ModelCompileRequest,
  ModelCompileResult, ModelCompilerProfile, ModelExchangeArtifact, ModelInputContract
} from "./types.ts";
import type { ModelAdapter } from "./model_adapter.ts";
import { createModelExchangeArtifact } from "./model_adapter.ts";
import {
  ModelCompilerRegistry, assembleModelProgram, canonicalModelInputContracts, parseModelProposal
} from "./model_compiler.ts";

const HEX64=/^[0-9a-f]{64}$/;
const REQUEST_KEYS=new Set(["profileId","objective","inputContracts"]);

function required(value:unknown,label:string):string {
  if(typeof value!=="string"||!value.trim())throw new TypeError(`${label} is required`);
  return value;
}
function digest(value:unknown,label:string):string {
  const text=required(value,label);
  if(!HEX64.test(text))throw new TypeError(`${label} must be a lowercase SHA-256 hex digest`);
  return text;
}
function assertCompileContext(context:AuthorizedTenantContext):void {
  const tenantId=required(context?.tenant?.tenantId,"authorized tenantId");
  const principalId=required(context?.principal?.principalId,"authorized principalId");
  const auth=context?.authorization;
  if(
    auth?.status!=="ALLOW"||
    auth.principalId!==principalId||
    auth.requestedTenantId!==tenantId||
    auth.action!=="model:compile"||
    auth.resource?.kind!=="model_compilation"||
    auth.resource.id!==undefined
  )throw new Error("Authorized context does not permit exact model:compile action");
}
function canonicalRequest(request:ModelCompileRequest,profile:ModelCompilerProfile):ModelCompileRequest {
  if(!request||typeof request!=="object"||Array.isArray(request))throw new TypeError("model compile request must be an object");
  for(const key of Object.keys(request as any))if(!REQUEST_KEYS.has(key))throw new TypeError(`model compile request contains forbidden or unknown field: ${key}`);
  const profileId=required(request.profileId,"profileId");
  if(profileId!==profile.profileId)throw new Error("Compile request profileId does not match resolved profile");
  const objective=required(request.objective,"objective");
  if(Buffer.byteLength(objective,"utf8")>profile.maxObjectiveBytes)throw new RangeError("objective exceeds profile byte limit");
  return {profileId,objective,inputContracts:canonicalModelInputContracts(request.inputContracts,profile)};
}
function issue(code:string,message:string,nodeId?:string):ModelCompilationIssue {
  const out:ModelCompilationIssue={code,message};
  if(nodeId!==undefined)out.nodeId=nodeId;
  return out;
}
function issueSort(a:ModelCompilationIssue,b:ModelCompilationIssue):number {
  return (a.nodeId??"").localeCompare(b.nodeId??"")||a.code.localeCompare(b.code)||a.message.localeCompare(b.message);
}
export function normalizeModelCompilationIssues(error:unknown):ModelCompilationIssue[] {
  let issues:ModelCompilationIssue[];
  if(error instanceof ProgramValidationError){
    issues=error.issues.map(x=>issue(required(x.code,"issue code"),required(x.message,"issue message"),x.nodeId));
  }else{
    const message=error instanceof Error?error.message:String(error);
    let code="MODEL_PROPOSAL_INVALID";
    if(error instanceof RangeError)code="MODEL_PROPOSAL_LIMIT";
    else if(error instanceof TypeError)code="MODEL_PROPOSAL_SCHEMA";
    else if(/not allowed.*compiler profile|operation.*not allowed/i.test(message))code="MODEL_OPERATION_NOT_ALLOWED";
    else if(/reserved.*context|platform-context/i.test(message))code="MODEL_RESERVED_CONTEXT";
    else if(/undeclared input/i.test(message))code="MODEL_UNDECLARED_INPUT";
    issues=[issue(code,required(message||"Invalid model proposal","issue message"))];
  }
  return issues.sort(issueSort);
}
function gatewayProposal(responseBody:string):unknown {
  let parsed:any;
  try{parsed=JSON.parse(responseBody);}catch{throw new TypeError("model gateway response is not valid JSON");}
  if(!parsed||typeof parsed!=="object"||Array.isArray(parsed)||Object.keys(parsed).length!==1||!("proposal" in parsed)){
    throw new TypeError("model gateway response must contain exactly one proposal field");
  }
  return parsed.proposal;
}
function registrySubset(registry:OperationRegistry,profile:ModelCompilerProfile){
  const allowed=new Set(profile.allowedOperationIds);
  const selected=registry.manifest().filter(x=>allowed.has(x.id));
  if(selected.length!==allowed.size)throw new Error("Compiler profile operation registry identity is incomplete");
  return selected;
}
function adapterIdentity(adapter:ModelAdapter,profile:ModelCompilerProfile):void {
  const m=adapter?.manifest;
  if(!m||m.adapterId!==profile.adapterId)throw new Error("Resolved compiler profile does not match model adapter");
  required(m.version,"model adapter version");digest(m.implementationHash,"model adapter implementationHash");
  required(m.provider,"model adapter provider");required(m.modelId,"model adapter modelId");
}
function terminalCompilationId(input:{
  tenantId:string;principalId:string;compilationRequestHash:string;profileHash:string;
  adapterManifest:ModelAdapter["manifest"];compilerManifest:ReturnType<typeof compilerManifest>;
  operationRegistryManifestHash:string;exchangeArtifactHashes:string[];status:"VALIDATED"|"REJECTED";
  compiledProgramHash?:string;finalIssues:ModelCompilationIssue[];
}):string {
  const terminal=input.status==="VALIDATED"
    ? {compiledProgramHash:digest(input.compiledProgramHash,"compiledProgramHash")}
    : {finalIssuesHash:hashJson(input.finalIssues as any)};
  const commitment={
    tenantId:input.tenantId,principalId:input.principalId,compilationRequestHash:input.compilationRequestHash,
    profileHash:input.profileHash,
    adapterManifest:{
      adapterId:input.adapterManifest.adapterId,version:input.adapterManifest.version,
      implementationHash:input.adapterManifest.implementationHash,provider:input.adapterManifest.provider,modelId:input.adapterManifest.modelId
    },
    compilerManifest:input.compilerManifest,
    operationRegistryManifestHash:input.operationRegistryManifestHash,
    exchangeArtifactHashes:input.exchangeArtifactHashes,
    status:input.status,
    terminal
  };
  return `model-compilation:${hashJson(commitment as any)}`;
}

export interface ModelCompilationServiceOptions {
  profiles:ModelCompilerRegistry;
  repository:ModelCompilationRepository;
  registry:OperationRegistry;
  adapter:ModelAdapter;
  now?:()=>string;
}

export class ModelCompilationService {
  private readonly profiles:ModelCompilerRegistry;
  private readonly repository:ModelCompilationRepository;
  private readonly registry:OperationRegistry;
  private readonly adapter:ModelAdapter;
  private readonly now:()=>string;

  constructor(options:ModelCompilationServiceOptions){
    if(!options?.profiles||typeof options.profiles.resolve!=="function")throw new TypeError("model compiler profile registry is required");
    if(!options?.repository||typeof options.repository.commitCompilation!=="function")throw new TypeError("model compilation repository is required");
    if(!options?.registry||typeof options.registry.manifest!=="function")throw new TypeError("operation registry is required");
    if(!options?.adapter||typeof options.adapter.invoke!=="function")throw new TypeError("model adapter is required");
    this.profiles=options.profiles;this.repository=options.repository;this.registry=options.registry;this.adapter=options.adapter;
    this.now=options.now??(()=>new Date().toISOString());
  }

  async compile(
    context:AuthorizedTenantContext,
    requestInput:ModelCompileRequest,
    compilationRequestHashInput:string
  ):Promise<ModelCompileResult> {
    assertCompileContext(context);
    const compilationRequestHash=digest(compilationRequestHashInput,"compilationRequestHash");
    const resolved=this.profiles.resolve(context.tenant,required(requestInput?.profileId,"profileId"));
    const {profile,profileHash}=resolved;
    adapterIdentity(this.adapter,profile);
    const request=canonicalRequest(requestInput,profile);
    const fullRegistryManifest=this.registry.manifest();
    const operationRegistryManifestHash=hashJson(fullRegistryManifest as any);
    const operationRegistryManifest=registrySubset(this.registry,profile);
    const compiler=compilerManifest();
    const artifacts:ModelExchangeArtifact[]=[];
    let previousResponseBody:string|undefined;
    let issues:ModelCompilationIssue[]=[];
    let compiledProgram:AxiomProgram|undefined;

    for(let attempt=0;attempt<=profile.maxRepairAttempts;attempt++){
      const mode=attempt===0?"INITIAL" as const:"REPAIR" as const;
      const capturedAt=required(this.now(),"model capture time");
      const captured=await this.adapter.invoke({
        tenant:context.tenant,profile,profileHash,compilationRequestHash,attempt,mode,
        objective:request.objective,inputContracts:request.inputContracts,
        operationRegistryManifest,remainingRepairAttempts:profile.maxRepairAttempts-attempt,
        capturedAt,
        ...(mode==="REPAIR"?{previousResponseBody:required(previousResponseBody,"previousResponseBody"),issues:structuredClone(issues)}:{})
      });
      const artifact=createModelExchangeArtifact({
        tenantId:context.tenant.tenantId,manifest:this.adapter.manifest,profileId:profile.profileId,profileHash,
        compilationRequestHash,attempt,mode,captured
      });
      artifacts.push(artifact);
      const normalizedResponseBody=captured.normalizedResponseBody??captured.responseBody;
      previousResponseBody=normalizedResponseBody;

      try{
        const proposal=parseModelProposal(gatewayProposal(normalizedResponseBody),profile);
        const assembled=assembleModelProgram(request,proposal,profile);
        compiledProgram=compileProgram(assembled,this.registry);
        issues=[];
        break;
      }catch(error){
        issues=normalizeModelCompilationIssues(error);
        compiledProgram=undefined;
      }
    }

    const status=compiledProgram?"VALIDATED" as const:"REJECTED" as const;
    const compiledProgramHash=compiledProgram?hashJson(compiledProgram as any):undefined;
    const exchangeArtifactIds=artifacts.map(x=>x.artifactId);
    const exchangeArtifactHashes=artifacts.map(x=>x.artifactHash);
    const finalIssues=status==="REJECTED"?structuredClone(issues):[];
    const compilationId=terminalCompilationId({
      tenantId:context.tenant.tenantId,principalId:context.principal.principalId,compilationRequestHash,profileHash,
      adapterManifest:this.adapter.manifest,compilerManifest:compiler,operationRegistryManifestHash,
      exchangeArtifactHashes,status,compiledProgramHash,finalIssues
    });
    const core:any={
      compilationId,tenantId:context.tenant.tenantId,principalId:context.principal.principalId,
      authorizationDecisionHash:digest(context.authorization.decisionHash,"authorizationDecisionHash"),
      compilationRequestHash,profileId:profile.profileId,profileVersion:profile.version,profileHash,
      adapterManifest:structuredClone(this.adapter.manifest),compilerManifest:compiler,operationRegistryManifestHash,
      objective:request.objective,inputContracts:structuredClone(request.inputContracts),
      exchangeArtifactIds,exchangeArtifactHashes,finalIssues,status,
      ...(compiledProgram?{compiledProgram,compiledProgramHash}:{}),
      createdAt:artifacts[artifacts.length-1].capturedAt
    };
    const record:ModelCompilationRecord={...core,recordHash:hashJson(core)};
    await this.repository.commitCompilation(context.tenant,artifacts,record);
    if(status==="VALIDATED"){
      return {status,compilationId,compiledProgramHash:compiledProgramHash!,attemptCount:artifacts.length};
    }
    return {status,compilationId,issues:finalIssues,attemptCount:artifacts.length};
  }
}
