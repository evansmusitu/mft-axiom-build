/**
 * UNMOUNTED PRIVATE QUALIFICATION TOOL, not an application login adapter.
 * Only an authenticated operator may configure this for the existing MMF
 * Cloudflare client and API-pinned public key. Codes/verifiers/nonces must
 * originate in a legitimate, CSRF-checked server-side qualification flow.
 *
 * A real code is intentionally tested with two invalid verifiers before the
 * correct verifier. A provider may invalidate the code on an invalid request;
 * that yields a failed qualification, never a fallback or relaxed login.
 * Nothing here accepts missing discovery capabilities, creates a session,
 * mounts a route, changes Access/MFA or enables a customer operation.
 */
import {createHash,createPublicKey} from 'node:crypto';
import {createPrivateOidcCodeExchanger} from '../commercial/mmf-oidc-private-token-exchange.mjs';
import {verifyPinnedOidcIdToken} from '../commercial/mmf-oidc-admission.mjs';

const deny=()=>{throw Error('MMF_CLOUDFLARE_PKCE_QUALIFICATION_DENIED')};
const CLIENT=/^[A-Za-z0-9._:@-]{4,128}$/;
const TOKEN=/^[A-Za-z0-9_-]{43}$/;
const CODE=/^[A-Za-z0-9._~-]{8,2048}$/;
const sha=x=>createHash('sha256').update(x).digest('hex');
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const CALLBACK='https://mail-stage.mftintelligence.com/private/oidc/callback';

const OAUTH_ERRORS=new Set(['invalid_request','invalid_client','invalid_grant','unauthorized_client',
 'unsupported_grant_type','invalid_scope','access_denied','temporarily_unavailable','server_error']);
async function negativeEvidence(response,diagnostic){
 const reject=reason=>{diagnostic.reason=reason;deny()};
 if(!(response instanceof Response))reject('NEGATIVE_RESPONSE_TYPE');
 if(response.status!==400)reject('NEGATIVE_HTTP_STATUS');
 if(response.redirected)reject('NEGATIVE_REDIRECT');
 if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(response.headers.get('content-type')||''))reject('NEGATIVE_MEDIA_TYPE');
 const length=response.headers.get('content-length');
 if(length!==null&&(!/^(0|[1-9]\d*)$/.test(length)||Number(length)>4096))reject('NEGATIVE_LENGTH');
 if(!response.body)reject('NEGATIVE_BODY');
 diagnostic.reason='NEGATIVE_BODY_READ';
 const reader=response.body.getReader();let size=0;const parts=[];
 try{
  while(true){
   const {value,done}=await reader.read();if(done)break;
   if(!(value instanceof Uint8Array)||value.length===0)reject('NEGATIVE_BODY');
   size+=value.length;if(size>4096)reject('NEGATIVE_LENGTH');parts.push(value);
  }
 }finally{try{await reader.cancel()}catch{};try{reader.releaseLock()}catch{}}
 const bytes=new Uint8Array(size);let offset=0;
 for(const p of parts){bytes.set(p,offset);offset+=p.length}
 let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}catch{reject('NEGATIVE_JSON')}
 // An outage, invalid client, generic denial or successful response says
 // nothing about correct S256 verification and must not qualify this probe.
 diagnostic.oauthError=plain(body)&&OAUTH_ERRORS.has(body.error)?body.error:'OTHER_OR_MISSING';
 if(!plain(body)||body.error!=='invalid_grant')reject('NEGATIVE_OAUTH_ERROR');
 if(Object.hasOwn(body,'id_token')||Object.hasOwn(body,'access_token')||Object.hasOwn(body,'refresh_token'))reject('NEGATIVE_TOKEN_RETURNED');
}

