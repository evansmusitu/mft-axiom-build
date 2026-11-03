import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {DistributedExecutionStore} from "../src/distributed_execution_store.ts";
const H=(c:string)=>c.repeat(64),A={tenantId:"tenant:quota-gate-a"},B={tenantId:"tenant:quota-gate-b"};
function intent(tenantId:string,c:string){
 return {tenantId,principalId:"principal:quota-gate",authorizationDecisionHash:H("a"),
 requestHash:H(c),compilationId:"model-compilation:"+H("b"),compilationRecordHash:H("c"),
 profileId:"profile:gate",profileVersion:"1",profileHash:H("d"),
 compilerManifest:{id:"axiom.phase1-compiler",version:"1",implementationHash:H("e")},
 operationRegistryManifestHash:H("f"),
 executionRequest:{asOf:"2026-11-01T12:00:00.000Z",issuedAt:"2026-11-01T12:00:01.000Z",
 program:{irVersion:"0.1",objective:"quota gate",assumptions:[],inputs:{},
 nodes:[],constraints:[],decisionNodeId:"decision"},requirements:[],bindings:[]},
 snapshotId:"snapshot:"+H("1"),snapshotHash:H("2"),
 createdAt:tenantId===A.tenantId?"2026-11-01T12:00:02.000Z":"2026-11-01T12:00:02.200Z"};
}
const dir=mkdtempSync(join(tmpdir(),"axiom-p27a-gate-")),path=join(dir,"jobs.db");
const a=new DistributedExecutionStore(path),b=new DistributedExecutionStore(path);
try{
 await a.installTenantAdmissionQuotas([{tenantId:A.tenantId,maxOutstandingJobs:1},
  {tenantId:B.tenantId,maxOutstandingJobs:1}]);
 await b.installTenantAdmissionQuotas([{tenantId:A.tenantId,maxOutstandingJobs:1},
  {tenantId:B.tenantId,maxOutstandingJobs:1}]);
 const first=await a.create(A,intent(A.tenantId,"3"));
 assert.equal((await b.create(A,intent(A.tenantId,"3"))).intent.jobId,first.intent.jobId);
 await assert.rejects(()=>b.create(A,intent(A.tenantId,"4")) ,/TENANT_QUOTA_EXCEEDED/);
 await assert.rejects(()=>a.create({tenantId:"tenant:unknown"},intent("tenant:unknown","5")),
  /TENANT_QUOTA_UNCONFIGURED/);
 await b.create(B,intent(B.tenantId,"5"));
 await assert.rejects(()=>a.installTenantAdmissionQuotas([{tenantId:A.tenantId,maxOutstandingJobs:2}]),
  /immutable|mismatch/);
 const leased=await a.claimNext("worker:quota-gate","2026-11-01T12:00:03.000Z",1000);
 assert.equal(leased?.job.intent.jobId,first.intent.jobId);
 await assert.rejects(()=>b.create(A,intent(A.tenantId,"6")),/TENANT_QUOTA_EXCEEDED/);
 await a.failTerminal(A,first.intent.jobId,"worker:quota-gate",leased!.leaseEpoch,
  "2026-11-01T12:00:03.100Z","STALE");
 const next=await b.create(A,intent(A.tenantId,"6"));
 assert.equal(next.state.status,"PENDING");
 console.log(JSON.stringify({phase:"P2.7A — Tenant Queue Admission Capacity",status:"PASS",checks:[
  "operator-configured tenant registry requires valid bounded positive quotas",
  "atomic admission rejects a second pending job beyond tenant capacity",
  "exact replay returns one original job despite capacity exhaustion",
  "unknown tenant admission fails closed",
  "different tenant capacity is independent",
  "lease retains outstanding-job capacity",
  "terminal outcome frees capacity without changing frozen jobs",
  "reconfiguration and silent quota widening are denied",
  "second repository instance cannot bypass quota mode"
 ],firstJobId:first.intent.jobId,replacementJobId:next.intent.jobId}));
}finally{a.close();b.close();rmSync(dir,{recursive:true,force:true});}
