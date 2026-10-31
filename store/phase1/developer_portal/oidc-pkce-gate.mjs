/**
 * MUSITU Store V2: PRIVATE, UNDEPLOYED OIDC auth-code+PKCE qualification.
 * Not a provider client, HTTP route, cookie/session service or public login.
 * All state, identity grants, sessions and token exchange MUST use trusted,
 * separately authorized durable server-side integrations. Never use in-memory
 * test doubles, applicant-provided identities, or client-controlled JWKS live.
 */
import {createHash,createPublicKey,randomBytes,timingSafeEqual,verify} from 'node:crypto';
const ALLOWED=new Set(['developer','review_identity','review_security','owner']);
const denial=()=>new Error('oidc_denied');
function ensure(value){if(!value)throw denial();}
const random=()=>randomBytes(32).toString('base64url');
const digest=x=>createHash('sha256').update(x).digest('base64url');
const compare=(a,b)=>{
 if(typeof a!=='string'||typeof b!=='string')return false;
 const x=Buffer.from(a),y=Buffer.from(b);
 return x.length===y.length&&timingSafeEqual(x,y);
};
function https(raw){
 ensure(typeof raw==='string'&&raw.length<=512);
 let u;try{u=new URL(raw);}catch{throw denial();}
 ensure(u.protocol==='https:'&&!u.username&&!u.password&&!u.hash&&!u.search&&(u.href===raw||u.origin===raw));
 return u;
}
function decode(raw,max){
 ensure(typeof raw==='string'&&raw.length>0&&raw.length<=max&&/^[A-Za-z0-9_-]+$/.test(raw));
 const buf=Buffer.from(raw,'base64url');
 ensure(buf.toString('base64url')===raw&&buf.length<=max);
 let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buf));}catch{throw denial();}
 ensure(value&&!Array.isArray(value)&&typeof value==='object');
 return value;
}
function createVerifier({issuer,clientId,jwks,acceptedAcr,now}){
 ensure(jwks&&Array.isArray(jwks.keys)&&jwks.keys.length>0&&jwks.keys.length<=10);
 const keys=new Map();
 for(const j of jwks.keys){
  ensure(j&&j.kty==='EC'&&j.crv==='P-256'&&typeof j.x==='string'&&typeof j.y==='string'&&
    !Object.hasOwn(j,'d')&&j.alg==='ES256'&&j.use==='sig'&&
    typeof j.kid==='string'&&/^[A-Za-z0-9_-]{3,80}$/.test(j.kid)&&!keys.has(j.kid));
  let key;try{key=createPublicKey({key:j,format:'jwk'});}catch{throw denial();}
  ensure(key.asymmetricKeyType==='ec'&&key.asymmetricKeyDetails?.namedCurve==='prime256v1');
  keys.set(j.kid,key);
 }
 return function verifyIdToken(value,expectedNonce){
  ensure(typeof value==='string'&&value.length<=8192);
  const parts=value.split('.');ensure(parts.length===3);
  const h=decode(parts[0],1024),claims=decode(parts[1],4096);
  ensure(h.alg==='ES256'&&keys.has(h.kid)&&(!Object.hasOwn(h,'typ')||h.typ==='JWT')&&
    !Object.hasOwn(h,'jwk')&&!Object.hasOwn(h,'jku')&&!Object.hasOwn(h,'x5u')&&!Object.hasOwn(h,'crit'));
  const sig=Buffer.from(parts[2]||'','base64url');
  ensure(sig.length===64&&sig.toString('base64url')===parts[2]);
  ensure(verify('sha256',Buffer.from(parts[0]+'.'+parts[1]),
   {key:keys.get(h.kid),dsaEncoding:'ieee-p1363'},sig));
  const sec=now()/1000;
  ensure(Number.isSafeInteger(sec)||Number.isFinite(sec));
  ensure(claims.iss===issuer&&claims.aud===clientId&&
    (!Object.hasOwn(claims,'azp')||claims.azp===clientId)&&
    typeof claims.sub==='string'&&/^[A-Za-z0-9_-]{6,120}$/.test(claims.sub)&&
    Number.isSafeInteger(claims.iat)&&Number.isSafeInteger(claims.exp)&&
    Number.isSafeInteger(claims.auth_time)&&
    (!Object.hasOwn(claims,'nbf')||Number.isSafeInteger(claims.nbf)&&claims.nbf<=sec)&&
    claims.iat<=sec+30&&claims.exp>sec&&claims.exp>claims.iat&&claims.exp-claims.iat<=900&&
    claims.auth_time<=sec&&sec-claims.auth_time<=600&&
    compare(claims.nonce,expectedNonce)&&
    Array.isArray(claims.amr)&&claims.amr.includes('mfa')&&
    typeof claims.acr==='string'&&acceptedAcr.includes(claims.acr));
  // IdP email, roles, tenant, publisherId and self-reported authorization
  // claims are deliberately NOT returned or trusted for RBAC.
  return {issuer:claims.iss,subject:claims.sub,authTime:claims.auth_time,
    assurance:claims.acr,tokenExpiresAt:claims.exp};
 };
}
export function createPrivateOidcGate({issuer,clientId,authorizationEndpoint,tokenEndpoint,
 redirectUri,jwks,acceptedAcr,ledger,exchangeCode,trustedDirectory,sessionRegistrar,
 now=Date.now}={}){
 const issuerUrl=https(issuer),authUrl=https(authorizationEndpoint),tokenUrl=https(tokenEndpoint),redirect=https(redirectUri);
 // Deliberately restrict this private pilot to one trusted issuer origin.
 ensure(authUrl.origin===issuerUrl.origin&&tokenUrl.origin===issuerUrl.origin&&
  typeof clientId==='string'&&/^[A-Za-z0-9:_-]{6,128}$/.test(clientId)&&
  Array.isArray(acceptedAcr)&&acceptedAcr.length>0&&acceptedAcr.length<=5&&
  acceptedAcr.every(x=>typeof x==='string'&&x.length>=6&&x.length<=120)&&
  ledger&&typeof ledger.begin==='function'&&typeof ledger.consume==='function'&&
  typeof exchangeCode==='function'&&typeof trustedDirectory?.resolve==='function'&&
  typeof sessionRegistrar==='function'&&typeof now==='function');
 const verifyIdToken=createVerifier({issuer,clientId,jwks,acceptedAcr,now});
 return Object.freeze({
  async start(){
   try{
    const state=random(),nonce=random(),verifier=randomBytes(64).toString('base64url');
    ensure(await ledger.begin({state,nonce,verifier,createdAt:now(),issuer,clientId,redirectUri})===true);
    const url=new URL(authUrl);
    for(const [k,v] of Object.entries({response_type:'code',client_id:clientId,redirect_uri:redirectUri,
      scope:'openid',state,nonce,code_challenge:digest(verifier),code_challenge_method:'S256',max_age:'600'}))
     url.searchParams.set(k,v);
    return Object.freeze({authorizationUrl:url.toString()});
   }catch{throw denial();}
  },
  async complete(callbackHref){
   try{
    ensure(typeof callbackHref==='string'&&callbackHref.length<=4096);
    const callback=new URL(callbackHref);
    ensure(callback.origin===redirect.origin&&callback.pathname===redirect.pathname&&
      !callback.hash&&!callback.username&&!callback.password&&
      callback.searchParams.size===3&&
      ['code','state','iss'].every(k=>callback.searchParams.getAll(k).length===1)&&
      callback.searchParams.get('iss')===issuer);
    const code=callback.searchParams.get('code'),state=callback.searchParams.get('state');
    ensure(typeof code==='string'&&/^[A-Za-z0-9._~-]{8,1024}$/.test(code)&&
      typeof state==='string'&&/^[A-Za-z0-9_-]{43}$/.test(state));
    // consume MUST be single-use atomic against an encrypted, durable store.
    // Consume before any token endpoint egress, preventing callback replay.
    const flow=await ledger.consume(state);
    ensure(flow&&compare(flow.state,state)&&flow.issuer===issuer&&flow.clientId===clientId&&
      flow.redirectUri===redirectUri&&typeof flow.verifier==='string'&&
      /^[A-Za-z0-9_-]{86}$/.test(flow.verifier)&&
      typeof flow.nonce==='string'&&/^[A-Za-z0-9_-]{43}$/.test(flow.nonce)&&
      Number.isFinite(flow.createdAt)&&now()>=flow.createdAt&&now()-flow.createdAt<=300_000);
    const response=await exchangeCode({tokenEndpoint,clientId,redirectUri,code,verifier:flow.verifier});
    ensure(response&&typeof response.id_token==='string');
    const identity=verifyIdToken(response.id_token,flow.nonce);
    const grant=await trustedDirectory.resolve({issuer:identity.issuer,subject:identity.subject});
    ensure(grant&&grant.subject===identity.subject&&ALLOWED.has(grant.role));
    if(grant.role==='developer')ensure(typeof grant.publisherId==='string'&&/^[a-z][a-z0-9-]{2,63}$/.test(grant.publisherId));
    else ensure(!Object.hasOwn(grant,'publisherId'));
    const registration=await sessionRegistrar({issuer:identity.issuer,subject:identity.subject,
      role:grant.role,...(grant.role==='developer'?{publisherId:grant.publisherId}:{}),
      authTime:identity.authTime,assurance:identity.assurance,expiresAt:identity.tokenExpiresAt});
    ensure(registration?.created===true&&typeof registration.sessionId==='string'&&
      /^[A-Za-z0-9_-]{12,128}$/.test(registration.sessionId));
    return Object.freeze({sessionId:registration.sessionId,role:grant.role,
      publisherApproved:false,publicationAuthorized:false,paymentAuthorized:false,
      payoutAuthorized:false,entitlementGranted:false});
   }catch{throw denial();}
  }
 });
}
