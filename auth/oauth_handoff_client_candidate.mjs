// Candidate OAuth-side adapter. No portal cookie or provider token is accepted.
import {readHandoffText,handoffFormContentType} from '../customer_frontier/customer_control_plane/oauth_handoff_contract_candidate.mjs';
import {parseIdentityJson} from '../customer_frontier/customer_control_plane/zitadel_provider_tokens_candidate.mjs';
import {HANDOFF_AUTH,HANDOFF_PORTAL,HANDOFF_PATH,HANDOFF_COOKIE,handoffOpaque,handoffCredential} from './oauth_session_handoff_candidate.mjs';
export const handoffEnabled=env=>env?.OAUTH_HANDOFF_QUALIFIED==='qualified_private_binding';
const failure=()=>new Response('Unable to connect. Return to ChatGPT and start again.',{status:503,headers:{'cache-control':'no-store','referrer-policy':'no-referrer'}});
export async function beginOAuthHandoff(request,env,flowId,nonceHash,csrf){
 if(new URL(request.url).origin!==HANDOFF_AUTH||env.OAUTH_ISSUER&&env.OAUTH_ISSUER!==HANDOFF_AUTH||
  env.OAUTH_KEYLESS_QUALIFIED!=='qualified_private_binding'||!env.OAUTH_SESSION_VERIFIER?.fetch||!handoffOpaque(csrf))return failure();
 let p;try{
  const r=await env.OAUTH_SESSION_VERIFIER.fetch(new Request('https://axiom-internal/oauth/handoff/create',{method:'POST',
   headers:{'content-type':'application/json'},body:JSON.stringify({flow_id:flowId,nonce_hash:nonceHash}),redirect:'manual',signal:AbortSignal.timeout(5000)}));
  if(r.status!==201)return failure();p=parseIdentityJson(await readHandoffText(r,2048));
 }catch{return failure();}
 if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).sort().join(',')!=='expires_at_ms,flow_id,handoff_id'||p.flow_id!==flowId||!handoffOpaque(p.handoff_id)||
  !Number.isSafeInteger(p.expires_at_ms)||p.expires_at_ms<=Date.now()||p.expires_at_ms>Date.now()+300000)return failure();
 const age=Math.floor((p.expires_at_ms-Date.now())/1000);if(age<1)return failure();
 return new Response(`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect MUSITU Axiom</title></head>`+
  `<body><main><h1>Connect MUSITU Axiom</h1><p>Sign in to your verified MUSITU Axiom account to connect with ChatGPT.</p>`+
  `<a href="${HANDOFF_PORTAL+HANDOFF_PATH}?handoff=${p.handoff_id}">Sign in and connect</a></main></body></html>`,{status:200,
  headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','pragma':'no-cache','referrer-policy':'no-referrer',
   'x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
   'set-cookie':`${HANDOFF_COOKIE}=${csrf}; Path=/; Max-Age=${age}; HttpOnly; Secure; SameSite=Lax`}});
}
export function handoffConsentRequest(request,form,env){
 if(!handoffEnabled(env)||new URL(request.url).origin!==HANDOFF_AUTH||request.headers.get('origin')!==HANDOFF_PORTAL||
  !handoffFormContentType(request))throw Error('handoff_denied');
 const names=['auth_mode','flow_id','handoff_id','handoff_grant'];
 if([...form.keys()].length!==names.length||names.some(k=>form.getAll(k).length!==1)||
  [...form.keys()].some(k=>!names.includes(k))||!handoffOpaque(form.get('handoff_id'))||!handoffOpaque(form.get('handoff_grant')))throw Error('handoff_denied');
 const csrf=handoffCredential(request,HANDOFF_COOKIE);
 // Supply only the OAuth host cookie to the private verifier. Browser headers,
 // unrelated cookies and any alleged portal session cannot cross this boundary.
 return {csrf,request:new Request(request.url,{method:'POST',headers:{cookie:HANDOFF_COOKIE+'='+csrf}}),
  handoff:{handoff_id:form.get('handoff_id'),handoff_grant:form.get('handoff_grant')}};
}
