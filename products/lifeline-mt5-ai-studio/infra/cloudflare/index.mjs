import { createRemoteJWKSet, jwtVerify } from 'jose';

// Narrow ChatGPT-facing research/API gateway. No trading or wildcard tool passthrough.
const allowed = new Set(['lifeline_status','lifeline_evaluate_trades','lifeline_get_evidence','lifeline_verify_ledger']);
const methods = new Set(['initialize','ping','tools/list','tools/call']);
const json = (obj,status) => new Response(JSON.stringify(obj), {status,headers:{'content-type':'application/json','cache-control':'no-store'}});
function config(env) {
  const required = ['ACCESS_ISSUER','ACCESS_AUD','MODAL_ORIGIN','MODAL_PROXY_KEY','MODAL_PROXY_SECRET','EDGE_SHARED_SECRET'];
  if (required.some(k=>!env[k] || typeof env[k]!=='string')) return null;
  try {
    const issuer = new URL(env.ACCESS_ISSUER), origin = new URL(env.MODAL_ORIGIN);
    if (issuer.protocol!=='https:' || !issuer.hostname.endsWith('.cloudflareaccess.com') || issuer.pathname!=='/' ||
        origin.protocol!=='https:' || !origin.hostname.endsWith('.modal.run') || origin.username || origin.password) return null;
    return {issuer:issuer.origin,origin:origin.origin};
  } catch {return null;}
}
export default {async fetch(request,env) {
  const cfg=config(env);
  if (!cfg) return json({error:'not_configured'},503);
  const path = new URL(request.url).pathname;
  if (path === '/healthz' && request.method === 'GET') return json({state:'auth_required',trading:false},200);
  if (path !== '/mcp' || request.method !== 'POST') return json({error:'not_found'},404);
  const jwt = request.headers.get('cf-access-jwt-assertion');
  if (!jwt) return json({error:'unauthorized'},401);
  let subject;
  try {
    const keys=createRemoteJWKSet(new URL(cfg.issuer+'/cdn-cgi/access/certs'));
    const {payload}=await jwtVerify(jwt,keys,{issuer:cfg.issuer,audience:env.ACCESS_AUD,algorithms:['RS256']});
    subject=payload.sub;
    if (typeof subject!=='string' || !subject || subject.length>200) throw Error('subject');
  } catch {return json({error:'unauthorized'},401);}
  let body; let rpc;
  try {
    body=await request.text();
    if (new TextEncoder().encode(body).length>131072) return json({error:'oversized'},413);
    rpc=JSON.parse(body);
  } catch {return json({error:'invalid_json'},400);}
  if (!rpc || typeof rpc!=='object' || Array.isArray(rpc) || rpc.jsonrpc!=='2.0' || !methods.has(rpc.method) ||
      (rpc.method==='tools/call' && !allowed.has(rpc.params?.name))) return json({error:'not_permitted'},403);
  let response;
  try {
    response=await fetch(cfg.origin+'/mcp', {method:'POST',redirect:'manual',headers:{
      'content-type':'application/json','modal-key':env.MODAL_PROXY_KEY,'modal-secret':env.MODAL_PROXY_SECRET,
      'x-lifeline-edge-secret':env.EDGE_SHARED_SECRET,'x-lifeline-subject':subject
    },body});
  } catch {return json({error:'private_runtime_unavailable'},502);}
  if (response.status>=300 && response.status<400) return json({error:'redirect_blocked'},502);
  const payload=await response.text();
  if (payload.length>512000) return json({error:'upstream_oversized'},502);
  return new Response(payload,{status:response.status,headers:{'content-type':'application/json','cache-control':'no-store'}});
}};