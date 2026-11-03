import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {generateKeyPairSync,sign} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import {canonicalize,hashJson} from "../../phase1/src/canonical.ts";
import {DistributedExecutionStore} from "../src/distributed_execution_store.ts";
import {createWorkerTrustRecord,StaticWorkerTrustStore,WorkerRequestAuthenticator,workerRequestSigningPayload} from "../src/worker_authentication.ts";
import {createStaticWorkerLeaseSigner,verifyWorkerLeaseCapability,workerLeaseCapabilityHash} from "../src/worker_lease_capability.ts";
import {AuthenticatedDistributedExecutionStore} from "../src/authenticated_distributed_store.ts";
const scope={tenantId:"tenant:authenticated-jobs"};
const H=(x:string)=>x.repeat(64);
function core(requestHash=H("b")){
 return {tenantId:scope.tenantId,principalId:"principal:test",authorizationDecisionHash:H("a"),requestHash,
 compilationId:"model-compilation:"+H("c"),compilationRecordHash:H("d"),profileId:"p",profileVersion:"1",
 profileHash:H("e"),compilerManifest:{id:"axiom.phase1-compiler",version:"1",implementationHash:H("f")},
 operationRegistryManifestHash:H("1"),executionRequest:{asOf:"2026-10-09T16:00:00.000Z",
 issuedAt:"2026-10-09T16:00:01.000Z",program:{irVersion:"0.1",objective:"test",assumptions:[],inputs:{},nodes:[],
 constraints:[],decisionNodeId:"decision"},requirements:[],bindings:[]},snapshotId:"snapshot:"+H("2"),
 snapshotHash:H("3"),createdAt:"2026-10-09T16:00:02.000Z"};
}
async function fixture(){
 const dir=mkdtempSync(join(tmpdir(),"axiom-auth-jobs-")),path=join(dir,"jobs.db");
 const legacy=new DistributedExecutionStore(path);
 const workerKeys=generateKeyPairSync("ed25519"),leaseKeys=generateKeyPairSync("ed25519");
 const workerPem=workerKeys.publicKey.export({type:"spki",format:"pem"}).toString();
 const record=createWorkerTrustRecord({workerId:"worker:one",keyId:"wk:one",poolId:"trusted",
 publicKeyPem:workerPem,status:"ACTIVE",maxLeaseMs:20000,
 allowedActions:["CLAIM","HEARTBEAT","RELEASE","COMPLETE","FAIL_TERMINAL"]});
 const auth=new WorkerRequestAuthenticator(new StaticWorkerTrustStore([record]),{maxAgeMs:30000,futureSkewMs:5000});
 const signer=createStaticWorkerLeaseSigner("lease:one",leaseKeys);
 const secure=new AuthenticatedDistributedExecutionStore(path,auth,signer);
 let n=0;
 function proof(action:"CLAIM"|"HEARTBEAT"|"RELEASE"|"COMPLETE"|"FAIL_TERMINAL",body:unknown,targetJobId?:string,issuedAt="2026-10-09T16:00:03.000Z"){
   const base={protocolVersion:"axiom.worker-request/v1" as const,workerId:"worker:one",keyId:"wk:one",
   requestId:"req:"+ (++n),action,bodyHash:hashJson(body as any),issuedAt,...targetJobId===undefined?{}:{targetJobId}};
   return {...base,signatureBase64:sign(null,Buffer.from(canonicalize(workerRequestSigningPayload(base))),workerKeys.privateKey).toString("base64")};
 }
 return {dir,legacy,secure,signer,leaseKeys,record,proof,close(){secure.close();legacy.close();rmSync(dir,{recursive:true,force:true});}};
}
test("authenticated claim is the only authority and exact retry cannot take another job",async()=>{
 const f=await fixture();
 try{
   const a=await f.legacy.create(scope,core());
   await f.legacy.create(scope,core(H("9")));
   await assert.rejects(()=>f.secure.claimNext("worker:one" as any,5000,"2026-10-09T16:00:03.000Z"));
   const p=f.proof("CLAIM",{leaseMs:5000});
   const first=await f.secure.claimNext(p,5000,"2026-10-09T16:00:03.000Z");
   assert.equal(first?.job.intent.jobId,a.intent.jobId);
   assert.equal(first?.job.state.leaseEpoch,1);
   assert.equal(first?.job.state.leaseWorkerKeyId,"wk:one");
   assert.ok(first?.capability);
   assert.equal(verifyWorkerLeaseCapability(first!.capability,{"lease:one":f.leaseKeys.publicKey}),true);
   const repeat=await f.secure.claimNext(p,5000,"2026-10-09T16:00:05.000Z");
   assert.deepEqual(repeat,first);
   assert.equal((await f.legacy.get(scope,a.intent.jobId)).state.attemptCount,1);
   const second=await f.secure.claimNext(f.proof("CLAIM",{leaseMs:5000}),5000,"2026-10-09T16:00:03.000Z");
   assert.notEqual(second?.job.intent.jobId,a.intent.jobId);
   await assert.rejects(()=>f.legacy.complete(scope,a.intent.jobId,"worker:one",1,"2026-10-09T16:00:04.000Z",{} as any));
 }finally{f.close();}
});
test("heartbeat rotates active capability; stale, mismatched and expired tokens cannot mutate",async()=>{
 const f=await fixture();try{
 const job=await f.legacy.create(scope,core());
 const claim=await f.secure.claimNext(f.proof("CLAIM",{leaseMs:2000}),2000,"2026-10-09T16:00:03.000Z");
 assert.ok(claim);
 const hb=await f.secure.heartbeat(
 f.proof("HEARTBEAT",{leaseMs:2000,capabilityId:claim!.capability.capabilityId},job.intent.jobId,"2026-10-09T16:00:03.500Z"),
 claim!.capability,2000,"2026-10-09T16:00:03.500Z");
 assert.notEqual(hb.capability.capabilityId,claim!.capability.capabilityId);
 await assert.rejects(()=>f.secure.releaseForRetry(
 f.proof("RELEASE",{capabilityId:claim!.capability.capabilityId},job.intent.jobId,"2026-10-09T16:00:03.600Z"),
 claim!.capability,"2026-10-09T16:00:03.600Z"));
 const forged=structuredClone(hb.capability);forged.core.jobId="other";
 await assert.rejects(()=>f.secure.releaseForRetry(
 f.proof("RELEASE",{capabilityId:hb.capability.capabilityId},job.intent.jobId,"2026-10-09T16:00:03.600Z"),forged,"2026-10-09T16:00:03.600Z"));
 await assert.rejects(()=>f.secure.releaseForRetry(
 f.proof("RELEASE",{capabilityId:hb.capability.capabilityId},job.intent.jobId,"2026-10-09T16:00:06.000Z"),
 hb.capability,"2026-10-09T16:00:06.000Z"));
 const released=await f.secure.releaseForRetry(
 f.proof("RELEASE",{capabilityId:hb.capability.capabilityId},job.intent.jobId,"2026-10-09T16:00:04.000Z"),hb.capability,"2026-10-09T16:00:04.000Z");
 assert.equal(released.state.status,"PENDING");
 assert.equal(released.state.leaseCapabilityCoreHash,undefined);
 }finally{f.close();}
});
test("request conflicts and receipt tampering fail closed",async()=>{
 const f=await fixture();try{
 await f.legacy.create(scope,core());
 const p=f.proof("CLAIM",{leaseMs:1000});
 const first=await f.secure.claimNext(p,1000,"2026-10-09T16:00:03.000Z");
 assert.ok(first);
 await assert.rejects(()=>f.secure.claimNext(p,2000,"2026-10-09T16:00:03.000Z"),/conflict|mismatch/i);
 }finally{f.close();}
});

