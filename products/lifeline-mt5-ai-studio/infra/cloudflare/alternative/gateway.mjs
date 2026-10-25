/** Cloudflare owner-only gateway helper; CALL ONLY after verified Access JWT.
 * No Modal credentials, GitHub PAT, Windows host, broker access, or public queue.
 */
import {serviceHmac,json} from './protocol.mjs';
export async function signInternalRequest({path,body,tenant,key,stamp,nonce}){
  if(path!=='/stage/status'||body!=='{}'||typeof tenant!=='string'||
      !/^[A-Za-z0-9_-]{1,100}$/.test(tenant))throw Error('untrusted_scope');
  const time=stamp===undefined?Math.floor(Date.now()/1000):stamp;
  const moment=String(time);
  const one=nonce===undefined?crypto.randomUUID().replaceAll('-',''):nonce;
  const signature=await serviceHmac(key,path,moment,one,tenant,body);
  return new Request('https://lifeline-service.invalid'+path,{
    method:'POST',redirect:'manual',
    headers:{'content-type':'application/json',
      'x-lifeline-stage-time':moment,'x-lifeline-stage-nonce':one,
      'x-lifeline-stage-tenant':tenant,'x-lifeline-stage-signature':signature},
    body
  });
}
export async function forwardAlternative(request,env,authenticatedTenant){
  // Explicit authorization beyond mere secret presence protects against
  // accidentally activating an unreviewed route after provisioning.
  if(env?.LIFELINE_ALT_CUTOVER!=='OFFLINE_STAGE_AUTHORIZED'||
     (env.LIFELINE_ALT_MODE!==undefined&&
      env.LIFELINE_ALT_MODE!=='STATELESS_READONLY')||
     !env.LIFELINE_ALT_SERVICE||typeof env.LIFELINE_ALT_SERVICE.fetch!=='function'||
     typeof env.LIFELINE_ALT_KEY!=='string'||env.LIFELINE_ALT_KEY.length<32||
     typeof env.AGENT_TENANT!=='string'||authenticatedTenant!==env.AGENT_TENANT)
    return json({error:'alternative_not_configured'},503);
  const u=new URL(request.url);
  if(u.pathname!=='/owner/alternative/status'||u.search||u.hash||request.method!=='GET')
    return json({error:'not_found'},404);
  let signed,result;
  try{
    signed=await signInternalRequest({path:'/stage/status',body:'{}',
      tenant:authenticatedTenant,key:env.LIFELINE_ALT_KEY});
    result=await env.LIFELINE_ALT_SERVICE.fetch(signed);
    if(result.status!==200||!(result.headers.get('content-type')||'').startsWith('application/json'))
      throw Error('invalid_stage_response');
    const raw=await result.text();
    if(raw.length>4096)throw Error('oversized');
    const body=JSON.parse(raw);
    if(env.LIFELINE_ALT_MODE==='STATELESS_READONLY'){
      const keys=['d1_connected','job_counts_available','jobs','modal_connected',
        'native_windows_connected','neon_connected','schema','status_origin','trading_enabled'];
      if(!body||Object.keys(body).sort().join(',')!==keys.join(',')||
         body.schema!=='lifeline.cloudflare_alt_stateless.v1'||
         body.status_origin!=='static_source_only'||body.jobs!==null||
         body.job_counts_available!==false||body.d1_connected!==false||
         body.trading_enabled!==false||body.native_windows_connected!==false||
         body.modal_connected!==false||body.neon_connected!==false)
        throw Error('untrusted_stateless_response');
      return json({schema:'lifeline.cloudflare_alt_stateless.v1',
        status_origin:'static_source_only',jobs:null,job_counts_available:false,
        d1_connected:false,trading_enabled:false,native_windows_connected:false,
        modal_connected:false,neon_connected:false});
    }
    if(body?.schema!=='lifeline.cloudflare_alt_status.v1'||
       body?.trading_enabled!==false||body?.native_windows_connected!==false||
       body?.modal_connected!==false||body?.neon_connected!==false||
       !body.jobs||typeof body.jobs!=='object'||
       Object.keys(body.jobs).sort().join(',')!=='CLAIMED,COMPLETED,PENDING'||
       !Object.values(body.jobs).every(n=>Number.isSafeInteger(n)&&n>=0&&n<=250))
      throw Error('untrusted_stage_response');
    // Construct a fresh response from an allowlist; never leak internal data.
    return json({schema:body.schema,jobs:{PENDING:body.jobs.PENDING,
       CLAIMED:body.jobs.CLAIMED,COMPLETED:body.jobs.COMPLETED},
       trading_enabled:false,native_windows_connected:false,
       modal_connected:false,neon_connected:false});
  }catch{return json({error:'alternative_private_stage_unavailable'},502);}
}
