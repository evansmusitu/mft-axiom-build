import type { AxiomNode, AxiomProgram, CompilerManifest, ConstraintSpec, JsonValue, TypeRef, TypedValue } from "../../phase1/src/types.ts";
import type { ReasoningCertificate } from "../../phase1/src/certificate.ts";
import type { SignerIdentity } from "./signer.ts";

export interface TenantScope { tenantId: string; }

export interface PrincipalIdentity {
  principalId:string;
  issuer:string;
  subject:string;
}

export interface CredentialEvidence {
  issuer:string;
  subject:string;
  keyId:string;
  jwtId:string;
  issuedAt:string;
  expiresAt:string;
  tokenHash:string;
}

export interface AuthenticatedPrincipal {
  principal:PrincipalIdentity;
  credential:CredentialEvidence;
}

export interface FactAuthentication {
  keyId: string;
  issuedAt: string;
  nonce: string;
  envelopeHash: string;
  signature: string;
}

export interface FactAcquisition {
  artifactId:string;
  artifactHash:string;
  adapterId:string;
  adapterVersion:string;
  adapterImplementationHash:string;
  operationId:string;
  mappingId:string;
  mappingVersion:string;
  mappingImplementationHash:string;
  canonicalRequestHash:string;
  capturedAt:string;
}

export interface TemporalFact {
  id: string;
  entity: string;
  attribute: string;
  value: TypedValue;
  validFrom: string;
  validUntil?: string;
  observedAt: string;
  source: string;
  confidence?: number;
  supersedes?: string[];
  acquisition?: FactAcquisition;
  authentication?: FactAuthentication;
}

export interface EvidenceArtifact {
  artifactId:string;
  tenantId:string;
  adapterId:string;
  adapterVersion:string;
  adapterImplementationHash:string;
  operationId:string;
  mappingId:string;
  canonicalRequestHash:string;
  capturedAt:string;
  upstreamStatus:number;
  mediaType:string;
  bodyEncoding:"utf8"|"base64";
  body:string;
  bodyHash:string;
  artifactHash:string;
}
export type VerifiedEvidenceArtifact=EvidenceArtifact;

export interface MappingManifest {
  mappingId:string;
  version:string;
  implementationHash:string;
}
export interface AdapterOperationManifest {
  operationId:string;
  parameterSchemaHash:string;
  responseMediaTypes:string[];
  maxResponseBytes:number;
  timeoutMs:number;
  mappingIds:string[];
}
export interface AdapterManifest {
  adapterId:string;
  version:string;
  implementationHash:string;
  capability:"READ"|"COMPUTE";
  operations:AdapterOperationManifest[];
}
export interface CapturedEvidence {
  status:number;
  mediaType:string;
  bodyEncoding?:"utf8"|"base64";
  body:string;
}
export interface EvidenceAcquisitionRequest {
  adapterId:string;
  operationId:string;
  mappingId:string;
  parameters:Record<string,JsonValue>;
}
export interface EvidenceAcquisitionResult {
  status:"COMMITTED";
  acquisitionId:string;
  artifactId:string;
  artifactHash:string;
  factIds:string[];
}
export interface AcquisitionRecord {
  acquisitionId:string;
  tenantId:string;
  principalId:string;
  authorizationDecisionHash:string;
  adapterId:string;
  adapterVersion:string;
  adapterImplementationHash:string;
  operationId:string;
  mappingId:string;
  mappingVersion:string;
  mappingImplementationHash:string;
  canonicalRequestHash:string;
  artifactId:string;
  artifactHash:string;
  factIds:string[];
  capturedAt:string;
  status:"COMMITTED";
  recordHash:string;
}

export interface SignedFactEnvelope {
  tenantId: string;
  keyId: string;
  issuedAt: string;
  nonce: string;
  fact: TemporalFact;
  signature: string;
}

export interface WorldSnapshot {
  tenantId: string;
  snapshotId: string;
  asOf: string;
  facts: TemporalFact[];
  snapshotHash: string;
}

export interface EvidenceRequirement { id:string; entity:string; attribute:string; maxAgeMs:number; }
export interface PolicyCheck {
  requirementId:string; ok:boolean;
  code:"OK"|"MISSING_EVIDENCE"|"STALE_EVIDENCE"|"CONFLICTING_EVIDENCE"|"FUTURE_EVIDENCE";
  factIds:string[]; message:string;
}
export interface PolicyDecision { status:"ALLOW"|"DENY"; snapshotId:string; checks:PolicyCheck[]; }
export interface PolicyManifest { id:"axiom.evidence-policy"; version:string; implementationHash:string; }
export interface InputBinding { inputName:string; entity:string; attribute:string; }
export interface ExecutionRequest { asOf:string; issuedAt:string; program:AxiomProgram; requirements:EvidenceRequirement[]; bindings:InputBinding[]; }
export interface AppliedBinding extends InputBinding { factId:string; }

