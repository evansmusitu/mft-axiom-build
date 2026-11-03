import assert from "node:assert/strict";
import {createAxiomWorkerControlHttpServer} from "../src/worker_control_http.ts";
let calls=0;
const jobs={async claimNext(){return undefined;},async heartbeat(){throw Error("unused");},
 async releaseForRetry(){throw Error("unused");}};
const verifier={async complete(proof:any,cap:any,result:any,now:string){
 calls++;assert.equal(proof.action,"COMPLETE");assert.equal(cap.capabilityId,"cap:gate");
 assert.equal(result.status,"APPROVED");assert.equal(now,"2026-11-02T08:00:04.000Z");
 return {intent:{jobId:"job:gate"},state:{status:"SUCCEEDED"}} as any;
}};
async function withServer(enabled:boolean,fn:(base:string)=>Promise<void>){
 const server=createAxiomWorkerControlHttpServer({
  jobs,clock:()=>"2026-11-02T08:00:04.000Z",trustedIngress:()=>true,
  ...(enabled?{verifiedCompletion:verifier}:{})
 });
 await new Promise<void>((ok,bad)=>server.once("error",bad).listen(0,"127.0.0.1",ok));
 try{await fn("http://127.0.0.1:"+(server.address() as {port:number}).port);}
 finally{await new Promise<void>((ok,bad)=>server.close(e=>e?bad(e):ok()));}
}
async function send(base:string,path:string,obj:any){
 const r=await fetch(base+path,{method:"POST",headers:{"content-type":"application/json"},
 body:JSON.stringify(obj)});return {status:r.status,data:await r.json()};
}
const path="/v1/worker/jobs/job%3Agate/complete";
const body={proof:{action:"COMPLETE",targetJobId:"job:gate"},
 capability:{capabilityId:"cap:gate",core:{}},
 result:{status:"APPROVED",snapshotId:"s",policyDecision:{status:"ALLOW",snapshotId:"s",checks:[]},
 certificateId:"c",executionRecordId:"r"}};
await withServer(false,async base=>{assert.equal((await send(base,path,body)).status,404);});
await withServer(true,async base=>{
 assert.deepEqual(await send(base,path,body),{status:200,
  data:{status:"COMPLETED",jobStatus:"SUCCEEDED",jobId:"job:gate"}});
 assert.equal((await send(base,path,{...body,serverTime:"2099"})).status,400);
 assert.equal((await send(base,path,{...body,result:{status:"APPROVED"}})).status,400);
 assert.equal((await send(base,"/v1/worker/jobs/job%3Agate/fail-terminal",body)).status,404);
});
assert.equal(calls,1);
await import("./phase2-9b-gate.ts");
console.log(JSON.stringify({phase:"P2.9C — Opt-In Verified Remote Completion HTTP",
 status:"PASS",checks:["default route absent","explicit trusted completion service mandatory",
 "exact worker job action and body shape","no remote FAIL_TERMINAL",
 "server-owned time","no unverified completion fallback",
 "real certificate and replay tests in Phase-2 conformance"]}));
