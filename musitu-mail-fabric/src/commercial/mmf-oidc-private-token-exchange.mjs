/**
 * MMF private OIDC stage: pinned, bounded authorization-code+PKCE token exchange.
 * Provides an adapter to PrivateOidcBrowserStage.callback({exchangeCode}); it
 * does NOT establish an approved issuer, launch a listener, create a customer,
 * enable delivery, exchange a real code, or turn on commerce. The operator must
 * independently approve issuer, token endpoint and client registration.
 * No client secret / refresh token / access token is returned or logged.
 */
const deny=()=>{throw Error('MMF_PRIVATE_OIDC_EXCHANGE_DENIED')};
const CODE=/^[A-Za-z0-9._~-]{8,2048}$/;
const VERIFIER=/^[A-Za-z0-9_-]{43}$/;
const CLIENT=/^[A-Za-z0-9._:-]{4,128}$/;
const MAX_RESPONSE=16384;
function secureUrl(input){
 if(typeof input!=='string'||input.length>500)deny();
 let u;try{u=new URL(input)}catch{deny()}
 if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.port||
  u.hostname==='localhost'||u.hostname==='127.0.0.1'||u.href!==input)deny();
 return u;
}
async function boundedJson(response){
 if(!response||response.status!==200||response.ok!==true||response.redirected||
   !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(response.headers?.get?.('content-type')||''))deny();
 const length=response.headers.get('content-length');
 if(length!==null&&(!/^(0|[1-9]\d*)$/.test(length)||Number(length)>MAX_RESPONSE))deny();
 if(!response.body||typeof response.body.getReader!=='function')deny();
 const reader=response.body.getReader();let size=0;const chunks=[];
 try{
  while(true){const {done,value}=await reader.read();if(done)break;
   if(!(value instanceof Uint8Array)||value.byteLength===0)deny();
   size+=value.byteLength;if(size>MAX_RESPONSE)deny();chunks.push(value);
  }
 }finally{try{reader.releaseLock()}catch{}}
 if(size===0)deny();
 const bytes=new Uint8Array(size);let offset=0;
 for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
 let j;try{j=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}catch{deny()}
 if(!j||typeof j!=='object'||Array.isArray(j)||Object.getPrototypeOf(j)!==Object.prototype)deny();
 if(typeof j.id_token!=='string'||j.id_token.length<20||j.id_token.length>8192||
  !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(j.id_token)||
  (j.token_type!==undefined&&j.token_type!=='Bearer')||
  (j.expires_in!==undefined&&(!Number.isSafeInteger(j.expires_in)||j.expires_in<=0||j.expires_in>3600)))deny();
 return Object.freeze({id_token:j.id_token});
}
/** Construct once with independently pinned operator configuration; never use HTTP-provided URLs. */
export function createPrivateOidcCodeExchanger({issuer,tokenEndpoint,clientId,redirectUri,
 fetchImpl=globalThis.fetch,timeoutMs=8000}={}){
 const base=secureUrl(issuer),endpoint=secureUrl(tokenEndpoint),redirect=secureUrl(redirectUri);
 const prefix=base.pathname==='/'?'/':base.pathname.replace(/\/$/,'')+'/';
 if(endpoint.origin!==base.origin||!endpoint.pathname.startsWith(prefix)||
  endpoint.pathname.length<=prefix.length||
  !CLIENT.test(clientId||'')||redirect.pathname!=='/private/oidc/callback'||
  typeof fetchImpl!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<500||timeoutMs>8000)deny();
 return async function exchangeCode({code,codeVerifier,clientId:requestedClientId,redirectUri:requestedRedirectUri,signal}={}){
  try{
   if(typeof code!=='string'||!CODE.test(code)||typeof codeVerifier!=='string'||
    !VERIFIER.test(codeVerifier)||requestedClientId!==clientId||requestedRedirectUri!==redirect.href||
    !(signal instanceof AbortSignal))deny();
   const body=new URLSearchParams({grant_type:'authorization_code',code,code_verifier:codeVerifier,
    client_id:clientId,redirect_uri:redirect.href});
   const response=await fetchImpl(endpoint.href,{method:'POST',
    headers:{'content-type':'application/x-www-form-urlencoded'},body:body.toString(),
    redirect:'error',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',
    signal:AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)])});
   return await boundedJson(response);
  }catch{deny()}
 };
}
