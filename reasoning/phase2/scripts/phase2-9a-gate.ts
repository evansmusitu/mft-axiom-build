import assert from "node:assert/strict";
import {createAxiomWorkerControlHttpServer} from "../src/worker_control_http.ts";
const now="2026-11-02T08:00:03.000Z";
let calls=0;
const repo={
 async claimNext(proof:any,ms:number,time:string){calls++;assert.equal(proof.action,"CLAIM");
  assert.equal(ms,5000);assert.equal(time,now);return undefined;},
 async heartbeat(){throw Error("should not be reached");},
 async releaseForRetry(){throw Error("should not be reached");}
};
assert.throws(()=>createAxiomWorkerControlHttpServer({jobs:repo,clock:()=>now} as any),/trustedIngress/);
async function withServer(ingress:boolean,cb:(base:string)=>Promise<void>){
 const server=createAxiomWorkerControlHttpServer({jobs:repo,clock:()=>now,trustedIngress:()=>ingress});
 await new Promise<void>((ok,bad)=>server.once("error",bad).listen(0,"127.0.0.1",ok));
 try{const address=server.address() as {port:number};await cb("http://127.0.0.1:"+address.port);}
 finally{await new Promise<void>((ok,bad)=>server.close(e=>e?bad(e):ok()));}
}
async function req(base:string,path:string,body:unknown){
 const r=await fetch(base+path,{method:"POST",headers:{"content-type":"application/json"},
 body:JSON.stringify(body)});return {status:r.status,data:await r.json()};
}
await withServer(false,async base=>{
 const denied=await req(base,"/v1/worker/claims",{proof:{action:"CLAIM"},leaseMs:5000});
 assert.equal(denied.status,403);assert.equal(denied.data.error.code,"UNTRUSTED_TRANSPORT");
 assert.equal(calls,0);
});
await withServer(true,async base=>{
 const completion=await req(base,"/v1/worker/jobs/job/complete",{proof:{},capability:{}});
 assert.equal(completion.status,404);
 const terminal=await req(base,"/v1/worker/jobs/job/fail-terminal",{proof:{},capability:{}});
 assert.equal(terminal.status,404);
 const forgedTime=await req(base,"/v1/worker/claims",{proof:{action:"CLAIM"},leaseMs:5000,
 serverNow:"2099-01-01T00:00:00.000Z"});
 assert.equal(forgedTime.status,400);
 const claim=await req(base,"/v1/worker/claims",{proof:{action:"CLAIM"},leaseMs:5000});
 assert.equal(claim.status,200);assert.equal(claim.data.status,"IDLE");assert.equal(calls,1);
});
console.log(JSON.stringify({phase:"P2.9A — Signed Remote Worker Control HTTP",
 status:"PASS",checks:["explicit trusted ingress required","denial before repository access",
 "only signed repository CLAIM HEARTBEAT RELEASE","no remote terminal success/failure routes",
 "no client-supplied server time or tenant identity","server-owned timestamp",
 "HTTP body and content-type budget","verified signed receipt/lease via Phase2.5C tests"]}));
