import {createServer,type IncomingMessage,type Server} from "node:http";
import {URL} from "node:url";
import {distributedIso} from "./distributed_execution_store.ts";
import type {AuthenticatedWorkerJobRepository} from "./authenticated_worker_runtime.ts";
import type {WorkerRequestProof} from "./worker_authentication.ts";
import type {ControlPlaneResult} from "./types.ts";
import type {VerifiedRemoteCompletionService} from "./verified_remote_completion.ts";
import type {WorkerLeaseCapability} from "./worker_lease_capability.ts";

const MAX_REQUEST_BYTES=32*1024;
const MAX_RESPONSE_BYTES=1024*1024;
class HttpWorkerInputError extends Error{
 readonly status:number;
 readonly code:string;
 constructor(status:number,code:string){super(code);this.status=status;this.code=code;}
}
function object(value:unknown):value is Record<string,any>{
 return value!==null&&typeof value==="object"&&!Array.isArray(value);
}
function exact(value:unknown,keys:string[]):value is Record<string,any>{
 return object(value)&&Object.keys(value).sort().join("\0")===keys.slice().sort().join("\0");
}
function result(res:any,status:number,body:unknown):void{
 const json=JSON.stringify(body);
 if(Buffer.byteLength(json,"utf8")>MAX_RESPONSE_BYTES){
  res.writeHead(500,{"content-type":"application/json","cache-control":"no-store"});
  res.end('{"error":{"code":"RESPONSE_TOO_LARGE"}}');return;
 }
 res.writeHead(status,{"content-type":"application/json","cache-control":"no-store",
  "x-content-type-options":"nosniff"});
 res.end(json);
}
function error(res:any,status:number,code:string):void{
 result(res,status,{error:{code}});
}
function route(req:IncomingMessage,allowVerifiedCompletion:boolean):{action:"CLAIM"|"HEARTBEAT"|"RELEASE"|"COMPLETE";jobId?:string}|undefined{
 if(req.method!=="POST")return undefined;
 const url=new URL(req.url??"/","http://axiom-worker.invalid");
 if(url.search||url.hash)return undefined;
 if(url.pathname==="/v1/worker/claims")return {action:"CLAIM"};
 const match=url.pathname.match(/^\/v1\/worker\/jobs\/([^/]+)\/(heartbeat|release|complete)$/);
 if(!match||(match[2]==="complete"&&!allowVerifiedCompletion))return undefined;
 let jobId:string;
 try{jobId=decodeURIComponent(match[1]);}catch{return undefined;}
 if(!jobId||jobId.length>256||jobId.includes("/")||jobId.includes("\\")
  ||jobId.includes("%")||jobId.includes("\u0000"))return undefined;
 return {action:match[2]==="heartbeat"?"HEARTBEAT":match[2]==="complete"?"COMPLETE":"RELEASE",jobId};
}
async function jsonBody(req:IncomingMessage):Promise<unknown>{
 const len=req.headers["content-length"];
 if(len!==undefined){
  const length=Number(len);
  if(!Number.isSafeInteger(length)||length<0)throw new HttpWorkerInputError(400,"INVALID_LENGTH");
  if(length>MAX_REQUEST_BYTES){req.resume();throw new HttpWorkerInputError(413,"BODY_TOO_LARGE");}
 }
 const parts:Buffer[]=[];let total=0;
 for await(const part of req){
  const chunk=Buffer.isBuffer(part)?part:Buffer.from(part);
  total+=chunk.length;
  if(total>MAX_REQUEST_BYTES)throw new HttpWorkerInputError(413,"BODY_TOO_LARGE");
  parts.push(chunk);
 }
 if(total===0)throw new HttpWorkerInputError(400,"INVALID_BODY");
 try{
  const json=new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(parts,total));
  return JSON.parse(json);
 }catch{throw new HttpWorkerInputError(400,"INVALID_JSON");}
}
function classify(e:unknown):{status:number;code:string}{
 const message=e instanceof Error?e.message:"";
 if(message.includes("WORKER_UNAUTHENTICATED"))return {status:401,code:"WORKER_UNAUTHENTICATED"};
 if(message.includes("WORKER_FORBIDDEN"))return {status:403,code:"WORKER_FORBIDDEN"};
 if(message.includes("WORKER_REQUEST_CONFLICT"))return {status:409,code:"WORKER_REQUEST_CONFLICT"};
 if(message.includes("REMOTE_COMPLETION_UNVERIFIED"))return {status:409,code:"WORKER_COMPLETION_UNVERIFIED"};
 if(message.includes("LEASE_LOST")||message.includes("INVALID_LEASE_CAPABILITY"))
  return {status:409,code:"LEASE_LOST"};
 if(e instanceof HttpWorkerInputError)return {status:e.status,code:e.code};
 if(e instanceof TypeError||e instanceof RangeError)return {status:400,code:"INVALID_WORKER_REQUEST"};
 return {status:500,code:"WORKER_OPERATION_FAILED"};
}
function proofFor(proof:unknown,action:"CLAIM"|"HEARTBEAT"|"RELEASE"|"COMPLETE",jobId?:string):WorkerRequestProof{
 if(!object(proof)||proof.action!==action||proof.targetJobId!==jobId)
  throw new HttpWorkerInputError(400,"INVALID_PROOF_ROUTE");
 return proof as unknown as WorkerRequestProof;
}
function leaseMs(value:unknown):number{
 if(!Number.isSafeInteger(value)||Number(value)<1||Number(value)>86400000)
  throw new HttpWorkerInputError(400,"INVALID_LEASE_MS");
 return Number(value);
}
function cap(value:unknown):WorkerLeaseCapability{
 if(!object(value)||typeof value.capabilityId!=="string"||!object(value.core))
  throw new HttpWorkerInputError(400,"INVALID_LEASE_CAPABILITY");
 return value as unknown as WorkerLeaseCapability;
}
export interface AxiomWorkerControlHttpDeps{
 jobs:Pick<AuthenticatedWorkerJobRepository,"claimNext"|"heartbeat"|"releaseForRetry">;
 clock:()=>string;
 trustedIngress:(request:IncomingMessage)=>boolean;
 verifiedCompletion?:Pick<VerifiedRemoteCompletionService,"complete">;
}
/**
 * Dedicated worker-control listener. The caller MUST enforce private mTLS/TLS ingress
 * in its trustedIngress implementation. Never use request headers as trust evidence.
 * No remote COMPLETE/FAIL_TERMINAL route is exposed.
 */
