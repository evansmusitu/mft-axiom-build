/**
 * MMF private staging cryptographic Access gate.
 * ONLY a controlled, non-commercial status endpoint is present.
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
   if(u.pathname!=='/private/gateway')return noRoute();
   return new Response(JSON.stringify({stage:'private-access-verified',realSending:false,payments:false,
    customerApi:false,realOidcLoginVerified:false,tenantDashboardDeployed:false}),{status:200,headers:safeHeaders});
  }catch(error){return denied(denialClass(error))}
 }});
}
export default {fetch(req,env){
 try{return createMmfStageGate(env).fetch(req)}catch{return denied('CONFIG_BLOCKED')}
}};