export interface PlatformExecutionRecord {
  id:string; tenantId:string; snapshotId:string; snapshotHash:string;
  policyDecision:PolicyDecision; policyManifest:PolicyManifest; requirements:EvidenceRequirement[];
  bindings:AppliedBinding[]; platformContextHash:string; certificate:ReasoningCertificate;
  signerKeyId:string;
  platformContextVersion?:"2";
  signerIdentity?:SignerIdentity;
  signingIntentId?:string;
  executionIntentId?:string; executionRequestHash?:string; recordHash:string;
}
export interface ControlPlaneResult {
  status:"APPROVED"|"DENIED"; snapshotId:string; policyDecision:PolicyDecision;
  certificateId?:string; executionRecordId?:string;
}
export interface ReplayResult { status:"MATCH"|"MISMATCH"; diagnostics:string[]; }

export type ApiAction="fact:ingest"|"execution:create"|"execution:read"|"execution:replay"|"execution:job:read"|"evidence:acquire"|"model:compile"|"model:execute"|"model:dispatch"|"model:explain";
export interface ApiResource { kind:"fact"|"execution"|"execution_job"|"evidence"|"model_compilation"; id?:string; }
export interface AuthorizationTarget { requestedTenantId:string; action:ApiAction; resource:ApiResource; }
export interface AuthorizationGrant { grantId:string; principalId:string; tenantId:string; action:ApiAction; }
export interface AuthorizationPolicyManifest {
  id:"axiom.api-authorization";
  version:string;
  implementationHash:string;
  grantsHash:string;
}
export interface AuthorizationDecision {
  status:"ALLOW"|"DENY";
  principalId:string;
  requestedTenantId:string;
  action:ApiAction;
  resource:ApiResource;
  matchedGrantIds:string[];
  policyManifest:AuthorizationPolicyManifest;
  decisionHash:string;
}
export interface AuthorizedTenantContext {
  principal:PrincipalIdentity;
  credential:CredentialEvidence;
  tenant:TenantScope;
  authorization:AuthorizationDecision;
}

export interface StoredApiOutcome {
  statusCode:number;
  bodyJson:string;
  contentType:string;
}
export interface IdempotencyClaimInput {
  principalId:string;
  tenantId:string;
  action:ApiAction;
  idempotencyKeyHash:string;
  requestHash:string;
  createdAt:string;
}
export interface IdempotencyCompleteInput extends IdempotencyClaimInput {
  completedAt:string;
}
export type IdempotencyClaimResult=
  | {status:"CLAIMED"}
  | {status:"IN_PROGRESS"}
  | {status:"CONFLICT"}
  | {status:"REPLAY";outcome:StoredApiOutcome};

export interface AuditEvent {
  requestedTenantId:string;
  requestId:string;
  principalId?:string;
  action:ApiAction;
  resource:ApiResource;
  credentialTokenHash?:string;
  authorizationDecisionHash?:string;
  requestHash:string;
  idempotencyKeyHash?:string;
  outcome:string;
  timestamp:string;
}
export interface AuditRecord extends AuditEvent {
  sequence:number;
  previousHash:string;
  recordHash:string;
}
export interface AuditVerificationResult {
  status:"MATCH"|"MISMATCH";
  diagnostics:string[];
}


export interface ModelInputContract {
  inputName:string;
  type:TypeRef;
  entity:string;
  attribute:string;
  requirementId:string;
  maxAgeMs:number;
}
export interface ModelProgramProposal {
  assumptions:string[];
  nodes:AxiomNode[];
  constraints:ConstraintSpec[];
  decisionNodeId:string;
}
export interface ModelCompilationIssue {
  code:string;
  message:string;
  nodeId?:string;
}
export interface ModelCompilerProfile {
  profileId:string;
  version:string;
  adapterId:string;
  allowedOperationIds:string[];
  maxRepairAttempts:number;
  maxInputs:number;
  maxNodes:number;
  maxConstraints:number;
  maxAssumptions:number;
  maxObjectiveBytes:number;
  maxModelResponseBytes:number;
}
export interface ModelAdapterManifest {
  adapterId:string;
  version:string;
  implementationHash:string;
  provider:string;
  modelId:string;
}
export interface ModelCompileRequest {
  profileId:string;
  objective:string;
  inputContracts:ModelInputContract[];
}
export interface ModelExecuteRequest {
  asOf:string;
  issuedAt:string;
}
export interface ModelExchangeArtifact {
  artifactId:string;
  tenantId:string;
  adapterId:string;
  adapterVersion:string;
  adapterImplementationHash:string;
  provider:string;
  modelId:string;
  profileId:string;
  profileHash:string;
  compilationRequestHash:string;
  attempt:number;
  mode:"INITIAL"|"REPAIR";
  capturedAt:string;
  requestBody:string;
  requestBodyHash:string;
  responseBody:string;
  responseBodyHash:string;
  normalizedResponseBody?:string;
  normalizedResponseBodyHash?:string;
  artifactHash:string;
}
export interface ModelCompilationRecord {
  compilationId:string;
  tenantId:string;
  principalId:string;
  authorizationDecisionHash:string;
  compilationRequestHash:string;
  profileId:string;
  profileVersion:string;
  profileHash:string;
  adapterManifest:ModelAdapterManifest;
  compilerManifest:CompilerManifest;
  operationRegistryManifestHash:string;
  objective:string;
  inputContracts:ModelInputContract[];
  exchangeArtifactIds:string[];
  exchangeArtifactHashes:string[];
  finalIssues:ModelCompilationIssue[];
  status:"VALIDATED"|"REJECTED";
  compiledProgram?:AxiomProgram;
  compiledProgramHash?:string;
  createdAt:string;
  recordHash:string;
}
export type ModelCompileResult=
  | {status:"VALIDATED";compilationId:string;compiledProgramHash:string;attemptCount:number}
  | {status:"REJECTED";compilationId:string;issues:ModelCompilationIssue[];attemptCount:number};


