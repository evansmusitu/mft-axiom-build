// S1 candidate only. Never exposes a public login/linking endpoint or mints tokens.
// Called ONLY by a separate, future OAuth consent gateway after its CSRF check.
// A private IdP verifier is the authority for current session identity, while
// oauth_identity_links is an independently reviewed mapping in the OAuth D1.
const deny=(message)=>{throw new Error(message)};
const text=(x,max)=>typeof x==='string'&&x.length>0&&x.length<=max;
const digest=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');
export async function resolveVerifiedOAuthCustomer({request,env,db,flowId,now=Date.now()}={}){
 if(env?.OAUTH_KEYLESS_QUALIFIED!=='qualified_private_binding')deny('keyless_not_qualified');
 if(!env.OAUTH_SESSION_VERIFIER?.fetch)deny('identity_verifier_unavailable');
 if(!db?.prepare||!text(flowId,160)||!/^flow_[A-Za-z0-9_-]{16,155}$/.test(flowId))deny('oauth_flow_invalid');
 if(!Number.isSafeInteger(now))deny('oauth_time_invalid');
 const suppliedCookie=request?.headers?.get('cookie')||'';
 if(!suppliedCookie||suppliedCookie.length>4096)deny('identity_session_missing');
 let pinned;
 try{pinned=new URL(env.OAUTH_IDENTITY_ISSUER)}catch{deny('identity_issuer_not_qualified')}
 if(pinned.protocol!=='https:'||pinned.username||pinned.password||pinned.search||pinned.hash||
    pinned.pathname!=='/'||env.OAUTH_IDENTITY_ISSUER!==pinned.origin)deny('identity_issuer_not_qualified');
 const response=await env.OAUTH_SESSION_VERIFIER.fetch(new Request('https://axiom-internal/identity/verify-oauth-session',{
  method:'POST',headers:{'content-type':'application/json','cookie':suppliedCookie,
   'x-axiom-purpose':'oauth-existing-customer-link'},
  body:JSON.stringify({flow_id:flowId,audience:'chatgpt-oauth-keyless'}),redirect:'error'
 }));
 if(response.status!==200)deny('identity_verification_failed');
 let proof;
 try{proof=await response.json()}catch{deny('identity_verification_failed')}
 if(proof?.authenticated!==true||proof?.production_qualified!==true||
  proof.audience!=='chatgpt-oauth-keyless'||proof.issuer!==pinned.origin||
  proof.flow_id!==flowId||proof.email_verified!==true||proof.mfa_verified!==true||
  !text(proof.subject,240)||!text(proof.tenant_id,150))deny('identity_assurance_denied');
 const auth=proof.auth_at_ms,expiry=proof.expires_at_ms;
 if(!Number.isSafeInteger(auth)||!Number.isSafeInteger(expiry)||
   auth>now+30000||now-auth>300000||expiry<=now||expiry-auth>300000)deny('identity_session_stale');
 // Never trust a customer ID from browser JSON or verifier claims. A separate
 // reviewed migration must create this exact issuer+subject+tenant relationship.
 const hashed=await digest(proof.issuer+'\n'+proof.subject);
 const row=await db.prepare("SELECT l.customer_id,l.tenant_id FROM oauth_identity_links l JOIN customers c ON c.id=l.customer_id WHERE l.issuer=?1 AND l.subject_sha256=?2 AND l.tenant_id=?3 AND l.state='active' AND c.status='active' LIMIT 1")
  .bind(proof.issuer,hashed,proof.tenant_id).first();
 if(!row||!text(row.customer_id,160)||row.tenant_id!==proof.tenant_id)deny('identity_not_linked');
 return {customer_id:row.customer_id,tenant_id:row.tenant_id};
}
