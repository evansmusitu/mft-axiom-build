// External IdP remains authority for OAuth PKCE, session cookies, MFA, and recovery.
// This bridge cannot self-issue authorization codes or create a session.
export async function qualifiedLoginRedirect(env,{intent='login'}={}){
 if(!['login','register'].includes(intent))throw new Error('invalid_login_intent');
 if(env.IDENTITY_LOGIN_QUALIFIED!=='qualified_private_binding'||!env.IDENTITY_LOGIN_SERVICE?.fetch)throw new Error('login_not_qualified');
 const r=await env.IDENTITY_LOGIN_SERVICE.fetch(new Request('https://axiom-internal/identity/start-login',{method:'POST',headers:{'content-type':'application/json','x-axiom-purpose':'customer-login'},body:JSON.stringify({intent,return_path:'/'}),redirect:'error'}));
 if(r.status!==200)throw new Error('login_not_available');
 const data=await r.json();let u;try{u=new URL(data.authorization_url)}catch{throw new Error('invalid_login_redirect')}
 if(u.origin!=='https://auth.mftintelligence.com'||u.pathname!=='/oauth/authorize'||u.username||u.password||u.hash||
    (u.searchParams.get('state')||'').length<32||
    !/^[A-Za-z0-9_-]{43,128}$/.test(u.searchParams.get('code_challenge')||'')||
    u.searchParams.get('code_challenge_method')!=='S256')throw new Error('invalid_login_redirect');
 return u.href;
}
