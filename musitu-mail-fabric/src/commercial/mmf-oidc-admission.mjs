/**
 * MMF STAGE-ONLY identity admission for a privately connected, independently
 * configured OIDC identity provider. Never expose this module as a public
 * endpoint or accept customer-supplied issuer/JWK/fingerprints/tenant owners.
 *
 * The operator must separately establish the genuine provider, pin its signing
 * public key out-of-band, and review callback/session/CSRF/CSP/TLS handling.
 * No payment, email sending, tenant entitlement, or public API activation.
 */
import {createHash,createHmac,createPublicKey,randomBytes,verify,timingSafeEqual} from 'node:crypto';
import {mmfTransaction} from './mmf-db-transaction.mjs';
const deny=()=>{throw Error('MMF_OIDC_DENIED')};
const STR=/^[A-Za-z0-9_-]+$/;
const FINGERPRINT=/^[a-f0-9]{64}$/;
const CLIENT=/^[A-Za-z0-9._:-]{4,128}$/;
const KID=/^[A-Za-z0-9._:-]{4,100}$/;
const subject=x=>typeof x==='string'&&x.length>=4&&x.length<=180&&!/[\s\x00-\x1f]/.test(x);
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const nowInteger=x=>Number.isSafeInteger(x)&&x>0;
const sha=x=>createHash('sha256').update(x).digest('hex');
const trustedIssuer=x=>{
 if(typeof x!=='string'||x.length>300||!x.startsWith('https://'))deny();
 let u;try{u=new URL(x)}catch{deny()}
 if(u.username||u.password||u.search||u.hash||u.port||
    u.pathname.includes('%')||!(u.origin===x||u.origin+u.pathname===x))deny();
 return x;
};
function decoded(segment,maxBytes){
 if(typeof segment!=='string'||segment.length<2||segment.length>maxBytes*2||!STR.test(segment))deny();
 const b=Buffer.from(segment,'base64url');
 if(!b.length||b.length>maxBytes||b.toString('base64url')!==segment)deny();
 let out;try{out=JSON.parse(b.toString('utf8'))}catch{deny()}
 if(!obj(out))deny();
 return out;
}
function pinnedKey(options){
 if(!obj(options)||!KID.test(options.keyId)||!obj(options.publicJwk)||
    options.publicJwk.kty!=='RSA'||typeof options.publicJwk.n!=='string'||
    typeof options.publicJwk.e!=='string'||
    (options.publicJwk.use!==undefined&&options.publicJwk.use!=='sig')||
    (options.publicJwk.alg!==undefined&&options.publicJwk.alg!=='RS256')||
    (options.publicJwk.key_ops!==undefined&&(!Array.isArray(options.publicJwk.key_ops)||options.publicJwk.key_ops.length!==1||options.publicJwk.key_ops[0]!=='verify'))||
    Object.keys(options.publicJwk).some(k=>!['kty','n','e','kid','alg','use','key_ops'].includes(k))||
    !FINGERPRINT.test(options.spkiFingerprint))deny();
 let key;try{key=createPublicKey({format:'jwk',key:options.publicJwk})}catch{deny()}
 if(key.asymmetricKeyType!=='rsa'||key.asymmetricKeyDetails?.modulusLength<2048||
    sha(key.export({format:'der',type:'spki'}))!==options.spkiFingerprint)deny();
 return key;
}
export function verifyPinnedOidcIdToken(idToken,options){
 try{
  const issuer=trustedIssuer(options?.issuer);
  if(!CLIENT.test(options.audience)||!subject(options.nonce)||!nowInteger(options.nowMs))deny();
  const key=pinnedKey(options);
  if(typeof idToken!=='string'||idToken.length>8192)deny();
  const parts=idToken.split('.');if(parts.length!==3)deny();
  const [h,p,s]=parts;
  const header=decoded(h,800),claims=decoded(p,4000);
  if(header.alg!=='RS256'||header.typ!=='JWT'||header.kid!==options.keyId||
     Object.keys(header).some(k=>!['alg','typ','kid'].includes(k)))deny();
  if(typeof s!=='string'||s.length>1024||!STR.test(s))deny();
  const signature=Buffer.from(s,'base64url');
  if(signature.toString('base64url')!==s||signature.length!==key.asymmetricKeyDetails.modulusLength/8||
     !verify('RSA-SHA256',Buffer.from(h+'.'+p),key,signature))deny();
  const goodAudience=claims.aud===options.audience||
    Array.isArray(claims.aud)&&claims.aud.length>=2&&claims.aud.length<=8&&
    new Set(claims.aud).size===claims.aud.length&&
    claims.aud.every(x=>typeof x==='string'&&CLIENT.test(x))&&
    claims.aud.includes(options.audience)&&claims.azp===options.audience;
  if(claims.iss!==issuer||!goodAudience||
     (claims.azp!==undefined&&claims.azp!==options.audience)||
     claims.nonce!==options.nonce||!subject(claims.sub)||
     !Number.isSafeInteger(claims.exp)||!Number.isSafeInteger(claims.iat)||
     claims.nbf!==undefined&&!Number.isSafeInteger(claims.nbf))deny();
  const now=Math.floor(options.nowMs/1000);
  // Ten-minute maximum login-token age, at most one-hour provider token lifetime.
  if(claims.exp<=now||claims.iat>now+60||claims.iat<now-600||
     claims.exp-claims.iat>3600||claims.nbf!==undefined&&claims.nbf>now+60)deny();
  const actorSubject='oidc:'+sha(issuer+'\x00'+claims.sub);
  return Object.freeze({actorSubject,issuer,audience:options.audience,
    expiresAtMs:claims.exp*1000,realSendingAuthorized:false,commercialPaymentsAuthorized:false});
 }catch{deny()}
}
const sql=`
CREATE TABLE IF NOT EXISTS mmf_oidc_login_challenges(challenge_hash TEXT PRIMARY KEY, expires_ms INTEGER NOT NULL, consumed INTEGER NOT NULL DEFAULT 0 CHECK(consumed IN (0,1))) STRICT;
CREATE TABLE IF NOT EXISTS mmf_oidc_sessions(session_hash TEXT PRIMARY KEY, actor_subject TEXT NOT NULL, expires_ms INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1))) STRICT;
CREATE INDEX IF NOT EXISTS mmf_oidc_session_subject ON mmf_oidc_sessions(actor_subject,revoked);
`;
export class IdentityAdmission {
 constructor(db,{issuer,audience,keyId,publicJwk,spkiFingerprint,sessionPepper,env,now=Date.now}={}){
  if(!db?.exec||!db?.prepare||typeof now!=='function'||
     !env||env.MMF_REAL_SEND_ENABLED!=='false'||env.MMF_COMMERCE_ENABLED!=='false'||
     env.MMF_CUSTOMER_API_ENABLED!=='false'||
     !sessionPepper||Buffer.from(sessionPepper).length!==32)deny();
  trustedIssuer(issuer);if(!CLIENT.test(audience))deny();
  pinnedKey({keyId,publicJwk,spkiFingerprint});
  this.db=db;this.options=Object.freeze({issuer,audience,keyId,publicJwk,spkiFingerprint});
  this.pepper=Buffer.from(sessionPepper);this.now=now;
  db.exec(sql);
 }
 issueChallenge(){
  const at=this.now();if(!nowInteger(at))deny();
  const nonce=randomBytes(32).toString('base64url');
  const expiresAtMs=at+5*60000;
  this.db.prepare('INSERT INTO mmf_oidc_login_challenges(challenge_hash,expires_ms) VALUES(?,?)')
   .run(sha(nonce),expiresAtMs);
  return Object.freeze({nonce,expiresAtMs,identityConfirmed:false,publicApiEnabled:false});
 }
 #sessionHash(token){return createHmac('sha256',this.pepper).update(token).digest('hex')}
 acceptLogin({idToken,nonce}={}){
  const at=this.now();if(!nowInteger(at)||!subject(nonce))deny();
  const identity=verifyPinnedOidcIdToken(idToken,{...this.options,nonce,nowMs:at});
  const sessionToken='mmf_session_'+randomBytes(32).toString('base64url');
  const sessionExpiresAtMs=Math.min(identity.expiresAtMs,at+15*60000);
  if(sessionExpiresAtMs<=at)deny();
  try{return mmfTransaction(this.db,()=>{
   const updated=this.db.prepare('UPDATE mmf_oidc_login_challenges SET consumed=1 WHERE challenge_hash=? AND expires_ms>=? AND consumed=0').run(sha(nonce),at);
   if(updated.changes!==1)deny();
   this.db.prepare('INSERT INTO mmf_oidc_sessions(session_hash,actor_subject,expires_ms) VALUES(?,?,?)')
    .run(this.#sessionHash(sessionToken),identity.actorSubject,sessionExpiresAtMs);
   return Object.freeze({sessionToken,actorSubject:identity.actorSubject,expiresAtMs:sessionExpiresAtMs,
    realSendingAuthorized:false,commercialPaymentsAuthorized:false,customerApiEnabled:false});
  });}catch{deny()}
 }
 authenticateSession(token){
  if(typeof token!=='string'||!/^mmf_session_[A-Za-z0-9_-]{43}$/.test(token))deny();
  const digest=this.#sessionHash(token);
  const row=this.db.prepare('SELECT actor_subject,session_hash,expires_ms FROM mmf_oidc_sessions WHERE session_hash=? AND revoked=0').get(digest);
  if(!row||row.expires_ms<=this.now()||!timingSafeEqual(Buffer.from(row.session_hash),Buffer.from(digest)))deny();
  return Object.freeze({actorSubject:row.actor_subject,expiresAtMs:row.expires_ms,
    customerApiEnabled:false,commercialPaymentsAuthorized:false,realSendingAuthorized:false});
 }
 revokeSession(token){
  if(typeof token!=='string'||!/^mmf_session_[A-Za-z0-9_-]{43}$/.test(token))deny();
  return this.db.prepare('UPDATE mmf_oidc_sessions SET revoked=1 WHERE session_hash=? AND revoked=0')
   .run(this.#sessionHash(token)).changes===1;
 }
}

/**
 * Server-private adapter: user-supplied actorSubject is NEVER forwarded.
 * Real deployment must add a trusted private transport, TLS, session binding,
 * permissions and independent production review. This is not a public API.
 */
export class StageCommercialController {
 constructor({admission,platform}={}){
  if(!(admission instanceof IdentityAdmission)||!platform||
     typeof platform.createTenant!=='function'||typeof platform.effectiveEntitlement!=='function'||
     typeof platform.readTenantDashboard!=='function')deny();
  this.admission=admission;this.platform=platform;
 }
 #verified(sessionToken){return this.admission.authenticateSession(sessionToken).actorSubject}
 createTenant({sessionToken,tenantId}={}){
  return this.platform.createTenant({tenantId,ownerSubject:this.#verified(sessionToken)});
 }
 issueApiKey({sessionToken,tenantId,scope}={}){
  return this.platform.issueApiKey({tenantId,scope,actorSubject:this.#verified(sessionToken)});
 }
 revokeApiKey({sessionToken,tenantId,keyId}={}){
  return this.platform.revokeApiKey({tenantId,keyId,actorSubject:this.#verified(sessionToken)});
 }
 requestDomain({sessionToken,tenantId,domain}={}){
  return this.platform.requestDomain({tenantId,domain,actorSubject:this.#verified(sessionToken)});
 }
 verifyDomainDns({sessionToken,tenantId,domain,resolveTxt}={}){
  return this.platform.verifyDomainDns({tenantId,domain,resolveTxt,actorSubject:this.#verified(sessionToken)});
 }
 openSubscription({sessionToken,tenantId,planCode,orderReference}={}){
  return this.platform.openSubscription({tenantId,planCode,orderReference,actorSubject:this.#verified(sessionToken)});
 }
 getSubscription({sessionToken,tenantId,orderReference}={}){
  return this.platform.getSubscription({tenantId,orderReference,actorSubject:this.#verified(sessionToken)});
 }
 getDashboard({sessionToken,tenantId}={}){
  return this.platform.readTenantDashboard({tenantId,actorSubject:this.#verified(sessionToken)});
 }
 getUsage({sessionToken,tenantId}={}){
  return this.platform.getUsage({tenantId,actorSubject:this.#verified(sessionToken)});
 }
 tenantEntitlement({sessionToken,tenantId}={}){
  return this.platform.effectiveEntitlement({tenantId,actorSubject:this.#verified(sessionToken)});
 }
}