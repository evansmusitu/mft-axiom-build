// Staging-only ingress adapter for the already-reviewed, separate ZITADEL
// browser Worker. This does not activate or qualify an IdP, customer link,
// website, ChatGPT OAuth session, or Cloudflare service binding.
import {ZITADEL_STAGING} from './zitadel_provider_tokens_candidate.mjs';

const ORIGIN=new URL(ZITADEL_STAGING.redirect_uri).origin;
const ROUTES=new Set(['/auth/start','/auth/callback','/auth/logout']);
const failure=(status)=>new Response(JSON.stringify({ok:false,error:'identity_not_qualified'}),
 {status,headers:{'content-type':'application/json','cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff'}});
const param=(url,key)=>{const v=url.searchParams.getAll(key);return v.length===1?v[0]:null;};
function validAuthorizationRedirect(location){
 let u;try{u=new URL(location);}catch{return false;}
 const parameters=['client_id','redirect_uri','response_type','scope','state','nonce','code_challenge','code_challenge_method','max_age'];
 if([...u.searchParams.keys()].length!==parameters.length||
    parameters.some(key=>u.searchParams.getAll(key).length!==1))return false;
 return u.origin===ZITADEL_STAGING.issuer&&u.pathname==='/oauth/v2/authorize'&&
  !u.username&&!u.password&&!u.hash&&param(u,'client_id')===ZITADEL_STAGING.client_id&&
  param(u,'redirect_uri')===ZITADEL_STAGING.redirect_uri&&param(u,'response_type')==='code'&&
  param(u,'code_challenge_method')==='S256'&&
  /^[A-Za-z0-9_-]{43,128}$/.test(param(u,'code_challenge')||'')&&
  /^[A-Za-z0-9_-]{32,256}$/.test(param(u,'nonce')||'')&&
  /^[A-Za-z0-9_-]{32,256}$/.test(param(u,'state')||'')&&
  param(u,'scope')==='openid email'&&param(u,'max_age')==='300';
}
function validHostOnlyCookies(headers,route){
 const cookies=headers.getSetCookie?.()||[headers.get('set-cookie')].filter(Boolean);
 if(cookies.length<1||cookies.length>2)return false;
 const names=[];
 for(const c of cookies){
  // This is the exact output contract of the separately reviewed staging
  // browser worker; reject duplicate attributes, ambiguous paths and expiry.
  const m=/^(__Host-axiom_(?:login|customer))=([A-Za-z0-9_-]{43}|); Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=(0|[1-9][0-9]{0,2})$/.exec(c);
  if(!m||Number(m[3])>300)return false;
  const zero=m[3]==='0';
  if(zero===(m[2].length>0))return false;
  names.push(m[1]);
  if(route==='/auth/start'&&(m[1]!=='__Host-axiom_login'||zero))return false;
  if(route==='/auth/callback'&&m[1]==='__Host-axiom_login'&&!zero)return false;
  if(route==='/auth/logout'&&!zero)return false;
 }
 return new Set(names).size===names.length&&
  (route==='/auth/start'||names.includes('__Host-axiom_customer'));
}

export async function stagingIdentityRoute(request,env){
 const u=new URL(request.url);
 if(u.origin!==ORIGIN||!ROUTES.has(u.pathname))return null;
 if(env.CUSTOMER_IDP_STAGING_ADMITTED!=='qualified_staging'||
    env.CUSTOMER_IDP_ROUTE_ADMITTED!=='qualified_private_binding'||
    typeof env.CUSTOMER_IDP_BROWSER?.fetch!=='function')return failure(503);
 const expected=u.pathname==='/auth/logout'?'POST':'GET';
 if(request.method!==expected)return failure(405);
 if(u.pathname==='/auth/logout'&&request.headers.get('origin')!==ORIGIN)return failure(403);
 let result;
 try{result=await env.CUSTOMER_IDP_BROWSER.fetch(request);}catch{return failure(503);}
 if(!(result instanceof Response))return failure(502);
 if(result.status===303){
  const location=result.headers.get('location');
  if(u.pathname==='/auth/start'?!validAuthorizationRedirect(location):location!==ORIGIN+'/')return failure(502);
  if(!validHostOnlyCookies(result.headers,u.pathname))return failure(502);
  // The private service is not allowed to add CORS, Refresh, debug headers
  // or a response body to the public browser contract. Only the validated
  // redirect and host-only cookies cross this boundary.
  const headers=new Headers({'location':location,'cache-control':'no-store',
   'referrer-policy':'no-referrer','x-content-type-options':'nosniff'});
  const cookies=result.headers.getSetCookie?.()||[result.headers.get('set-cookie')].filter(Boolean);
  for(const cookie of cookies)headers.append('set-cookie',cookie);
  return new Response(null,{status:303,headers});
 }
 if(![400,401,503].includes(result.status))return failure(502);
 // On a failed callback the private broker deliberately expires the one-use
 // login cookie. Permit only that exact deletion, never a new session cookie.
 if(result.status===400&&u.pathname==='/auth/callback'){
  const cookies=result.headers.getSetCookie?.()||[result.headers.get('set-cookie')].filter(Boolean);
  const clear='__Host-axiom_login=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0';
  if(cookies.length===1&&cookies[0]===clear){
   const response=failure(400);response.headers.append('set-cookie',clear);return response;
  }
 }
 // Never forward private provider error cookies, redirects, or token details.
 return failure(result.status);
}
