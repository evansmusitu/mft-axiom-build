import {hashJson} from "../../phase1/src/canonical.ts";
import {distributedIso,distributedResultShape} from "./distributed_execution_store.ts";
import {WorkerRequestAuthenticator,type WorkerRequestProof} from "./worker_authentication.ts";
import {verifyWorkerLeaseCapability,workerLeaseCapabilityHash,
 type WorkerLeaseCapability,type WorkerLeaseCapabilitySigner} from "./worker_lease_capability.ts";
import type {AuthenticatedWorkerJobRepository} from "./authenticated_worker_runtime.ts";
import type {ControlPlaneResult,DistributedExecutionJob,PlatformExecutionRecord,
 ReplayResult,TenantScope} from "./types.ts";

export interface TrustedRemoteCompletionDependencies{
 jobs:Pick<AuthenticatedWorkerJobRepository,"complete">;
 auth:WorkerRequestAuthenticator;
 leaseSigner:WorkerLeaseCapabilitySigner;
 jobReader:{get(scope:TenantScope,jobId:string):Promise<DistributedExecutionJob>};
 executions:{getByIntent(scope:TenantScope,jobId:string):Promise<PlatformExecutionRecord|undefined>};
 replayFactory:{create(scope:TenantScope):{replayStored(id:string):Promise<ReplayResult>}};
}
function denied():never{throw new Error("REMOTE_COMPLETION_UNVERIFIED");}
function same(a:unknown,b:unknown):boolean{
 try{return hashJson(a as any)===hashJson(b as any);}catch{return false;}
}
export class VerifiedRemoteCompletionService{
 private readonly deps:TrustedRemoteCompletionDependencies;
 constructor(deps:TrustedRemoteCompletionDependencies){
  if(!deps?.jobs||typeof deps.jobs.complete!=="function"
   ||!deps.auth||typeof deps.auth.authenticate!=="function"
   ||!deps.leaseSigner||typeof deps.leaseSigner.trustedPublicKeyPem!=="function"
   ||!deps.jobReader||typeof deps.jobReader.get!=="function"
   ||!deps.executions||typeof deps.executions.getByIntent!=="function"
   ||!deps.replayFactory||typeof deps.replayFactory.create!=="function")
   throw new TypeError("Trusted server completion repositories, signer and replay authority are mandatory");
  this.deps=deps;
 }
 async complete(proof:WorkerRequestProof,capability:WorkerLeaseCapability,
  result:ControlPlaneResult,serverNow:string):Promise<DistributedExecutionJob>{
  const at=distributedIso(serverNow,"trusted server time");
  const core=capability?.core;
  if(!core||typeof capability.capabilityId!=="string"||!core.jobId||!core.tenantId
   ||!core.signerKeyId||!core.workerId||!core.workerKeyId||!core.poolId)
   denied();
  // Verify exact Ed25519 worker identity + request body BEFORE any job/record reads.
  const worker=this.deps.auth.authenticate(proof,{
   action:"COMPLETE",bodyHash:hashJson({capabilityId:capability.capabilityId,result}),
   targetJobId:core.jobId
  },at);
  if(worker.identity.workerId!==core.workerId||worker.identity.keyId!==core.workerKeyId
   ||worker.identity.poolId!==core.poolId||worker.action!=="COMPLETE"
   ||!core.allowedActions?.includes("COMPLETE"))denied();
  // The lease signature must not be treated as self-authenticating.
  const pem=this.deps.leaseSigner.trustedPublicKeyPem(core.signerKeyId);
  if(!pem||!verifyWorkerLeaseCapability(capability,{[core.signerKeyId]:pem}))denied();
  if(Date.parse(core.leaseExpiresAt)<=Date.parse(at))denied();
  const scope:TenantScope={tenantId:core.tenantId};
  const job=await this.deps.jobReader.get(scope,core.jobId);
  if(job.intent.tenantId!==scope.tenantId||job.intent.jobId!==core.jobId
   ||job.intent.intentHash!==core.intentHash||job.state.leaseEpoch!==core.leaseEpoch)denied();
  const live=job.state.status==="LEASED"
   &&job.state.leaseOwner===worker.identity.workerId
   &&job.state.leaseWorkerKeyId===worker.identity.keyId
   &&job.state.leasePoolId===worker.identity.poolId
   &&job.state.leaseExpiresAt===core.leaseExpiresAt
   &&job.state.leaseCapabilityCoreHash===workerLeaseCapabilityHash(capability);
  // A terminal state can only return an existing signed operation receipt;
  // the underlying store refuses a new transition from a terminal state.
  const terminalReplay=(job.state.status==="SUCCEEDED"||job.state.status==="DENIED")
   &&job.state.resultHash===hashJson(result as any)&&same(job.state.result,result);
  if(!live&&!terminalReplay)denied();
  const record=await this.deps.executions.getByIntent(scope,job.intent.jobId);
  if(!record||!record.certificate||!record.certificate.core||!record.certificate.certificateId
   ||!record.id||!record.recordHash)denied();
  const {recordHash,...recordCore}=record;
  if(hashJson(recordCore as any)!==recordHash)denied();
  if(record.tenantId!==scope.tenantId||record.executionIntentId!==job.intent.jobId
   ||record.executionRequestHash!==hashJson(job.intent.executionRequest as any)
   ||record.snapshotId!==job.intent.snapshotId
   ||record.snapshotHash!==job.intent.snapshotHash)denied();
  const status=(record.certificate.core as any).decisionStatus;
  if(status!=="APPROVED"&&status!=="DENIED")denied();
  const verified:ControlPlaneResult={
   status,snapshotId:record.snapshotId,policyDecision:structuredClone(record.policyDecision),
   certificateId:record.certificate.certificateId,executionRecordId:record.id
  };
  distributedResultShape(job.intent,verified);
  if(!same(verified,result))denied();
  const replay=await this.deps.replayFactory.create(scope).replayStored(record.id);
  if(replay.status!=="MATCH"||replay.diagnostics.length!==0)denied();
  // The durable store reauthenticates, checks current epoch and receipt, and
  // atomically persists the terminal job transition.
  return this.deps.jobs.complete(proof,capability,at,verified);
 }
}
