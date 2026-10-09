import {createHash} from 'node:crypto';
/** Adapter interface: send(message, stableAttemptKey) -> {outcome,providerId?}.
 * outcome is accepted | rejected | unknown, NOT delivered to the recipient.
 */
export function createSimulatedProvider({region='us-east-1',outcome='accepted'}={}){
  let attempts=0;
  return {name:'simulation',region,get attempts(){return attempts;},async send(){attempts++;return {outcome,providerId:outcome==='accepted'?'simulation-'+attempts:undefined};}};
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

/** Optional self-hosted Postal adapter. A Postal API acknowledgment is not inbox delivery. */
export function createPostalProvider({baseUrl,apiKey,region='us-east-1',allowNetwork=false,fetchImpl=fetch}={}){
  if(!allowNetwork)throw new TypeError('Postal sending requires explicit opt-in');
  let url;
  try{url=new URL(baseUrl);}catch{throw new TypeError('Postal transport requires a HTTPS origin');}
  const host=url.hostname.toLowerCase();
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/'||!host.includes('.')||/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[|::1)/i.test(host)||host.endsWith('.local'))throw new TypeError('Postal transport requires a HTTPS origin');
  if(typeof apiKey!=='string'||apiKey.length<12||apiKey.length>256||/[\r\n]/.test(apiKey))throw new TypeError('Postal API key must be provisioned securely');
  return {name:'postal',region,async send(message){
    const body={to:[message.to],from:message.from,subject:message.subject,plain_body:message.text};
    let response;
    try{response=await fetchImpl(url.origin+'/api/v1/send/message',{
      method:'POST',redirect:'error',headers:{'X-Server-API-Key':apiKey,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(12000)
    });}catch{return {outcome:'unknown'};}
    if(response.status>=400&&response.status<500)return {outcome:'rejected'};
    if(![200,201,202].includes(response.status))return {outcome:'unknown'};
    try{
      const data=await response.json();const id=data?.data?.message_id;
      if(data?.status==='success'&&typeof id==='string'&&id.length>6&&id.length<400){
        return {outcome:'accepted',providerId:'postal-'+createHash('sha256').update(id).digest('hex')};
      }
    }catch{}
    return {outcome:'unknown'};
  }};
}
