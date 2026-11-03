import type {Pool,PoolClient} from "pg";
import {hashJson} from "../../phase1/src/canonical.ts";
import {enableFairPostgres,lockFairPostgres,selectFairPostgres,recordFairPostgres} from "./tenant_fair_scheduling_postgres.ts";
import {WorkerRequestAuthenticator,type WorkerRequestProof,type AuthenticatedWorkerContext,type WorkerAction} from "./worker_authentication.ts";
import {type WorkerLeaseCapability,type WorkerLeaseCapabilityCore,type WorkerLeaseCapabilitySigner,
 workerLeaseCapabilityHash,verifyWorkerLeaseCapability} from "./worker_lease_capability.ts";
import {PgAuthenticatedJobTransactions} from "./authenticated_worker_postgres_transactions.ts";
import type {WorkerReceiptOutcome} from "./authenticated_worker_transactions.ts";
import {distributedMakeState,distributedResultShape,distributedIso} from "./distributed_execution_store.ts";
import type {ControlPlaneResult,DistributedExecutionJob} from "./types.ts";
import type {AuthenticatedExecutionLease} from "./authenticated_distributed_store.ts";

function present<T>(v:T|undefined,label:string):T{
 if(v===undefined)throw new Error("Missing "+label);return v;
}
export class AuthenticatedPostgresDistributedExecutionStore{
 private readonly tx:PgAuthenticatedJobTransactions;
 async enableTenantFairScheduling():Promise<void>{await enableFairPostgres(this.tx.pool);}
 async activate():Promise<void>{
  await this.tx.transaction(async client=>this.tx.activate(client));
 }
 private readonly auth:WorkerRequestAuthenticator;
 private readonly signer:WorkerLeaseCapabilitySigner;
 constructor(pool:Pool,auth:WorkerRequestAuthenticator,signer:WorkerLeaseCapabilitySigner){
  if(!pool||!auth||!signer)throw new TypeError("Authenticated PostgreSQL workers require pool, auth, signer");
  this.tx=new PgAuthenticatedJobTransactions(pool,signer);this.auth=auth;this.signer=signer;
 }
 private at(value:string):string{return distributedIso(value,"server time");}
 private leaseMs(ms:number,w:AuthenticatedWorkerContext){
  if(!Number.isSafeInteger(ms)||ms<1||ms>w.maxLeaseMs)throw new Error("WORKER_FORBIDDEN");
 }
 private core(job:DistributedExecutionJob,w:AuthenticatedWorkerContext,exp:string):WorkerLeaseCapabilityCore{
  const actions=(["HEARTBEAT","RELEASE","COMPLETE","FAIL_TERMINAL"] as const).filter(x=>w.allowedActions.includes(x));
  if(!actions.length)throw new Error("WORKER_FORBIDDEN");
  return {protocolVersion:"axiom.worker-lease/v1",workerId:w.identity.workerId,
   workerKeyId:w.identity.keyId,poolId:w.identity.poolId,tenantId:job.intent.tenantId,
   jobId:job.intent.jobId,intentHash:job.intent.intentHash,leaseEpoch:job.state.leaseEpoch,
   leaseExpiresAt:exp,allowedActions:[...actions],signerKeyId:this.signer.identity.keyId};
 }
 private async saveLeased(c:PoolClient,job:DistributedExecutionJob,w:AuthenticatedWorkerContext,exp:string):Promise<WorkerReceiptOutcome>{
  const core=this.core(job,w,exp);
  const next={intent:job.intent,state:distributedMakeState(job.intent.intentHash,{
   status:"LEASED",leaseEpoch:job.state.leaseEpoch,attemptCount:job.state.attemptCount,
   leaseOwner:w.identity.workerId,leaseExpiresAt:exp,
   leaseWorkerKeyId:w.identity.keyId,leasePoolId:w.identity.poolId,
   leaseCapabilityCoreHash:workerLeaseCapabilityHash(core)})};
  await this.tx.update(c,next);
  return {kind:"LEASE",job:next,core,signedLease:this.signer.issue(core)};
 }
 private leaseResult(out:WorkerReceiptOutcome):AuthenticatedExecutionLease|undefined{
  if(out.kind==="IDLE")return undefined;
  const job=present(out.job,"lease job"),core=present(out.core,"lease core") as WorkerLeaseCapabilityCore;
  if(out.kind!=="LEASE"||core.tenantId!==job.intent.tenantId||core.jobId!==job.intent.jobId
   ||core.intentHash!==job.intent.intentHash||core.leaseEpoch!==job.state.leaseEpoch
   ||core.leaseExpiresAt!==job.state.leaseExpiresAt||core.workerId!==job.state.leaseOwner
   ||core.workerKeyId!==job.state.leaseWorkerKeyId||core.poolId!==job.state.leasePoolId
   ||workerLeaseCapabilityHash(core)!==job.state.leaseCapabilityCoreHash)
   throw new Error("Postgres worker receipt lease mismatch");
  const signed=present(out.signedLease,"stored signed lease");
  const trusted=this.signer.trustedPublicKeyPem(signed.core.signerKeyId);
  if(!trusted||hashJson(signed.core as any)!==hashJson(core as any)
    ||!verifyWorkerLeaseCapability(signed,{[signed.core.signerKeyId]:trusted}))
    throw new Error("Stored signed lease receipt integrity mismatch");
  return {job:structuredClone(job),capability:structuredClone(signed)};
 }
 async claimNext(proof:WorkerRequestProof,leaseMs:number,serverNow:string):Promise<AuthenticatedExecutionLease|undefined>{
  const at=this.at(serverNow);
  const old=typeof proof?.workerId==="string"&&typeof proof?.requestId==="string"?
   await this.tx.pool.query("SELECT 1 FROM axiom_worker_operation_receipts WHERE worker_id=$1 AND request_id=$2",
    [proof.workerId,proof.requestId]):undefined;
  const w=this.auth.authenticate(proof,{action:"CLAIM",bodyHash:hashJson({leaseMs})},at,Boolean(old?.rowCount));
  this.leaseMs(leaseMs,w);
  const outcome=await this.tx.transaction(async c=>{
   await this.tx.activate(c);
   const previous=await this.tx.receipt(c,w);if(previous)return previous;
   const fair=await lockFairPostgres(c);
   const row=await selectFairPostgres(c,at,fair);
   if(!row){const idle={kind:"IDLE" as const};await this.tx.save(c,w,idle,at);return idle;}
   const job=this.tx.verify(row);
   const next={intent:job.intent,state:distributedMakeState(job.intent.intentHash,{
    status:"LEASED",leaseEpoch:job.state.leaseEpoch+1,attemptCount:job.state.attemptCount+1})};
   const expiration=new Date(Date.parse(at)+leaseMs).toISOString();
   const result=await this.saveLeased(c,next,w,expiration);
   await recordFairPostgres(c,job.intent.tenantId,fair);
   await this.tx.save(c,w,result,at);return result;
  });
  return this.leaseResult(outcome);
 }
 private async validLease(
  c:PoolClient,w:AuthenticatedWorkerContext,capability:WorkerLeaseCapability,at:string
 ):Promise<DistributedExecutionJob>{
  const core=capability?.core;
  if(!core||!core.signerKeyId)throw new Error("INVALID_LEASE_CAPABILITY");
  const trusted=this.signer.trustedPublicKeyPem(core.signerKeyId);
  if(!trusted||!verifyWorkerLeaseCapability(capability,{[core.signerKeyId]:trusted}))
   throw new Error("INVALID_LEASE_CAPABILITY");
  if(!core.allowedActions.includes(w.action as any)
   ||core.workerId!==w.identity.workerId||core.workerKeyId!==w.identity.keyId
   ||core.poolId!==w.identity.poolId||core.jobId!==w.targetJobId)
   throw new Error("INVALID_LEASE_CAPABILITY");
  const job=this.tx.verify(await this.tx.row(c,core.tenantId,core.jobId));
  if(job.state.status!=="LEASED"||job.intent.intentHash!==core.intentHash
   ||job.state.leaseEpoch!==core.leaseEpoch||job.state.leaseExpiresAt!==core.leaseExpiresAt
   ||job.state.leaseOwner!==core.workerId||job.state.leaseWorkerKeyId!==core.workerKeyId
   ||job.state.leasePoolId!==core.poolId
   ||job.state.leaseCapabilityCoreHash!==workerLeaseCapabilityHash(capability)
   ||Date.parse(core.leaseExpiresAt)<=Date.parse(at))throw new Error("LEASE_LOST");
  return job;
 }
 private async mutate(
  proof:WorkerRequestProof,capability:WorkerLeaseCapability,action:Exclude<WorkerAction,"CLAIM">,
  body:any,serverNow:string,
  transition:(client:PoolClient,job:DistributedExecutionJob,w:AuthenticatedWorkerContext,at:string)=>Promise<WorkerReceiptOutcome>
 ):Promise<WorkerReceiptOutcome>{
  const at=this.at(serverNow);
  const old=typeof proof?.workerId==="string"&&typeof proof?.requestId==="string"?
   await this.tx.pool.query("SELECT 1 FROM axiom_worker_operation_receipts WHERE worker_id=$1 AND request_id=$2",
    [proof.workerId,proof.requestId]):undefined;
  const w=this.auth.authenticate(proof,{action,bodyHash:hashJson(body),targetJobId:proof?.targetJobId},at,Boolean(old?.rowCount));
  return this.tx.transaction(async client=>{
   await this.tx.activate(client);
   const prior=await this.tx.receipt(client,w);if(prior)return prior;
   const job=await this.validLease(client,w,capability,at);
   const out=await transition(client,job,w,at);
   await this.tx.save(client,w,out,at);
   return out;
  });
 }
async heartbeat(proof:WorkerRequestProof,cap:WorkerLeaseCapability,leaseMs:number,at:string):Promise<AuthenticatedExecutionLease>{
  const out=await this.mutate(proof,cap,"HEARTBEAT",{leaseMs,capabilityId:cap.capabilityId},at,async(c,job,w,time)=>{
   this.leaseMs(leaseMs,w);
   return this.saveLeased(c,job,w,new Date(Date.parse(time)+leaseMs).toISOString());
  });
  return present(this.leaseResult(out),"heartbeat lease");
 }
 async releaseForRetry(proof:WorkerRequestProof,cap:WorkerLeaseCapability,at:string):Promise<DistributedExecutionJob>{
  const out=await this.mutate(proof,cap,"RELEASE",{capabilityId:cap.capabilityId},at,async(c,job)=>{
   const next={intent:job.intent,state:distributedMakeState(job.intent.intentHash,{
    status:"PENDING",leaseEpoch:job.state.leaseEpoch,attemptCount:job.state.attemptCount})};
   await this.tx.update(c,next);return {kind:"JOB",job:next};
  });
  return structuredClone(present(out.job,"released job"));
 }
 async complete(proof:WorkerRequestProof,cap:WorkerLeaseCapability,at:string,result:ControlPlaneResult):Promise<DistributedExecutionJob>{
  const out=await this.mutate(proof,cap,"COMPLETE",{capabilityId:cap.capabilityId,result},at,async(c,job,w,time)=>{
   distributedResultShape(job.intent,result);
   const next={intent:job.intent,state:distributedMakeState(job.intent.intentHash,{
    status:result.status==="APPROVED"?"SUCCEEDED":"DENIED",leaseEpoch:job.state.leaseEpoch,
    attemptCount:job.state.attemptCount,terminalAt:time,result:structuredClone(result),resultHash:hashJson(result as any)})};
   await this.tx.update(c,next);return {kind:"JOB",job:next};
  });
  return structuredClone(present(out.job,"completed job"));
 }
 async failTerminal(proof:WorkerRequestProof,cap:WorkerLeaseCapability,at:string,code:"STALE"|"FAILED_INTEGRITY"):Promise<DistributedExecutionJob>{
  if(code!=="STALE"&&code!=="FAILED_INTEGRITY")throw new TypeError("Invalid failure code");
  const out=await this.mutate(proof,cap,"FAIL_TERMINAL",{capabilityId:cap.capabilityId,code},at,async(c,job,w,time)=>{
   const next={intent:job.intent,state:distributedMakeState(job.intent.intentHash,{
    status:code,leaseEpoch:job.state.leaseEpoch,attemptCount:job.state.attemptCount,
    terminalAt:time,failureCode:code})};
   await this.tx.update(c,next);return {kind:"JOB",job:next};
  });
  return structuredClone(present(out.job,"failed job"));
 }
}

export async function createAuthenticatedPostgresDistributedExecutionStore(
 pool:Pool,auth:WorkerRequestAuthenticator,signer:WorkerLeaseCapabilitySigner
):Promise<AuthenticatedPostgresDistributedExecutionStore>{
 const repository=new AuthenticatedPostgresDistributedExecutionStore(pool,auth,signer);
 await repository.activate();
 return repository;
}
