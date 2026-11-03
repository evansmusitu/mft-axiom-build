import {hashJson} from "../../phase1/src/canonical.ts";
import {initializeFairSQLite,enableFairSQLite,selectFairSQLite,recordFairSQLite} from "./tenant_fair_scheduling_sqlite.ts";
import {WorkerRequestAuthenticator,type WorkerRequestProof,type AuthenticatedWorkerContext,type WorkerAction} from "./worker_authentication.ts";
import {type WorkerLeaseCapability,type WorkerLeaseCapabilityCore,type WorkerLeaseCapabilitySigner,
 workerLeaseCapabilityHash,verifyWorkerLeaseCapability} from "./worker_lease_capability.ts";
import {AuthenticatedJobTransactions,type WorkerReceiptOutcome} from "./authenticated_worker_transactions.ts";
import {distributedMakeState,distributedResultShape,distributedIso} from "./distributed_execution_store.ts";
import type {ControlPlaneResult,DistributedExecutionJob} from "./types.ts";

export interface AuthenticatedExecutionLease{job:DistributedExecutionJob;capability:WorkerLeaseCapability}
function notMissing<T>(v:T|undefined,label:string):T{
 if(v===undefined)throw new Error("Missing "+label);return v;
}
export class AuthenticatedDistributedExecutionStore{
 private readonly tx:AuthenticatedJobTransactions;
 constructor(path:string,privateAuth:WorkerRequestAuthenticator,privateSigner:WorkerLeaseCapabilitySigner){
  if(!privateAuth||!privateSigner)throw new TypeError("Worker trust and lease signer required");
  this.auth=privateAuth;this.signer=privateSigner;this.tx=new AuthenticatedJobTransactions(path,privateSigner);initializeFairSQLite(this.tx.db);
 }
 private readonly auth:WorkerRequestAuthenticator;
 private readonly signer:WorkerLeaseCapabilitySigner;
 close(){this.tx.close();}
 async enableTenantFairScheduling(){enableFairSQLite(this.tx.db);}
 private at(time:string):string{return distributedIso(time,"server time");}
 private leaseMs(ms:number,worker:AuthenticatedWorkerContext):number{
  if(!Number.isSafeInteger(ms)||ms<1||ms>worker.maxLeaseMs)throw new Error("WORKER_FORBIDDEN");
  return ms;
 }
 private capabilityCore(job:DistributedExecutionJob,worker:AuthenticatedWorkerContext,expires:string):WorkerLeaseCapabilityCore{
  const actions=(["HEARTBEAT","RELEASE","COMPLETE","FAIL_TERMINAL"] as const).filter(a=>worker.allowedActions.includes(a));
  if(!actions.length)throw new Error("WORKER_FORBIDDEN");
  return {protocolVersion:"axiom.worker-lease/v1",
   workerId:worker.identity.workerId,workerKeyId:worker.identity.keyId,poolId:worker.identity.poolId,
   tenantId:job.intent.tenantId,jobId:job.intent.jobId,intentHash:job.intent.intentHash,
   leaseEpoch:job.state.leaseEpoch,leaseExpiresAt:expires,
   allowedActions:[...actions],signerKeyId:this.signer.identity.keyId};
 }
 private saveLeased(job:DistributedExecutionJob,worker:AuthenticatedWorkerContext,expires:string):WorkerReceiptOutcome{
  const core=this.capabilityCore(job,worker,expires);
  const state=distributedMakeState(job.intent.intentHash,{
   status:"LEASED",leaseEpoch:job.state.leaseEpoch,attemptCount:job.state.attemptCount,
   leaseOwner:worker.identity.workerId,leaseExpiresAt:expires,
   leaseWorkerKeyId:worker.identity.keyId,leasePoolId:worker.identity.poolId,
   leaseCapabilityCoreHash:workerLeaseCapabilityHash(core)});
  const next={intent:job.intent,state};this.tx.update(next);
  return {kind:"LEASE",job:next,core,signedLease:this.signer.issue(core)};
 }
 private asLease(result:WorkerReceiptOutcome):AuthenticatedExecutionLease|undefined{
  if(result.kind==="IDLE")return undefined;
  const job=notMissing(result.job,"lease job");
  const core=notMissing(result.core,"lease core") as WorkerLeaseCapabilityCore;
  if(result.kind!=="LEASE"
   ||job.intent.jobId!==core.jobId||job.intent.intentHash!==core.intentHash
   ||job.state.leaseEpoch!==core.leaseEpoch||job.state.leaseExpiresAt!==core.leaseExpiresAt
   ||job.state.leaseOwner!==core.workerId||job.state.leaseWorkerKeyId!==core.workerKeyId
   ||job.state.leasePoolId!==core.poolId||job.state.leaseCapabilityCoreHash!==workerLeaseCapabilityHash(core))
   throw new Error("Receipt lease integrity mismatch");
  const signed=notMissing(result.signedLease,"stored signed lease");
  const trusted=this.signer.trustedPublicKeyPem(signed.core.signerKeyId);
  if(!trusted||hashJson(signed.core as any)!==hashJson(core as any)
    ||!verifyWorkerLeaseCapability(signed,{[signed.core.signerKeyId]:trusted}))
    throw new Error("Stored signed lease receipt integrity mismatch");
  return {job:structuredClone(job),capability:structuredClone(signed)};
 }
 async claimNext(proof:WorkerRequestProof,leaseMs:number,serverNow:string):Promise<AuthenticatedExecutionLease|undefined>{
  const at=this.at(serverNow);

  const exists=typeof proof?.workerId==="string"&&typeof proof?.requestId==="string"&&
   Boolean(this.tx.db.prepare("SELECT 1 FROM axiom_worker_operation_receipts WHERE worker_id=? AND request_id=?")
    .get(proof.workerId,proof.requestId));
  const worker=this.auth.authenticate(proof,{action:"CLAIM",bodyHash:hashJson({leaseMs})},at,exists);
  this.leaseMs(leaseMs,worker);
  const outcome=this.tx.transaction(()=>{
   const prior=this.tx.receipt(worker);if(prior)return prior;
   const row=selectFairSQLite(this.tx.db,at);
   if(!row){const idle={kind:"IDLE" as const};this.tx.save(worker,idle,at);return idle;}
   const job=this.tx.verify(row);
   const next={intent:job.intent,state:distributedMakeState(job.intent.intentHash,{
    status:"LEASED",leaseEpoch:job.state.leaseEpoch+1,attemptCount:job.state.attemptCount+1})};
   const expires=new Date(Date.parse(at)+leaseMs).toISOString();
   const result=this.saveLeased(next,worker,expires);
   recordFairSQLite(this.tx.db,job.intent.tenantId);
   this.tx.save(worker,result,at);return result;
  });
  return this.asLease(outcome);
 }
 private validLease(worker:AuthenticatedWorkerContext,capability:WorkerLeaseCapability,at:string):DistributedExecutionJob{
  const core=capability?.core;
  if(!core||!core.signerKeyId)throw new Error("INVALID_LEASE_CAPABILITY");
  const pem=this.signer.trustedPublicKeyPem(core.signerKeyId);
  if(!pem||!verifyWorkerLeaseCapability(capability,{[core.signerKeyId]:pem}))
   throw new Error("INVALID_LEASE_CAPABILITY");
  if(!core.allowedActions.includes(worker.action as any)
   ||core.workerId!==worker.identity.workerId||core.workerKeyId!==worker.identity.keyId
   ||core.poolId!==worker.identity.poolId||core.jobId!==worker.targetJobId)
   throw new Error("INVALID_LEASE_CAPABILITY");
  const job=this.tx.verify(this.tx.row(core.tenantId,core.jobId));
  if(job.state.status!=="LEASED"||job.state.leaseOwner!==core.workerId
   ||job.state.leaseWorkerKeyId!==core.workerKeyId||job.state.leasePoolId!==core.poolId
   ||job.state.leaseEpoch!==core.leaseEpoch||job.state.leaseExpiresAt!==core.leaseExpiresAt
   ||job.state.leaseCapabilityCoreHash!==workerLeaseCapabilityHash(capability)
   ||job.intent.intentHash!==core.intentHash||Date.parse(core.leaseExpiresAt)<=Date.parse(at))
   throw new Error("LEASE_LOST");
  return job;
 }
 private mutate(
  proof:WorkerRequestProof,capability:WorkerLeaseCapability,action:Exclude<WorkerAction,"CLAIM">,
  body:unknown,serverNow:string,fn:(job:DistributedExecutionJob,worker:AuthenticatedWorkerContext,at:string)=>WorkerReceiptOutcome
 ):WorkerReceiptOutcome{
  const at=this.at(serverNow);

  const exists=typeof proof?.workerId==="string"&&typeof proof?.requestId==="string"&&
   Boolean(this.tx.db.prepare("SELECT 1 FROM axiom_worker_operation_receipts WHERE worker_id=? AND request_id=?")
    .get(proof.workerId,proof.requestId));
  const worker=this.auth.authenticate(proof,{action,bodyHash:hashJson(body as any),targetJobId:proof?.targetJobId},at,exists);
  return this.tx.transaction(()=>{
   const prior=this.tx.receipt(worker);if(prior)return prior;
   const job=this.validLease(worker,capability,at);
   const result=fn(job,worker,at);this.tx.save(worker,result,at);return result;
  });
 }
async heartbeat(proof:WorkerRequestProof,capability:WorkerLeaseCapability,leaseMs:number,at:string):Promise<AuthenticatedExecutionLease>{
  const result=this.mutate(proof,capability,"HEARTBEAT",{leaseMs,capabilityId:capability.capabilityId},at,(job,worker,time)=>{
   this.leaseMs(leaseMs,worker);
   return this.saveLeased(job,worker,new Date(Date.parse(time)+leaseMs).toISOString());
  });
  return notMissing(this.asLease(result),"heartbeat");
 }
 async releaseForRetry(proof:WorkerRequestProof,capability:WorkerLeaseCapability,at:string):Promise<DistributedExecutionJob>{
  const result=this.mutate(proof,capability,"RELEASE",{capabilityId:capability.capabilityId},at,job=>{
   const next={intent:job.intent,state:distributedMakeState(job.intent.intentHash,{
    status:"PENDING",leaseEpoch:job.state.leaseEpoch,attemptCount:job.state.attemptCount})};
   this.tx.update(next);return {kind:"JOB",job:next};
  });
  return structuredClone(notMissing(result.job,"release result"));
 }
 async complete(proof:WorkerRequestProof,capability:WorkerLeaseCapability,at:string,outcome:ControlPlaneResult):Promise<DistributedExecutionJob>{
  const result=this.mutate(proof,capability,"COMPLETE",{capabilityId:capability.capabilityId,result:outcome},at,(job,worker,time)=>{
   distributedResultShape(job.intent,outcome);
   const next={intent:job.intent,state:distributedMakeState(job.intent.intentHash,{
    status:outcome.status==="APPROVED"?"SUCCEEDED":"DENIED",
    leaseEpoch:job.state.leaseEpoch,attemptCount:job.state.attemptCount,
    terminalAt:time,result:structuredClone(outcome),resultHash:hashJson(outcome as any)})};
   this.tx.update(next);return {kind:"JOB",job:next};
  });
  return structuredClone(notMissing(result.job,"complete result"));
 }
 async failTerminal(proof:WorkerRequestProof,capability:WorkerLeaseCapability,at:string,code:"STALE"|"FAILED_INTEGRITY"):Promise<DistributedExecutionJob>{
  if(code!=="STALE"&&code!=="FAILED_INTEGRITY")throw new TypeError("Unsupported worker failure code");
  const result=this.mutate(proof,capability,"FAIL_TERMINAL",{capabilityId:capability.capabilityId,code},at,(job,worker,time)=>{
   const next={intent:job.intent,state:distributedMakeState(job.intent.intentHash,{
    status:code,leaseEpoch:job.state.leaseEpoch,attemptCount:job.state.attemptCount,
    terminalAt:time,failureCode:code})};
   this.tx.update(next);return {kind:"JOB",job:next};
  });
  return structuredClone(notMissing(result.job,"terminal result"));
 }
}