export function createAxiomWorkerControlHttpServer(options:AxiomWorkerControlHttpDeps):Server{
 if(!options?.jobs||typeof options.jobs.claimNext!=="function"
  ||typeof options.jobs.heartbeat!=="function"||typeof options.jobs.releaseForRetry!=="function")
  throw new TypeError("Worker control repository required");
 if(typeof options.clock!=="function")throw new TypeError("Trusted worker server clock required");
 if(typeof options.trustedIngress!=="function")
  throw new TypeError("Worker trustedIngress validator required");
 if(options.verifiedCompletion!==undefined&&typeof options.verifiedCompletion.complete!=="function")
  throw new TypeError("Verified worker completion service is invalid");
 return createServer(async(req,res)=>{
  try{
   let trusted=false;
   try{trusted=options.trustedIngress(req)===true;}catch{}
   if(!trusted){req.resume();error(res,403,"UNTRUSTED_TRANSPORT");return;}
   const match=route(req,options.verifiedCompletion!==undefined);
   if(!match){req.resume();error(res,404,"NOT_FOUND");return;}
   if((req.headers["content-type"]??"").toString().split(";")[0].trim().toLowerCase()!=="application/json"){
    req.resume();error(res,415,"UNSUPPORTED_MEDIA_TYPE");return;
   }
   const input=await jsonBody(req);
   const keys=match.action==="CLAIM"?["proof","leaseMs"]:
    match.action==="HEARTBEAT"?["proof","capability","leaseMs"]:
    match.action==="COMPLETE"?["proof","capability","result"]:["proof","capability"];
   if(!exact(input,keys))throw new HttpWorkerInputError(400,"INVALID_BODY_SHAPE");
   const proof=proofFor(input.proof,match.action,match.jobId);
   const now=distributedIso(options.clock(),"trusted worker server clock");
   if(match.action==="CLAIM"){
    const lease=await options.jobs.claimNext(proof,leaseMs(input.leaseMs),now);
    result(res,200,lease?{status:"LEASED",lease}:{status:"IDLE"});return;
   }
   const capability=cap(input.capability);
   if(match.action==="HEARTBEAT"){
    const lease=await options.jobs.heartbeat(proof,capability,leaseMs(input.leaseMs),now);
    result(res,200,{status:"LEASED",lease});return;
   }
   if(match.action==="COMPLETE"){
    if(!options.verifiedCompletion||!exact(input.result,
     ["status","snapshotId","policyDecision","certificateId","executionRecordId"]))
     throw new HttpWorkerInputError(400,"INVALID_COMPLETION_RESULT");
    const done=await options.verifiedCompletion.complete(proof,capability,
     input.result as ControlPlaneResult,now);
    if(done.state.status!=="SUCCEEDED"&&done.state.status!=="DENIED")
     throw new Error("Verified completion produced a nonterminal result");
    result(res,200,{status:"COMPLETED",jobId:done.intent.jobId,jobStatus:done.state.status});
    return;
   }
   const job=await options.jobs.releaseForRetry(proof,capability,now);
   result(res,200,{status:"RELEASED",jobStatus:job.state.status});
  }catch(e){
   const failure=classify(e);
   if(!res.headersSent)error(res,failure.status,failure.code);
   else res.destroy();
  }
 });
}
