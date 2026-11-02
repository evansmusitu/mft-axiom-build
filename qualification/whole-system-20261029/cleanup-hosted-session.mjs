/** Bounded cleanup only. A lost DELETE acknowledgment must be reconciled with
 * GET before any retry; this module has no session-creation or input path. */
import assert from 'node:assert/strict';

export async function cleanupHostedSession({sessionId,apiKey,fetchImpl=fetch,attempts=3,timeoutMs=10000}){
  assert.match(sessionId,/^sess_[A-Za-z0-9_-]{1,195}$/);
  assert.ok(typeof apiKey==='string'&&apiKey.trim());
  assert.ok(Number.isSafeInteger(attempts)&&attempts>=1&&attempts<=3);
  const observations=[];
  const request=async method=>{
    try{
      const response=await fetchImpl('https://api.openai.com/v1/agents/sessions/'+sessionId,{method,headers:{authorization:'Bearer '+apiKey,'OpenAI-Beta':'agents=v1'},redirect:'error',signal:AbortSignal.timeout(timeoutMs)});
      const status=response.status;void response.body?.cancel().catch(()=>{});
      observations.push({method,status});return status;
    }catch{observations.push({method,status:null,error:'BOUNDED_TRANSPORT_ERROR'});return null;}
  };
  let status=await request('GET'),ack=false;
  for(let i=0;i<attempts&&status!==404;i++){
    // A denied/unavailable read cannot establish ownership or whether it exists.
    if(status!==200)break;
    const deletion=await request('DELETE');ack ||= deletion!==null&&deletion>=200&&deletion<300;
    status=await request('GET');
  }
  return {id:sessionId,status:status===404?'VERIFIED_ABSENT':'CLEANUP_UNCERTAIN',delete_acknowledged:ack,readback_status:status,observations,
    new_sessions:0,input_events:0,sandbox_destruction:'ASYNCHRONOUS_NOT_INDEPENDENTLY_ATTESTED'};
}
