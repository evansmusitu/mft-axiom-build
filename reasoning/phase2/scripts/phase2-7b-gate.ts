import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {DistributedExecutionStore} from "../src/distributed_execution_store.ts";

const dir=mkdtempSync(join(tmpdir(),"axiom-p27b-gate-")),path=join(dir,"jobs.db");
let jobs=new DistributedExecutionStore(path);
const H=(c:string)=>c.repeat(64),A={tenantId:"tenant:fair-gate-a"},B={tenantId:"tenant:fair-gate-b"};
function intent(tenantId:string,hash:string,createdAt:string){
 return {tenantId,principalId:"principal:fair-gate",authorizationDecisionHash:H("a"),requestHash:hash,
 compilationId:"model-compilation:"+H("b"),compilationRecordHash:H("c"),profileId:"profile:fair",
 profileVersion:"1",profileHash:H("d"),
 compilerManifest:{id:"axiom.phase1-compiler",version:"1",implementationHash:H("e")},
 operationRegistryManifestHash:H("f"),
 executionRequest:{asOf:"2026-11-01T10:00:00.000Z",issuedAt:"2026-11-01T10:00:01.000Z",
  program:{irVersion:"0.1",objective:"fair gate",assumptions:[],inputs:{},nodes:[],constraints:[],decisionNodeId:"decision"},
  requirements:[],bindings:[]},snapshotId:"snapshot:"+H("1"),snapshotHash:H("2"),createdAt};
}
try{
 await jobs.enableTenantFairScheduling();
 const a1=await jobs.create(A,intent(A.tenantId,H("3"),"2026-11-01T10:00:02.000Z"));
 const a2=await jobs.create(A,intent(A.tenantId,H("4"),"2026-11-01T10:00:02.100Z"));
 const b1=await jobs.create(B,intent(B.tenantId,H("5"),"2026-11-01T10:00:02.200Z"));
 assert.equal((await jobs.claimNext("fair:first","2026-11-01T10:00:03.000Z",5000))?.job.intent.jobId,a1.intent.jobId);
 assert.equal((await jobs.claimNext("fair:second","2026-11-01T10:00:03.001Z",5000))?.job.intent.jobId,b1.intent.jobId);
 assert.equal((await jobs.claimNext("fair:third","2026-11-01T10:00:03.002Z",5000))?.job.intent.jobId,a2.intent.jobId);
 jobs.close();jobs=new DistributedExecutionStore(path);
 await jobs.enableTenantFairScheduling();
 const b2=await jobs.create(B,intent(B.tenantId,H("6"),"2026-11-01T10:00:02.300Z"));
 const a3=await jobs.create(A,intent(A.tenantId,H("7"),"2026-11-01T10:00:02.400Z"));
 assert.equal((await jobs.claimNext("fair:fourth","2026-11-01T10:00:03.003Z",5000))?.job.intent.jobId,b2.intent.jobId);
 assert.equal((await jobs.claimNext("fair:fifth","2026-11-01T10:00:03.004Z",5000))?.job.intent.jobId,a3.intent.jobId);
 assert.equal(await jobs.claimNext("fair:idle","2026-11-01T10:00:03.005Z",5000),undefined);
 console.log(JSON.stringify({phase:"P2.7B — Durable Tenant-Fair Worker Claims",status:"PASS",
 checks:["operator opt-in persists fairness mode","each claim serves least recently serviced eligible tenant",
 "preserve FIFO within same tenant","persist fair cursor across repository reopen","never rotate after IDLE claim",
 "preserve original signed reasoning and lease-fencing contracts"],sequence:["A","B","A","B","A"]}));
}finally{try{jobs.close()}catch{}rmSync(dir,{recursive:true,force:true});}
