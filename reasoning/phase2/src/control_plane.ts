import { hashJson } from "../../phase1/src/canonical.ts";
import { compileProgram } from "../../phase1/src/compiler.ts";
import { replayCertificate } from "../../phase1/src/replay.ts";
import { AxiomRuntime } from "../../phase1/src/runtime.ts";
import type { OperationRegistry } from "../../phase1/src/registry.ts";
import type { AxiomProgram, JsonValue, TypeRef } from "../../phase1/src/types.ts";
import { evaluateEvidencePolicy, evidencePolicyManifest, selectEvidenceFact } from "./policy.ts";
import type { ExecutionRepository, WorldStateRepository } from "./repositories.ts";
import type {
  AppliedBinding, ControlPlaneResult, EvidenceRequirement, ExecutionRequest,
  PlatformExecutionRecord, PolicyDecision, PolicyManifest, ReplayResult, TenantScope, WorldSnapshot
} from "./types.ts";
import { signerPublicKeySha256, signingIntentIdForCertificate, type SignerIdentity, type SignerProvider } from "./signer.ts";

const PLATFORM_CONTEXT_PREFIX="AXIOM_PLATFORM_CONTEXT_SHA256:";

function json(value:unknown):JsonValue{return value as JsonValue;}
function typeHash(type:TypeRef):string{return hashJson(type as any);}
function checkedTenant(scope:TenantScope):TenantScope {
  if(!scope?.tenantId?.trim())throw new TypeError("tenantId is required");
  return {tenantId:scope.tenantId};
}
function required(value:string,label:string):string {
  if(typeof value!=="string"||!value.trim())throw new TypeError(`${label} is required`);
  return value;
}
function canonicalTime(value:string,label:string):string {
  const ms=Date.parse(value);
  if(!Number.isFinite(ms))throw new TypeError(`${label} must be an ISO-8601 timestamp`);
  return new Date(ms).toISOString();
}
function assertUnique(values:string[],label:string):void {
  const seen=new Set<string>();
  for(const value of values){if(seen.has(value))throw new Error(`Duplicate ${label}: ${value}`);seen.add(value);}
}
function canonicalIssuedAt(issuedAt:string,snapshotAsOf:string):string {
  const normalized=canonicalTime(issuedAt,"issuedAt");
  const issuedMs=Date.parse(normalized),snapshotMs=Date.parse(snapshotAsOf);
  if(issuedMs<snapshotMs)throw new RangeError("issuedAt cannot be before the world-state snapshot asOf time");
  return normalized;
}
function legacyPlatformContext(
  tenant:TenantScope,snapshot:WorldSnapshot,policyDecision:PolicyDecision,policyManifest:PolicyManifest,
  requirements:EvidenceRequirement[],bindings:AppliedBinding[],executionIntentId?:string,executionRequestHash?:string
){
  const core={tenantId:tenant.tenantId,snapshotId:snapshot.snapshotId,snapshotHash:snapshot.snapshotHash,policyDecision,policyManifest,requirements,bindings};
  return executionIntentId?{...core,executionIntentId,executionRequestHash}:core;
}
function legacyContextHash(
  tenant:TenantScope,snapshot:WorldSnapshot,policyDecision:PolicyDecision,policyManifest:PolicyManifest,
  requirements:EvidenceRequirement[],bindings:AppliedBinding[],executionIntentId?:string,executionRequestHash?:string
):string {
  return hashJson(json(legacyPlatformContext(tenant,snapshot,policyDecision,policyManifest,requirements,bindings,executionIntentId,executionRequestHash)));
}
function platformContextV2(
  tenant:TenantScope,snapshot:WorldSnapshot,policyDecision:PolicyDecision,policyManifest:PolicyManifest,
  requirements:EvidenceRequirement[],bindings:AppliedBinding[],signerIdentity:SignerIdentity,
  executionIntentId?:string,executionRequestHash?:string
){
  const core={
    platformContextVersion:"2",tenantId:tenant.tenantId,snapshotId:snapshot.snapshotId,snapshotHash:snapshot.snapshotHash,
    policyDecision,policyManifest,requirements,bindings,signerIdentity
  };
  return executionIntentId?{...core,executionIntentId,executionRequestHash}:core;
}
function contextHashV2(
  tenant:TenantScope,snapshot:WorldSnapshot,policyDecision:PolicyDecision,policyManifest:PolicyManifest,
  requirements:EvidenceRequirement[],bindings:AppliedBinding[],signerIdentity:SignerIdentity,
  executionIntentId?:string,executionRequestHash?:string
):string {
  return hashJson(json(platformContextV2(
    tenant,snapshot,policyDecision,policyManifest,requirements,bindings,signerIdentity,executionIntentId,executionRequestHash
  )));
}
function validatedSignerIdentity(provider:SignerProvider):{identity:SignerIdentity;trustedKey:string} {
  const raw=provider?.identity as any;
  if(!raw||raw.protocolVersion!=="axiom.signer/v1"||raw.algorithm!=="Ed25519"||(raw.mode!=="LOCAL"&&raw.mode!=="EXTERNAL")){
    throw new Error("Signer identity is invalid");
  }
  if(typeof raw.providerId!=="string"||!raw.providerId.trim()||typeof raw.keyId!=="string"||!raw.keyId.trim()){
    throw new Error("Signer identity is incomplete");
  }
  if(!/^[0-9a-f]{64}$/.test(String(raw.publicKeySha256??"")))throw new Error("Signer identity public key hash is invalid");
  if(provider.keyId!==raw.keyId)throw new Error("Signer identity keyId does not match active signer key");
  const trustedKey=provider.trustedPublicKeyPem(raw.keyId);
  if(!trustedKey)throw new Error(`Signer provider has no trusted public key for active key ${raw.keyId}`);
  if(signerPublicKeySha256(trustedKey)!==raw.publicKeySha256){
    throw new Error("Signer identity does not match trusted public key");
  }
  return {identity:structuredClone(raw) as SignerIdentity,trustedKey};
}

