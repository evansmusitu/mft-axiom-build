/**
 * PRIVATE QUALIFICATION: pinned-issuer JWKS rotation for RS256 access tokens.
 * Production use additionally needs real IdP provisioning, token revocation,
 * key custody, MFA policy and external security qualification. Does not fetch
 * any URL from JWT headers or customer-supplied parameters.
 */
import {verifyPinnedOidcJwt} from './oidc.mjs';

const DENIED=()=>{throw new Error('OIDC_TRUST_CONFIGURATION_MISSING');};
const JSON_TYPE=/^application\/json(?:\s*;|$)/i;
const KID=/^[A-Za-z0-9._-]{1,128}$/;
const MAX_BODY=65536;
function checkConfig(config){
 if(!config||typeof config.issuer!=='string'||typeof config.audience!=='string'||!config.audience||
    typeof config.jwksUri!=='string'||!Number.isInteger(config.maxTokenAgeSeconds)||
    config.maxTokenAgeSeconds<1||config.maxTokenAgeSeconds>3600||
    !Number.isInteger(config.jwksTtlSeconds)||config.jwksTtlSeconds<30||config.jwksTtlSeconds>3600||
    (config.jwksFetchTimeoutMs!==undefined&&(!Number.isSafeInteger(config.jwksFetchTimeoutMs)||
     config.jwksFetchTimeoutMs<100||config.jwksFetchTimeoutMs>3000)))DENIED();
 let issuer,jwks;
 try{issuer=new URL(config.issuer);jwks=new URL(config.jwksUri);}catch{DENIED();}
 if(issuer.protocol!=='https:'||jwks.protocol!=='https:'||issuer.origin!==jwks.origin||
    issuer.search||issuer.hash||issuer.username||issuer.password||jwks.search||jwks.hash||jwks.username||jwks.password||
    !issuer.pathname.startsWith('/realms/')||!jwks.pathname.startsWith(issuer.pathname.replace(/\/$/,'')+'/')||
    issuer.href!==config.issuer)DENIED();
 if(config.fetchImpl!==undefined&&typeof config.fetchImpl!=='function')DENIED();
 return {issuer,jwks};
}
function peekKid(token){
 if(typeof token!=='string'||token.length>12288||token.length<30)throw new Error('INVALID_JWT');
 const parts=token.split('.');
 if(parts.length!==3||!parts.every(x=>/^[A-Za-z0-9_-]+$/.test(x)))throw new Error('INVALID_JWT');
 let header;
 try{
  const b=Buffer.from(parts[0],'base64url');
  if(b.toString('base64url')!==parts[0]||b.length>8192)throw new Error();
  header=JSON.parse(b.toString('utf8'));
 }catch{throw new Error('INVALID_JWT');}
 if(!header||typeof header!=='object'||Array.isArray(header)||header.alg!=='RS256'||header.typ!=='JWT'||
   !KID.test(header.kid)||Object.keys(header).some(k=>!['typ','alg','kid'].includes(k)))throw new Error('DISALLOWED_JWT_HEADER');
 return header.kid;
}
async function fetchBoundedJwks(url,fetchImpl,timeoutMs){
 const controller=new AbortController();
 let timeout;
 const deadline=new Promise((_,reject)=>{
  timeout=setTimeout(()=>{controller.abort();reject(new Error('JWKS_FETCH_TIMEOUT'));},timeoutMs);
 });
 const work=async()=>{
  const res=await fetchImpl(url,{method:'GET',redirect:'error',cache:'no-store',credentials:'omit',
    headers:{accept:'application/json'},signal:controller.signal});
  if(!res||res.status!==200||!JSON_TYPE.test(res.headers?.get('content-type')||''))throw new Error('JWKS_FETCH_REJECTED');
  if(Number(res.headers.get('content-length')||0)>MAX_BODY)throw new Error('JWKS_TOO_LARGE');
  if(!res.body?.getReader)throw new Error('JWKS_NO_BODY');
  const reader=res.body.getReader();let size=0;const buffers=[];
  try{
   while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
    if(size>MAX_BODY)throw new Error('JWKS_TOO_LARGE');buffers.push(Buffer.from(value));}
  }catch(e){await reader.cancel().catch(()=>{});throw e;}
  let result;
  try{result=JSON.parse(Buffer.concat(buffers,size).toString('utf8'));}catch{throw new Error('JWKS_INVALID_JSON');}
  if(!result||!Array.isArray(result.keys)||result.keys.length===0||result.keys.length>32)throw new Error('JWKS_INVALID_SHAPE');
  const seen=new Set();
  for(const key of result.keys){
   if(!key||key.kty!=='RSA'||!KID.test(key.kid)||(key.alg&&key.alg!=='RS256')||
     (key.use&&key.use!=='sig')||typeof key.n!=='string'||typeof key.e!=='string'||
     !/^[A-Za-z0-9_-]{300,2048}$/.test(key.n)||!/^[A-Za-z0-9_-]{1,12}$/.test(key.e)||seen.has(key.kid))
      throw new Error('JWKS_UNTRUSTED_KEY');
   seen.add(key.kid);
  }
  return {keys:result.keys};
 };
 try{return await Promise.race([work(),deadline]);}
 finally{clearTimeout(timeout);}
}
export function createOidcJwksVerifier(config){
 const {jwks}=checkConfig(config);
 const fetchImpl=config.fetchImpl||globalThis.fetch;
 const ttl=config.jwksTtlSeconds;
 let cached=null,expiry=0,inflight=null,lastUnknownRefresh=0;
 async function refresh(){
  if(inflight)return inflight;
  inflight=fetchBoundedJwks(jwks.href,fetchImpl,config.jwksFetchTimeoutMs??3000).then(result=>{
    cached=result;expiry=Date.now()+ttl*1000;return result;
  }).finally(()=>{inflight=null;});
  return inflight;
 }
 return Object.freeze({
  async verify(token){
   const kid=peekKid(token);
   if(!cached||Date.now()>=expiry)await refresh();
   else if(!cached.keys.some(k=>k.kid===kid)){
    // One bounded unknown-kid refresh per 30 seconds, preventing attacker-controlled
    // kid values from inducing an unlimited stream of trusted IdP network calls.
    if(Date.now()-lastUnknownRefresh<30000)throw new Error('UNKNOWN_SIGNING_KEY');
    lastUnknownRefresh=Date.now();await refresh();
   }
   return verifyPinnedOidcJwt(token,{issuer:config.issuer,audience:config.audience,jwks:cached,
     maxTokenAgeSeconds:config.maxTokenAgeSeconds});
  }
 });
}