test("revoked worker credentials cannot mutate even a currently valid signed lease",async()=>{
 const f=await fixture();let blocked:AuthenticatedDistributedExecutionStore|undefined;
 try{
  const job=await f.legacy.create(scope,core());
  const lease=await f.secure.claimNext(f.proof("CLAIM",{leaseMs:5000}),5000,"2026-10-09T16:00:03.000Z");
  assert.ok(lease);
  const revoked=createWorkerTrustRecord({workerId:f.record.identity.workerId,keyId:f.record.identity.keyId,
   poolId:f.record.identity.poolId,publicKeyPem:f.record.publicKeyPem,status:"REVOKED",
   maxLeaseMs:f.record.maxLeaseMs,allowedActions:[...f.record.allowedActions]});
  blocked=new AuthenticatedDistributedExecutionStore(join(f.dir,"jobs.db"),
   new WorkerRequestAuthenticator(new StaticWorkerTrustStore([revoked]),{maxAgeMs:30000,futureSkewMs:5000}),f.signer);
  await assert.rejects(()=>blocked!.releaseForRetry(
   f.proof("RELEASE",{capabilityId:lease!.capability.capabilityId},job.intent.jobId),
   lease!.capability,"2026-10-09T16:00:03.500Z"),/UNAUTHENTICATED/);
  assert.equal((await f.legacy.get(scope,job.intent.jobId)).state.status,"LEASED");
 }finally{blocked?.close();f.close();}
});
test("legacy lease cannot mutate after secure-mode migration and reclaims only after expiry",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"axiom-secure-migrate-")),path=join(dir,"jobs.db");
 const legacy=new DistributedExecutionStore(path);
 let secure:AuthenticatedDistributedExecutionStore|undefined;
 try{
  const job=await legacy.create(scope,core());
  const old=await legacy.claimNext("legacy:worker","2026-10-09T16:00:03.000Z",1000);
  assert.ok(old);
  const keys=generateKeyPairSync("ed25519"),leaseKey=generateKeyPairSync("ed25519");
  const auth=new WorkerRequestAuthenticator(new StaticWorkerTrustStore([
   createWorkerTrustRecord({workerId:"migrated:worker",keyId:"wk:migrated",poolId:"trusted",
    publicKeyPem:keys.publicKey.export({type:"spki",format:"pem"}).toString(),status:"ACTIVE",
    maxLeaseMs:5000,allowedActions:["CLAIM","HEARTBEAT","RELEASE","COMPLETE","FAIL_TERMINAL"]})
  ]),{maxAgeMs:30000,futureSkewMs:5000});
  secure=new AuthenticatedDistributedExecutionStore(path,auth,createStaticWorkerLeaseSigner("lease:migrate",leaseKey));
  let n=0;
  const claimProof=(issuedAt:string)=>{
   const p={protocolVersion:"axiom.worker-request/v1" as const,workerId:"migrated:worker",
    keyId:"wk:migrated",requestId:"migration:"+(++n),action:"CLAIM" as const,
    bodyHash:hashJson({leaseMs:1000}),issuedAt};
   return {...p,signatureBase64:sign(null,Buffer.from(canonicalize(workerRequestSigningPayload(p))),keys.privateKey).toString("base64")};
  };
  await assert.rejects(()=>legacy.releaseForRetry(scope,job.intent.jobId,"legacy:worker",1,
   "2026-10-09T16:00:03.500Z"),/WORKER_AUTH_REQUIRED/);
  assert.equal(await secure.claimNext(claimProof("2026-10-09T16:00:03.500Z"),1000,
   "2026-10-09T16:00:03.500Z"),undefined);
  const reclaimed=await secure.claimNext(claimProof("2026-10-09T16:00:04.000Z"),1000,
   "2026-10-09T16:00:04.000Z");
  assert.equal(reclaimed?.job.intent.jobId,job.intent.jobId);
  assert.equal(reclaimed?.job.state.leaseEpoch,2);
 }finally{secure?.close();legacy.close();rmSync(dir,{recursive:true,force:true});}
});
test("mutated durable worker operation receipts are rejected before idempotent replay",async()=>{
 const f=await fixture();try{
  await f.legacy.create(scope,core());
  const proof=f.proof("CLAIM",{leaseMs:1000});
  await f.secure.claimNext(proof,1000,"2026-10-09T16:00:03.000Z");
  const sql=new DatabaseSync(join(f.dir,"jobs.db"));
  try{sql.prepare("UPDATE axiom_worker_operation_receipts SET outcome_hash=? WHERE worker_id=? AND request_id=?")
   .run("0".repeat(64),proof.workerId,proof.requestId);
  }finally{sql.close();}
  await assert.rejects(()=>f.secure.claimNext(proof,1000,"2026-10-09T16:00:03.000Z"),/integrity/i);
 }finally{f.close();}
});

