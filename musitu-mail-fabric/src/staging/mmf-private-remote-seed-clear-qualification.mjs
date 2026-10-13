/**
 * Single bounded synthetic-only remote qualification, deliberately WITHOUT
 * Durable Object restart, live onboarding or customer payments. Unlike the
 * legacy proof, cleanup is attempted whenever seeding was attempted, even if
 * the remote seed acknowledgment fails. It never clears unrelated records.
 */
import {randomBytes} from 'node:crypto';
const HASH=/^[0-9a-f]{64}$/;
const denied=category=>{throw Error('MMF_PRIVATE_SEED_CLEAR_'+category)};
const exact=(x,keys)=>x&&Object.getPrototypeOf(x)===Object.prototype&&
 Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
export async function qualifyPrivateSyntheticSeedClear({
 fetchImpl=globalThis.fetch,makeDigest=()=>randomBytes(32).toString('hex'),
 base='http://127.0.0.1:8796',timeoutMs=12000
}={}){
 let origin;
 try{const u=new URL(base);if(u.protocol!=='http:'||!['127.0.0.1','localhost'].includes(u.hostname)||u.port!=='8796'||u.pathname!=='/'||u.search||u.hash||u.username||u.password)denied('NONLOCAL_DENIED');origin=u.origin}
 catch(e){if(e?.message==='MMF_PRIVATE_SEED_CLEAR_NONLOCAL_DENIED')throw e;denied('NONLOCAL_DENIED')}
 const hash=()=>{const d=makeDigest();if(typeof d!=='string'||!HASH.test(d))denied('INVALID_SYNTHETIC_DIGEST');return d};
 const run=hash(),records=[0,1].map(i=>({tenantDigest:hash(),subjectDigest:hash(),domainDigest:hash(),keyDigest:hash(),plan:i?'GROWTH':'LAUNCH'}));
 if(new Set([run,...records.flatMap(r=>[r.tenantDigest,r.subjectDigest,r.domainDigest,r.keyDigest])]).size!==9)denied('DUPLICATE_DIGEST');
 async function call(path,payload){
  let resp;
  try{resp=await fetchImpl(origin+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(timeoutMs)})}
  catch{denied('REMOTE_UNAVAILABLE')}
  if(resp?.status!==200)denied('REMOTE_DENIED');
  try{return await resp.json()}catch{denied('RESPONSE_INVALID')}
 }
 const seed={run,records};let attempted=false,good=false,absent=false,original=null;
 const initial=await call('/control/read',seed);
 if(!exact(initial,['present'])||initial.present!==false)denied('DIRTY_START');
 try{
  attempted=true;
  const seeded=await call('/control/seed',seed);
  if(!exact(seeded,['stored','tenantCount'])||seeded.stored!==true||seeded.tenantCount!==2)denied('SEED_UNVERIFIED');
  const present=await call('/control/read',seed);
  if(!exact(present,['present','tenantCount','domainPendingCount','subscriptionPendingCount','usageCount','revokedCount','entitlementsActive'])||
     present.present!==true||present.tenantCount!==2||present.domainPendingCount!==2||present.subscriptionPendingCount!==2||
     present.usageCount!==0||present.revokedCount!==0||present.entitlementsActive!==0)denied('READBACK_UNVERIFIED');
  good=true;
 }catch(e){original=e}
 finally{
  if(attempted){
   try{const cleaned=await call('/control/clear',{run});if(!exact(cleaned,['cleared'])||cleaned.cleared!==true)good=false}
   catch{good=false}
   try{const read=await call('/control/read',seed);absent=exact(read,['present'])&&read.present===false}
   catch{absent=false}
  }
 }
 if(!absent)denied('CLEANUP_UNCONFIRMED');
 if(original)throw original;
 if(!good)denied('CLEAR_ACK_UNVERIFIED');
 return {gate:'MMF_PRIVATE_REMOTE_SYNTHETIC_SEED_READ_CLEAR_PROVEN',realRemoteSqliteUsed:true,
  syntheticTenantRecordsWritten:2,domainPendingNotVerified:true,subscriptionsPendingNotPaid:true,
  finalReadbackEmpty:true,forcedRestartProven:false,customerEmailsSent:false,
  merchantPaymentsCalled:false,publicIngressEnabled:false,commercialReleaseAuthorized:false};
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 qualifyPrivateSyntheticSeedClear().then(x=>console.log(JSON.stringify(x))).catch(e=>{
  const safe=/^MMF_PRIVATE_SEED_CLEAR_[A-Z_]+$/.test(e?.message||'')?e.message:'MMF_PRIVATE_SEED_CLEAR_UNKNOWN_DENIED';
  console.error(safe);process.exitCode=2;
 });
}
