// Opt-in staging wrapper; deliberately NOT imported by the production gateway.
// The caller supplies the independently reviewed gateway, preserving its exact
// schemas, protocol, numerical verification, OAuth and billing implementation.
import {authorizeCanonicalMCP} from '../auth/canonical_mcp_authorization_candidate.mjs';

const publicMethods=new Set(['initialize','tools/list','server/discover','ping','notifications/initialized']);
const publicTools=new Set(['search','fetch','musitu_axiom_capabilities']);
const json=(body)=>Response.json(body,{headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
async function describe(request){
 const u=new URL(request.url);
 if(request.method==='GET'&&u.pathname==='/health')return {public:true};
 if(request.method!=='POST'||u.pathname!=='/mcp')return {invalid:true};
 let m;try{m=await request.clone().json();}catch{return {invalid:true};}
 if(!m||Array.isArray(m)||typeof m!=='object'||m.jsonrpc!=='2.0'||typeof m.method!=='string')return {invalid:true};
 return {id:m.id??null,public:publicMethods.has(m.method)||
  (m.method==='tools/call'&&publicTools.has(m.params?.name))};
}
function denied(id,env){
 const result={content:[{type:'text',text:'Your AXIOM account could not be authorized for this request.'}],
  structuredContent:{authenticated:false},isError:true};
 const resource=env.MCP_PUBLIC_BASE||'https://mcp.mftintelligence.com';
 try{const u=new URL(resource);if(u.protocol==='https:'&&u.origin===resource&&!u.username&&!u.password)
  result._meta={'mcp/www_authenticate':[`Bearer resource_metadata="${resource}/.well-known/oauth-protected-resource"`]};}catch{}
 return json({jsonrpc:'2.0',id,result});
}
export function withCanonicalMCPAdmission(gateway){
 if(typeof gateway?.fetch!=='function')throw new TypeError('reviewed_gateway_required');
 return {async fetch(request,env,ctx){
  const suppliedCore=env.MCP_CORE;
  if(typeof suppliedCore?.fetch!=='function')return gateway.fetch(request,env,ctx);
  const guardedCore={async fetch(coreRequest){
   const info=await describe(coreRequest);
   if(info.invalid)return json({jsonrpc:'2.0',id:null,error:{code:-32600,message:'Invalid Request'}});
   if(!info.public&&!(await authorizeCanonicalMCP(coreRequest,env)).ok)return denied(info.id,env);
   // Check the real service-boundary call, not a prior browser/UI preflight.
   // No principal headers are injected and no original private binding escapes.
   return suppliedCore.fetch(coreRequest);
  }};
  return gateway.fetch(request,{...env,MCP_CORE:guardedCore},ctx);
 }};
}
