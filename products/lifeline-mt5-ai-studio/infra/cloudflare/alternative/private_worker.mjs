/** Private Service-Binding target. It MUST have no workers.dev, preview URL,
 * custom domain, or public route; exact HMAC is additional defense-in-depth.
 * D1 used only for local synthetic status and replay deny; no real job execution.
 */
import {serviceHmac,safeEqual,json} from './protocol.mjs';
const STATUS='/stage/status';
export default {async fetch(request,env){
  const u=new URL(request.url);
  if(u.pathname!==STATUS||u.search||u.hash)return json({error:'not_found'},404);
  if(request.method!=='POST')return json({error:'method_not_allowed'},405);
  // DATABASE mode retains durable nonce replay rejection. A distinct, strictly
  // read-only, explicitly selected STATELESS mode is permitted if no D1 exists.
  // Status-only duplicate requests are harmless but NOT replay-protected.
  const stateless=env?.LIFELINE_ALT_MODE==='STATELESS_READONLY';
  if(!env||typeof env.SERVICE_HMAC_KEY!=='string'||env.SERVICE_HMAC_KEY.length<32||
     typeof env.STAGE_TENANT!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(env.STAGE_TENANT)||
     (env.LIFELINE_ALT_MODE!==undefined&&!stateless)||
     (stateless&&env.DB!==undefined)||
     (!stateless&&(!env.DB||typeof env.DB.prepare!=='function')))
    return json({error:'stage_not_configured'},503);
  if(request.headers.get('content-type')!=='application/json')return json({error:'unauthorized'},401);
  const stamp=request.headers.get('x-lifeline-stage-time')||'';
  const nonce=request.headers.get('x-lifeline-stage-nonce')||'';
  const tenant=request.headers.get('x-lifeline-stage-tenant')||'';
  const sig=request.headers.get('x-lifeline-stage-signature')||'';
  const now=Math.floor(Date.now()/1000);
  if(!/^\d{10}$/.test(stamp)||Math.abs(now-Number(stamp))>90||
     !/^[a-f0-9]{32}$/.test(nonce)||tenant!==env.STAGE_TENANT||
     !/^[a-f0-9]{64}$/.test(sig))
    return json({error:'unauthorized'},401);
  let body;
  try{body=await request.text();}catch{return json({error:'unauthorized'},401);}
  if(body!=='{}')return json({error:'unauthorized'},401);
  try{
    const expected=await serviceHmac(env.SERVICE_HMAC_KEY,STATUS,stamp,nonce,tenant,body);
    if(!safeEqual(sig,expected))return json({error:'unauthorized'},401);
  }catch{return json({error:'unauthorized'},401);}
  if(stateless){
    // No jobs, storage, side effects, agent polling, or cross-provider calls.
    // This is a constant code-level capability report, NOT observed queue state.
    return json({schema:'lifeline.cloudflare_alt_stateless.v1',
      status_origin:'static_source_only',jobs:null,job_counts_available:false,
      d1_connected:false,trading_enabled:false,native_windows_connected:false,
      modal_connected:false,neon_connected:false});
  }
  // Store the request nonce BEFORE any other action. Unique primary key is an
  // atomic replay guard. D1 Free enforces quotas rather than billing overages.
  try{
    const recorded=await env.DB.prepare(
      'INSERT OR IGNORE INTO lifeline_alt_nonces (tenant,nonce,created_at) VALUES (?,?,?)'
    ).bind(tenant,nonce,Number(stamp)).run();
    if(recorded?.meta?.changes!==1)return json({error:'unauthorized'},401);
    const rows=await env.DB.prepare(
      'SELECT state,COUNT(*) AS count FROM lifeline_alt_jobs WHERE tenant=? GROUP BY state'
    ).bind(tenant).all();
    if(!Array.isArray(rows?.results))throw Error('db_unavailable');
    const jobs={PENDING:0,CLAIMED:0,COMPLETED:0};
    for(const row of rows.results){
      if(!Object.hasOwn(jobs,row.state)||!Number.isSafeInteger(row.count)||
         row.count<0||row.count>250)throw Error('invalid_stage_database');
      jobs[row.state]=row.count;
    }
    return json({schema:'lifeline.cloudflare_alt_status.v1',jobs,
      trading_enabled:false,native_windows_connected:false,
      modal_connected:false,neon_connected:false});
  }catch{return json({error:'stage_storage_unavailable'},503);}
}};