function resultFromRecord(record:PlatformExecutionRecord):ControlPlaneResult {
  const status=(record.certificate.core as any).decisionStatus;
  if(status!=="APPROVED"&&status!=="DENIED")throw new Error("Stored execution decision status is invalid");
  return {
    status,snapshotId:record.snapshotId,policyDecision:structuredClone(record.policyDecision),
    certificateId:record.certificate.certificateId,executionRecordId:record.id
  };
}

export class ReasoningControlPlane {
  private readonly tenant:TenantScope;
  private readonly world:WorldStateRepository;
  private readonly executions:ExecutionRepository;
  private readonly signer:SignerProvider;
  private readonly registry:OperationRegistry;

  constructor(deps:{tenant:TenantScope;world:WorldStateRepository;executions:ExecutionRepository;signer:SignerProvider;registry:OperationRegistry}){
    this.tenant=checkedTenant(deps.tenant);
    this.world=deps.world;this.executions=deps.executions;this.signer=deps.signer;this.registry=deps.registry;
  }

  private assertBoundExisting(record:PlatformExecutionRecord,request:ExecutionRequest,snapshotId:string,executionIntentId:string):void {
    const requestHash=hashJson(json(request));
    if(
      record.executionIntentId!==executionIntentId||
      record.executionRequestHash!==requestHash||
      record.snapshotId!==snapshotId
    )throw new Error("Execution intent request or snapshot mismatch");
  }