// Destructive provider tests must use sacrificial codes, never a login code.
export function createCloudflareMmfPkceQualification(options){return createQualification(options,true)}
// Normal OIDC exchange: exactly one correct-verifier request; no session issued.
export function createCloudflareMmfPositiveOidcQualification(options){return createQualification(options,false)}
function unverifiedPresence(token){
 let claims;try{claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString('utf8'))}catch{}
 return Object.freeze({amr:plain(claims)&&Array.isArray(claims.amr),
  authTime:plain(claims)&&Number.isSafeInteger(claims.auth_time),
  nonce:plain(claims)&&typeof claims.nonce==='string'});
}
function createQualification({clientId,issuer,tokenEndpoint,redirectUri,
 keyId,publicJwk,spkiFingerprint,env,fetchImpl=globalThis.fetch,now=Date.now,timeoutMs=8000}={},negativeProbes=true){
 try{
  if(!CLIENT.test(clientId||'')||
   issuer!=='https://musitu-axiom.cloudflareaccess.com/cdn-cgi/access/sso/oidc/'+clientId||
   tokenEndpoint!==issuer+'/token'||redirectUri!==CALLBACK||typeof fetchImpl!=='function'||
   typeof now!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<500||timeoutMs>8000||
   !env||env.MMF_REAL_SEND_ENABLED!=='false'||env.MMF_COMMERCE_ENABLED!=='false'||
   env.MMF_CUSTOMER_API_ENABLED!=='false'||!plain(publicJwk)||publicJwk.kty!=='RSA'||
   typeof publicJwk.n!=='string'||typeof publicJwk.e!=='string'||
   publicJwk.alg!==undefined&&publicJwk.alg!=='RS256'||
   publicJwk.use!==undefined&&publicJwk.use!=='sig'||
   publicJwk.key_ops!==undefined&&(!Array.isArray(publicJwk.key_ops)||publicJwk.key_ops.length!==1||publicJwk.key_ops[0]!=='verify')||
   !/^[A-Za-z0-9._:-]{4,100}$/.test(keyId||'')||
   !/^[a-f0-9]{64}$/.test(spkiFingerprint||'')||
   Object.keys(publicJwk).some(k=>!['kty','n','e','kid','alg','use','key_ops'].includes(k)))deny();
  const key=createPublicKey({format:'jwk',key:publicJwk});
  if(key.asymmetricKeyType!=='rsa'||key.asymmetricKeyDetails?.modulusLength<2048||
   sha(key.export({format:'der',type:'spki'}))!==spkiFingerprint)deny();
  // Copy the public key so later caller mutation cannot change the trusted pin.
  const pinned=Object.freeze({issuer,audience:clientId,keyId,
   publicJwk:Object.freeze({kty:'RSA',n:publicJwk.n,e:publicJwk.e}),spkiFingerprint});
  const exchange=createPrivateOidcCodeExchanger({issuer,tokenEndpoint,clientId,redirectUri,fetchImpl,timeoutMs});
  const usedCodes=new Set();
  return async function qualify(input){
   let diagnostic={stage:'INPUT_VALIDATION',reason:'INPUT_REJECTED'};
   try{
    if(!plain(input)||Object.keys(input).sort().join(',')!=='code,codeVerifier,nonce,signal')deny();
    const {code,codeVerifier,nonce,signal}=input;
    if(typeof code!=='string'||typeof codeVerifier!=='string'||typeof nonce!=='string'||
     !CODE.test(code)||!TOKEN.test(codeVerifier)||!TOKEN.test(nonce)||
     !(signal instanceof AbortSignal)||signal.aborted)deny();
    const digest=sha(code);
    if(usedCodes.has(digest)||usedCodes.size>=16)deny();
    usedCodes.add(digest); // Consume locally before the first await; no replay retries.
    const totalSignal=AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]);
    const challenge=createHash('sha256').update(codeVerifier).digest('base64url');
    const wrong=(codeVerifier[0]==='A'?'B':'A')+codeVerifier.slice(1);
    if(challenge===codeVerifier||wrong===challenge)deny();
    for(const [index,probe] of (negativeProbes?[wrong,challenge]:[]).entries()){
     diagnostic={stage:index===0?'NEGATIVE_WRONG_VERIFIER':'NEGATIVE_CHALLENGE_VERIFIER',reason:'TOKEN_REQUEST_FAILED'};
     totalSignal.throwIfAborted();
     const body=new URLSearchParams({grant_type:'authorization_code',client_id:clientId,
      redirect_uri:redirectUri,code,code_verifier:probe});
     const response=await fetchImpl(tokenEndpoint,{method:'POST',
      headers:{'content-type':'application/x-www-form-urlencoded'},body:body.toString(),
      redirect:'error',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',signal:totalSignal});
     await negativeEvidence(response,diagnostic);
    }
    diagnostic={stage:'CORRECT_VERIFIER_EXCHANGE',reason:'TOKEN_RESPONSE_REJECTED'};
    totalSignal.throwIfAborted();
    const result=await exchange({code,codeVerifier,clientId,redirectUri,signal:totalSignal});
    totalSignal.throwIfAborted();
    const at=now();if(!Number.isSafeInteger(at)||at<=0)deny();
    // This is the unchanged signature/issuer/audience/nonce/recent-MFA verifier.
    // No unsigned flag or provider policy metadata can substitute for its claims.
    diagnostic={stage:'SIGNED_ID_TOKEN_VALIDATION',reason:'SIGNED_ID_TOKEN_REJECTED',unverifiedClaimPresence:unverifiedPresence(result.id_token)};
    verifyPinnedOidcIdToken(result.id_token,{...pinned,nonce,nowMs:at});
    if(!negativeProbes)return Object.freeze({positivePkceExchangeVerified:true,negativePkceChecksQualified:false,
     signedMfaAndNonceChecksPassed:true,sessionCreated:false,strictDiscoveryQualified:false,customerApiEnabled:false,
     realSendingEnabled:false,paymentsEnabled:false,productionReady:false});
    return Object.freeze({pkceChecksPassed:true,signedMfaAndNonceChecksPassed:true,sessionCreated:false,
     strictDiscoveryQualified:false,customerApiEnabled:false,realSendingEnabled:false,paymentsEnabled:false,productionReady:false});
   }catch{
    // Only local fixed enums cross this boundary. Never copy caught provider
    // errors, descriptions, response bodies, tokens or input values.
    throw Object.assign(new Error('MMF_CLOUDFLARE_PKCE_QUALIFICATION_DENIED'),
     {qualificationDiagnostic:Object.freeze({...diagnostic})});
   }
  };
 }catch{deny()}
}
