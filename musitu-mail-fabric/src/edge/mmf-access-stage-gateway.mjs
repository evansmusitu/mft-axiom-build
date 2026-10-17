/**
 * MMF private staging cryptographic Access gate.
 * Private operator dashboard and controlled non-commercial status endpoint only.
 * Requiring both a valid Cloudflare Access assertion and the independently
 * pre-approved operator's email SHA-256 prevents accidental access grants.
 * This is not the MMF OIDC app or a real customer dashboard.
 */
const ISSUER='https://musitu-axiom.cloudflareaccess.com';
const HOST='mail-stage.mftintelligence.com';
// This keyset is populated ONLY by the authenticated isolated GitHub deployment,
// after live TLS metadata readback and matching Cloudflare Account/Access application.
// No runtime network fetch: the Worker encountered KEY_TRANSPORT when fetching the
// same account's Access cert endpoint. Keys are PUBLIC but must be operator pinned.
// No acceptance of JWTs is possible with an empty, expired or unmatched keyset.
const PINNED_ACCESS_CERTS={keys:[],validUntil:0};
const safeHeaders=Object.freeze({'cache-control':'no-store','x-content-type-options':'nosniff',
 'referrer-policy':'no-referrer','x-frame-options':'DENY',
 'content-security-policy':"default-src 'none'; frame-ancestors 'none'",'strict-transport-security':'max-age=31536000',
 'content-type':'application/json; charset=utf-8'});
// These support codes contain no tokens, user identifiers, header values or secrets.
const safeSupportCodes=new Set(['REQUEST_CONTEXT','TOKEN_NOT_PRESENT','TOKEN_FORMAT','SIGNING_KEY',
 'SIGNATURE','CLAIMS','ADMIN_IDENTITY','CONFIG_BLOCKED','SERVER_UNAVAILABLE',
 'KEY_TRANSPORT','KEY_IMPORT','VERIFY_RUNTIME','IDENTITY_HASH_RUNTIME']);
const denied=(code='SERVER_UNAVAILABLE')=>new Response(JSON.stringify({error:'MMF_PRIVATE_ACCESS_DENIED',
 supportCode:safeSupportCodes.has(code)?code:'SERVER_UNAVAILABLE'}),{status:403,headers:safeHeaders});