  private async replayRecord(record:PlatformExecutionRecord):Promise<ReplayResult> {
    const diagnostics:string[]=[];
    let snapshot:WorldSnapshot;
    try{
      snapshot=await this.world.getSnapshot(this.tenant,record.snapshotId);
    }catch(err){
      return {status:"MISMATCH",diagnostics:[err instanceof Error?err.message:String(err)]};
    }
    if(record.tenantId!==this.tenant.tenantId)diagnostics.push("execution tenant mismatch");
    if(snapshot.tenantId!==this.tenant.tenantId)diagnostics.push("snapshot tenant mismatch");
    if(snapshot.snapshotHash!==record.snapshotHash)diagnostics.push("snapshot hash mismatch");
    if(record.policyDecision.snapshotId!==snapshot.snapshotId)diagnostics.push("policy snapshot mismatch");

    const currentPolicyManifest=evidencePolicyManifest();
    if(hashJson(json(record.policyManifest))!==hashJson(json(currentPolicyManifest)))diagnostics.push("policy implementation mismatch");
    const recomputedPolicy=evaluateEvidencePolicy(snapshot,record.requirements);
    if(hashJson(json(recomputedPolicy))!==hashJson(json(record.policyDecision)))diagnostics.push("policy replay mismatch");

    let expectedContextHash:string;
    if(record.platformContextVersion==="2"){
      if(!record.signerIdentity)diagnostics.push("signer identity missing");
      if(!record.signingIntentId)diagnostics.push("signing intent missing");
      if(record.signerIdentity){
        if(record.signerKeyId!==record.signerIdentity.keyId)diagnostics.push("signer key identity mismatch");
        const trustedIdentityKey=this.signer.trustedPublicKeyPem(record.signerIdentity.keyId);
        if(!trustedIdentityKey)diagnostics.push(`unknown signer key: ${record.signerIdentity.keyId}`);
        else if(signerPublicKeySha256(trustedIdentityKey)!==record.signerIdentity.publicKeySha256)diagnostics.push("signer identity public key hash mismatch");
        if(record.signingIntentId&&signingIntentIdForCertificate(record.certificate,record.signerIdentity)!==record.signingIntentId){
          diagnostics.push("signing intent mismatch");
        }
        expectedContextHash=contextHashV2(
          this.tenant,snapshot,record.policyDecision,record.policyManifest,record.requirements,record.bindings,
          record.signerIdentity,record.executionIntentId,record.executionRequestHash
        );
      }else{
        expectedContextHash=record.platformContextHash;
      }
    }else{
      expectedContextHash=legacyContextHash(
        this.tenant,snapshot,record.policyDecision,record.policyManifest,record.requirements,record.bindings,
        record.executionIntentId,record.executionRequestHash
      );
    }
    if(record.platformContextHash!==expectedContextHash)diagnostics.push("platform context hash mismatch");
    const contextAssumptions=record.certificate.replay.program.assumptions.filter(a=>a.startsWith(PLATFORM_CONTEXT_PREFIX));
    if(contextAssumptions.length!==1||contextAssumptions[0]!==`${PLATFORM_CONTEXT_PREFIX}${expectedContextHash}`)diagnostics.push("platform context certificate binding mismatch");

    const replayProgram=record.certificate.replay.program;
    for(const binding of record.bindings){
      const fact=snapshot.facts.find(f=>f.id===binding.factId);
      if(!fact){diagnostics.push(`binding fact missing: ${binding.factId}`);continue;}
      const input=replayProgram.inputs[binding.inputName];
      if(!input){diagnostics.push(`bound input missing: ${binding.inputName}`);continue;}
      const expectedSource=`world-state:${this.tenant.tenantId}:${fact.source}:${fact.id}`;
      if(input.provenance?.source!==expectedSource||input.provenance?.observedAt!==fact.observedAt||input.provenance?.contentHash!==hashJson(fact.value.value))diagnostics.push(`binding provenance mismatch: ${binding.inputName}`);
      if(hashJson(json({type:input.type,value:input.value}))!==hashJson(json({type:fact.value.type,value:fact.value.value})))diagnostics.push(`binding value mismatch: ${binding.inputName}`);
    }

    const trustedKey=this.signer.trustedPublicKeyPem(record.signerKeyId);
    if(!trustedKey)diagnostics.push(`unknown signer key: ${record.signerKeyId}`);
    const phase1=replayCertificate(record.certificate,this.registry,undefined,trustedKey);
    diagnostics.push(...phase1.diagnostics);
    return {status:diagnostics.length?"MISMATCH":"MATCH",diagnostics};
  }

  private async recoverBoundExisting(
    record:PlatformExecutionRecord,request:ExecutionRequest,snapshotId:string,executionIntentId:string
  ):Promise<ControlPlaneResult> {
    this.assertBoundExisting(record,request,snapshotId,executionIntentId);
    const replay=await this.replayRecord(record);
    if(replay.status!=="MATCH"){
      throw new Error(`Existing execution intent proof mismatch: ${replay.diagnostics.join("; ")}`);
    }
    return resultFromRecord(record);
  }

