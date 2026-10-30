/**
 * MUSITU Store V2 — PRIVATE, UNDEPLOYED HTTP adapter for OIDC+PKCE candidate.
 * No server, issuer enrollment, credential access, payments or public routes.
 * Dependencies must be operator-verified, durable and trusted server-side:
 * gate.start/complete, sessionLookup and sessionRevoke. Mocked in local tests.
 */
import {timingSafeEqual} from 'node:crypto';
const SESSION='__Host-musitu_store_session';
const FLOW='__Host-musitu_store_flow';
const FLOW_STATE=/^[A-Za-z0-9_-]{43}$/;
const SID=/^[A-Za-z0-9_-]{12,128}$/;
const ROLES=new Set(['developer','owner','review_identity','review_security']);
const DENIED={publisherApproved:false,publicationAuthorized:false,paymentAuthorized:false,payoutAuthorized:false,entitlementGranted:false};
const headers={'cache-control':'no-store','content-type':'application/json; charset=utf-8',
 'content-security-policy':"default-src 'none'; frame-ancestors 'none'",'referrer-policy':'no-referrer',
 'x-content-type-options':'nosniff','x-frame-options':'DENY',
 'strict-transport-security':'max-age=31536000; includeSubDomains'};
const respond=(status,body,extra={})=>new Response(status===204?null:JSON.stringify(body),{
 status,headers:{...headers,...extra}});
function canonicalOrigin(s){
 if(typeof s!=='string'||s.length>350)throw Error('private_http_configuration_denied');
 let u;try{u=new URL(s);}catch{throw Error('private_http_configuration_denied');}
 if(u.protocol!=='https:'||u.origin!==s||u.username||u.password||u.hash||u.search||u.pathname!=='/'||u.port)
  throw Error('private_http_configuration_denied');
 return s;
}
function cookieValue(cookieHeader,name,pattern){
 if(typeof cookieHeader!=='string'||cookieHeader.length>4096)return null;
 const found=cookieHeader.split(';').map(x=>x.trim()).filter(x=>x.startsWith(name+'='));
 if(found.length!==1)return null;
 const value=found[0].slice(name.length+1);
 return pattern.test(value)?value:null;
}
function sessionId(cookieHeader){return cookieValue(cookieHeader,SESSION,SID);}
function flowCookie(value,age){return `${FLOW}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${age}`;}
function sessionCookie(value,age){return `${SESSION}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${age}`;}
function equalFlow(a,b){
 if(typeof a!=='string'||typeof b!=='string'||!FLOW_STATE.test(a)||!FLOW_STATE.test(b))return false;
 return timingSafeEqual(Buffer.from(a),Buffer.from(b));
}
export function createPrivateOidcHttpHandler({origin,issuerOrigin,gate,sessionLookup,sessionRevoke,now=Date.now}={}){
 const site=canonicalOrigin(origin),issuer=canonicalOrigin(issuerOrigin);
 if(!gate||typeof gate.start!=='function'||typeof gate.complete!=='function'||
    typeof sessionLookup!=='function'||typeof sessionRevoke!=='function'||typeof now!=='function')
  throw Error('private_http_configuration_denied');
 return async function handle(req){
  try{
   if(!(req instanceof Request))return respond(400,{ok:false,code:'invalid_request',...DENIED});
   const u=new URL(req.url);
   if(u.origin!==site||u.hash||u.username||u.password)
    return respond(404,{ok:false,code:'not_found',...DENIED});
   if(u.pathname==='/auth/oidc/start'&&req.method==='GET'){
    if(u.search)return respond(400,{ok:false,code:'invalid_request',...DENIED});
    try{
     const result=await gate.start();
     const target=new URL(result?.authorizationUrl);
     if(target.protocol!=='https:'||target.origin!==issuer||target.username||target.password||target.hash||
       target.searchParams.getAll('state').length!==1||
       !FLOW_STATE.test(target.searchParams.get('state')??''))
      throw Error('invalid_redirect');
     // Bind the one-time server-side OIDC state to THIS browser, preventing
     // an attacker from logging a victim into the attacker's account via CSRF.
     return new Response(null,{status:303,headers:{...headers,location:target.toString(),
       'set-cookie':flowCookie(target.searchParams.get('state'),300)}});
    }catch{return respond(503,{ok:false,code:'identity_provider_unavailable',...DENIED});}
   }
   if(u.pathname==='/auth/oidc/callback'&&req.method==='GET'){
    const state=u.searchParams.get('state');
    const browserState=cookieValue(req.headers.get('cookie'),FLOW,FLOW_STATE);
    if(u.searchParams.getAll('state').length!==1||!equalFlow(state,browserState))
     return respond(401,{ok:false,code:'identity_not_verified',...DENIED},
       {'set-cookie':flowCookie('',0)});
    try{
     const v=await gate.complete(req.url);
     if(!v||!SID.test(v.sessionId)||!ROLES.has(v.role)||
        Object.keys(DENIED).some(k=>v[k]!==false))throw Error('unsafe_session');
     const responseHeaders=new Headers({...headers,location:site+'/auth/session'});
     responseHeaders.append('set-cookie',sessionCookie(v.sessionId,900));
     responseHeaders.append('set-cookie',flowCookie('',0));
     return new Response(null,{status:303,headers:responseHeaders});
    }catch{return respond(401,{ok:false,code:'identity_not_verified',...DENIED},
      {'set-cookie':flowCookie('',0)});}
   }
   if(u.search||u.pathname==='/auth/oidc/callback'||u.pathname==='/auth/oidc/start')
    return respond(404,{ok:false,code:'not_found',...DENIED});
   if(u.pathname==='/auth/session'&&req.method==='GET'){
    if(req.headers.has('authorization'))return respond(401,{ok:false,code:'unauthorized',...DENIED});
    const sid=sessionId(req.headers.get('cookie'));
    if(!sid)return respond(401,{ok:false,code:'unauthorized',...DENIED});
    try{
     const s=await sessionLookup(sid);
     if(s?.active!==true||!ROLES.has(s.role)||typeof s.subject!=='string'||
        !Number.isSafeInteger(s.expiresAt)||s.expiresAt<=now()/1000)
      throw Error('session_inactive');
     return respond(200,{ok:true,authenticated:true,role:s.role,...DENIED});
    }catch{return respond(401,{ok:false,code:'unauthorized',...DENIED});}
   }
   if(u.pathname==='/auth/logout'&&req.method==='POST'){
    if(req.headers.get('origin')!==site||req.headers.get('sec-fetch-site')!=='same-origin')
     return respond(403,{ok:false,code:'origin_denied',...DENIED});
    const sid=sessionId(req.headers.get('cookie'));
    if(!sid)return respond(401,{ok:false,code:'unauthorized',...DENIED});
    try{
     if(await sessionRevoke(sid)!==true)throw Error('revoke_denied');
     // A write acknowledgment is not proof of revocation. Re-read the durable
     // authorization state and report success only once it is no longer active.
     const observed=await sessionLookup(sid);
     if(observed?.active!==false&&observed!==null)throw Error('revoke_not_observed');
     return respond(204,null,{'set-cookie':sessionCookie('',0)});
    }catch{return respond(503,{ok:false,code:'session_revocation_unavailable',...DENIED});}
   }
   return respond(404,{ok:false,code:'not_found',...DENIED});
  }catch{return respond(400,{ok:false,code:'invalid_request',...DENIED});}
 };
}
