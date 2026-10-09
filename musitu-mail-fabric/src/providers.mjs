/** Provider outcome is an API acknowledgment, never proof of recipient delivery. */
export function createSimulatedProvider({region='us-east-1',outcome='accepted'}={}){
  let attempts=0;
  return {name:'simulation',region,get attempts(){return attempts;},async send(){
    attempts++;return {outcome,providerId:outcome==='accepted'?'simulation-'+attempts:undefined};
  }};
}
export function createResendProvider({apiKey,region='us-east-1',fetchImpl=fetch,allowNetwork=false}={}){
  if(!allowNetwork)throw new TypeError('Network sending requires an explicit opt-in');
  if(typeof apiKey!=='string'||!/^re_[A-Za-z0-9_-]{12,}$/.test(apiKey))throw new TypeError('Resend credential must be supplied securely');
  return {name:'resend',region,async send(message,stableAttemptKey){
    const envelope={from:message.from,to:[message.to],subject:message.subject,text:message.text};
    let response;
    try{response=await fetchImpl('https://api.resend.com/emails',{
      method:'POST',redirect:'error',headers:{authorization:'Bearer '+apiKey,'content-type':'application/json','Idempotency-Key':stableAttemptKey},
      body:JSON.stringify(envelope),signal:AbortSignal.timeout(12000)
    });}catch{return {outcome:'unknown'};}
    if(response.status>=400&&response.status<500)return {outcome:'rejected'};
    if(![200,201,202].includes(response.status))return {outcome:'unknown'};
    try{const j=await response.json();if(typeof j?.id==='string'&&/^[0-9a-z-]{10,}$/i.test(j.id))return {outcome:'accepted',providerId:j.id};}
    catch{}
    return {outcome:'unknown'};
  }};
}
