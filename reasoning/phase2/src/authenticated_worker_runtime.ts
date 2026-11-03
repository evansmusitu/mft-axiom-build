import {randomUUID,sign,type KeyObject} from "node:crypto";
import {canonicalize,hashJson} from "../../phase1/src/canonical.ts";
import {ModelExecutionError} from "./model_execution_service.ts";
import type {DistributedModelWorkerRuntimeFactory,DistributedWorkerOutcome} from "./distributed_model_execution.ts";
import type {WorkerAction,WorkerRequestProof} from "./worker_authentication.ts";
import {workerRequestSigningPayload} from "./worker_authentication.ts";
import {distributedIso} from "./distributed_execution_store.ts";
import type {AuthenticatedExecutionLease} from "./authenticated_distributed_store.ts";
import type {WorkerLeaseCapability} from "./worker_lease_capability.ts";
import type {ControlPlaneResult,DistributedExecutionJob} from "./types.ts";
export interface AuthenticatedWorkerCredential{
 workerId:string;keyId:string;privateKey:KeyObject;
}
export interface AuthenticatedWorkerJobRepository{
 claimNext(proof:WorkerRequestProof,leaseMs:number,at:string):Promise<AuthenticatedExecutionLease|undefined>;
 heartbeat(proof:WorkerRequestProof,cap:WorkerLeaseCapability,leaseMs:number,at:string):Promise<AuthenticatedExecutionLease>;
 releaseForRetry(proof:WorkerRequestProof,cap:WorkerLeaseCapability,at:string):Promise<DistributedExecutionJob>;
 complete(proof:WorkerRequestProof,cap:WorkerLeaseCapability,at:string,result:ControlPlaneResult):Promise<DistributedExecutionJob>;
 failTerminal(proof:WorkerRequestProof,cap:WorkerLeaseCapability,at:string,code:"STALE"|"FAILED_INTEGRITY"):Promise<DistributedExecutionJob>;
}
function stale(error:unknown):boolean {
 const message=error instanceof Error?error.message:String(error);
 return /LEASE_LOST|stale lease|WORKER_UNAUTHENTICATED|INVALID_LEASE_CAPABILITY/i.test(message);
}
function integrity(error:unknown):boolean {
 const message=error instanceof Error?error.message:String(error);
 return /integrity|mismatch|not found for tenant|reserved platform context|no executable template|input contract|placeholder|template input|bound world snapshot|world snapshot/i.test(message);
}
function prepared(intent:any){
 return {compilationId:intent.compilationId,compilationRecordHash:intent.compilationRecordHash,
  profileId:intent.profileId,profileVersion:intent.profileVersion,profileHash:intent.profileHash,
  compilerManifest:structuredClone(intent.compilerManifest),
  operationRegistryManifestHash:intent.operationRegistryManifestHash,
  executionRequest:structuredClone(intent.executionRequest)};
}
export class AuthenticatedDistributedModelExecutionWorker{
 private readonly jobs:AuthenticatedWorkerJobRepository;
 private readonly runtimes:DistributedModelWorkerRuntimeFactory;
 private readonly leaseMs:number;
 private readonly clock:()=>string;
 private readonly worker:AuthenticatedWorkerCredential;
 constructor(options:{jobs:AuthenticatedWorkerJobRepository;runtimes:DistributedModelWorkerRuntimeFactory;
  worker:AuthenticatedWorkerCredential;leaseMs:number;clock:()=>string}){
  if(!options?.jobs||!options?.runtimes||typeof options.runtimes.create!=="function")
   throw new TypeError("Authenticated worker needs job store and tenant runtime factory");
  if(!options.worker||typeof options.worker.workerId!=="string"||!options.worker.workerId
   ||typeof options.worker.keyId!=="string"||!options.worker.keyId
   ||options.worker.privateKey?.type!=="private"
   ||options.worker.privateKey.asymmetricKeyType!=="ed25519")
   throw new TypeError("Authenticated Ed25519 worker credential required");
  if(!Number.isSafeInteger(options.leaseMs)||options.leaseMs<1||options.leaseMs>86_400_000)
   throw new TypeError("Invalid worker lease duration");
  if(typeof options.clock!=="function")throw new TypeError("Trusted worker clock required");
  this.jobs=options.jobs;this.runtimes=options.runtimes;this.worker=options.worker;
  this.leaseMs=options.leaseMs;this.clock=options.clock;
 }
 private now():string{return distributedIso(this.clock(),"server worker clock");}
 private proof(action:WorkerAction,body:any,at:string,targetJobId?:string):WorkerRequestProof{
  const core={protocolVersion:"axiom.worker-request/v1" as const,
   workerId:this.worker.workerId,keyId:this.worker.keyId,requestId:randomUUID(),
   action,bodyHash:hashJson(body),issuedAt:at,...(targetJobId?{targetJobId}:{})};
  return {...core,signatureBase64:sign(null,Buffer.from(canonicalize(workerRequestSigningPayload(core))),
   this.worker.privateKey).toString("base64")};
 }
 async runOnce():Promise<DistributedWorkerOutcome>{
  const claimTime=this.now();
  const lease=await this.jobs.claimNext(this.proof("CLAIM",{leaseMs:this.leaseMs},claimTime),
   this.leaseMs,claimTime);
  if(!lease)return {status:"IDLE"};
  const intent=lease.job.intent,scope={tenantId:intent.tenantId},capability=lease.capability;
  const mutate=async(action:"COMPLETE"|"RELEASE"|"FAIL_TERMINAL",body:any)=>{
   const at=this.now();
   const proof=this.proof(action,{capabilityId:capability.capabilityId,...body},at,intent.jobId);
   if(action==="COMPLETE")return this.jobs.complete(proof,capability,at,body.result);
   if(action==="FAIL_TERMINAL")return this.jobs.failTerminal(proof,capability,at,body.code);
   return this.jobs.releaseForRetry(proof,capability,at);
  };
  try{
   const runtime=this.runtimes.create(scope);
   if(!runtime?.modelExecutor||typeof runtime.modelExecutor.validatePrepared!=="function"
    ||!runtime?.executions||typeof runtime.executions.getByIntent!=="function"
    ||!runtime?.plane||typeof runtime.plane.executeBound!=="function")
    throw new Error("Authenticated worker runtime is invalid");
   const existing=await runtime.executions.getByIntent(scope,intent.jobId);
   if(!existing)await runtime.modelExecutor.validatePrepared(scope,prepared(intent));
   const result=await runtime.plane.executeBound(structuredClone(intent.executionRequest),
    intent.snapshotId,intent.jobId);
   const done=await mutate("COMPLETE",{result});
   return {status:"COMPLETED",jobId:intent.jobId,jobStatus:done.state.status as "SUCCEEDED"|"DENIED"};
  }catch(error){
   if(stale(error))return {status:"LEASE_LOST",jobId:intent.jobId};
   const terminal=error instanceof ModelExecutionError&&error.code==="COMPILATION_STALE"?"STALE":
    integrity(error)?"FAILED_INTEGRITY":undefined;
   try{
    if(terminal){
     const failed=await mutate("FAIL_TERMINAL",{code:terminal});
     return {status:"TERMINAL",jobId:intent.jobId,jobStatus:failed.state.status as "STALE"|"FAILED_INTEGRITY"};
    }
    await mutate("RELEASE",{});
    return {status:"RETRY",jobId:intent.jobId};
   }catch(transitionError){
    if(stale(transitionError))return {status:"LEASE_LOST",jobId:intent.jobId};
    throw transitionError;
   }
  }
 }
}
