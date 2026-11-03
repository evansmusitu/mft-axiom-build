#!/usr/bin/env node
/**
 * Bounded, operator-approved READ-ONLY staging HTTP probe.
 * No side-effect routes, automatic credentials, production defaults, or arbitrary network discovery.
 * This is controlled load+client fault evidence, NOT a chaos/penetration-test certification.
 */
import {createHash} from "node:crypto";
import {readFileSync,realpathSync,writeFileSync} from "node:fs";
import {isIP} from "node:net";
import {performance} from "node:perf_hooks";

const HASH=/^[a-f0-9]{64}$/;
function digest(data){return createHash("sha256").update(data).digest("hex");}
function fail(code){const e=new Error(code);e.safeCode=code;throw e;}
function strictInt(value,name,max,min=1){
  if(!Number.isSafeInteger(value)||value<min||value>max)fail("CONFIG_INVALID");
  return value;
}
function canonicalUrl(value){
  if(typeof value!=="string"||!value.trim())fail("CONFIG_INVALID");
  let u;
  try{u=new URL(value);}catch{fail("CONFIG_INVALID");}
  if(u.protocol!=="https:"||u.username||u.password||u.hash||u.search||!u.pathname.startsWith("/"))fail("CONFIG_INVALID");
  const host=u.hostname.replace(/^\[|\]$/g,"").toLowerCase();
  const ip=isIP(host);
  const loopback=host==="localhost"||host.endsWith(".localhost")||host==="127.0.0.1"||host==="::1";
  if(loopback||ip!==0||host==="metadata.google.internal"||host.endsWith(".internal"))fail("CONFIG_INVALID");
  if(u.port&&u.port!=="443")fail("CONFIG_INVALID");
  return u;
}
function quantile(values,p){
  if(!values.length)return null;
  const s=[...values].sort((a,b)=>a-b);
  return Math.round(s[Math.ceil(p*s.length)-1]*10)/10;
}
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
async function checkedBody(response,maxBytes){
  if(!response.body)return;
  const reader=response.body.getReader();
  let size=0;
  try{
    while(true){
      const next=await reader.read();
      if(next.done)break;
      size+=next.value.byteLength;
      if(size>maxBytes)fail("RESPONSE_TOO_LARGE");
    }
  }finally{
    try{await reader.cancel();}catch{}
    try{reader.releaseLock();}catch{}
  }
}
async function main(){
  if(process.env.AXIOM_STAGING_LOAD!=="AUTHORIZED")fail("AUTHORIZATION_REQUIRED");
  // Missing or inaccessible operator manifests are invalid configuration,
  // not an uncategorized failure. Never disclose the filesystem path.
  let source;
  try{
    const p=realpathSync(process.env.AXIOM_STAGING_CONFIG_PATH??"");
    source=readFileSync(p);
  }catch{fail("CONFIG_INVALID");}
  const claimed=process.env.AXIOM_STAGING_CONFIG_SHA256;
  if(!HASH.test(claimed??"")||digest(source)!==claimed)fail("CONFIG_INVALID");
  let c;
  try{c=JSON.parse(source.toString("utf8"));}catch{fail("CONFIG_INVALID");}
  if(!c||typeof c!=="object"||Array.isArray(c))fail("CONFIG_INVALID");
  const names=["schemaVersion","approvedUrl","requestCount","concurrency","requestsPerSecond",
    "timeoutMs","maxRunSeconds","maxResponseBytes","acceptedStatus","maxErrorRateBps",
    "maxP95Ms","maxP99Ms","clientAbortEvery","clientAbortAfterMs"];
  if(Object.keys(c).some(x=>!names.includes(x))||c.schemaVersion!=="axiom.staging-readonly-load/v1")fail("CONFIG_INVALID");
  const u=canonicalUrl(c.approvedUrl);
  const requestCount=strictInt(c.requestCount,"requestCount",1000);
  const concurrency=strictInt(c.concurrency,"concurrency",16);
  const requestsPerSecond=strictInt(c.requestsPerSecond,"requestsPerSecond",20);
  const timeoutMs=strictInt(c.timeoutMs,"timeoutMs",10000);
  const maxRunSeconds=strictInt(c.maxRunSeconds,"maxRunSeconds",120);
  const maxResponseBytes=strictInt(c.maxResponseBytes,"maxResponseBytes",65536);
  const maxErrorRateBps=strictInt(c.maxErrorRateBps,"maxErrorRateBps",10000,0);
  const maxP95Ms=strictInt(c.maxP95Ms,"maxP95Ms",10000);
  const maxP99Ms=strictInt(c.maxP99Ms,"maxP99Ms",10000);
  const clientAbortEvery=strictInt(c.clientAbortEvery??0,"clientAbortEvery",1000,0);
  const clientAbortAfterMs=strictInt(c.clientAbortAfterMs??0,"clientAbortAfterMs",timeoutMs,0);
  if(clientAbortEvery>0&&!clientAbortAfterMs||clientAbortEvery===0&&clientAbortAfterMs)fail("CONFIG_INVALID");
  if(requestCount/requestsPerSecond>maxRunSeconds)fail("CONFIG_INVALID");
  if(!Array.isArray(c.acceptedStatus)||!c.acceptedStatus.length||c.acceptedStatus.length>10||
    c.acceptedStatus.some(x=>!Number.isInteger(x)||x<200||x>299))fail("CONFIG_INVALID");
  const outPath=process.env.AXIOM_STAGING_EVIDENCE_PATH;
  if(!outPath||outPath.trim()!==outPath||!outPath.startsWith("/"))fail("CONFIG_INVALID");
  // No network is opened until the full, hash-pinned manifest has been validated.
  const start=performance.now(),latencies=[],statusCounts={},errors={};
  let next=0,successful=0,failed=0,injected=0;
  async function worker(){
    while(next<requestCount){
      const ordinal=next++;
      const due=start+ordinal*1000/requestsPerSecond;
      const wait=due-performance.now();
      if(wait>0)await sleep(wait);
      if(performance.now()-start>maxRunSeconds*1000){failed++;errors.DEADLINE=(errors.DEADLINE??0)+1;continue;}
      const abort=new AbortController(),begin=performance.now();
      const fault=clientAbortEvery>0&&(ordinal+1)%clientAbortEvery===0;
      const cutoff=fault?clientAbortAfterMs:timeoutMs;
      const timer=setTimeout(()=>abort.abort(),cutoff);
      try{
        const headers={"accept":"application/json"};
        if(process.env.AXIOM_STAGING_AUTHORIZATION)headers.authorization=process.env.AXIOM_STAGING_AUTHORIZATION;
        const response=await fetch(u,{method:"GET",headers,redirect:"manual",signal:abort.signal,cache:"no-store"});
        await checkedBody(response,maxResponseBytes);
        const elapsed=performance.now()-begin;
        latencies.push(elapsed);
        statusCounts[response.status]=(statusCounts[response.status]??0)+1;
        if(!c.acceptedStatus.includes(response.status)){failed++;errors.UNEXPECTED_STATUS=(errors.UNEXPECTED_STATUS??0)+1;}
        else if(!fault)successful++;
        else {failed++;errors.FAULT_COMPLETED_UNEXPECTEDLY=(errors.FAULT_COMPLETED_UNEXPECTEDLY??0)+1;}
      }catch(error){
        if(fault&&abort.signal.aborted){injected++;}else{
          failed++;
          const code=abort.signal.aborted?"TIMEOUT":error?.safeCode==="RESPONSE_TOO_LARGE"?"RESPONSE_TOO_LARGE":"NETWORK_OR_BODY_ERROR";
          errors[code]=(errors[code]??0)+1;
        }
      }finally{clearTimeout(timer);}
    }
  }
  await Promise.all(Array.from({length:Math.min(concurrency,requestCount)},()=>worker()));
  const measured=successful+failed;
  const errorRateBps=measured===0?10000:Math.ceil(failed*10000/measured);
  const p95=quantile(latencies,.95),p99=quantile(latencies,.99),p50=quantile(latencies,.5);
  const passed=measured>0&&errorRateBps<=maxErrorRateBps&&p95!==null&&p95<=maxP95Ms&&p99<=maxP99Ms;
  const evidence={
    schemaVersion:"axiom.staging-readonly-load-evidence/v1",
    manifestSha256:claimed,targetOrigin:u.origin,targetPath:u.pathname,
    recordedAt:new Date().toISOString(),sourceSha:process.env.CI_COMMIT_SHA??null,
    requestCount,successful,failed,injectedClientAborts:injected,
    errorRateBps,p50Ms:p50,p95Ms:p95,p99Ms:p99,
    statusCounts,errors,
    durationMs:Math.round((performance.now()-start)*10)/10,
    outcome:passed?"PASS":"FAIL"
  };
  // Atomic refusal to overwrite prior evidence. No full responses or secrets are recorded.
  writeFileSync(outPath,JSON.stringify(evidence,null,2)+"\n",{flag:"wx",mode:0o600});
  console.log(JSON.stringify({outcome:evidence.outcome,requestCount,successful,failed,injected,manifestSha256:claimed,evidenceSha256:digest(JSON.stringify(evidence))}));
  if(!passed)process.exitCode=1;
}
main().catch(error=>{
  // Never echo provider exceptions or URLs; only bounded, allowlisted error codes.
  console.error(error?.safeCode??"STAGING_LOAD_FAILED");
  process.exitCode=1;
});