const denialClass=e=>{
 const reason=e?.message||'';
 if(reason.startsWith('ACCESS_COOKIE_MISSING')||reason==='ACCESS_COOKIE_INVALID')return 'TOKEN_NOT_PRESENT';
 if(reason.startsWith('ACCESS_COOKIE')||reason==='HEADER_NOT_APPROVED'||reason==='TOKEN_MALFORMED'||reason==='TOKEN_UNTRUSTED'||reason.startsWith('JWT_'))return 'TOKEN_FORMAT';
 if(reason==='CERTS_TRANSPORT')return 'KEY_TRANSPORT';
 if(reason==='CERTS_IMPORT_FAILED')return 'KEY_IMPORT';
 if(reason==='SIGNATURE_RUNTIME')return 'VERIFY_RUNTIME';
 if(reason==='IDENTITY_HASH_RUNTIME')return 'IDENTITY_HASH_RUNTIME';
 if(reason==='CERTS_UNAVAILABLE'||reason==='CERTS_TOO_LARGE'||reason==='CERTS_INVALID'||reason==='UNKNOWN_ACCESS_SIGNER')return 'SIGNING_KEY';
 if(reason==='SIGNATURE_INVALID')return 'SIGNATURE';
 if(reason==='ACCESS_CLAIMS_INVALID')return 'CLAIMS';
 if(reason==='ADMIN_NOT_APPROVED')return 'ADMIN_IDENTITY';
 return 'SERVER_UNAVAILABLE';
};
// Preserve signed assertion priority: an invalid present header NEVER falls back to a cookie.
function browserAccessCookie(raw){
 if(typeof raw!=='string'||!raw||raw.length>8192||/[\r\n\x00-\x1f]/.test(raw))throw Error('ACCESS_COOKIE_INVALID');
 const fields=raw.split(';').map(x=>x.trim()).filter(x=>x.startsWith('CF_Authorization='));
 if(fields.length!==1)throw Error('ACCESS_COOKIE_MISSING_OR_DUPLICATED');
 const value=fields[0].slice('CF_Authorization='.length);
 if(value.length<64||value.length>8192||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value))throw Error('ACCESS_COOKIE_MALFORMED');
 return value;
}
const noRoute=()=>new Response(JSON.stringify({error:'NOT_AVAILABLE'}),{status:404,headers:safeHeaders});
const dashboardCsp="default-src 'none'; base-uri 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'none'; connect-src 'none'; frame-ancestors 'none'; form-action 'none'; object-src 'none'";
const dashboardStyle=`:root{color-scheme:dark;font:16px/1.5 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#090e17;color:#f2f6ff}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(ellipse at 85% 0%,#18283d 0%,#0a0f19 42%,#090e17 100%)}.shell{max-width:1150px;margin:0 auto;padding:24px 24px 80px}.nav{display:flex;align-items:center;justify-content:space-between;gap:18px;padding-bottom:28px;border-bottom:1px solid #273449}.brand{display:flex;align-items:center;gap:12px;font-weight:790;letter-spacing:.04em;font-size:18px}.mark{width:43px;height:43px;border-radius:14px;background:linear-gradient(140deg,#2de2c5,#537beb);display:grid;place-items:center;color:#041823;font-weight:950;box-shadow:0 8px 25px #16aeaa33}.nav small{display:block;color:#8aa5bd;letter-spacing:.12em;text-transform:uppercase;font-weight:650;font-size:10px}.pill{border:1px solid #2b6e69;background:#10302f;border-radius:50px;padding:7px 13px;color:#95f4db;font-size:12px;font-weight:700;white-space:nowrap}.eyebrow{margin:46px 0 12px;text-transform:uppercase;letter-spacing:.16em;font-size:12px;color:#7ee5da;font-weight:750}h1{font-size:clamp(34px,5.3vw,62px);letter-spacing:-.045em;line-height:1.05;max-width:860px;margin:0}h1 span{color:#72e1d1}.lede{color:#aabacf;max-width:760px;font-size:16px;margin:19px 0 26px}.banner{border:1px solid #355d6c;background:linear-gradient(125deg,#10313a,#12213a);border-radius:18px;padding:20px 23px;display:flex;align-items:start;gap:16px}.banner strong{display:block;font-size:17px}.banner p{margin:5px 0 0;color:#bfd1df;font-size:14px}.shield{flex:0 0 43px;width:43px;height:43px;border-radius:14px;background:#1e5053;display:grid;place-items:center;font-size:22px;color:#9df7de}.section-header{display:flex;align-items:baseline;justify-content:space-between;gap:20px;margin:35px 0 17px}h2{font-size:22px;letter-spacing:-.025em;margin:0}.subdued{color:#8ea3b9;font-size:13px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.card{border:1px solid #263448;background:#111b2a;border-radius:19px;padding:22px;min-height:162px;display:flex;flex-direction:column;justify-content:space-between}.card .icon{display:flex;align-items:center;justify-content:space-between;font-size:24px}.badge{font-size:11px;letter-spacing:.04em;text-transform:uppercase;font-weight:750;border:1px solid #465670;border-radius:50px;padding:4px 8px;color:#b8c5d6}.badge.good{color:#85f1cb;border-color:#326b60;background:#163730}.value{font-size:21px;line-height:1.2;font-weight:750;letter-spacing:-.02em;margin:16px 0 4px}.small{color:#98abc0;font-size:13px}.panel{margin-top:20px;border:1px solid #253249;border-radius:20px;background:#111a28;padding:24px}.feature{display:flex;align-items:center;justify-content:space-between;gap:20px;border-bottom:1px solid #253249;padding:17px 0}.feature:last-child{border-bottom:0}.feature strong{display:block}.feature p{margin:4px 0 0;font-size:13px;color:#8fa6be}.muted-button{border:1px solid #405065;color:#b0c0d3;border-radius:11px;background:#172335;padding:9px 13px;font:inherit;font-size:12px;white-space:nowrap}.muted-button:disabled{opacity:.72;cursor:not-allowed}.actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:25px}.link{display:inline-flex;align-items:center;text-decoration:none;justify-content:center;padding:12px 17px;border-radius:11px;background:#68e5d0;color:#062d31;font-weight:800;font-size:13px;min-height:46px}.link.secondary{border:1px solid #44516a;background:#162137;color:#e1eaf5}footer{margin-top:48px;padding-top:19px;border-top:1px solid #223047;color:#8298ae;font-size:12px}footer strong{color:#c9d9e7}@media(max-width:720px){.shell{padding:18px 16px 48px}.nav{padding-bottom:18px}.brand{font-size:15px}.eyebrow{margin-top:30px}.grid{grid-template-columns:1fr}.card{min-height:135px}.banner{padding:16px}.feature{align-items:flex-start;flex-direction:column;gap:9px}.section-header{align-items:start;flex-direction:column;gap:4px}.actions a{flex-grow:1}}`;
function privateOperatorDashboard(){
 // Intentional non-customer read-only shell. Never fabricate tenants, domains,
 // API keys, payment transactions or OIDC callbacks from static stage metadata.
 const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark"><title>MUSITU Mail Fabric · Private operator console</title><style>${dashboardStyle}</style></head><body><main class="shell"><header class="nav"><div class="brand"><div class="mark" aria-hidden="true">M</div><div>MUSITU <span style="color:#7fe9dd">MAIL FABRIC</span><small>Private operator workspace</small></div></div><div class="pill">● Access verified</div></header><p class="eyebrow">Private staging / owner only</p><h1>Control your mail infrastructure <span>with confidence.</span></h1><p class="lede">This console is secured by your Cloudflare Access identity. It is a read-only engineering preview, not a live customer dashboard. No sending, payment or customer API is permitted.</p><section class="banner" aria-label="Verified access"><div class="shield" aria-hidden="true">✓</div><div><strong>Secure operator access confirmed</strong><p>The current request passed signature, issuer, audience, expiry and approved-administrator verification. The real application-level OIDC callback has not been qualified.</p></div></section><section aria-label="System readiness"><div class="section-header"><h2>System overview</h2><span class="subdued">Live identity · restricted preview</span></div><div class="grid"><article class="card"><div class="icon"><span aria-hidden="true">◇</span><span class="badge good">Verified</span></div><div><div class="value">Private access</div><div class="small">Signed Cloudflare Access assertion accepted</div></div></article><article class="card"><div class="icon"><span aria-hidden="true">◎</span><span class="badge">Pending</span></div><div><div class="value">Application OIDC</div><div class="small">Provider client registered; callback unverified</div></div></article><article class="card"><div class="icon"><span aria-hidden="true">▣</span><span class="badge">Restricted</span></div><div><div class="value">Mail delivery</div><div class="small">Real outbound sending disabled</div></div></article><article class="card"><div class="icon"><span aria-hidden="true">⌘</span><span class="badge">Offline</span></div><div><div class="value">Tenant records</div><div class="small">Live tenant database not attached to this preview</div></div></article><article class="card"><div class="icon"><span aria-hidden="true">⬡</span><span class="badge">Not connected</span></div><div><div class="value">Sender domains</div><div class="small">No domain inventory is exposed here</div></div></article><article class="card"><div class="icon"><span aria-hidden="true">▥</span><span class="badge">Disabled</span></div><div><div class="value">Payments</div><div class="small">No checkout, billing or live transactions</div></div></article></div></section><section class="panel" aria-label="Administrative capabilities"><div class="section-header" style="margin-top:0"><h2>Operator controls</h2><span class="subdued">Protected until qualification</span></div><div class="feature"><div><strong>Tenant administration</strong><p>Enable only after tenant-scoped OIDC sessions and durable authorization are proven.</p></div><button class="muted-button" disabled>Not yet connected</button></div><div class="feature"><div><strong>Domain verification</strong><p>Requires persistent per-tenant DNS challenges and safe readback.</p></div><button class="muted-button" disabled>Awaiting validation</button></div><div class="feature"><div><strong>Usage and billing</strong><p>No synthetic figures are presented as real customer usage.</p></div><button class="muted-button" disabled>Disabled in staging</button></div></section><div class="actions"><a class="link" href="/private/gateway">View verification status →</a><a class="link secondary" href="/private/dashboard">Refresh console</a></div><footer><strong>MUSITU Mail Fabric</strong> · Evidence-native private staging. Independent provider-level MFA and application OIDC acceptance are not implied by this page. Public customer registration, sending and payments remain disabled.</footer></main></body></html>`;
 return new Response(html,{status:200,headers:{...safeHeaders,'content-type':'text/html; charset=utf-8','content-security-policy':dashboardCsp,'permissions-policy':'camera=(), microphone=(), geolocation=()'}});
}

