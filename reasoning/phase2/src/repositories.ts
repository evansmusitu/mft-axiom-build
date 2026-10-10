import type {
  AcquisitionRecord, AuditEvent, AuditRecord, AuditVerificationResult, AuthorizationGrant, EvidenceArtifact,
  IdempotencyClaimInput, IdempotencyClaimResult, IdempotencyCompleteInput, PlatformExecutionRecord,
  StoredApiOutcome, TemporalFact, TenantScope, WorldSnapshot, ModelCompilationRecord, ModelExchangeArtifact, ModelExplanationRecord,
  DistributedExecutionIntentCore, DistributedExecutionJob, DistributedExecutionLease, ControlPlaneResult
} from "./types.ts";

export interface IngestionReplayClaim {
  keyId:string;
  nonce:string;
  issuedAt:string;
}
export interface VerifiedFactCommit {
  fact:TemporalFact;
  claim:IngestionReplayClaim;
}

export interface WorldStateRepository {
  putFact(scope:TenantScope,fact:TemporalFact):Promise<void>;
  putAuthenticatedFact(scope:TenantScope,fact:TemporalFact,claim:IngestionReplayClaim):Promise<boolean>;
  snapshot(scope:TenantScope,asOf:string):Promise<WorldSnapshot>;
  getSnapshot(scope:TenantScope,snapshotId:string):Promise<WorldSnapshot>;
}
export interface EvidenceRepository {
  commitAcquisition(scope:TenantScope,artifact:EvidenceArtifact,record:AcquisitionRecord,facts:VerifiedFactCommit[]):Promise<void>;
  getEvidenceArtifact(scope:TenantScope,artifactId:string):Promise<EvidenceArtifact>;
  getAcquisition(scope:TenantScope,acquisitionId:string):Promise<AcquisitionRecord>;
}

export interface ExecutionRepository {
  put(scope:TenantScope,record:PlatformExecutionRecord):Promise<void>;
  get(scope:TenantScope,id:string):Promise<PlatformExecutionRecord>;
  getByIntent(scope:TenantScope,executionIntentId:string):Promise<PlatformExecutionRecord|undefined>;
  putForIntent(scope:TenantScope,executionIntentId:string,record:PlatformExecutionRecord):Promise<PlatformExecutionRecord>;
}

export interface AuthorizationGrantRepository {
  putGrant(grant:AuthorizationGrant):Promise<void>;
  listApplicable(principalId:string,tenantId:string):Promise<AuthorizationGrant[]>;
}

export interface IdempotencyRepository {
  claim(input:IdempotencyClaimInput):Promise<IdempotencyClaimResult>;
  complete(input:IdempotencyCompleteInput,outcome:StoredApiOutcome):Promise<void>;
}
export interface AuditRepository {
  append(event:AuditEvent):Promise<AuditRecord>;
  verifyStream(requestedTenantId:string):Promise<AuditVerificationResult>;
}


export interface ModelCompilationRepository {
  commitCompilation(scope:TenantScope,artifacts:ModelExchangeArtifact[],record:ModelCompilationRecord):Promise<void>;
  getCompilation(scope:TenantScope,compilationId:string):Promise<ModelCompilationRecord>;
  getModelArtifact(scope:TenantScope,artifactId:string):Promise<ModelExchangeArtifact>;
}


export interface ModelExplanationRepository {
  put(scope:TenantScope,record:ModelExplanationRecord):Promise<void>;
  get(scope:TenantScope,explanationId:string):Promise<ModelExplanationRecord>;
}


export interface DistributedExecutionRepository {
  create(scope:TenantScope,intent:DistributedExecutionIntentCore):Promise<DistributedExecutionJob>;
  get(scope:TenantScope,jobId:string):Promise<DistributedExecutionJob>;
  claimNext(workerId:string,now:string,leaseMs:number):Promise<DistributedExecutionLease|undefined>;
  heartbeat(scope:TenantScope,jobId:string,workerId:string,leaseEpoch:number,now:string,leaseMs:number):Promise<DistributedExecutionLease>;
  releaseForRetry(scope:TenantScope,jobId:string,workerId:string,leaseEpoch:number,now:string):Promise<DistributedExecutionJob>;
  complete(scope:TenantScope,jobId:string,workerId:string,leaseEpoch:number,now:string,result:ControlPlaneResult):Promise<DistributedExecutionJob>;
  failTerminal(scope:TenantScope,jobId:string,workerId:string,leaseEpoch:number,now:string,code:"STALE"|"FAILED_INTEGRITY"):Promise<DistributedExecutionJob>;
}
