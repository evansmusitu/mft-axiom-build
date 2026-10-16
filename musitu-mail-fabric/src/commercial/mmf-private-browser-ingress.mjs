/**
 * PRIVATE STAGE-ONLY OIDC browser Request/Response adapter.
 * NOT mounted in any public Worker, DNS route or running server. Requires an
 * independent trusted HTTPS/rate-limit gate and approved code exchanger.
 * Does not enable customer APIs, mail delivery or commercial payments.
 */
import {PrivateOidcBrowserStage} from './mmf-oidc-browser-stage.mjs';

const DENIED='MMF_PRIVATE_BROWSER_INGRESS_DENIED';
const deny=()=>{throw Error(DENIED)};
const TENANT=/^[a-z][a-z0-9-]{2,45}$/;
const TOKEN=/^[A-Za-z0-9_-]{43}$/;
const HTML_ESCAPE={'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
const escapeHtml=s=>String(s).replace(/[&<>"']/g,c=>HTML_ESCAPE[c]);
const CSS_POLICY="default-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'";
const HEADERS={
 'cache-control':'no-store',
 'content-security-policy':CSS_POLICY,
 'x-content-type-options':'nosniff',
 'x-frame-options':'DENY',
 'referrer-policy':'no-referrer',
 'strict-transport-security':'max-age=31536000',
 'permissions-policy':'camera=(), microphone=(), geolocation=()',
};
const response=(body,{status=200,type='text/html; charset=utf-8',location,setCookies=[]}={})=>{
 const headers=new Headers({...HEADERS,'content-type':type});
 if(location)headers.set('location',location);
 for(const value of setCookies)headers.append('set-cookie',value);
 return new Response(body,{status,headers});
};
const forbidden=()=>response('MMF_PRIVATE_BROWSER_DENIED',{status:403,type:'text/plain; charset=utf-8'});
const cookie=(header,name)=>{
 if(typeof header!=='string'||header.length>4096||/[\r\n\x00]/.test(header))deny();
 const pairs=header.split(';').map(x=>x.trim()).filter(x=>x.startsWith(name+'='));
 if(pairs.length!==1)deny();const value=pairs[0].slice(name.length+1);
 if(!TOKEN.test(value))deny();return value;
};
function allowedSearch(search,fields){
 if(search.length>4096)deny();
 const params=new URLSearchParams(search);
 if([...params.keys()].length!==fields.length||fields.some(k=>params.getAll(k).length!==1)||
    [...params.keys()].some(k=>!fields.includes(k)))deny();
 return params;
}
async function form(req){
 if(!/^application\/x-www-form-urlencoded(?:;\s*charset=utf-8)?$/i.test(req.headers.get('content-type')||''))deny();
 const length=req.headers.get('content-length');
 if(length!==null&&(!/^\d{1,3}$/.test(length)||Number(length)>512))deny();
 if(!req.body)deny();
 const reader=req.body.getReader();const parts=[];let count=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;
  if(!(value instanceof Uint8Array))deny();count+=value.byteLength;if(count>512)deny();parts.push(value);
 }}finally{try{reader.releaseLock()}catch{}}
 const bytes=new Uint8Array(count);let i=0;for(const part of parts){bytes.set(part,i);i+=part.byteLength;}
 let str;try{str=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{deny()}
 return new URLSearchParams(str);
}
function page(title,content){
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} — MUSITU Mail Fabric (private)</title></head><body><main><h1>MUSITU Mail Fabric · Private staging</h1><p>Real sending, customer APIs and payment checkout are disabled.</p>${content}</main></body></html>`;
}
const logoutForm=csrf=>`<form action="/private/logout" method="post"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button type="submit">Sign out</button></form>`;
function onBoarding(csrf){return page('Tenant onboarding',
 `<h2>Create private stage tenant</h2><form action="/private/tenants" method="post"><label>Tenant ID <input name="tenantId" pattern="[a-z][a-z0-9-]{2,45}" minlength="3" maxlength="46" required></label><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button type="submit">Create private tenant</button></form>${logoutForm(csrf)}`);
}
function dashboardHtml(d,csrf){
 const table=(label,headers,rows)=>`<section><h3>${label}</h3><table><thead><tr>${headers.map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(x=>`<td>${escapeHtml(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></section>`;
 return page('Tenant dashboard',`<h2>Tenant ${escapeHtml(d.tenantId)}</h2><p>Sending disabled · Payments disabled</p><p>Usage: ${escapeHtml(d.usage.count)} stage events in ${escapeHtml(d.usage.period)}</p>`+
 table('Domains',['Domain','State'],d.domains.map(v=>[v.domain,v.status]))+
 table('API key inventory',['Key ID','Scope','Revoked'],d.apiKeys.map(v=>[v.keyId,v.scope,v.revoked?'Yes':'No']))+
 table('Subscription requests',['Order','Plan','State'],d.subscriptions.map(v=>[v.orderReference,v.planCode,v.status]))+
 `<h3>Request private DNS verification</h3><form action="/private/domains" method="post"><input type="hidden" name="tenantId" value="${escapeHtml(d.tenantId)}"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><label>Domain <input name="domain" maxlength="190" required></label><button type="submit">Request TXT challenge</button></form>`+
 logoutForm(csrf));
}
export function createMmfPrivateBrowserIngress({browser,exchangeCode,gateRequest,env,origin}={}){
 if(!(browser instanceof PrivateOidcBrowserStage)||typeof exchangeCode!=='function'||
  typeof gateRequest!=='function'||origin!==browser.origin||!env||
  env.MMF_REAL_SEND_ENABLED!=='false'||env.MMF_COMMERCE_ENABLED!=='false'||
  env.MMF_CUSTOMER_API_ENABLED!=='false')deny();
 const host=new URL(origin).host;
 async function fetch(req){
  try{
   if(!(req instanceof Request)||req.url.length>4096||!['GET','POST'].includes(req.method)||
    req.headers.get('host')!==host||
    ['x-forwarded-host','x-forwarded-proto','forwarded','x-original-url','x-rewrite-url'].some(n=>req.headers.has(n))||
    (req.headers.get('cookie')||'').length>4096)deny();
   const url=new URL(req.url);
   if(url.origin!==origin||url.username||url.password||url.hash||
    /%|\/\/|\\/.test(url.pathname))deny();
   const site=req.headers.get('sec-fetch-site'),mode=req.headers.get('sec-fetch-mode'),dest=req.headers.get('sec-fetch-dest');
   if(mode!=='navigate'||dest!=='document'||
     !(site==='same-origin'||
       site==='cross-site'&&url.pathname==='/private/oidc/callback'&&req.method==='GET'||
       site==='none'&&url.pathname==='/private/login'&&req.method==='GET'))deny();
   const requestOrigin=req.headers.get('origin');
   if((req.method==='POST'&&requestOrigin!==origin)||
      (requestOrigin!==null&&requestOrigin!==origin))deny();
   if(await gateRequest(Object.freeze({method:req.method,path:url.pathname,stageOnly:true}))!==true)deny();
   const cookieHeader=req.headers.get('cookie')||'';
   if(url.pathname==='/private/login'&&req.method==='GET'){
    if(url.search)deny();const result=browser.begin({origin});
    return response(null,{status:302,location:result.authorizationUrl,setCookies:result.setCookies});
   }
   if(url.pathname==='/private/oidc/callback'&&req.method==='GET'){
    const params=allowedSearch(url.search,['state','code']);
    const result=await browser.callback({origin,cookieHeader,state:params.get('state'),code:params.get('code'),exchangeCode});
    // A browser arriving from an external IdP can suppress Strict session cookies
    // throughout a cross-site redirect chain. A user-activated first-party link
    // ensures the next navigation is genuinely same-site, without relaxing cookies.
    return response(page('Identity accepted','<h2>Private identity confirmed</h2><p>Select Continue to establish a same-origin session navigation.</p><a href="/private/tenants">Continue to private onboarding</a>'),
     {status:200,setCookies:result.setCookies});
   }
   if(url.pathname==='/private/tenants'&&req.method==='GET'){
    if(url.search)deny();browser.readSession({origin,cookieHeader});
    return response(onBoarding(cookie(cookieHeader,'__Host-mmf_csrf')));
   }
   if(url.pathname==='/private/tenants'&&req.method==='POST'){
    if(url.search)deny();const payload=await form(req);
    const params=allowedSearch('?'+payload.toString(),['tenantId','csrf']);
    const tenantId=params.get('tenantId'),csrf=params.get('csrf');
    if(!TENANT.test(tenantId||''))deny();
    const sessionToken=browser.authorizeMutation({origin,cookieHeader,csrfHeader:csrf});
    browser.controller.createTenant({sessionToken,tenantId});
    return response(null,{status:303,location:origin+'/private/dashboard?tenantId='+tenantId});
   }
   if(url.pathname==='/private/domains'&&req.method==='POST'){
    if(url.search)deny();
    const params=allowedSearch('?'+(await form(req)).toString(),['tenantId','domain','csrf']);
    const tenantId=params.get('tenantId'),domain=params.get('domain');
    if(!TENANT.test(tenantId||'')||typeof domain!=='string'||domain.length>190)deny();
    const sessionToken=browser.authorizeMutation({origin,cookieHeader,csrfHeader:params.get('csrf')});
    const challenge=browser.controller.requestDomain({sessionToken,tenantId,domain});
    if(challenge.status!=='PENDING_DNS'||challenge.canSendMail!==false)deny();
    return response(page('Domain DNS challenge',`<h2>Private DNS verification pending</h2><p>PENDING_DNS · Mail sending remains disabled.</p><p>TXT name: <code>${escapeHtml(challenge.dnsName)}</code></p><p>TXT value: <code>${escapeHtml(challenge.txtValue)}</code></p><a href="/private/dashboard?tenantId=${escapeHtml(tenantId)}">Back to private dashboard</a>${logoutForm(params.get('csrf'))}`));
   }
   if(url.pathname==='/private/dashboard'&&req.method==='GET'){
    const params=allowedSearch(url.search,['tenantId']);const tenantId=params.get('tenantId');
    if(!TENANT.test(tenantId||''))deny();
    const d=browser.readDashboard({origin,cookieHeader,tenantId});
    if(d.canSendMail!==false||d.canInitiatePayments!==false||d.customerApiEnabled!==false)deny();
    return response(dashboardHtml(d,cookie(cookieHeader,'__Host-mmf_csrf')));
   }
   if(url.pathname==='/private/logout'&&req.method==='POST'){
    if(url.search)deny();const params=allowedSearch('?'+(await form(req)).toString(),['csrf']);
    const done=browser.logout({origin,cookieHeader,csrfHeader:params.get('csrf')});
    if(!done.revoked)deny();return response(null,{status:303,location:origin+'/private/login',setCookies:done.clearCookies});
   }
   deny();
  }catch{return forbidden()}
 }
 return Object.freeze({fetch,customerApiEnabled:false,publicIngressInstalled:false});
}