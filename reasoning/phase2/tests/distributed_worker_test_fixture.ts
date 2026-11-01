import { generateKeyPairSync } from "node:crypto";
import type {
  ControlPlaneResult, DistributedExecutionJob, TenantScope, WorkerAction, WorkerLeaseCapability
} from "../src/types.ts";
import {
  AuthenticatedDistributedWorkerControl, WorkerRequestAuthenticator, createStaticWorkerCredential,
  createStaticWorkerLeaseSigner, createWorkerTrustRecord, distributedWorkerOperationBodyHash
} from "../src/index.ts";

const ALL_ACTIONS:WorkerAction[]=["CLAIM","HEARTBEAT","RELEASE","COMPLETE","FAIL_TERMINAL"];

export function createDistributedWorkerTestAuthority(maxLeaseMs=24*60*60*1000){
  const workers=new Map<string,{record:any;credential:any}>();
  const leaseKeys=generateKeyPairSync("ed25519");
  let requestSequence=0;
  const trustStore={
    get(workerId:string,keyId:string){
      const worker=workers.get(workerId);
      return worker&&worker.record.identity.keyId===keyId?worker.record:undefined;
    }
  };
  const leaseSigner=createStaticWorkerLeaseSigner("lease:test:v1",leaseKeys);
  const authenticator=new WorkerRequestAuthenticator({trustStore,maxRequestAgeMs:24*60*60*1000,maxFutureSkewMs:0});

  function worker(workerId:string){
    let existing=workers.get(workerId);
    if(existing)return existing;
    const keys=generateKeyPairSync("ed25519");
    const keyId=`${workerId}:key:v1`;
    const record=createWorkerTrustRecord({
      workerId,keyId,poolId:`pool:${workerId}`,publicKey:keys.publicKey,
      status:"ACTIVE",maxLeaseMs,allowedActions:[...ALL_ACTIONS]
    });
    existing={record,credential:createStaticWorkerCredential(workerId,keyId,keys.privateKey)};
    workers.set(workerId,existing);
    return existing;
  }

  function proof(workerId:string,action:WorkerAction,now:string,body:unknown,targetJobId?:string,requestId?:string){
    const value=worker(workerId);
    return value.credential.sign({
      requestId:requestId??`request:test:${++requestSequence}`,
      action,
      ...(targetJobId===undefined?{}:{targetJobId}),
      bodyHash:distributedWorkerOperationBodyHash(action,body),
      issuedAt:now
    });
  }

  return {
    storeOptions:{workerTrustStore:trustStore,leaseSigner},
    trustStore,leaseSigner,authenticator,
    credential(workerId:string){return worker(workerId).credential;},
    bind(jobs:any){
      const control=new AuthenticatedDistributedWorkerControl({jobs,authenticator});
      const capabilities=new Map<string,WorkerLeaseCapability>();
      const capabilityKey=(jobId:string,leaseEpoch:number)=>`${jobId}\u0000${leaseEpoch}`;
      const capability=(jobId:string,leaseEpoch:number)=>{
        const value=capabilities.get(capabilityKey(jobId,leaseEpoch));
        if(!value)throw new Error(`No test lease capability for ${jobId} epoch ${leaseEpoch}`);
        return value;
      };
      return {
        control,
        create:(...args:any[])=>jobs.create(...args),
        get:(...args:any[])=>jobs.get(...args),
        close:()=>typeof jobs.close==="function"?jobs.close():undefined,
        workerOptions(workerId:string){
          return {
            control,
            credential:worker(workerId).credential,
            requestId:()=>`request:test:runtime:${++requestSequence}`
          };
        },
        async claimNext(workerId:string,now:string,leaseMs:number){
          const lease=await control.claim(proof(workerId,"CLAIM",now,{leaseMs}),now,leaseMs);
          if(lease)capabilities.set(capabilityKey(lease.job.intent.jobId,lease.leaseEpoch),lease.capability);
          return lease;
        },
        async heartbeat(scope:TenantScope,jobId:string,workerId:string,leaseEpoch:number,now:string,leaseMs:number){
          const current=capability(jobId,leaseEpoch);
          const next=await control.heartbeat(
            scope,jobId,proof(workerId,"HEARTBEAT",now,{leaseMs,capabilityId:current.capabilityId},jobId),
            current,now,leaseMs
          );
          capabilities.set(capabilityKey(jobId,leaseEpoch),next.capability);
          return next;
        },
        async releaseForRetry(scope:TenantScope,jobId:string,workerId:string,leaseEpoch:number,now:string){
          const current=capability(jobId,leaseEpoch);
          return control.release(
            scope,jobId,proof(workerId,"RELEASE",now,{capabilityId:current.capabilityId},jobId),
            current,now
          );
        },
        async complete(
          scope:TenantScope,jobId:string,workerId:string,leaseEpoch:number,now:string,result:ControlPlaneResult
        ):Promise<DistributedExecutionJob>{
          const current=capability(jobId,leaseEpoch);
          return control.complete(
            scope,jobId,proof(workerId,"COMPLETE",now,{capabilityId:current.capabilityId,result},jobId),
            current,now,result
          );
        },
        async failTerminal(
          scope:TenantScope,jobId:string,workerId:string,leaseEpoch:number,now:string,code:"STALE"|"FAILED_INTEGRITY"
        ):Promise<DistributedExecutionJob>{
          const current=capability(jobId,leaseEpoch);
          return control.fail(
            scope,jobId,proof(workerId,"FAIL_TERMINAL",now,{capabilityId:current.capabilityId,code},jobId),
            current,now,code
          );
        },
        capability
      };
    }
  };
}
