/**
 * Cloudflare Access application JWT verification. This module trusts neither
 * a browser Origin nor arbitrary identity headers. Tokens are RS256-signed,
 * with a pinned issuer, app audience, verified timestamps and stable subject.
 * Requires an independently configured Access application and policy.
 */
export class AccessVerificationError extends Error {
  constructor(code='ACCESS_DENIED') { super('Cloud workspace authentication rejected.'); this.name='AccessVerificationError'; this.code=code; }
}
const reject=(code)=>{throw new AccessVerificationError(code);};
const B64URL=/^[A-Za-z0-9_-]+$/;
const MAX_TOKEN=8192;
export function accessConfiguration(env){
  const domain=env?.ACCESS_TEAM_DOMAIN;
  const audience=env?.ACCESS_AUD;
  if(typeof domain!=='string'||!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(domain)||
    typeof audience!=='string'||audience.length<8||audience.length>160||!/^[-A-Za-z0-9_]+$/.test(audience)){
    reject('AUTH_NOT_CONFIGURED');
  }
  return {domain,audience};
}
function decode(segment){
  if(typeof segment!=='string'||segment.length<2||segment.length>MAX_TOKEN||!B64URL.test(segment))reject('INVALID_JWT');
  const binary=atob(segment.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-segment.length%4)%4));
  return Uint8Array.from(binary,c=>c.charCodeAt(0));
}
function decodeJSON(segment){
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(decode(segment)));}
  catch{reject('INVALID_JWT');}
}
function plainObject(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
export async function verifyAccessJWT(token,env,{fetchImpl=globalThis.fetch,now=Math.floor(Date.now()/1000)}={}){
  const {domain,audience}=accessConfiguration(env);
  if(typeof token!=='string'||token.length<90||token.length>MAX_TOKEN)reject('INVALID_JWT');
  const segments=token.split('.');
  if(segments.length!==3)reject('INVALID_JWT');
  const [encodedHead,encodedPayload,encodedSignature]=segments;
  const header=decodeJSON(encodedHead);
  const claims=decodeJSON(encodedPayload);
  if(!plainObject(header)||!plainObject(claims)||header.alg!=='RS256'||
    typeof header.kid!=='string'||header.kid.length<5||header.kid.length>128||
    !/^[-A-Za-z0-9_]+$/.test(header.kid)||
    (header.typ!==undefined&&header.typ!=='JWT'))reject('INVALID_JWT');
  if(claims.iss!==domain||!(typeof claims.aud==='string'?claims.aud===audience:
      Array.isArray(claims.aud)&&claims.aud.includes(audience))||
    !Number.isInteger(claims.exp)||!Number.isInteger(claims.iat)||
    (claims.nbf!==undefined&&!Number.isInteger(claims.nbf))||
    !Number.isFinite(now)||claims.exp<=now||claims.iat>now+30||
    claims.exp-claims.iat>86400||claims.exp<=claims.iat||
    (claims.nbf!==undefined&&claims.nbf>now+30)||
    typeof claims.sub!=='string'||claims.sub.length<8||claims.sub.length>256||
    !/^[A-Za-z0-9:_@.\-]+$/.test(claims.sub))reject('INVALID_CLAIMS');
  let response;
  try{
    response=await fetchImpl(domain+'/cdn-cgi/access/certs',{
      method:'GET',redirect:'error',signal:AbortSignal.timeout(5000),
      headers:{accept:'application/json'}
    });
    if(!response.ok)reject('KEY_FETCH_FAILED');
    const raw=await response.text();
    if(raw.length>40000)reject('KEY_FETCH_FAILED');
    const keys=JSON.parse(raw)?.keys;
    if(!Array.isArray(keys)||keys.length<1||keys.length>30)reject('KEY_FETCH_FAILED');
    const matches=keys.filter(k=>plainObject(k)&&k.kid===header.kid&&k.kty==='RSA'&&
      (k.use===undefined||k.use==='sig')&&(k.alg===undefined||k.alg==='RS256')&&
      typeof k.n==='string'&&typeof k.e==='string');
    if(matches.length!==1)reject('SIGNING_KEY_UNAVAILABLE');
    const key=await crypto.subtle.importKey('jwk',matches[0],
      {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
    const signature=decode(encodedSignature);
    const signedBytes=new TextEncoder().encode(encodedHead+'.'+encodedPayload);
    const valid=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,signature,signedBytes);
    if(!valid)reject('BAD_SIGNATURE');
  }catch(error){
    if(error instanceof AccessVerificationError)throw error;
    reject('AUTH_VERIFICATION_UNAVAILABLE');
  }
  // Only cryptographically verified subject is returned: never accept tenant,
  // role, or entitlement from a bearer token supplied by the browser.
  return {subject:claims.sub};
}
