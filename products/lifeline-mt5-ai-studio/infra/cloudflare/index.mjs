import {createRemoteJWKSet, jwtVerify} from 'jose';
import {backendBindingReadiness} from './backend_readiness.mjs';

// LIFELINE Cloudflare Access gateway. Broker/finance trading is forbidden on this surface.
const TOOL_ALLOWLIST=new Set(['lifeline_status']);
const METHODS=new Set(['initialize','ping','tools/list','tools/call','notifications/initialized']);
const AGENT_ROUTES=new Set(['/agent/pull','/agent/receipt']);
const OPERATOR_ROUTES=new Set(['/operator/probe','/operator/status']);
const encoder=new TextEncoder();
const reply=(o,status=200)=>new Response(JSON.stringify(o),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const sorted=(v)=>Array.isArray(v)?v.map(sorted):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,sorted(x)])):v;
const hex=a=>Array.from(new Uint8Array(a),x=>x.toString(16).padStart(2,'0')).join('');
const same=(a,b)=>{if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0;};
function readConfig(env){
  // Credential presence never authorizes activation. Explicit owner-governed
  // cutover is an independent binding that is absent from staging by default.
  if(env?.LIFELINE_PRIVATE_BACKEND_CUTOVER!=='AUTHORIZED')return null;
  const needed=['ACCESS_ISSUER','ACCESS_AUD','MODAL_ORIGIN','MODAL_PROXY_KEY','MODAL_PROXY_SECRET','EDGE_SHARED_SECRET',
    'AGENT_ID','AGENT_TENANT','AGENT_HMAC_KEY','ACCESS_OPERATOR_SUB'];
  if(needed.some(k=>typeof env[k]!=='string'||!env[k]))return null;
  if(env.EDGE_SHARED_SECRET.length<32||env.AGENT_HMAC_KEY.length<32)return null;
  try{
    const issuer=new URL(env.ACCESS_ISSUER), modal=new URL(env.MODAL_ORIGIN);
    if(issuer.protocol!=='https:'||!issuer.hostname.endsWith('.cloudflareaccess.com')||issuer.pathname!=='/'||
       modal.protocol!=='https:'||!modal.hostname.endsWith('.modal.run')||modal.pathname!=='/'||
       issuer.username||issuer.password||issuer.search||modal.username||modal.password||modal.search||
       !/^[A-Za-z0-9_-]{1,100}$/.test(env.AGENT_ID)||
       !/^[A-Za-z0-9_-]{1,100}$/.test(env.AGENT_TENANT)||
       !/^[A-Za-z0-9_-]{1,100}$/.test(env.ACCESS_OPERATOR_SUB))return null;
    return {issuer:issuer.origin,modal:modal.origin};
  }catch{return null;}
}
// Limited diagnostic path: owner must have an actual *application* Access JWT.
// Unlike backend routes, this path needs only 3 identity bindings. It never
// forwards to Modal, reads Neon, signs agent jobs, or exposes identity values.
function readOwnerConfig(env){
  if(!env||typeof env.ACCESS_ISSUER!=='string'||typeof env.ACCESS_AUD!=='string'||
     typeof env.ACCESS_OPERATOR_SUB!=='string')return null;
  try{
    const issuer=new URL(env.ACCESS_ISSUER);
    if(issuer.protocol!=='https:'||!issuer.hostname.endsWith('.cloudflareaccess.com')||
       !issuer.hostname.endsWith('.cloudflareaccess.com')||issuer.pathname!=='/'||
       issuer.search||issuer.hash||issuer.username||issuer.password||
       !/^[A-Za-z0-9_-]{8,128}$/.test(env.ACCESS_AUD)||
       !/^[A-Za-z0-9_-]{1,100}$/.test(env.ACCESS_OPERATOR_SUB))return null;
    return {issuer:issuer.origin};
  }catch{return null;}
}
async function authenticateAccess(request,env,cfg){
  const token=request.headers.get('cf-access-jwt-assertion');
  if(!token||token.length>20000)return null;
  try{
    const jwks=createRemoteJWKSet(new URL(cfg.issuer+'/cdn-cgi/access/certs'));
    const {payload}=await jwtVerify(token,jwks,{issuer:cfg.issuer,audience:env.ACCESS_AUD,algorithms:['RS256']});
    if(typeof payload.sub!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(payload.sub))return null;
    // A correctly signed JWT alone is not a tenant membership decision.
    // Bind to the owner/sub explicitly enrolled after interactive MFA.
    if(!same(payload.sub,env.ACCESS_OPERATOR_SUB))return null;
    return payload.sub;
  }catch{return null;}
}
async function authenticateAgent(request,env,body){
  const agentId=request.headers.get('x-lifeline-agent-id')||'';
  const tenant=request.headers.get('x-lifeline-tenant')||'';
  const stamp=request.headers.get('x-lifeline-time')||'';
  const nonce=request.headers.get('x-lifeline-nonce')||'';
  const signature=request.headers.get('x-lifeline-signature')||'';
  if(agentId!==env.AGENT_ID||tenant!==env.AGENT_TENANT||!/^\d{10,14}$/.test(stamp)||
     Math.abs(Math.floor(Date.now()/1000)-Number(stamp))>120||
     !/^[A-Za-z0-9_-]{16,100}$/.test(nonce)||!sigPattern.test(signature))return false;
  const hashed=hex(await crypto.subtle.digest('SHA-256',encoder.encode(JSON.stringify(sorted(body)))));
  const input=[agentId,tenant,stamp,nonce,hashed].join('\n');
  const key=await crypto.subtle.importKey('raw',encoder.encode(env.AGENT_HMAC_KEY),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const expected=hex(await crypto.subtle.sign('HMAC',key,encoder.encode(input)));
  return same(signature,expected);
}
const sigPattern=/^[a-f0-9]{64}$/;
export default {async fetch(request,env){
  const path=new URL(request.url).pathname;
  if(path==='/owner/verify'){
    if(request.method!=='GET')return reply({error:'method_not_allowed'},405);
    const ownerCfg=readOwnerConfig(env);
    if(!ownerCfg)return reply({error:'owner_identity_not_configured'},503);
    const subject=await authenticateAccess(request,env,ownerCfg);
    if(!subject)return reply({error:'access_jwt_required'},401);
    return reply({schema:'lifeline.owner_access_jwt_verified.v1',
      owner_access_token_signature_verified:true,
      owner_identity_pinned:true,
      trading_enabled:false,
      private_backend_connected:false,
      windows_host_connected:false},200);
  }
  if(path==='/owner/readiness'){
    // This route is deliberately diagnostic-only: never invoke Modal/Neon or
    // return raw values, hashes or lengths of any credential to the browser.
    if(request.method!=='GET')return reply({error:'method_not_allowed'},405);
    if(new URL(request.url).search)return reply({error:'unexpected_query'},400);
    const ownerCfg=readOwnerConfig(env);
    if(!ownerCfg)return reply({error:'owner_identity_not_configured'},503);
    const subject=await authenticateAccess(request,env,ownerCfg);
    if(!subject)return reply({error:'access_jwt_required'},401);
    return reply(backendBindingReadiness(env),200);
  }
  const cfg=readConfig(env);
  if(!cfg)return reply({error:'not_configured'},503);
  if(path==='/healthz'&&request.method==='GET')return reply({state:'authorization_required',trading:false});
  // MCP 2025-03-26 Streamable HTTP: this server does not offer an SSE GET
  // stream. Only an authenticated owner receives the required HTTP 405.
  if(path==='/mcp'&&request.method==='GET'){
    const subject=await authenticateAccess(request,env,cfg);
    if(!subject)return reply({error:'unauthorized'},401);
    return new Response(null,{status:405,headers:{'allow':'POST','cache-control':'no-store'}});
  }
  if(request.method!=='POST'||(!AGENT_ROUTES.has(path)&&!OPERATOR_ROUTES.has(path)&&path!=='/mcp'))
    return reply({error:'not_found'},404);
  const size=request.headers.get('content-length');
  if(size&&Number(size)>65536)return reply({error:'oversized'},413);
  let raw,body;
  try{
    raw=await request.text();if(encoder.encode(raw).length>65536)return reply({error:'oversized'},413);
    body=JSON.parse(raw);if(!body||Array.isArray(body)||typeof body!=='object')return reply({error:'invalid_json'},400);
  }catch{return reply({error:'invalid_json'},400);}
  let subject=null;
  if(AGENT_ROUTES.has(path)){
    if(!await authenticateAgent(request,env,body))return reply({error:'unauthorized'},401);
  }else{
    subject=await authenticateAccess(request,env,cfg);
    if(!subject)return reply({error:'unauthorized'},401);
  }
  if(path==='/mcp'){
    if(body.jsonrpc!=='2.0'||!METHODS.has(body.method))
      return reply({error:'operation_not_permitted'},403);
    // Legacy MCP lifecycle uses a notification with NO JSON-RPC id.
    // Deny any other notification or extra fields before touching Modal.
    const initialized=(body.method==='notifications/initialized');
    if(initialized){
      if(Object.hasOwn(body,'id')||
         Object.keys(body).some(k=>!['jsonrpc','method','params'].includes(k))||
         (Object.hasOwn(body,'params')&&(!body.params||
           typeof body.params!=='object'||Array.isArray(body.params)||
           Object.keys(body.params).length!==0)))
        return reply({error:'operation_not_permitted'},403);
    }else{
      const id=body.id;
      const identifierOk=(typeof id==='number'&&Number.isSafeInteger(id))||
        (typeof id==='string'&&id.length>0&&id.length<=128&&
          [...id].every(ch=>ch.charCodeAt(0)>=32&&ch.charCodeAt(0)<=126));
      if(!identifierOk||Object.keys(body).some(k=>!['jsonrpc','id','method','params'].includes(k)))
        return reply({error:'operation_not_permitted'},403);
    }
    if(body.method==='initialize'){
      const params=body.params;
      const boundedString=(v,n)=>typeof v==='string'&&v.length>0&&v.length<=n&&
        [...v].every(ch=>ch.codePointAt(0)>=32&&ch.codePointAt(0)!==127);
      const client=params?.clientInfo;
      if(!params||Array.isArray(params)||typeof params!=='object'||
         Object.keys(params).some(k=>!['protocolVersion','capabilities','clientInfo'].includes(k))||
         params.protocolVersion!=='2025-03-26'||
         !params.capabilities||typeof params.capabilities!=='object'||Array.isArray(params.capabilities)||
         !client||typeof client!=='object'||Array.isArray(client)||
         Object.keys(client).some(k=>!['name','version'].includes(k))||
         !boundedString(client.name,100)||!boundedString(client.version,60))
        return reply({error:'operation_not_permitted'},403);
    }else if(body.method==='ping'||body.method==='tools/list'){
      if(Object.hasOwn(body,'params')&&(!body.params||typeof body.params!=='object'||
         Array.isArray(body.params)||Object.keys(body.params).length!==0))
        return reply({error:'operation_not_permitted'},403);
    }
    if(body.method==='tools/call'){
      const params=body.params;
      // Never accept extra tool arguments or non-object params even if an
      // upstream implementation becomes more permissive later.
      if(!params||Array.isArray(params)||typeof params!=='object'||
         !TOOL_ALLOWLIST.has(params.name)||
         Object.keys(params).some(k=>k!=='name'&&k!=='arguments')||
         (Object.hasOwn(params,'arguments')&&(!params.arguments||
           typeof params.arguments!=='object'||Array.isArray(params.arguments)||
           Object.keys(params.arguments).length!==0)))
        return reply({error:'operation_not_permitted'},403);
    }
  }
  const headers={'content-type':'application/json','modal-key':env.MODAL_PROXY_KEY,
                 'modal-secret':env.MODAL_PROXY_SECRET,'x-lifeline-edge-secret':env.EDGE_SHARED_SECRET};
  // Cloudflare JWT sub and Neon tenant are distinct identities.
  // Only a pinned, verified owner may map to this single, fixed tenant.
  // Never accept client-supplied x-lifeline-subject or x-lifeline-tenant.
  if(subject)headers['x-lifeline-subject']=env.AGENT_TENANT;
  if(AGENT_ROUTES.has(path))for(const k of ['x-lifeline-agent-id','x-lifeline-tenant','x-lifeline-time','x-lifeline-nonce','x-lifeline-signature'])
    headers[k]=request.headers.get(k);
  let response;
  try{response=await fetch(cfg.modal+path,{method:'POST',redirect:'manual',headers,body:raw});}
  catch{return reply({error:'private_runtime_unavailable'},502);}
  if(response.status>=300&&response.status<400)return reply({error:'unexpected_redirect'},502);
  // Never proxy Modal's error bodies: internal diagnostics could disclose secrets.
  if(response.status>=400)return reply({error:'private_runtime_rejected'},502);
  // The only accepted legacy MCP notification is acknowledged by HTTP 202
  // with ZERO bytes, not a JSON-RPC response. No other backend response passes.
  if(path==='/mcp'&&body.method==='notifications/initialized'){
    if(response.status!==202||(
      response.headers.has('content-length')&&response.headers.get('content-length')!=='0'
    ))return reply({error:'invalid_private_backend_response'},502);
    if(response.body){
      const reader=response.body.getReader();
      try{
        const first=await reader.read();
        if(!first.done){
          await reader.cancel().catch(()=>{});
          return reply({error:'invalid_private_backend_response'},502);
        }
      }catch{return reply({error:'private_runtime_unavailable'},502);}
      finally{reader.releaseLock();}
    }
    return new Response(null,{status:202,headers:{'cache-control':'no-store'}});
  }
  const mime=response.headers.get('content-type')||'';
  if(!/^application\/json(?:\s*;|\s*$)/i.test(mime.trim()))
    return reply({error:'invalid_private_backend_response'},502);
  // Fail before streaming if Modal has already declared an excessive body size.
  const declared=response.headers.get('content-length');
  if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>131072))
    return reply({error:'oversized_backend_result'},502);
  if(!response.body)return reply({error:'invalid_private_backend_response'},502);
  const reader=response.body.getReader();
  let bytes=0;
  const chunks=[];
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      bytes+=value.byteLength;
      if(bytes>131072){
        void reader.cancel().catch(()=>{});
        return reply({error:'oversized_backend_result'},502);
      }
      chunks.push(value);
    }
  }catch{
    return reply({error:'private_runtime_unavailable'},502);
  }finally{
    reader.releaseLock();
  }
  const merged=new Uint8Array(bytes);
  let offset=0;
  for(const chunk of chunks){merged.set(chunk,offset);offset+=chunk.byteLength;}
  let output,parsed;
  try{
    output=new TextDecoder('utf-8',{fatal:true}).decode(merged);
    parsed=JSON.parse(output);
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('invalid shape');
  }catch{return reply({error:'invalid_private_backend_response'},502);}
  return new Response(output,{status:response.status,headers:{'content-type':'application/json','cache-control':'no-store'}});
}};