const validHash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const validAud=x=>typeof x==='string'&&x.length>20&&x.length<200&&/^[A-Za-z0-9_-]+$/.test(x);
const bytes=b=>{
 if(typeof b!=='string'||!b.length||b.length>5000||!/^[A-Za-z0-9_-]+$/.test(b)||b.length%4===1)throw Error('JWT_MALFORMED');
 let x;try{x=Uint8Array.from(atob(b.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-b.length%4)%4)),c=>c.charCodeAt(0))}catch{throw Error('JWT_MALFORMED')}
 if(x.length===0)throw Error('JWT_EMPTY');return x;
};
const json=b=>{
 let x;try{x=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes(b)))}catch{throw Error('JWT_MALFORMED')}
 if(!x||typeof x!=='object'||Array.isArray(x))throw Error('JWT_NOT_OBJECT');return x;
};
async function getPublicKey(kid, env){
 // The optional override is only for isolated unit tests; production's five
 // existing Worker bindings cannot supply it. Neither branch trusts the JWT's
 // unverified kid as a URL and neither branch calls a third-party endpoint.
 const signedKeys=env.MMF_PINNED_ACCESS_CERTS??PINNED_ACCESS_CERTS;
 if(!signedKeys||typeof signedKeys!=='object'||Array.isArray(signedKeys)||
    !Number.isSafeInteger(signedKeys.validUntil)||
    signedKeys.validUntil<=Date.now()||signedKeys.validUntil>Date.now()+15*86400000||
    !Array.isArray(signedKeys.keys)||signedKeys.keys.length<1||signedKeys.keys.length>5)throw Error('CERTS_INVALID');
 const matched=signedKeys.keys.filter(j=>j&&j.kid===kid&&j.kty==='RSA'&&
    typeof j.n==='string'&&j.n.length>=200&&j.n.length<=1024&&
    typeof j.e==='string'&&j.e.length>=2&&j.e.length<=10&&
    (!j.alg||j.alg==='RS256')&&(!j.use||j.use==='sig')&&!j.d);
 if(matched.length!==1)throw Error('UNKNOWN_ACCESS_SIGNER');
 try{return await crypto.subtle.importKey('jwk',{kty:'RSA',n:matched[0].n,e:matched[0].e},
    {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify'])}
 catch{throw Error('CERTS_IMPORT_FAILED')}
}
async function verified(token,env){
 if(typeof token!=='string'||token.length<64||token.length>8192)throw Error('TOKEN_UNTRUSTED');
 const parts=token.split('.');if(parts.length!==3)throw Error('TOKEN_MALFORMED');
 const h=json(parts[0]), p=json(parts[1]);
 if(h.alg!=='RS256'||typeof h.kid!=='string'||h.kid.length>100||
  !/^[A-Za-z0-9._:-]+$/.test(h.kid))throw Error('HEADER_NOT_APPROVED');
 const sig=bytes(parts[2]);
 const pk=await getPublicKey(h.kid,env);
 let valid;try{valid=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',pk,sig,new TextEncoder().encode(parts[0]+'.'+parts[1]))}catch{throw Error('SIGNATURE_RUNTIME')}
 if(!valid)throw Error('SIGNATURE_INVALID');
 const now=Math.floor(Date.now()/1000);
 const audiences=typeof p.aud==='string'?[p.aud]:p.aud;
 if(p.iss!==ISSUER||!Array.isArray(audiences)||!audiences.includes(env.MMF_ACCESS_AUD)||
  !Number.isSafeInteger(p.iat)||p.iat>now+60||p.iat<now-3600||
  !Number.isSafeInteger(p.exp)||p.exp<=now||p.exp>now+3600||
  (p.nbf!==undefined&&(!Number.isSafeInteger(p.nbf)||p.nbf>now+60))||
  typeof p.email!=='string'||p.email.length<5||p.email.length>254)throw Error('ACCESS_CLAIMS_INVALID');
 let digest;try{digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(p.email.toLowerCase()))}catch{throw Error('IDENTITY_HASH_RUNTIME')}
 const candidate=[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
 if(candidate!==env.MMF_APPROVED_ADMIN_SHA256)throw Error('ADMIN_NOT_APPROVED');
 return true;
}
export function createMmfStageGate(env){
 if(!env||!validAud(env.MMF_ACCESS_AUD)||!validHash(env.MMF_APPROVED_ADMIN_SHA256)||
  env.MMF_REAL_SEND_ENABLED!=='false'||env.MMF_COMMERCE_ENABLED!=='false'||
  env.MMF_CUSTOMER_API_ENABLED!=='false')throw Error('MMF_SAFE_STAGE_REQUIRED');
 return Object.freeze({async fetch(req){
  try{
   if(!(req instanceof Request)||req.method!=='GET'||req.headers.has('x-forwarded-host')||
    req.headers.has('x-original-url')||req.headers.has('forwarded'))return denied('REQUEST_CONTEXT');
   const u=new URL(req.url);
   if(u.protocol!=='https:'||u.hostname!==HOST||u.port||u.username||u.password||u.hash||u.search)return denied('REQUEST_CONTEXT');
   const assertion=req.headers.has('cf-access-jwt-assertion')?
     req.headers.get('cf-access-jwt-assertion'):browserAccessCookie(req.headers.get('cookie'));
   if(!assertion||!(await verified(assertion,env)))return denied('TOKEN_NOT_PRESENT');
   if(u.pathname==='/private/dashboard')return privateOperatorDashboard();
   if(u.pathname!=='/private/gateway')return noRoute();
   return new Response(JSON.stringify({stage:'private-access-verified',realSending:false,payments:false,
    customerApi:false,realOidcLoginVerified:false,tenantDashboardDeployed:false}),{status:200,headers:safeHeaders});
  }catch(error){return denied(denialClass(error))}
 }});
}
export default {fetch(req,env){
 try{return createMmfStageGate(env).fetch(req)}catch{return denied('CONFIG_BLOCKED')}
}};