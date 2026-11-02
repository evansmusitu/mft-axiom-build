// Candidate contract for a separately operated private IdP verifier. No IdP keys,
// cookie minting, token exchange or provider qualification is performed here.
const fail=code=>{throw new Error(code);};
const text=(v,max)=>typeof v==='string'&&v.trim().length>0&&v.length<=max&&!/[\u0000-\u001f\u007f]/.test(v);
export const sha256=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
export function pinnedIdentityIssuer(env){
 const issuer=env.CUSTOMER_IDENTITY_ISSUER;let url;
 try{url=new URL(issuer);}catch{fail('identity_issuer_not_qualified');}
 if(typeof issuer!=='string'||url.protocol!=='https:'||url.origin!==issuer||url.username||url.password||url.search||url.hash)fail('identity_issuer_not_qualified');
 return issuer;
}
function credentials(request){
 const cookie=request.headers.get('cookie')||'',authorization=request.headers.get('authorization')||'';
 if((!cookie&&!authorization)||(cookie&&authorization)||cookie.length>8192||
  (authorization&&!/^Bearer [A-Za-z0-9._~-]{16,4096}$/.test(authorization)))fail('authentication_required');
 return {cookie,authorization};
}
export function validateSessionAssertion(p,{issuer,audience,challenge,request_sha256,now=Date.now(),requireTenant=true}){
 if(!p||!text(p.issuer,200)||!text(p.subject,240)||(requireTenant&&!text(p.tenant_id,150))||
  p.audience!==audience||p.authenticated!==true)fail('identity_verifier_invalid');
 if(p.issuer!==issuer)fail('identity_issuer_mismatch');
 if(p.verified!==true||p.email_verified!==true||p.mfa_verified!==true||p.revoked!==false||
  !text(p.session_id,160)||!Number.isSafeInteger(p.session_version)||p.session_version<1||
  p.state_verified!==true||p.nonce_verified!==true||p.pkce_method!=='S256')fail('identity_session_assurance_required');
 if(p.challenge!==challenge||p.request_sha256!==request_sha256)fail('identity_session_binding_mismatch');
 const {issued_at_ms:i,auth_time_ms:a,verified_at_ms:v,expires_at_ms:e}=p;
 if(![i,a,v,e].every(Number.isSafeInteger)||i>now+30000||a>now+30000||v>now+30000||
  v<now-30000||e<=now||i>v||a>i||e<=i||e-i>900000||now-a>43200000)fail('identity_session_stale');
 // Roles, customer UUIDs and other authority claims are deliberately not copied.
 return {issuer:p.issuer,subject:p.subject,tenant_id:p.tenant_id,audience:p.audience,
  session_id:p.session_id,session_version:p.session_version};
}
export async function requestIdentityAssertion(request,env,{binding,qualification,audience,purpose,path}){
 if(!binding?.fetch)fail('identity_verifier_unavailable');
 if(qualification!=='qualified_private_binding')fail('identity_verifier_not_qualified');
 const issuer=pinnedIdentityIssuer(env),credential=credentials(request);
 const challenge=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
 const request_sha256=await sha256(JSON.stringify({audience,purpose,method:request.method,url:request.url,...credential}));
 let response;
 try{response=await binding.fetch(new Request('https://axiom-internal'+path,{
  method:'POST',headers:{...credential,'content-type':'application/json','x-axiom-audience':audience},
  body:JSON.stringify({audience,purpose,challenge,request_sha256}),redirect:'error',signal:AbortSignal.timeout(5000)
 }));}catch{fail('identity_verifier_unavailable');}
 if(response.status!==200)fail('authentication_required');
 let p;try{const raw=await response.text();if(raw.length>16000)fail('identity_verifier_invalid');p=JSON.parse(raw);}catch{fail('identity_verifier_invalid');}
 return {proof:p,context:{issuer,audience,challenge,request_sha256}};
}
export async function verifyCustomerSession(request,env,{audience='customer-control-plane'}={}){
 if(!['customer-control-plane','axiom-chatgpt-oauth'].includes(audience))fail('identity_audience_not_qualified');
 const {proof,context}=await requestIdentityAssertion(request,env,{binding:env.IDENTITY_VERIFIER,
  qualification:env.IDENTITY_VERIFIER_QUALIFIED,audience,purpose:'customer-session',path:'/session/verify'});
 return validateSessionAssertion(proof,context);
}
