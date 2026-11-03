import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DistributedExecutionStore} from "../src/distributed_execution_store.ts";

const H=(c:string)=>c.repeat(64),A={tenantId:"tenant:quota-a"},B={tenantId:"tenant:quota-b"};
function intent(tenantId:string,requestHash:string){
 return {tenantId,principalId:"principal:quota",authorizationDecisionHash:H("a"),requestHash,
 compilationId:"model-compilation:"+H("b"),compilationRecordHash:H("c"),
 profileId:"profile:quota",profileVersion:"1",profileHash:H("d"),
 compilerManifest:{id:"axiom.phase1-compiler",version:"1",implementationHash:H("e")},
 operationRegistryManifestHash:H("f"),
 executionRequest:{asOf:"2026-11-01T12:00:00.000Z",issuedAt:"2026-11-01T12:00:01.000Z",
 program:{irVersion:"0.1",objective:"quota",assumptions:[],inputs:{},nodes:[],constraints:[],decisionNodeId:"decision"},
 requirements:[],bindings:[]},snapshotId:"snapshot:"+H("1"),snapshotHash:H("2"),
 createdAt:tenantId==="tenant:quota-b"?"2026-11-01T12:00:02.200Z":"2026-11-01T12:00:02.000Z"};
}
test("configured quota rejects excess jobs but allows exact replay, tenant isolation and terminal capacity release",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"axiom-quota-")),path=join(dir,"jobs.db");
 const one=new DistributedExecutionStore(path),two=new DistributedExecutionStore(path);
 try{
  await one.installTenantAdmissionQuotas([{tenantId:A.tenantId,maxOutstandingJobs:1},
   {tenantId:B.tenantId,maxOutstandingJobs:1}]);
  const first=await one.create(A,intent(A.tenantId,H("3")));
  assert.equal((await two.create(A,intent(A.tenantId,H("3")))).intent.jobId,first.intent.jobId);
  await assert.rejects(()=>two.create(A,intent(A.tenantId,H("4"))),/TENANT_QUOTA_EXCEEDED/);
  await assert.rejects(()=>one.create({tenantId:"tenant:unregistered"},intent("tenant:unregistered",H("5"))),/TENANT_QUOTA_UNCONFIGURED/);
  const independent=await two.create(B,intent(B.tenantId,H("5")));
  assert.equal(independent.state.status,"PENDING");
  const lease=await one.claimNext("worker:quota","2026-11-01T12:00:03.000Z",5000);
  assert.equal(lease?.job.intent.jobId,first.intent.jobId);
  await assert.rejects(()=>two.create(A,intent(A.tenantId,H("6"))),/TENANT_QUOTA_EXCEEDED/);
  await one.failTerminal(A,first.intent.jobId,"worker:quota",lease!.leaseEpoch,
   "2026-11-01T12:00:03.100Z","STALE");
  const next=await two.create(A,intent(A.tenantId,H("6")));
  assert.equal(next.state.status,"PENDING");
 }finally{one.close();two.close();rmSync(dir,{recursive:true,force:true});}
});
test("capacity registry cannot be silently reconfigured or bypassed via a second repository instance",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"axiom-quota-policy-")),path=join(dir,"jobs.db");
 const one=new DistributedExecutionStore(path),two=new DistributedExecutionStore(path);
 try{
  await assert.rejects(()=>one.installTenantAdmissionQuotas([{tenantId:A.tenantId,maxOutstandingJobs:0}]),/quota|capacity|positive/i);
  await assert.rejects(()=>one.installTenantAdmissionQuotas([{tenantId:A.tenantId,maxOutstandingJobs:1},
   {tenantId:A.tenantId,maxOutstandingJobs:2}]),/duplicate/i);
  await one.installTenantAdmissionQuotas([{tenantId:A.tenantId,maxOutstandingJobs:1}]);
  await assert.rejects(()=>two.installTenantAdmissionQuotas([{tenantId:A.tenantId,maxOutstandingJobs:2}]),/mismatch|immutable/i);
  await assert.rejects(()=>two.installTenantAdmissionQuotas([{tenantId:B.tenantId,maxOutstandingJobs:2}]),/mismatch|immutable/i);
  await one.create(A,intent(A.tenantId,H("7")));
  await assert.rejects(()=>two.create(A,intent(A.tenantId,H("8"))),/TENANT_QUOTA_EXCEEDED/);
 }finally{one.close();two.close();rmSync(dir,{recursive:true,force:true});}
});
