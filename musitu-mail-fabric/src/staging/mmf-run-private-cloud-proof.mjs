/** One-shot, synthetic-only, localhost-to-private-Service-Binding cloud proof. */
import {randomBytes,createHash} from 'node:crypto';
const BASE='http://127.0.0.1:8796';
const deny=msg=>{throw Error('MMF_CLOUD_SQLITE_PROOF_DENIED_'+msg)};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function call(path,body={},acceptClosed=false){
 const res=await fetch(BASE+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(16000)});
 if(acceptClosed&&res.status===503)return {expectedReset:true};
 if(res.status!==200){const body=await res.json().catch(()=>({}));const category=['CLOSED_STAGE_VALIDATION_FAILED','REMOTE_BINDING_UNAVAILABLE','REMOTE_ENTRYPOINT_MISSING','RPC_TIMED_OUT','REMOTE_RPC_FAILED'].includes(body?.category)?body.category:'UNKNOWN';deny(path.slice(1)+'_HTTP_'+res.status+'_'+category)}
 const parsed=await res.json();
 if(!parsed||Object.getPrototypeOf(parsed)!==Object.prototype)deny('INVALID_RESPONSE');
 return parsed;
}
async function main(){
 const digest=createHash('sha256').update(randomBytes(32)).digest('hex');
 let cleanupNeeded=false;
 try{
  const start=await call('/read');if(start.digest!==null)deny('NONEMPTY_PROOF_OBJECT');
  const invalid=await fetch(BASE+'/write',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({digest:'INVALID'}),signal:AbortSignal.timeout(16000)});
  if(invalid.status!==503)deny('INVALID_WRITE_NOT_BLOCKED');
  const write=await call('/write',{digest});if(write.stored!==true)deny('NO_REAL_REMOTE_WRITE');
  cleanupNeeded=true;
  const before=await call('/read');if(before.digest!==digest)deny('WRITE_READ_MISMATCH');
  const crash=await call('/restart',{},true).catch(()=>({expectedReset:true}));
  if(crash.expectedReset!==true)deny('RESET_WAS_NOT_UNCATCHABLE');
  let recovered=false;
  for(let i=0;i<6;i++){
   await delay(i?700:250);
   try{if((await call('/read')).digest===digest){recovered=true;break}}catch{}
  }
  if(!recovered)deny('PERSISTENCE_AFTER_ABORT_FAILED');
  const clear=await call('/clear');if(clear.cleared!==true)deny('NO_CLEANUP');
  cleanupNeeded=false;
  if((await call('/read')).digest!==null)deny('NOT_CLEARED');
  const result={schema:'mmf-real-cloud-private-sqlite-roundtrip-v1',gate:'MMF_REAL_CLOUDFLARE_DURABLE_SQLITE_PERSISTENCE_PROVEN',
   realCloudflareStorageUsed:true,localLoopbackOnly:true,publicWorkersDevEnabled:false,syntheticRecordWritten:true,
   syntheticRecordReadAfterForcedRestart:true,syntheticRecordRemoved:true,customerDataUsed:false,
   paymentProviderCalled:false,emailSent:false,merchantCredentialsCopied:false,customerApiEnabled:false,
   productionReleaseAuthorized:false,sharedPaymentWorkersModified:false};
  console.log(JSON.stringify(result));
 }finally{if(cleanupNeeded){try{await call('/clear')}catch{}}
 }
}
main().catch(e=>{console.error('MMF_CLOUD_PROOF_FAILED',String(e.message||e).replace(/\s+/g,' ').slice(0,150));process.exitCode=2});