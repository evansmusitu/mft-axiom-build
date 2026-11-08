/** Read-only operational health, separate from Phase 1 acceptance/release. */
export function createHealthHandler({getPool,timeoutMs=3000}={}){
 if(typeof getPool!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>5000)throw Error('HEALTH_CONFIG_REJECTED');
 let current;
 function start(){
  const slot={result:null};current=slot;
  let client,timedOut=false,released=false,timer;
  function release(discard){if(client&&!released){released=true;try{client.release(discard);}catch{}}}
  const work=(async()=>{
   try{
    client=await getPool().connect();
    if(timedOut){release(Error('HEALTH_TIMEOUT'));return false;}
    const result=await client.query('SELECT 1 AS ok');
    return !timedOut&&result?.rows?.length===1&&result.rows[0].ok===1;
   }catch{release(Error('HEALTH_PROBE_FAILED'));return false;}
   finally{release(timedOut?Error('HEALTH_TIMEOUT'):undefined);}
  })();
  const deadline=new Promise(resolve=>{timer=setTimeout(()=>{timedOut=true;release(Error('HEALTH_TIMEOUT'));resolve(false);},timeoutMs);});
  slot.result=Promise.race([work,deadline]);
  // Keep the slot while an acquisition/query is unresolved, even after timeout.
  // Repeated monitor requests cannot accumulate additional pending pool leases.
  work.finally(()=>{clearTimeout(timer);if(current===slot)current=undefined;});
  return slot;
 }
 return async function GET(){
  const healthy=await (current??start()).result;
  return Response.json({status:healthy?'HEALTHY_PRIVATE_STAGING':'UNHEALTHY_PRIVATE_STAGING',phase1Complete:false,publicMessaging:false},{status:healthy?200:503,headers:{'cache-control':'no-store','referrer-policy':'no-referrer'}});
 };
}
