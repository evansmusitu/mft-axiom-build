/**
 * Bounded synthetic-only inspection of an existing CLOSED Cloudflare stage via
 * its localhost-only Worker service binding. Never creates tenant/control
 * records, deploys, clears, emails, payments or accesses customer APIs.
 * Warning: existing remote SQL read methods can CREATE TABLE IF NOT EXISTS;
 * this is not strictly an SQL read-only transaction.
 */
import {randomBytes} from 'node:crypto';
const HASH=/^[a-f0-9]{64}$/;
const denied=category=>{throw Error('MMF_PRIVATE_REMOTE_'+category)};
const allowedBindingCategories=new Set(['REMOTE_BINDING_UNAVAILABLE','REMOTE_ENTRYPOINT_MISSING','RPC_TIMED_OUT','REMOTE_RPC_FAILED']);
const ownKeys=(x,keys)=>x&&Object.getPrototypeOf(x)===Object.prototype&&
  Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
export async function inspectPrivateControlOccupancy({
 base='http://127.0.0.1:8796',fetchImpl=globalThis.fetch,
 makeDigest=()=>randomBytes(32).toString('hex'),timeoutMs=12000
}={}){
 let origin;
 try {const u=new URL(base);if(u.protocol!=='http:'||!['localhost','127.0.0.1'].includes(u.hostname)||u.username||u.password||u.pathname!=='/'||u.search||u.hash||u.port!=='8796')denied('NONLOCAL_DENIED');origin=u.origin}
 catch(e){if(String(e.message)==='MMF_PRIVATE_REMOTE_NONLOCAL_DENIED')throw e;denied('NONLOCAL_DENIED')}
 const checkDigest=()=>{const value=makeDigest();if(typeof value!=='string'||!HASH.test(value))denied('LOCAL_INPUT_DENIED');return value};
 async function call(path,payload,kind){
  const method=payload===undefined?'GET':'POST';
  let response;
  try{response=await fetchImpl(origin+path,{method,headers:method==='POST'?{'content-type':'application/json'}:{},
   ...(method==='POST'?{body:JSON.stringify(payload)}:{}),signal:AbortSignal.timeout(timeoutMs)})}
  catch{denied('RPC_UNAVAILABLE')}
  if(response?.status!==200){
   let data;try{data=await response.json()}catch{}
   if(kind==='control'&&response?.status===503&&data?.category==='CLOSED_STAGE_VALIDATION_FAILED')denied('RESIDUE_NOT_EXCLUDED');
   if(allowedBindingCategories.has(data?.category))denied('RPC_UNAVAILABLE');
   denied('REMOTE_REPLY_DENIED');
  }
  try{return await response.json()}catch{denied('MALFORMED_REPLY')}
 }
 const health=await call('/health');
 if(!ownKeys(health,['ok','localOnly'])||health.ok!==true||health.localOnly!==true)denied('MALFORMED_REPLY');
 const remote=await call('/read',{},'sqlite');
 if(!ownKeys(remote,['digest'])||!(remote.digest===null||(typeof remote.digest==='string'&&HASH.test(remote.digest))))denied('MALFORMED_REPLY');
 const run=checkDigest(),records=[0,1].map((index)=>({tenantDigest:checkDigest(),subjectDigest:checkDigest(),domainDigest:checkDigest(),keyDigest:checkDigest(),plan:index===0?'LAUNCH':'GROWTH'}));
 const control=await call('/control/read',{run,records},'control');
 if(!ownKeys(control,['present'])||control.present!==false)denied(control?.present===true?'RESIDUE_NOT_EXCLUDED':'MALFORMED_REPLY');
 return {gate:'MMF_PRIVATE_REMOTE_READBACK_EMPTY_PROVEN',loopbackOnly:true,
  existingRemoteRpcReachable:true,syntheticControlRowsAbsent:true,
  syntheticMutationPerformed:false,customerDataRead:false};
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 inspectPrivateControlOccupancy().then(out=>console.log(JSON.stringify(out)))
  .catch(e=>{console.error(String(e?.message||'MMF_PRIVATE_REMOTE_RPC_UNAVAILABLE').slice(0,100));process.exitCode=2});
}