  private async executeWithSnapshot(request:ExecutionRequest,snapshot:WorldSnapshot,executionIntentId?:string):Promise<ControlPlaneResult> {
    assertUnique(request.requirements.map(r=>r.id),"evidence requirement id");
    assertUnique(request.bindings.map(b=>b.inputName),"binding input name");
    if(snapshot.tenantId!==this.tenant.tenantId)throw new Error("World repository returned cross-tenant snapshot");
    if(snapshot.asOf!==canonicalTime(request.asOf,"asOf"))throw new Error("Bound world snapshot asOf does not match execution request");
    const issuedAt=canonicalIssuedAt(request.issuedAt,snapshot.asOf);
    const requirements=[...request.requirements].sort((a,b)=>a.id.localeCompare(b.id));
    const policyManifest=evidencePolicyManifest();
    const policyDecision=evaluateEvidencePolicy(snapshot,requirements);
    if(policyDecision.status==="DENY")return {status:"DENIED",snapshotId:snapshot.snapshotId,policyDecision};

    const program=structuredClone(request.program) as AxiomProgram;
    if(program.assumptions.some(a=>a.startsWith(PLATFORM_CONTEXT_PREFIX)))throw new Error("Program uses reserved AXIOM platform-context assumption namespace");

    const applied:AppliedBinding[]=[];
    for(const binding of [...request.bindings].sort((a,b)=>a.inputName.localeCompare(b.inputName))){
      const matchingRequirements=requirements.filter(r=>r.entity===binding.entity&&r.attribute===binding.attribute);
      if(matchingRequirements.length===0)throw new Error(`Binding ${binding.inputName} has no evidence requirement`);
      const target=program.inputs[binding.inputName];
      if(!target)throw new Error(`Program input not found: ${binding.inputName}`);
      const fact=selectEvidenceFact(snapshot,binding.entity,binding.attribute);
      if(typeHash(target.type)!==typeHash(fact.value.type))throw new Error(`Binding type mismatch for ${binding.inputName}`);
      program.inputs[binding.inputName]={
        type:structuredClone(fact.value.type),value:structuredClone(fact.value.value),
        provenance:{source:`world-state:${this.tenant.tenantId}:${fact.source}:${fact.id}`,observedAt:fact.observedAt,contentHash:hashJson(fact.value.value)}
      };
      applied.push({...binding,factId:fact.id});
    }

    const executionRequestHash=executionIntentId?hashJson(json(request)):undefined;
    const signerBoundary=validatedSignerIdentity(this.signer);
    const signerIdentity=signerBoundary.identity;
    const platformContextHash=contextHashV2(
      this.tenant,snapshot,policyDecision,policyManifest,requirements,applied,signerIdentity,executionIntentId,executionRequestHash
    );
    program.assumptions=[...program.assumptions,`${PLATFORM_CONTEXT_PREFIX}${platformContextHash}`];

    const compiled=compileProgram(program,this.registry);
    const execution=new AxiomRuntime(this.registry).execute(compiled);
    const signingIntentId=this.signer.signingIntentId(compiled,execution,issuedAt);
    const certificate=await this.signer.issue(compiled,execution,issuedAt);
    if(signingIntentIdForCertificate(certificate,signerIdentity)!==signingIntentId){
      throw new Error("Signer signing intent is inconsistent with the issued certificate and declared identity");
    }
    const activeTrustedKey=signerBoundary.trustedKey;
    const signerVerification=replayCertificate(certificate,this.registry,compiled,activeTrustedKey);
    if(signerVerification.status!=="MATCH")throw new Error(`Signer provider issued invalid certificate: ${signerVerification.diagnostics.join("; ")}`);

    const core={
      id:`platform:${certificate.certificateId}`,tenantId:this.tenant.tenantId,
      snapshotId:snapshot.snapshotId,snapshotHash:snapshot.snapshotHash,policyDecision,policyManifest,
      requirements,bindings:applied,platformContextHash,certificate,signerKeyId:signerIdentity.keyId,
      platformContextVersion:"2" as const,signerIdentity,signingIntentId,
      ...(executionIntentId?{executionIntentId,executionRequestHash}: {})
    };
    const record:PlatformExecutionRecord={...core,recordHash:hashJson(json(core))};
    if(!executionIntentId){
      await this.executions.put(this.tenant,record);
      return resultFromRecord(record);
    }
    try{
      const persisted=await this.executions.putForIntent(this.tenant,executionIntentId,record);
      this.assertBoundExisting(persisted,request,snapshot.snapshotId,executionIntentId);
      return resultFromRecord(persisted);
    }catch(error){
      const existing=await this.executions.getByIntent(this.tenant,executionIntentId);
      if(existing)return this.recoverBoundExisting(existing,request,snapshot.snapshotId,executionIntentId);
      throw error;
    }
  }

  async execute(request:ExecutionRequest):Promise<ControlPlaneResult> {
    const snapshot=await this.world.snapshot(this.tenant,request.asOf);
    return this.executeWithSnapshot(request,snapshot);
  }

  async executeBound(request:ExecutionRequest,snapshotId:string,executionIntentId:string):Promise<ControlPlaneResult> {
    required(snapshotId,"snapshotId");required(executionIntentId,"executionIntentId");
    const existing=await this.executions.getByIntent(this.tenant,executionIntentId);
    if(existing)return this.recoverBoundExisting(existing,request,snapshotId,executionIntentId);
    const snapshot=await this.world.getSnapshot(this.tenant,snapshotId);
    return this.executeWithSnapshot(request,snapshot,executionIntentId);
  }

  async replayStored(recordId:string):Promise<ReplayResult> {
    let record:PlatformExecutionRecord;
    try{
      record=await this.executions.get(this.tenant,recordId);
    }catch(err){
      return {status:"MISMATCH",diagnostics:[err instanceof Error?err.message:String(err)]};
    }
    return this.replayRecord(record);
  }
}
