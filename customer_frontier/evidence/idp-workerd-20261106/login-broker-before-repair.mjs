// External IdP owns OIDC PKCE, authentication, MFA, recovery and session binding.
// Fail closed if a private broker redirects to a different client or callback.
const invalid=()=>{throw new Error('invalid_login_redirect')};
const unique=(u,name)=>{
 const all=u.searchParams.getAll(name);
 if(all.length!==1||!all[0])invalid();
 return all[0];
};
export function validateLoginRedirect(value,env){
 if(typeof env.CUSTOMER_OAUTH_CLIENT_ID!=='string'||!/^[-._~A-Za-z0-9]{8,160}$/.test(env.CUSTOMER_OAUTH_CLIENT_ID))throw new Error('login_configuration_unqualified');
 let callback;
 try{callback=new URL(env.CUSTOMER_LOGIN_REDIRECT_URI)}catch{throw new Error('login_configuration_unqualified')}
 if(callback.protocol!=='https:'||!(/(^|\.)mftintelligence\.com$/).test(callback.hostname)||callback.username||callback.password||callback.hash||callback.search)throw new Error('login_configuration_unqualified');
 let u;try{u=new URL(value)}catch{invalid()}
 if(u.origin!=='https://auth.mftintelligence.com'||u.pathname!=='/oauth/authorize'||u.username||u.password||u.hash)invalid();
 if(unique(u,'client_id')!==env.CUSTOMER_OAUTH_CLIENT_ID||unique(u,'redirect_uri')!==callback.href||unique(u,'response_type')!=='code')invalid();
 if(!/^[A-Za-z0-9_-]{32,256}$/.test(unique(u,'state'))||!/^[A-Za-z0-9_-]{32,256}$/.test(unique(u,'nonce')))invalid();
 if(!/^[A-Za-z0-9_-]{43,128}$/.test(unique(u,'code_challenge'))||unique(u,'code_challenge_method')!=='S256')invalid();
 const scopes=unique(u,'scope').split(/\s+/);
 if(!scopes.includes('openid')||scopes.some(s=>!/^[a-zA-Z0-9:_-]+$/.test(s)))invalid();
 // Any duplicate security-sensitive parameter is ambiguous even if a provider parses it differently.
 return u.href;
}
export async function qualifiedLoginRedirect(env,{intent='login'}={}){
 if(!['login','register'].includes(intent))throw new Error('invalid_login_intent');
 if(env.IDENTITY_LOGIN_QUALIFIED!=='qualified_private_binding'||!env.IDENTITY_LOGIN_SERVICE?.fetch)throw new Error('login_not_qualified');
 const r=await env.IDENTITY_LOGIN_SERVICE.fetch(new Request('https://axiom-internal/identity/start-login',{method:'POST',headers:{'content-type':'application/json','x-axiom-purpose':'customer-login'},body:JSON.stringify({intent,return_path:'/'}),redirect:'error'}));
 if(r.status!==200)throw new Error('login_not_available');
 const data=await r.json();
 return validateLoginRedirect(data.authorization_url,env);
}
