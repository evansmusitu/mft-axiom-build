import type {Pool,PoolClient} from "pg";
import {hashJson} from "../../phase1/src/canonical.ts";
import type {AuthenticatedWorkerContext} from "./worker_authentication.ts";
import type {DistributedExecutionIntent,DistributedExecutionJob} from "./types.ts";
import {distributedVerifyIntent,distributedRowState,distributedVerifyState} from "./distributed_execution_store.ts";
import type {WorkerReceiptOutcome} from "./authenticated_worker_transactions.ts";
import {verifyWorkerReceiptSignature,type WorkerLeaseCapabilitySigner} from "./worker_lease_capability.ts";
function receiptCore(row:any){
 return {domain:"AXIOM_WORKER_OPERATION_RECEIPT_V1",workerId:row.worker_id,
  workerKeyId:row.worker_key_id,requestId:row.request_id,action:row.action,
  requestHash:row.request_hash,outcomeHash:row.outcome_hash,createdAt:row.created_at};
}
export class PgAuthenticatedJobTransactions{
 readonly pool:Pool;
 private readonly signer:WorkerLeaseCapabilitySigner;
 constructor(pool:Pool,signer:WorkerLeaseCapabilitySigner){this.pool=pool;this.signer=signer;}
 async transaction<T>(fn:(client:PoolClient)=>Promise<T>):Promise<T>{
  const c=await this.pool.connect();
  try{await c.query("BEGIN");const res=await fn(c);await c.query("COMMIT");return res;}
  catch(e){try{await c.query("ROLLBACK");}catch{}throw e;}
  finally{c.release();}
 }
 async activate(client:PoolClient):Promise<void>{
  await client.query("INSERT INTO axiom_worker_security_mode(singleton,enabled) VALUES(TRUE,TRUE) ON CONFLICT DO NOTHING");
 }
 verify(row:any):DistributedExecutionJob{
  const scope={tenantId:String(row.tenant_id)};
  const raw=typeof row.intent_json==="string"?JSON.parse(row.intent_json):row.intent_json;
  const intent=distributedVerifyIntent(scope,raw as DistributedExecutionIntent,String(row.intent_hash));
  if(intent.jobId!==String(row.job_id)||intent.createdAt!==String(row.created_at))
   throw new Error("Stored authenticated PostgreSQL worker intent mismatch");
  return {intent,state:distributedVerifyState(intent,distributedRowState(row),String(row.state_hash))};
 }
 async row(c:PoolClient,tenantId:string,jobId:string):Promise<any>{
  const r=await c.query("SELECT * FROM axiom_distributed_execution_jobs WHERE tenant_id=$1 AND job_id=$2 FOR UPDATE",[tenantId,jobId]);
  if(r.rowCount!==1)throw new Error("Worker job absent");
  return r.rows[0];
 }
 async update(c:PoolClient,job:DistributedExecutionJob):Promise<void>{
  const s=job.state;
  const r=await c.query(`UPDATE axiom_distributed_execution_jobs SET status=$1,
   lease_epoch=$2,attempt_count=$3,lease_owner=$4,lease_expires_at=$5,
   lease_worker_key_id=$6,lease_pool_id=$7,lease_capability_hash=$8,
   terminal_at=$9,result_json=$10::jsonb,result_hash=$11,failure_code=$12,state_hash=$13
   WHERE tenant_id=$14 AND job_id=$15`,[
   s.status,s.leaseEpoch,s.attemptCount,s.leaseOwner??null,s.leaseExpiresAt??null,
   s.leaseWorkerKeyId??null,s.leasePoolId??null,s.leaseCapabilityCoreHash??null,
   s.terminalAt??null,s.result===undefined?null:JSON.stringify(s.result),
   s.resultHash??null,s.failureCode??null,s.stateHash,job.intent.tenantId,job.intent.jobId]);
  if(r.rowCount!==1)throw new Error("Worker job update lost");
 }
 async receipt(c:PoolClient,worker:AuthenticatedWorkerContext):Promise<WorkerReceiptOutcome|undefined>{
  const r=await c.query("SELECT * FROM axiom_worker_operation_receipts WHERE worker_id=$1 AND request_id=$2 FOR UPDATE",
   [worker.identity.workerId,worker.requestId]);
  if(!r.rowCount)return undefined;
  const row=r.rows[0];
  if(row.worker_key_id!==worker.identity.keyId||row.action!==worker.action||row.request_hash!==worker.requestHash)
   throw new Error("WORKER_REQUEST_CONFLICT");
  const outcome=typeof row.outcome_json==="string"?JSON.parse(row.outcome_json):row.outcome_json;
  if(row.outcome_hash!==hashJson(outcome)||row.receipt_hash!==hashJson(receiptCore(row) as any))
   throw new Error("Worker operation receipt integrity mismatch");
  const trusted=this.signer.trustedPublicKeyPem(row.receipt_signer_key_id);
  if(!trusted||!verifyWorkerReceiptSignature(row.receipt_hash,row.receipt_signer_key_id,
    row.receipt_signature_base64,trusted))throw new Error("Worker operation receipt signature mismatch");
  return structuredClone(outcome);
 }
 async save(c:PoolClient,worker:AuthenticatedWorkerContext,outcome:WorkerReceiptOutcome,at:string):Promise<void>{
  const row={worker_id:worker.identity.workerId,worker_key_id:worker.identity.keyId,request_id:worker.requestId,
   action:worker.action,request_hash:worker.requestHash,outcome_hash:hashJson(outcome as any),created_at:at};
  const receiptHash=hashJson(receiptCore(row) as any);
  const signerKeyId=this.signer.identity.keyId;
  const signature=this.signer.signReceipt(receiptHash);
  await c.query(`INSERT INTO axiom_worker_operation_receipts
   (worker_id,worker_key_id,request_id,action,request_hash,outcome_json,outcome_hash,created_at,receipt_hash,receipt_signer_key_id,receipt_signature_base64)
   VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11)`,
   [row.worker_id,row.worker_key_id,row.request_id,row.action,row.request_hash,
    JSON.stringify(outcome),row.outcome_hash,row.created_at,receiptHash,signerKeyId,signature]);
 }
}
