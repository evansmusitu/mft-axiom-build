import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {DistributedExecutionStore} from "../src/distributed_execution_store.ts";
import {generateKeyPairSync,sign} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import {hashJson,canonicalize} from "../../phase1/src/canonical.ts";
import {AuthenticatedDistributedExecutionStore} from "../src/authenticated_distributed_store.ts";
import {WorkerRequestAuthenticator,StaticWorkerTrustStore,createWorkerTrustRecord,workerRequestSigningPayload} from "../src/worker_authentication.ts";
import {createStaticWorkerLeaseSigner} from "../src/worker_lease_capability.ts";

const A={tenantId:"tenant:fair-a"},B={tenantId:"tenant:fair-b"},H=(x:string)=>x.repeat(64);
function intent(tenantId:string,requestHash:string,createdAt:string){
 return {tenantId,principalId:"principal:fair",authorizationDecisionHash:H("a"),requestHash,
 compilationId:"model-compilation:"+H("b"),compilationRecordHash:H("c"),
 profileId:"profile:fair",profileVersion:"1",profileHash:H("d"),
 compilerManifest:{id:"axiom.phase1-compiler",version:"1",implementationHash:H("e")},
 operationRegistryManifestHash:H("f"),
 executionRequest:{asOf:"2026-11-01T10:00:00.000Z",issuedAt:"2026-11-01T10:00:01.000Z",
 program:{irVersion:"0.1",objective:"fair",assumptions:[],inputs:{},nodes:[],constraints:[],decisionNodeId:"decision"},requirements:[],bindings:[]},
 snapshotId:"snapshot:"+H("1"),snapshotHash:H("2"),createdAt};
}
test("explicitly enabled fair claims rotate tenants before draining oldest backlog and survive restart",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"axiom-fair-")),path=join(dir,"jobs.db");
 let jobs=new DistributedExecutionStore(path);
 try{
  await jobs.enableTenantFairScheduling();
  const a1=await jobs.create(A,intent(A.tenantId,H("1"),"2026-11-01T10:00:02.000Z"));
  const a2=await jobs.create(A,intent(A.tenantId,H("2"),"2026-11-01T10:00:02.100Z"));
  const b1=await jobs.create(B,intent(B.tenantId,H("3"),"2026-11-01T10:00:02.200Z"));
  assert.equal((await jobs.claimNext("worker:first","2026-11-01T10:00:03.000Z",5000))?.job.intent.jobId,a1.intent.jobId);
  assert.equal((await jobs.claimNext("worker:second","2026-11-01T10:00:03.001Z",5000))?.job.intent.jobId,b1.intent.jobId);
  assert.equal((await jobs.claimNext("worker:third","2026-11-01T10:00:03.002Z",5000))?.job.intent.jobId,a2.intent.jobId);
  jobs.close();
  jobs=new DistributedExecutionStore(path);
  await jobs.enableTenantFairScheduling();
  const a3=await jobs.create(A,intent(A.tenantId,H("4"),"2026-11-01T10:00:02.300Z"));
  const b2=await jobs.create(B,intent(B.tenantId,H("5"),"2026-11-01T10:00:02.400Z"));
  assert.equal((await jobs.claimNext("worker:fourth","2026-11-01T10:00:03.003Z",5000))?.job.intent.jobId,b2.intent.jobId);
  assert.equal((await jobs.claimNext("worker:fifth","2026-11-01T10:00:03.004Z",5000))?.job.intent.jobId,a3.intent.jobId);
  assert.equal(await jobs.claimNext("worker:idle","2026-11-01T10:00:03.005Z",5000),undefined);
 }finally{try{jobs.close();}catch{}rmSync(dir,{recursive:true,force:true});}
});
test("before explicit fair-mode activation historical FIFO claim order is preserved",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"axiom-fair-off-")),path=join(dir,"jobs.db");
 const jobs=new DistributedExecutionStore(path);
 try{
  const a1=await jobs.create(A,intent(A.tenantId,H("6"),"2026-11-01T10:00:02.000Z"));
  const a2=await jobs.create(A,intent(A.tenantId,H("7"),"2026-11-01T10:00:02.100Z"));
  await jobs.create(B,intent(B.tenantId,H("8"),"2026-11-01T10:00:02.200Z"));
  assert.equal((await jobs.claimNext("worker:first","2026-11-01T10:00:03.000Z",5000))?.job.intent.jobId,a1.intent.jobId);
  assert.equal((await jobs.claimNext("worker:second","2026-11-01T10:00:03.001Z",5000))?.job.intent.jobId,a2.intent.jobId);
 }finally{jobs.close();rmSync(dir,{recursive:true,force:true});}
});

test("authenticated SQLite claim replay never rotates fair cursor or consumes another tenant",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"axiom-fair-auth-")),path=join(dir,"jobs.db");
 const jobs=new DistributedExecutionStore(path);
 const wk=generateKeyPairSync("ed25519"),lk=generateKeyPairSync("ed25519");
 const trust=createWorkerTrustRecord({workerId:"worker:fair",keyId:"wk:fair",poolId:"pool:fair",
  publicKeyPem:wk.publicKey.export({type:"spki",format:"pem"}).toString(),status:"ACTIVE",
  maxLeaseMs:5000,allowedActions:["CLAIM","HEARTBEAT","RELEASE","COMPLETE","FAIL_TERMINAL"]});
 const auth=new WorkerRequestAuthenticator(new StaticWorkerTrustStore([trust]),{maxAgeMs:30000,futureSkewMs:5000});
 let secure:AuthenticatedDistributedExecutionStore|undefined;let i=0;
 const now="2026-11-01T10:00:03.000Z";
 function proof(){
  const base={protocolVersion:"axiom.worker-request/v1" as const,workerId:"worker:fair",keyId:"wk:fair",
   requestId:"fair-auth:"+(++i),action:"CLAIM" as const,bodyHash:hashJson({leaseMs:1000}),issuedAt:now};
  return {...base,signatureBase64:sign(null,Buffer.from(canonicalize(workerRequestSigningPayload(base))),wk.privateKey).toString("base64")};
 }
 try{
  await jobs.enableTenantFairScheduling();
  const a1=await jobs.create(A,intent(A.tenantId,H("a"),"2026-11-01T10:00:02.000Z"));
  const a2=await jobs.create(A,intent(A.tenantId,H("b"),"2026-11-01T10:00:02.100Z"));
  const b1=await jobs.create(B,intent(B.tenantId,H("c"),"2026-11-01T10:00:02.200Z"));
  secure=new AuthenticatedDistributedExecutionStore(path,auth,createStaticWorkerLeaseSigner("lease:fair",lk));
  const p=proof(),first=await secure.claimNext(p,1000,now);
  assert.equal(first?.job.intent.jobId,a1.intent.jobId);
  const readCursor=()=>{
   const db=new DatabaseSync(path);
   try{return (db.prepare("SELECT ordinal FROM axiom_tenant_fair_cursor WHERE singleton=1").get() as any).ordinal}
   finally{db.close();}
  };
  assert.equal(readCursor(),1);
  assert.deepEqual(await secure.claimNext(p,1000,"2026-11-01T10:00:03.100Z"),first);
  assert.equal(readCursor(),1);
  const second=await secure.claimNext(proof(),1000,now);
  assert.equal(second?.job.intent.jobId,b1.intent.jobId);
  const third=await secure.claimNext(proof(),1000,now);
  assert.equal(third?.job.intent.jobId,a2.intent.jobId);
  assert.equal(readCursor(),3);
 }finally{secure?.close();jobs.close();rmSync(dir,{recursive:true,force:true});}
});
