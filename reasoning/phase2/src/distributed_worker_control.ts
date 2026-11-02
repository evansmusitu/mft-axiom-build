import { sign, type KeyObject } from "node:crypto";
import { canonicalize } from "../../phase1/src/canonical.ts";
import type { DistributedExecutionRepository } from "./repositories.ts";
import type {
  AuthenticatedDistributedExecutionLease, ControlPlaneResult, DistributedExecutionJob,
  TenantScope, WorkerAction, WorkerLeaseCapability, WorkerRequestProof
} from "./types.ts";
import { WorkerRequestAuthenticator, workerRequestSigningPayload } from "./worker_authentication.ts";
import { distributedWorkerOperationBodyHash } from "./distributed_execution_store.ts";

function required(value:unknown,label:string):string {
  if(typeof value!=="string"||!value.trim())throw new TypeError(`${label} is required`);
  return value;
}
export interface DistributedWorkerCredential {
  readonly workerId:string;
  readonly keyId:string;
  sign(input:{requestId:string;action:WorkerAction;targetJobId?:string;bodyHash:string;issuedAt:string}):WorkerRequestProof;
}
export function createStaticWorkerCredential(workerIdInput:string,keyIdInput:string,privateKey:KeyObject):DistributedWorkerCredential {
  const workerId=required(workerIdInput,"workerId"),keyId=required(keyIdInput,"worker keyId");
  if(!privateKey||privateKey.type!=="private"||privateKey.asymmetricKeyType!=="ed25519")throw new TypeError("Worker credential requires an Ed25519 private key");
  return Object.freeze({
    workerId,keyId,
    sign(input){
      const unsigned={
        protocolVersion:"axiom.worker-request/v1" as const,workerId,keyId,
        requestId:required(input.requestId,"worker requestId"),action:input.action,
        ...(input.targetJobId===undefined?{}:{targetJobId:required(input.targetJobId,"targetJobId")}),
        bodyHash:required(input.bodyHash,"bodyHash"),issuedAt:required(input.issuedAt,"issuedAt")
      };
      const signatureBase64=sign(null,Buffer.from(canonicalize(workerRequestSigningPayload(unsigned) as any)),privateKey).toString("base64");
      return {...unsigned,signatureBase64};
    }
  });
}

export interface DistributedWorkerControl {
  claim(proof:WorkerRequestProof,now:string,leaseMs:number):Promise<AuthenticatedDistributedExecutionLease|undefined>;
  heartbeat(scope:TenantScope,jobId:string,proof:WorkerRequestProof,capability:WorkerLeaseCapability,now:string,leaseMs:number):Promise<AuthenticatedDistributedExecutionLease>;
  release(scope:TenantScope,jobId:string,proof:WorkerRequestProof,capability:WorkerLeaseCapability,now:string):Promise<DistributedExecutionJob>;
  complete(scope:TenantScope,jobId:string,proof:WorkerRequestProof,capability:WorkerLeaseCapability,now:string,result:ControlPlaneResult):Promise<DistributedExecutionJob>;
  fail(scope:TenantScope,jobId:string,proof:WorkerRequestProof,capability:WorkerLeaseCapability,now:string,code:"STALE"|"FAILED_INTEGRITY"):Promise<DistributedExecutionJob>;
}

export class AuthenticatedDistributedWorkerControl implements DistributedWorkerControl {
  private readonly jobs:Pick<DistributedExecutionRepository,
    "claimNextAuthenticated"|"heartbeatAuthenticated"|"releaseForRetryAuthenticated"|"completeAuthenticated"|"failTerminalAuthenticated">;
  private readonly authenticator:WorkerRequestAuthenticator;
  constructor(options:{
    jobs:Pick<DistributedExecutionRepository,"claimNextAuthenticated"|"heartbeatAuthenticated"|"releaseForRetryAuthenticated"|"completeAuthenticated"|"failTerminalAuthenticated">;
    authenticator:WorkerRequestAuthenticator;
  }){
    if(!options?.jobs||typeof options.jobs.claimNextAuthenticated!=="function")throw new TypeError("authenticated distributed job repository is required");
    if(!options?.authenticator||typeof options.authenticator.authenticate!=="function")throw new TypeError("worker request authenticator is required");
    this.jobs=options.jobs;this.authenticator=options.authenticator;
  }
  async claim(proof:WorkerRequestProof,now:string,leaseMs:number){
    const bodyHash=distributedWorkerOperationBodyHash("CLAIM",{leaseMs});
    const worker=this.authenticator.authenticate(proof,{action:"CLAIM",bodyHash,now});
    return this.jobs.claimNextAuthenticated(worker,now,leaseMs);
  }
  async heartbeat(scope:TenantScope,jobId:string,proof:WorkerRequestProof,capability:WorkerLeaseCapability,now:string,leaseMs:number){
    const bodyHash=distributedWorkerOperationBodyHash("HEARTBEAT",{leaseMs,capabilityId:capability.capabilityId});
    const worker=this.authenticator.authenticate(proof,{action:"HEARTBEAT",targetJobId:jobId,bodyHash,now});
    return this.jobs.heartbeatAuthenticated(scope,jobId,worker,capability,now,leaseMs);
  }
  async release(scope:TenantScope,jobId:string,proof:WorkerRequestProof,capability:WorkerLeaseCapability,now:string){
    const bodyHash=distributedWorkerOperationBodyHash("RELEASE",{capabilityId:capability.capabilityId});
    const worker=this.authenticator.authenticate(proof,{action:"RELEASE",targetJobId:jobId,bodyHash,now});
    return this.jobs.releaseForRetryAuthenticated(scope,jobId,worker,capability,now);
  }
  async complete(scope:TenantScope,jobId:string,proof:WorkerRequestProof,capability:WorkerLeaseCapability,now:string,result:ControlPlaneResult){
    const bodyHash=distributedWorkerOperationBodyHash("COMPLETE",{capabilityId:capability.capabilityId,result});
    const worker=this.authenticator.authenticate(proof,{action:"COMPLETE",targetJobId:jobId,bodyHash,now});
    return this.jobs.completeAuthenticated(scope,jobId,worker,capability,now,result);
  }
  async fail(scope:TenantScope,jobId:string,proof:WorkerRequestProof,capability:WorkerLeaseCapability,now:string,code:"STALE"|"FAILED_INTEGRITY"){
    const bodyHash=distributedWorkerOperationBodyHash("FAIL_TERMINAL",{capabilityId:capability.capabilityId,code});
    const worker=this.authenticator.authenticate(proof,{action:"FAIL_TERMINAL",targetJobId:jobId,bodyHash,now});
    return this.jobs.failTerminalAuthenticated(scope,jobId,worker,capability,now,code);
  }
}
