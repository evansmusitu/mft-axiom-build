// Explicit, bounded browser contract for the separate private handoff service.
import {readHandoffText} from './oauth_handoff_contract_candidate.mjs';
import {ZITADEL_STAGING,parseIdentityJson} from './zitadel_provider_tokens_candidate.mjs';
const HANDOFF_PORTAL=new URL(ZITADEL_STAGING.redirect_uri).origin,HANDOFF_AUTH='https://auth.mftintelligence.com',HANDOFF_PATH='/auth/oauth/authorize';
const handoffOpaque=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{43}$/.test(x);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fail=status=>new Response('Unable to connect this account. Return to ChatGPT and start again.',{status,headers:headers()});
function headers(){return {'content-type':'text/html; charset=utf-8','cache-control':'no-store','pragma':'no-cache','referrer-policy':'no-referrer',
 'x-content-type-options':'nosniff','content-security-policy':`default-src 'none'; form-action 'self' ${HANDOFF_AUTH}; base-uri 'none'; frame-ancestors 'none'`};}
const keys=(p,want)=>p&&!Array.isArray(p)&&Object.keys(p).sort().join(',')===want.split(',').sort().join(',');
const cookie=(value,age)=>`__Host-axiom_oauth_consent=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${age}`;
const page=content=>`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect MUSITU Axiom</title></head><body><main><h1>Connect MUSITU Axiom</h1>${content}</main></body></html>`;
export async function oauthHandoffRoute(request,env){
 const u=new URL(request.url);if(u.origin!==HANDOFF_PORTAL||u.pathname!==HANDOFF_PATH)return null;
 if(env.CUSTOMER_OAUTH_HANDOFF_ROUTE_ADMITTED!=='qualified_private_binding'||env.OAUTH_HANDOFF_QUALIFIED!=='qualified_private_binding'||
  typeof env.CUSTOMER_OAUTH_HANDOFF_BROWSER?.fetch!=='function')return fail(503);
 if(!['GET','POST'].includes(request.method))return fail(405);
 if([...u.searchParams.keys()].some(k=>k!=='handoff')||u.searchParams.getAll('handoff').length!==1||!handoffOpaque(u.searchParams.get('handoff')))return fail(400);
 if(request.method==='POST'&&request.headers.get('origin')!==HANDOFF_PORTAL)return fail(403);
 let r,p;try{
  r=await env.CUSTOMER_OAUTH_HANDOFF_BROWSER.fetch(new Request(request,{redirect:'manual',signal:AbortSignal.timeout(5000)}));
  if(r.status!==200)return fail([400,401,503].includes(r.status)?r.status:502);
  if(r.headers.get('content-type')!=='application/json')return fail(502);
  p=parseIdentityJson(await readHandoffText(r,4096));
 }catch{return fail(503);}
 if(p.handoff_id!==u.searchParams.get('handoff'))return fail(502);
 const h=headers();
 if(request.method==='GET'&&keys(p,'kind,handoff_id')&&p.kind==='login'){
  return new Response(null,{status:303,headers:{...h,location:HANDOFF_PORTAL+'/auth/start?intent=login&oauth_handoff='+p.handoff_id}});
 }
 if(request.method==='GET'&&keys(p,'kind,handoff_id,csrf,scope,expires_at_ms')&&p.kind==='consent'&&handoffOpaque(p.csrf)&&
  typeof p.scope==='string'&&/^(openid|email|axiom\.execute|billing\.(read|write))( (openid|email|axiom\.execute|billing\.(read|write)))*$/.test(p.scope)&&
  Number.isSafeInteger(p.expires_at_ms)&&p.expires_at_ms>Date.now()&&p.expires_at_ms<=Date.now()+300000){
  const age=Math.floor((p.expires_at_ms-Date.now())/1000);if(age<1)return fail(401);h['set-cookie']=cookie(p.csrf,age);
  return new Response(page(`<p>Connect your verified MUSITU Axiom account to ChatGPT.</p><p>Requested access: ${esc(p.scope)}</p>`+
   `<form method="post" action="${HANDOFF_PATH}?handoff=${p.handoff_id}"><input type="hidden" name="csrf" value="${p.csrf}">`+
   '<button name="consent" value="approve" type="submit">Allow ChatGPT connection</button></form>'),{status:200,headers:h});
 }
 if(request.method==='POST'&&keys(p,'kind,handoff_id,flow_id,grant')&&p.kind==='complete'&&handoffOpaque(p.grant)&&/^flow_[A-Za-z0-9_-]{32}$/.test(p.flow_id)){
  h['set-cookie']=cookie('',0);
  return new Response(page(`<p>Your account consent is recorded. Complete the connection in the browser that started it.</p>`+
   `<form method="post" action="${HANDOFF_AUTH}/oauth/authorize"><input type="hidden" name="auth_mode" value="verified_handoff">`+
   `<input type="hidden" name="flow_id" value="${p.flow_id}"><input type="hidden" name="handoff_id" value="${p.handoff_id}">`+
   `<input type="hidden" name="handoff_grant" value="${p.grant}"><button type="submit">Complete ChatGPT connection</button></form>`),{status:200,headers:h});
 }
 return fail(502);
}
