/**
 * Closed, synthetic-only Cloudflare DO restart qualification. No live identities,
 * payment events, provider mail, customer access or public ingress. A 503 alone
 * never proves a restart: the object constructor's ephemeral epoch must change.
 */
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const HASH=/^[0-9a-f]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const deny=()=>{throw Error('MMF_REMOTE_RESTART_QUALIFICATION_DENIED')};
const equals=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const empty=(state)=>state?.schema==='mmf-private-synthetic-control-occupancy-v1'&&
 ['ABSENT','EMPTY'].includes(state.state)&&state.tenantCount===0&&state.usageCount===0&&Object.keys(state).length===4;
const expected=(usageCount,revokedCount)=>({present:true,tenantCount:2,domainPendingCount:2,
 subscriptionPendingCount:2,usageCount,revokedCount,entitlementsActive:0});
export async function qualifyPrivateSyntheticRestart({
 fetchImpl=globalThis.fetch,makeDigest=()=>randomBytes(32).toString('hex'),
 base='http://127.0.0.1:8796',timeoutMs=12000,retryDelayMs=750
}={}){
 let origin;
 try{const u=new URL(base);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||u.port!=='8796'||
    u.username||u.password||u.pathname!=='/'||u.search||u.hash)deny();origin=u.origin}
 catch{deny()}
 const gen=()=>{const value=makeDigest();if(typeof value!=='string'||!HASH.test(value))deny();return value};
 async function call(path,payload){
  let result;
  try{result=await fetchImpl(origin+path,{method:payload===undefined?'GET':'POST',
   ...(payload===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(payload)}),
   signal:AbortSignal.timeout(timeoutMs)});
   if(result.status!==200)deny();return await result.json();
  }catch{deny()}
 }
 const inspect=async()=>{const v=await call('/control/inspect');if(!empty(v))deny();return true};
 const epoch=async()=>{const x=await call('/control/epoch');if(!x||Object.keys(x).length!==1||!UUID.test(x.epoch||''))deny();return x.epoch};
 await inspect();const before=await epoch();
 const run=gen(),records=[
  {tenantDigest:gen(),subjectDigest:gen(),domainDigest:gen(),keyDigest:gen(),plan:'LAUNCH'},
  {tenantDigest:gen(),subjectDigest:gen(),domainDigest:gen(),keyDigest:gen(),plan:'GROWTH'}
 ];
 const idem=gen();if(new Set([run,idem,...records.flatMap(x=>[x.tenantDigest,x.subjectDigest,x.domainDigest,x.keyDigest])]).size!==10)deny();
 const seed={run,records};let attempted=false,primaryError=null,qualified=false,cleaned=false;
 try{
  attempted=true;
  if(!equals(await call('/control/seed',seed),{stored:true,tenantCount:2}))deny();
  if(!equals(await call('/control/read',seed),expected(0,0)))deny();
  for(const r of records)if(!equals(await call('/control/access',{run,record:r}),{active:true}))deny();
  if(!equals(await call('/control/access',{run,record:{...records[0],keyDigest:records[1].keyDigest}}),{active:false}))deny();
  if(!equals(await call('/control/meter',{run,record:records[0],idem}),{metered:true}))deny();
  if(!equals(await call('/control/meter',{run,record:records[0],idem}),{metered:false}))deny();
  if(!equals(await call('/control/revoke',{run,record:records[0]}),{revoked:true}))deny();
  if(!equals(await call('/control/access',{run,record:records[0]}),{active:false}))deny();
  // A crash is EXPECTED to return 503 or break RPC. Do not conclude from that alone.
  let resetOutcome=false;
  try{const r=await fetchImpl(origin+'/restart',{method:'POST',
    headers:{'content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(timeoutMs)});
    resetOutcome=r.status===503;
  }catch{resetOutcome=true}
  if(!resetOutcome)deny();
  let different=false;
  for(let i=0;i<8;i++){
   if(i&&retryDelayMs)await new Promise(resolve=>setTimeout(resolve,retryDelayMs));
   try{if((await epoch())!==before){different=true;break}}catch{}
  }
  if(!different)deny();
  let persisted=false;
  for(let i=0;i<6;i++){
   if(i&&retryDelayMs)await new Promise(resolve=>setTimeout(resolve,retryDelayMs));
   try{if(equals(await call('/control/read',seed),expected(1,1))){persisted=true;break}}catch{}
  }
  if(!persisted)deny();
  if(!equals(await call('/control/access',{run,record:records[1]}),{active:true}))deny();
  if(!equals(await call('/control/meter',{run,record:records[1],idem}),{metered:true}))deny();
  if(!equals(await call('/control/read',seed),expected(2,1)))deny();
  qualified=true;
 }catch{primaryError=Error('MMF_REMOTE_RESTART_QUALIFICATION_DENIED')}
 finally{
  if(attempted){
   let ack=false;
   try{ack=equals(await call('/control/clear',{run}),{cleared:true})}catch{}
   try{cleaned=await inspect()}catch{cleaned=false}
   // A missing clear acknowledgement is not proof of residue when an independent
   // count-only readback establishes the private tables were emptied.
   if(!ack&&!cleaned)primaryError=Error('MMF_REMOTE_RESTART_CLEANUP_UNCONFIRMED');
  }
 }
 if(!cleaned)deny();if(primaryError||!qualified)throw primaryError||Error('MMF_REMOTE_RESTART_QUALIFICATION_DENIED');
 return {gate:'MMF_PRIVATE_REMOTE_CONTROL_RESTART_PERSISTENCE_PROVEN',
  verifiedNewInstanceEpoch:true,syntheticTenantCount:2,persistedRevocation:true,
  perTenantIdempotentUsage:true,cleanupConfirmed:true,domainOwnershipVerified:false,
  subscriptionPaid:false,customerMailSent:false,merchantPaymentCalled:false,
  customerAccessEnabled:false,publicIngressEnabled:false,productionReleaseAuthorized:false};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 qualifyPrivateSyntheticRestart().then(x=>console.log(JSON.stringify(x)))
  .catch(()=>{console.error('MMF_PRIVATE_REMOTE_RESTART_QUALIFICATION_UNPROVEN');process.exitCode=2});
}
