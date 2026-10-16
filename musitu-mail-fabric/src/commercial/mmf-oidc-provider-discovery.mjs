/**
 * PRIVATE STAGE ONLY — operator-approved OIDC discovery and JWKS read-only
 * qualification. No live issuer is configured or contacted by importing this
 * module. Never auto-trust provider-advertised keys or produce live sessions.
 *
 * A valid result may be passed to IdentityAdmission with the separately
 * approved issuer/client and the exact pinned key, but it is NOT an IdP
 * approval, MFA proof, production sign-in, or unattended JWKS rotation.
 */
import {createPublicKey,createHash} from 'node:crypto';
const deny=()=>{throw Error('MMF_OIDC_PROVIDER_DISCOVERY_DENIED')};
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const KID=/^[A-Za-z0-9._:-]{4,100}$/;
const SHA=/^[a-f0-9]{64}$/;
const URI_LIMIT=500;
function httpsUrl(text){
 if(typeof text!=='string'||text.length<12||text.length>URI_LIMIT)deny();
 let u;try{u=new URL(text)}catch{deny()}
 if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.port||
    u.hostname==='localhost'||u.hostname==='127.0.0.1'||u.href!==text||
    /%|\\|\/\//.test(u.pathname)||!u.hostname.includes('.'))deny();
 return u;
}
function underIssuer(url,issuer){
 const prefix=issuer.pathname==='/'?'/':issuer.pathname.replace(/\/$/,'')+'/';
 return url.origin===issuer.origin&&url.pathname.startsWith(prefix)&&url.pathname.length>prefix.length;
}
async function fetchJson(url,maxBytes,fetchImpl){
 const res=await fetchImpl(url,{method:'GET',headers:{accept:'application/json'},
  redirect:'error',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',
  signal:AbortSignal.timeout(8000)});
 if(!(res instanceof Response)||res.status!==200||!res.ok||res.redirected||
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(res.headers.get('content-type')||''))deny();
 const declared=res.headers.get('content-length');
 if(declared!==null&&(!/^(0|[1-9][0-9]*)$/.test(declared)||Number(declared)>maxBytes))deny();
 if(!res.body)deny();
 const reader=res.body.getReader();let total=0;const chunks=[];
 try{while(true){const {value,done}=await reader.read();if(done)break;
   if(!(value instanceof Uint8Array)||value.length===0)deny();
   total+=value.byteLength;if(total>maxBytes)deny();chunks.push(value);
 }}finally{try{await reader.cancel()}catch{};try{reader.releaseLock()}catch{}}
 if(total===0)deny();
 const bytes=new Uint8Array(total);let offset=0;
 for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
 let data;try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}catch{deny()}
 if(!plain(data))deny();return data;
}
function approvedKeyConfig(keys){
 if(!Array.isArray(keys)||keys.length<1||keys.length>4)deny();
 const ids=new Set(),fps=new Set();
 for(const k of keys){
  if(!plain(k)||Object.keys(k).sort().join(',')!=='kid,spkiFingerprint'||
     !KID.test(k.kid)||!SHA.test(k.spkiFingerprint)||ids.has(k.kid)||fps.has(k.spkiFingerprint))deny();
  ids.add(k.kid);fps.add(k.spkiFingerprint);
 }
 return keys;
}
function inspectKeys(set,pins){
 if(!Array.isArray(set)||set.length<1||set.length>24)deny();
 const seen=new Set(),byId=new Map();let unapproved=0;
 for(const jwk of set){
  if(!plain(jwk)||!KID.test(jwk.kid)||seen.has(jwk.kid)||
     Object.keys(jwk).some(k=>['d','p','q','dp','dq','qi','oth','k'].includes(k)))deny();
  seen.add(jwk.kid);byId.set(jwk.kid,jwk);
 }
 const accepted=[];
 for(const pin of pins){
  const jwk=byId.get(pin.kid);if(!jwk)deny();
  if(jwk.kty!=='RSA'||typeof jwk.n!=='string'||typeof jwk.e!=='string'||
    (jwk.alg!==undefined&&jwk.alg!=='RS256')||
    (jwk.use!==undefined&&jwk.use!=='sig')||
    (jwk.key_ops!==undefined&&(!Array.isArray(jwk.key_ops)||jwk.key_ops.length!==1||jwk.key_ops[0]!=='verify'))||
    Object.keys(jwk).some(k=>!['kty','n','e','kid','alg','use','key_ops'].includes(k)))deny();
  let key;try{key=createPublicKey({format:'jwk',key:{kty:'RSA',n:jwk.n,e:jwk.e}})}catch{deny()}
  if(key.asymmetricKeyType!=='rsa'||key.asymmetricKeyDetails?.modulusLength<2048||
     createHash('sha256').update(key.export({format:'der',type:'spki'})).digest('hex')!==pin.spkiFingerprint)deny();
  accepted.push(Object.freeze({keyId:pin.kid,spkiFingerprint:pin.spkiFingerprint,
   publicJwk:Object.freeze({kty:'RSA',n:jwk.n,e:jwk.e})}));
 }
 unapproved=set.length-accepted.length;
 return {accepted,unapproved};
}
export async function qualifyPrivateMmfOidcProvider({issuer,authorizationEndpoint,tokenEndpoint,
 jwksUri,approvedKeys,fetchImpl=globalThis.fetch}={}){
 try{
  const issuerUrl=httpsUrl(issuer),auth=httpsUrl(authorizationEndpoint),
   token=httpsUrl(tokenEndpoint),jwks=httpsUrl(jwksUri);
  if(!underIssuer(auth,issuerUrl)||!underIssuer(token,issuerUrl)||!underIssuer(jwks,issuerUrl)||
    typeof fetchImpl!=='function')deny();
  const pins=approvedKeyConfig(approvedKeys);
  const config=await fetchJson(issuer+'/.well-known/openid-configuration',16384,fetchImpl);
  if(config.issuer!==issuer||config.authorization_endpoint!==authorizationEndpoint||
   config.token_endpoint!==tokenEndpoint||config.jwks_uri!==jwksUri||
   !Array.isArray(config.response_types_supported)||!config.response_types_supported.includes('code')||
   !Array.isArray(config.grant_types_supported)||!config.grant_types_supported.includes('authorization_code')||
   !Array.isArray(config.code_challenge_methods_supported)||!config.code_challenge_methods_supported.includes('S256')||
   !Array.isArray(config.id_token_signing_alg_values_supported)||!config.id_token_signing_alg_values_supported.includes('RS256'))deny();
  const document=await fetchJson(jwksUri,32768,fetchImpl);
  if(Object.keys(document).some(x=>x!=='keys'))deny();
  const result=inspectKeys(document.keys,pins);
  return Object.freeze({issuer,authorizationEndpoint,tokenEndpoint,jwksUri,
   keyId:result.accepted[0].keyId,spkiFingerprint:result.accepted[0].spkiFingerprint,
   publicJwk:result.accepted[0].publicJwk,approvedSigningKeys:Object.freeze(result.accepted),
   unapprovedKeyCount:result.unapproved,publicCustomerLoginEnabled:false,
   mailSendingEnabled:false,commerceEnabled:false,
   issuerRegisteredByOperator:false,mfaPolicyVerified:false});
 }catch{deny()}
}