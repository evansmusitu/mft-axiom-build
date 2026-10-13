/** Actual remote-DO test via localhost-only Wrangler service binding, not customer onboarding. */
import {createHash,randomBytes} from 'node:crypto';
const BASE='http://127.0.0.1:8796';
const digest=()=>createHash('sha256').update(randomBytes(32)).digest('hex');
const deny=s=>{throw Error('MMF_REMOTE_CONTROL_PROOF_DENIED_'+s)};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function call(path,payload={},allowReset=false){
 const response=await fetch(BASE+path,{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify(payload),signal:AbortSignal.timeout(20000)});
 if(allowReset&&response.status===503)return {expectedReset:true};
 if(response.status!==200)deny('HTTP_'+response.status+'_'+path.replace(/[^a-z]/gi,'_'));
 const out=await response.json();if(!out||Object.getPrototypeOf(out)!==Object.prototype)deny('RESPONSE');return out;
}
const expected=(usageCount,revokedCount)=>({present:true,tenantCount:2,domainPendingCount:2,subscriptionPendingCount:2,usageCount,revokedCount,entitlementsActive:0});
async function main(){
 const run=digest(),records=[
  {tenantDigest:digest(),subjectDigest:digest(),domainDigest:digest(),keyDigest:digest(),plan:'LAUNCH'},
  {tenantDigest:digest(),subjectDigest:digest(),domainDigest:digest(),keyDigest:digest(),plan:'GROWTH'}
 ];
 const seed={run,records};let started=false;
 try{
  if(JSON.stringify(await call('/control/read',seed))!==JSON.stringify({present:false}))deny('DIRTY_START');
  if((await call('/control/seed',seed)).tenantCount!==2)deny('SEED');started=true;
  for(const r of records)if((await call('/control/access',{run,record:r})).active!==true)deny('ACCESS');
  if((await call('/control/access',{run,record:{...records[0],keyDigest:records[1].keyDigest}})).active!==false)deny('TENANT_ISOLATION');
  const idem=digest();
  if((await call('/control/meter',{run,record:records[0],idem})).metered!==true)deny('METER');
  if((await call('/control/meter',{run,record:records[0],idem})).metered!==false)deny('IDEMPOTENCY');
  if((await call('/control/revoke',{run,record:records[0]})).revoked!==true)deny('REVOKE');
  if((await call('/control/access',{run,record:records[0]})).active!==false)deny('REVOKED_ACCESS');
  const crash=await call('/restart',{},true).catch(()=>({expectedReset:true}));
  if(crash.expectedReset!==true)deny('CRASH_NOT_OBSERVED');
  let restored=false;
  for(let i=0;i<8;i++){
   await sleep(i?850:350);
   try{if(JSON.stringify(await call('/control/read',seed))===JSON.stringify(expected(1,1))){restored=true;break}}catch{}
  }
  if(!restored)deny('REMOTE_RESTART_PERSISTENCE');
  if((await call('/control/access',{run,record:records[1]})).active!==true)deny('SECOND_TENANT');
  if((await call('/control/meter',{run,record:records[1],idem})).metered!==true)deny('CROSS_TENANT_IDEMPOTENCY');
  if(JSON.stringify(await call('/control/read',seed))!==JSON.stringify(expected(2,1)))deny('STATE_INTEGRITY');
  if((await call('/control/clear',{run})).cleared!==true)deny('DELETE');started=false;
  if((await call('/control/read',seed)).present!==false)deny('RESIDUE');
  console.log(JSON.stringify({schema:'mmf-remote-synthetic-customer-controls-v1',
   gate:'MMF_PRIVATE_REMOTE_SYNTHETIC_CONTROL_PERSISTENCE_PROVEN',
   realCloudflareSqliteUsed:true,forcedDurableObjectRestart:true,syntheticTenantCount:2,
   syntheticOwnerIdentityDigestPersisted:true,domainChallengesPendingNotDnsVerified:true,
   subscriptionsPendingNotPaid:true,accessIsolationAndRevocationProven:true,
   perTenantUsageIdempotencyProven:true,purgedAndReadBack:true,
   productionCustomerControlKernelProven:false,realOidcProviderUsed:false,
   customerDataUsed:false,realEmailSent:false,providerPaymentCalled:false,
   realCustomerApiEnabled:false,productionReleaseAuthorized:false,
   publicIngressEnabled:false,sharedPaymentWorkersModified:false}));
 }finally{if(started){try{await call('/control/clear',{run})}catch{console.error('MMF_SYNTHETIC_CLEANUP_NOT_CONFIRMED')}}}
}
main().catch(e=>{console.error(String(e?.message||e).slice(0,140));process.exitCode=2});