export interface ModelExplanationProfile {
  profileId:string;
  version:string;
  adapterId:string;
  maxPromptBytes:number;
  maxResponseBytes:number;
}
export interface ModelExplainRequest { profileId:string; }
export interface ModelExplanationContent {
  summary:string;
  keyFactors:string[];
  limitations:string[];
}
export interface ModelExplanationRecord {
  explanationId:string;
  tenantId:string;
  executionId:string;
  executionRecordHash:string;
  principalId:string;
  authorizationDecisionHash:string;
  explanationRequestHash:string;
  profileId:string;
  profileVersion:string;
  profileHash:string;
  adapterManifest:ModelAdapterManifest;
  capturedAt:string;
  requestBody:string;
  requestBodyHash:string;
  responseBody:string;
  responseBodyHash:string;
  normalizedResponseBody:string;
  normalizedResponseBodyHash:string;
  authority:"ADVISORY_ONLY";
  content:ModelExplanationContent;
  recordHash:string;
}
export interface ModelExplainResult {
  status:"CREATED";
  explanationId:string;
  authority:"ADVISORY_ONLY";
  content:ModelExplanationContent;
  provider:string;
  modelId:string;
}


export interface PreparedModelExecution {
  compilationId:string;
  compilationRecordHash:string;
  profileId:string;
  profileVersion:string;
  profileHash:string;
  compilerManifest:CompilerManifest;
  operationRegistryManifestHash:string;
  executionRequest:ExecutionRequest;
}
export interface ModelDispatchResult {
  status:"QUEUED";
  jobId:string;
  snapshotId:string;
}

export type DistributedExecutionStatus=
  | "PENDING"
  | "LEASED"
  | "SUCCEEDED"
  | "DENIED"
  | "STALE"
  | "FAILED_INTEGRITY";

export interface DistributedExecutionIntentCore {
  tenantId:string;
  principalId:string;
  authorizationDecisionHash:string;
  requestHash:string;
  compilationId:string;
  compilationRecordHash:string;
  profileId:string;
  profileVersion:string;
  profileHash:string;
  compilerManifest:CompilerManifest;
  operationRegistryManifestHash:string;
  executionRequest:ExecutionRequest;
  snapshotId:string;
  snapshotHash:string;
  createdAt:string;
}
export interface DistributedExecutionIntent extends DistributedExecutionIntentCore {
  jobId:string;
  intentHash:string;
}
export interface DistributedExecutionState {
  status:DistributedExecutionStatus;
  leaseEpoch:number;
  attemptCount:number;
  leaseOwner?:string;
  leaseExpiresAt?:string;
  terminalAt?:string;
  result?:ControlPlaneResult;
  resultHash?:string;
  failureCode?:"STALE"|"FAILED_INTEGRITY";
  stateHash:string;
}
export interface DistributedExecutionJob {
  intent:DistributedExecutionIntent;
  state:DistributedExecutionState;
}
export interface DistributedExecutionLease {
  job:DistributedExecutionJob;
  workerId:string;
  leaseEpoch:number;
  leaseExpiresAt:string;
}


export type WorkerAction="CLAIM"|"HEARTBEAT"|"RELEASE"|"COMPLETE"|"FAIL_TERMINAL";

export interface WorkerIdentity {
  protocolVersion:"axiom.worker/v1";
  workerId:string;
  keyId:string;
  poolId:string;
  algorithm:"Ed25519";
  publicKeySha256:string;
}
export interface WorkerTrustRecord {
  identity:WorkerIdentity;
  publicKeyPem:string;
  status:"ACTIVE"|"REVOKED";
  maxLeaseMs:number;
  allowedActions:WorkerAction[];
  recordHash:string;
}
export interface WorkerRequestProof {
  protocolVersion:"axiom.worker-request/v1";
  workerId:string;
  keyId:string;
  requestId:string;
  action:WorkerAction;
  targetJobId?:string;
  bodyHash:string;
  issuedAt:string;
  signatureBase64:string;
}
export interface AuthenticatedWorkerContext {
  identity:WorkerIdentity;
  maxLeaseMs:number;
  allowedActions:WorkerAction[];
  requestId:string;
  action:WorkerAction;
  targetJobId?:string;
  bodyHash:string;
  issuedAt:string;
  requestHash:string;
}
