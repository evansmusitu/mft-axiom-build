/**
 * Isolated SQLite-backed Durable Object alternative when canonical D1 has no
 * free-tier-compatible slot. NOT DEPLOYED. No public routes or tenant onboarding.
 * Access JWT is verified at the private Worker boundary; only trusted,
 * server-derived subject is forwarded to one tenant-keyed private DO.
 */
import {DurableObject} from 'cloudflare:workers';
import {verifyAccessJWT,accessConfiguration} from './access-jwt.mjs';
import {workspaceFetch} from './gateway.mjs';
import {initializeDurableTenant} from './durable-sql-adapter.mjs';

const ORIGIN='https://workspace.mftintelligence.com';
const INTERNAL_ORIGIN='https://musitu-tenant.internal';
const ROUTE=/^\/api\/workspace\/v1\/tenants\/([a-z][a-z0-9_-]{2,39})\/slots\/([1-5])$/;
const MAX_BODY=250250;

function rejected(status,code){
  return new Response(JSON.stringify({code,error:'Cloud workspace operation denied.'}),{
    status,headers:{'content-type':'application/json; charset=utf-8',
      'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer',
      'content-security-policy':"default-src 'none'; frame-ancestors 'none'"}});
}
function ready(env){
  if(env?.WORKSPACE_ENABLED!=='true'||env.WORKSPACE_ORIGIN!==ORIGIN||
    !env.WORKSPACE_TENANTS?.idFromName||!env.WORKSPACE_TENANTS?.get||
    !env.WORKSPACE_RATE?.limit||
    typeof env.WORKSPACE_INTERNAL_KEY!=='string'||env.WORKSPACE_INTERNAL_KEY.length<32)return false;
  try{accessConfiguration(env);return true;}catch{return false;}
}
async function limited(env,subject){
  try{
    const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(subject));
    const key=Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('').slice(0,40);
    return (await env.WORKSPACE_RATE.limit({key})).success===true;
  }catch{return false;}
}

export async function durableWorkspaceFetch(request,env,{verifyJWT=verifyAccessJWT}={}){
  if(!ready(env))return rejected(503,'WORKSPACE_NOT_CONFIGURED');
  const url=new URL(request.url);
  const origin=request.headers.get('origin')||'';
  const method=request.method;
  if(url.origin!==ORIGIN||(origin&&origin!==ORIGIN)||(!origin&&method!=='GET'))
    return rejected(403,'ORIGIN_DENIED');
  const hit=ROUTE.exec(url.pathname);
  if(!hit)return rejected(404,'NOT_FOUND');
  if(method==='OPTIONS')return new Response(null,{status:204,headers:{
    'access-control-allow-origin':ORIGIN,'access-control-allow-methods':'GET, PUT, DELETE, OPTIONS',
    'access-control-allow-headers':'content-type,cf-access-jwt-assertion',
    'access-control-max-age':'300','vary':'Origin','cache-control':'no-store'}});
  if(!['GET','PUT','DELETE'].includes(method))return rejected(405,'METHOD_DENIED');
  let subject;
  try{({subject}=await verifyJWT(request.headers.get('cf-access-jwt-assertion'),env));}
  catch{return rejected(401,'INVALID_ACCESS_IDENTITY');}
  if(typeof subject!=='string'||subject.length<8||subject.length>256)return rejected(401,'INVALID_ACCESS_IDENTITY');
  if(!(await limited(env,subject)))return rejected(429,'WORKSPACE_RATE_LIMITED');
  let payload;
  if(method!=='GET'){
    const size=request.headers.get('content-length');
    if(size!==null&&(!/^\d+$/.test(size)||Number(size)>MAX_BODY))
      return rejected(413,'BODY_TOO_LARGE');
    try{payload=await request.text();}catch{return rejected(400,'INVALID_BODY');}
    if(payload.length>MAX_BODY)return rejected(413,'BODY_TOO_LARGE');
  }
  const tenant=hit[1];
  try{
    const stub=env.WORKSPACE_TENANTS.get(env.WORKSPACE_TENANTS.idFromName(
      'musitu.workspace.v1.tenant:'+tenant));
    const internalHeaders=new Headers({
      'x-musitu-internal-key':env.WORKSPACE_INTERNAL_KEY,
      'x-musitu-verified-subject':subject,
      'x-musitu-origin':origin
    });
    if(method!=='GET')internalHeaders.set('content-type',request.headers.get('content-type')||'');
    const internalURL=INTERNAL_ORIGIN+url.pathname;
    const result=await stub.fetch(new Request(internalURL,{
      method,headers:internalHeaders,...(payload!==undefined?{body:payload}:{})
    }));
    // Trust only the generated response from the bound private object; no
    // browser-controlled redirects or headers are forwarded to the caller.
    if(!(result instanceof Response))return rejected(503,'WORKSPACE_STORAGE_UNAVAILABLE');
    const body=await result.text();
    if(body.length>251000)return rejected(503,'WORKSPACE_STORAGE_UNAVAILABLE');
    const headers=new Headers({
      'content-type':'application/json; charset=utf-8','cache-control':'no-store',
      'x-content-type-options':'nosniff','referrer-policy':'no-referrer','vary':'Origin'
    });
    if(origin===ORIGIN)headers.set('access-control-allow-origin',ORIGIN);
    return new Response(body,{status:result.status,headers});
  }catch{return rejected(503,'WORKSPACE_STORAGE_UNAVAILABLE');}
}

export class MUSITUTenantWorkspace extends DurableObject{
  constructor(ctx,env){
    super(ctx,env);
    this.db=initializeDurableTenant(ctx.storage);
  }
  async fetch(request){
    if(!ready(this.env))return rejected(503,'WORKSPACE_NOT_CONFIGURED');
    const url=new URL(request.url);
    if(url.origin!==INTERNAL_ORIGIN||
      request.headers.get('x-musitu-internal-key')!==this.env.WORKSPACE_INTERNAL_KEY)
      return rejected(403,'INTERNAL_ONLY');
    const subject=request.headers.get('x-musitu-verified-subject');
    if(typeof subject!=='string'||subject.length<8||subject.length>256)
      return rejected(401,'INTERNAL_IDENTITY_REQUIRED');
    const origin=request.headers.get('x-musitu-origin')||'';
    const privateHeaders=new Headers(request.headers);
    privateHeaders.delete('x-musitu-internal-key');
    privateHeaders.delete('x-musitu-verified-subject');
    privateHeaders.delete('x-musitu-origin');
    if(origin)privateHeaders.set('origin',origin);
    privateHeaders.set('cf-access-jwt-assertion','verified-externally');
    const inner=new Request(ORIGIN+url.pathname,{
      method:request.method,headers:privateHeaders,
      ...(request.method!=='GET'?{body:await request.text()}:{})
    });
    // Only the already verified subject crosses the internal DO boundary.
    // Existing gateway SQL still performs membership checks INSIDE each write.
    return workspaceFetch(inner,{...this.env,WORKSPACE_DB:this.db,
      WORKSPACE_RATE:{limit:async()=>({success:true})}},{
      verifyJWT:async()=>({subject})
    });
  }
}
export default {fetch:durableWorkspaceFetch};