test("a signed exact worker operation replays after its freshness window without a second claim",async()=>{
 const f=await fixture();try{
  await f.legacy.create(scope,core());
  const proof=f.proof("CLAIM",{leaseMs:1000});
  const first=await f.secure.claimNext(proof,1000,"2026-10-09T16:00:03.000Z");
  assert.ok(first);
  const replay=await f.secure.claimNext(proof,1000,"2026-10-09T16:10:03.000Z");
  assert.deepEqual(replay,first);
  assert.equal((await f.legacy.get(scope,first!.job.intent.jobId)).state.attemptCount,1);
 }finally{f.close();}
});

test("a DB attacker cannot rewrite receipt hashes into authority to mint a new signed lease",async()=>{
 const f=await fixture();try{
  await f.legacy.create(scope,core());
  const proof=f.proof("CLAIM",{leaseMs:1000});
  const original=await f.secure.claimNext(proof,1000,"2026-10-09T16:00:03.000Z");
  assert.ok(original);
  const db=new DatabaseSync(join(f.dir,"jobs.db"));
  try{
   const row=db.prepare("SELECT * FROM axiom_worker_operation_receipts WHERE worker_id=? AND request_id=?")
    .get(proof.workerId,proof.requestId) as any;
   const forged=JSON.parse(row.outcome_json);
   forged.core.tenantId="tenant:forged";
   forged.core.jobId="execution-job:"+H("9");
   forged.job.intent.tenantId=forged.core.tenantId;
   forged.job.intent.jobId=forged.core.jobId;
   forged.job.state.leaseCapabilityCoreHash=workerLeaseCapabilityHash(forged.core);
   const outcomeHash=hashJson(forged);
   const receiptHash=hashJson({
    domain:"AXIOM_WORKER_OPERATION_RECEIPT_V1",workerId:row.worker_id,
    workerKeyId:row.worker_key_id,requestId:row.request_id,action:row.action,
    requestHash:row.request_hash,outcomeHash,createdAt:row.created_at
   });
   db.prepare("UPDATE axiom_worker_operation_receipts SET outcome_json=?,outcome_hash=?,receipt_hash=? WHERE worker_id=? AND request_id=?")
    .run(JSON.stringify(forged),outcomeHash,receiptHash,proof.workerId,proof.requestId);
  }finally{db.close();}
  await assert.rejects(()=>f.secure.claimNext(proof,1000,"2026-10-09T16:00:03.200Z"),/integrity|signature|mismatch/i);
 }finally{f.close();}
});

