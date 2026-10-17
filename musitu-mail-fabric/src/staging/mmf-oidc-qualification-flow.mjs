/** Private, time-limited browser harness for the existing qualification tool.
 * No application sessions or tenant operations. Call only AFTER the unchanged
 * cryptographic Access/admin gate. Durable transactions consume state and code
 * before network I/O. Codes and ID tokens are never persisted or returned.
 */
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {createCloudflareMmfPkceQualification} from './mmf-cloudflare-pkce-qualification.mjs';
const ORIGIN='https://mail-stage.mftintelligence.com';
const COOKIE='__Host-mmf_pkce_qualification';
const TOKEN=/^[A-Za-z0-9_-]{43}$/;
const CODE=/^[A-Za-z0-9._~-]{8,2048}$/;
const deny=()=>{throw Error('MMF_PRIVATE_QUALIFICATION_DENIED')};
const hash=s=>createHash('sha256').update(s).digest('hex');
const headers=Object.freeze({'cache-control':'no-store','referrer-policy':'no-referrer',
 'x-content-type-options':'nosniff','x-frame-options':'DENY',
 'strict-transport-security':'max-age=31536000',
 'content-security-policy':"default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"});
const cookie=(state,age)=>`${COOKIE}=${state}; Path=/; Max-Age=${age}; Secure; HttpOnly; SameSite=Lax`;
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{...headers,'content-type':'application/json; charset=utf-8'}});
const redirect=(location,setCookie)=>new Response(null,{status:303,headers:{...headers,location,...(setCookie?{'set-cookie':setCookie}:{})}});
function landing(){
 // A passive, authenticated landing page permits ordinary links from the
 // user's phone. Only the subsequent same-origin click starts any OIDC state.
 return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MUSITU Mail Fabric · Private sign-in check</title></head><body><main><h1>Private sign-in check</h1><p>Continue with your administrator account and complete the requested verification.</p><p><a href="/private/oidc/qualify">Continue to secure sign-in</a></p><p>This check does not enable mail sending or payments.</p><p><a href="/private/dashboard">Return to dashboard</a></p></main></body></html>`,
  {status:200,headers:{...headers,'content-type':'text/html; charset=utf-8'}});
}
const emptyResult=()=>({attempted:false,pkceAndSignedMfaVerified:false,applicationLoginEnabled:false,
 sessionCreated:false,strictDiscoveryQualified:false,realSending:false,payments:false,customerApi:false});
const equal=(a,b)=>TOKEN.test(a||'')&&TOKEN.test(b||'')&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
function stateCookie(raw){
 if(typeof raw!=='string'||raw.length>16384||/[\x00-\x1f]/.test(raw))deny();
 const values=raw.split(';').map(s=>s.trim()).filter(s=>s.startsWith(COOKIE+'='));
 if(values.length!==1)deny();
 const value=values[0].slice(COOKIE.length+1);if(!TOKEN.test(value))deny();return value;
}
export class MmfOidcQualificationFlow {
 constructor(storage,config,env,{now=Date.now,fetchImpl=globalThis.fetch,allowExpired=false}={}){
  if(!storage?.transaction||!storage?.getAlarm||!storage?.setAlarm||typeof now!=='function'||!Number.isSafeInteger(config?.validUntil)||
   !allowExpired&&config.validUntil<=now()||config?.validUntil>now()+2*86400000)deny();
  this.storage=storage;this.config=config;this.now=now;
  // Preserve a plain function call for injected platform fetch implementations.
  this.fetchImpl=(...args)=>fetchImpl(...args);
  // Validate pins/flags eagerly. The per-flow instance's code guard supplements
  // the durable ledger; it is not the cross-isolate replay boundary.
  this.qualifyConfig={...config,env,now,fetchImpl};
  createCloudflareMmfPkceQualification(this.qualifyConfig);
 }
 #live(){if(this.config.validUntil<=this.now())deny()}
 async begin(){
  this.#live();
  const at=this.now(),state=randomBytes(32).toString('base64url'),nonce=randomBytes(32).toString('base64url');
  const verifier=randomBytes(32).toString('base64url');
  await this.storage.transaction(async tx=>{
   const data=await tx.get('qualification')||{started:0,lastStart:0,pending:{},codes:[],result:emptyResult()};
   if(data.started>=16||at-data.lastStart<60000)deny();
   for(const [k,v] of Object.entries(data.pending))if(v.expires<=at)delete data.pending[k];
   if(Object.keys(data.pending).length>=4)deny();
   data.pending[hash(state)]={nonce,verifier,expires:at+300000};data.started++;data.lastStart=at;
   await tx.put('qualification',data);
  });
  const alarm=await this.storage.getAlarm();
  if(alarm===null||alarm>at+300000)await this.storage.setAlarm(at+300000);
  const url=new URL(this.config.issuer+'/authorization');
  for(const [key,value] of Object.entries({response_type:'code',client_id:this.config.clientId,
   redirect_uri:this.config.redirectUri,scope:'openid',state,nonce,
   code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',
   max_age:'0',prompt:'login'}))url.searchParams.set(key,value);
  return {authorizationUrl:url.href,setCookie:cookie(state,300)};
 }
 async callback({state,code,cookieHeader,signal}){
  this.#live();
  if(!TOKEN.test(state||'')||!CODE.test(code||'')||!equal(state,stateCookie(cookieHeader))||
   !(signal instanceof AbortSignal)||signal.aborted)deny();
  const at=this.now(),digest=hash(code);
  const pending=await this.storage.transaction(async tx=>{
   const data=await tx.get('qualification'),key=hash(state),value=data?.pending?.[key];
   if(!value||value.expires<=at||data.codes.includes(digest)||data.codes.length>=16)deny();
   // Delete nonce/verifier durably before awaiting an external token request.
   delete data.pending[key];data.codes.push(digest);
   data.result={...emptyResult(),attempted:true,when:new Date(at).toISOString(),status:'IN_PROGRESS'};
   await tx.put('qualification',data);return value;
  });
  let requests=0,successfulTokenResponses=0,result;
  const boundedFetch=async(url,options)=>{
   // Workers does not implement redirect:'error'. Manual transport plus an
   // explicit 3xx rejection preserves the existing no-redirect contract.
   if(options?.redirect!=='error')deny();
   requests++;const response=await this.fetchImpl(url,{...options,redirect:'manual'});
   if(response.redirected||response.status>=300&&response.status<400){
    try{await response.body?.cancel()}catch{};deny();
   }
   if(response.status===200)successfulTokenResponses++;
   return response;
  };
  try{
   const qualify=createCloudflareMmfPkceQualification({...this.qualifyConfig,fetchImpl:boundedFetch});
   await qualify({code,codeVerifier:pending.verifier,nonce:pending.nonce,signal});
   result={...emptyResult(),attempted:true,when:new Date(at).toISOString(),status:'QUALIFICATION_PASSED',pkceAndSignedMfaVerified:true};
  }catch{
   result={...emptyResult(),attempted:true,when:new Date(at).toISOString(),status:'QUALIFICATION_FAILED_CLOSED'};
  }
  result.tokenRequests=requests;result.successfulTokenResponses=successfulTokenResponses;
  await this.storage.transaction(async tx=>{
   const data=await tx.get('qualification');data.result=result;await tx.put('qualification',data);
  });
  return {setCookie:cookie('',0)};
 }
 async status(){this.#live();return (await this.storage.get('qualification'))?.result||emptyResult()}
 async purge(){
  const at=this.now();
  const next=await this.storage.transaction(async tx=>{
   const data=await tx.get('qualification');if(!data)return null;
   if(this.config.validUntil<=at){await tx.delete('qualification');return null}
   for(const [key,value] of Object.entries(data.pending))if(value.expires<=at)delete data.pending[key];
   await tx.put('qualification',data);
   return Math.min(this.config.validUntil,...Object.values(data.pending).map(x=>x.expires));
  });
  if(next!==null)await this.storage.setAlarm(next);
 }
}
/** HTTP boundary: exact routes/queries, no cross-site initiation or methods,
 * unchanged Access cryptographic gate before any durable state access. */
export async function routeMmfOidcQualification(req,{authorize,getFlow}={}){
 let supportCode='REQUEST_CONTEXT';
 let requestReason='REQUEST_TYPE';
 try{
  if(!(req instanceof Request)||typeof authorize!=='function'||typeof getFlow!=='function')deny();
  const u=new URL(req.url);
  if(!['/private/oidc','/private/oidc/qualify','/private/oidc/callback','/private/oidc/qualification'].includes(u.pathname))return null;
  requestReason='REQUEST_METHOD';if(req.method!=='GET')deny();
  requestReason='REQUEST_URL';if(u.origin!==ORIGIN||u.username||u.password||u.hash)deny();
  requestReason='REQUEST_URL_LENGTH';if(u.href.length>3000)deny();
  requestReason='FORWARDING_HEADER';
  if(req.headers.has('forwarded')||req.headers.has('x-forwarded-host')||req.headers.has('x-original-url'))deny();
  requestReason='RANGE_REQUEST';if(req.headers.has('range'))deny();
  requestReason='PREFETCH_REQUEST';if(req.headers.has('purpose')||req.headers.has('sec-purpose'))deny();
  requestReason='REQUEST_HOST';if(req.headers.has('host')&&req.headers.get('host')!==new URL(ORIGIN).hostname)deny();
  const site=req.headers.get('sec-fetch-site'),mode=req.headers.get('sec-fetch-mode'),dest=req.headers.get('sec-fetch-dest');
  requestReason='FETCH_MODE';if(mode&&mode!=='navigate')deny();
  requestReason='FETCH_DESTINATION';if(dest&&dest!=='document')deny();
  if(u.pathname==='/private/oidc/callback'){
   requestReason='CALLBACK_PROVIDER_ERROR';if(u.searchParams.has('error'))deny();
   requestReason='CALLBACK_DUPLICATE_PARAMETER';
   if([...u.searchParams.keys()].some(key=>u.searchParams.getAll(key).length>1))deny();
   requestReason='CALLBACK_UNEXPECTED_PARAMETER';
   if([...u.searchParams.keys()].some(key=>!['state','code'].includes(key)))deny();
   requestReason='CALLBACK_MISSING_PARAMETER';
   if(u.searchParams.size!==2||u.searchParams.getAll('state').length!==1||u.searchParams.getAll('code').length!==1)deny();
   requestReason='CALLBACK_STATE_FORMAT';if(!TOKEN.test(u.searchParams.get('state')||''))deny();
   const code=u.searchParams.get('code')||'';
   requestReason='CALLBACK_CODE_LENGTH';if(code.length<8||code.length>2048)deny();
   requestReason='CALLBACK_CODE_FORMAT';if(!CODE.test(code))deny();
  }else{
   requestReason='UNEXPECTED_QUERY';if(u.search)deny();
   requestReason='CROSS_SITE_INITIATION';if(u.pathname!=='/private/oidc'&&site&&!['same-origin','none'].includes(site))deny();
  }
  supportCode='ACCESS_GATE';
  if(!await authorize(req))deny();
  if(u.pathname==='/private/oidc')return landing();
  supportCode='FLOW_UNAVAILABLE';
  const flow=await getFlow();
  supportCode='FLOW_OPERATION';
  if(u.pathname==='/private/oidc/qualify'){
   const begin=await flow.begin();return redirect(begin.authorizationUrl,begin.setCookie);
  }
  if(u.pathname==='/private/oidc/callback'){
   const done=await flow.callback({state:u.searchParams.get('state'),code:u.searchParams.get('code'),
    cookieHeader:req.headers.get('cookie'),signal:req.signal});
   return redirect(ORIGIN+'/private/oidc/qualification',done.setCookie);
  }
  return json(await flow.status());
 }catch{return json({error:'MMF_PRIVATE_QUALIFICATION_DENIED',supportCode,
  ...(supportCode==='REQUEST_CONTEXT'?{requestReason}:{}),applicationLoginEnabled:false},403)}
}
