/**
 * Standalone VERIFY-ONLY trust boundary for a future independent inference IdP.
 * Does not issue capabilities, process prompts, contact identity providers,
 * consent to external data egress, or grant release authority.
 * Caller MUST pin issuer, exact inference-only audience and JWKS independently.
 */
export class IdentityDenied extends Error {
  constructor(){ super('EXTERNAL_IDENTITY_NOT_VERIFIED'); }
}
const TOK=/^[A-Za-z0-9_-]+$/;
const SUBJECT=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/;
const KID=/^[A-Za-z0-9_.:-]{1,80}$/;
const encoder=new TextEncoder();
const decoder=new TextDecoder('utf-8',{fatal:true});
function denied(){ throw new IdentityDenied(); }
function decode(segment){
  if(typeof segment!=='string' || segment.length>3000 || segment.length<2 || !TOK.test(segment))denied();
  const padded=segment.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-segment.length%4)%4);
  let bytes;
  try{ bytes=Uint8Array.from(atob(padded),x=>x.charCodeAt(0)); }
  catch{denied()}
  return bytes;
}
function parse(segment){
  try {
    const parsed=JSON.parse(decoder.decode(decode(segment)));
    if(parsed===null || typeof parsed!=='object' || Array.isArray(parsed))denied();
    return parsed;
  }catch{denied()}
}
function validHttps(v){
  if(typeof v!=='string'||v.length<12||v.length>256||v.includes('*'))return false;
  try{const u=new URL(v);return u.protocol==='https:'&&!!u.hostname&&!u.username&&!u.password&&!u.hash&&!u.search;}
  catch{return false}
}
function validPolicy(p){
  if(!p||typeof p!=='object'||Array.isArray(p)||
      Object.keys(p).sort().join(',')!=='audience,issuer,jwks'||
      !validHttps(p.issuer)||!validHttps(p.audience)||!Array.isArray(p.jwks)||
      p.jwks.length<1||p.jwks.length>8)return false;
  const kids=new Set();
  for(const jwk of p.jwks){
    if(!jwk||typeof jwk!=='object'||Array.isArray(jwk)||
      Object.keys(jwk).some(k=>!['kty','n','e','kid','alg','use'].includes(k))||
      jwk.kty!=='RSA'||jwk.alg!=='RS256'||jwk.use!=='sig'||
      typeof jwk.kid!=='string'||!KID.test(jwk.kid)||kids.has(jwk.kid)||
      typeof jwk.n!=='string'||jwk.n.length<342||jwk.n.length>730||!TOK.test(jwk.n)||
      typeof jwk.e!=='string'||!TOK.test(jwk.e))return false;
    kids.add(jwk.kid);
  }
  return true;
}
export async function verifyExternalInferenceIdentity(jwt,policy,now){
  if(typeof jwt!=='string'||jwt.length<100||jwt.length>4096||
     typeof now!=='number'||!Number.isSafeInteger(now)||!validPolicy(policy))denied();
  const segments=jwt.split('.');
  if(segments.length!==3||segments.some(x=>!x))denied();
  const [head,payload,sig]=segments;
  const header=parse(head), claims=parse(payload);
  if(Object.keys(header).sort().join(',')!=='alg,kid,typ'||
     header.alg!=='RS256'||header.typ!=='JWT'||typeof header.kid!=='string'||!KID.test(header.kid))denied();
  if(claims.iss!==policy.issuer||claims.aud!==policy.audience||
     typeof claims.sub!=='string'||!SUBJECT.test(claims.sub)||
     typeof claims.project!=='string'||!SUBJECT.test(claims.project)||
     claims.scope!=='axiom.inference'||
     !Number.isSafeInteger(claims.iat)||!Number.isSafeInteger(claims.nbf)||!Number.isSafeInteger(claims.exp)||
     claims.exp-claims.iat>600||claims.exp<=claims.iat||claims.iat>now||
     claims.iat<now-300||claims.nbf>now||claims.exp<=now)denied();
  const jwk=policy.jwks.find(x=>x.kid===header.kid);
  if(!jwk)denied();
  try{
    const key=await crypto.subtle.importKey('jwk',jwk,
      {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
    if(!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(sig),encoder.encode(head+'.'+payload))))denied();
  }catch{denied()}
  return Object.freeze({
    schema:'musitu.axiom.inference.external-identity-verification.v1',
    subject:claims.sub,project:claims.project,audience:policy.audience,inference_scope_verified:true,
    external_provider_consent_verified:false,capability_issued:false,
    production_authority:false,release_authority:false,
    provider_inference_qualified:false,
  });
}