test("rehashing a terminal worker receipt cannot manufacture a successful result",async()=>{
 const f=await fixture();try{
  const job=await f.legacy.create(scope,core());
  const lease=await f.secure.claimNext(f.proof("CLAIM",{leaseMs:5000}),5000,"2026-10-09T16:00:03.000Z");
  assert.ok(lease);
  const release=f.proof("RELEASE",{capabilityId:lease!.capability.capabilityId},job.intent.jobId);
  const released=await f.secure.releaseForRetry(release,lease!.capability,"2026-10-09T16:00:03.100Z");
  assert.equal(released.state.status,"PENDING");
  const db=new DatabaseSync(join(f.dir,"jobs.db"));
  try{
   const row=db.prepare("SELECT * FROM axiom_worker_operation_receipts WHERE worker_id=? AND request_id=?")
    .get(release.workerId,release.requestId) as any;
   const forged=JSON.parse(row.outcome_json);
   forged.job.state.status="SUCCEEDED";
   forged.job.state.terminalAt="2026-10-09T16:00:03.100Z";
   const outcomeHash=hashJson(forged);
   const receiptHash=hashJson({
    domain:"AXIOM_WORKER_OPERATION_RECEIPT_V1",workerId:row.worker_id,workerKeyId:row.worker_key_id,
    requestId:row.request_id,action:row.action,requestHash:row.request_hash,
    outcomeHash,createdAt:row.created_at
   });
   db.prepare("UPDATE axiom_worker_operation_receipts SET outcome_json=?,outcome_hash=?,receipt_hash=? WHERE worker_id=? AND request_id=?")
    .run(JSON.stringify(forged),outcomeHash,receiptHash,release.workerId,release.requestId);
  }finally{db.close();}
  await assert.rejects(()=>f.secure.releaseForRetry(release,lease!.capability,"2026-10-09T16:00:03.200Z"),
   /integrity|signature|mismatch/i);
 }finally{f.close();}
});
