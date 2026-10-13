/**
 * PRIVATE STAGE ONLY. A small server-side OIDC Authorization Code + PKCE
 * browser boundary. Nothing here installs a fetch handler, public DNS route,
 * identity provider, OAuth secret, payment authority or mail sending.
 *
 * The approved operator must supply a trusted, bounded code exchanger over
 * TLS; callback data never determines the token endpoint or issuer. The
 * provider ID token remains subject to the separately pinned OIDC verifier.
 */
import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {IdentityAdmission,StageCommercialController} from './mmf-oidc-admission.mjs';

const deny=()=>{throw Error('MMF_BROWSER_STAGE_DENIED')};
const TOKEN=/^[A-Za-z0-9_-]{43}$/;
const SESSION=/^mmf_session_[A-Za-z0-9_-]{43}$/;
const CODE=/^[A-Za-z0-9._~-]{8,2048}$/;
const CSRF_COOKIE='__Host-mmf_csrf',SESSION_COOKIE='__Host-mmf_session',STATE_COOKIE='__Host-mmf_oidc_state';
const b64sha=x=>createHash('sha256').update(x).digest('base64url');
const eq=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
function strictCookie(header,name,pattern){
 if(typeof header!=='string'||header.length>4096||/[\r\n\x00]/.test(header))deny();
 const all=header.split(';').map(x=>x.trim()).filter(x=>x.startsWith(name+'='));
 if(all.length!==1)deny();
 const raw=all[0].slice(name.length+1);
 if(!pattern.test(raw))deny();
 return raw;
}
function trustedHttps(value,exactOrigin=false){
 if(typeof value!=='string'||value.length>500)deny();
 let u;try{u=new URL(value)}catch{deny()}
 if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.port||
    u.hostname==='localhost'||u.hostname==='127.0.0.1'||
    (exactOrigin&&u.origin!==value)||(!exactOrigin&&u.href!==value))deny();
 return u;
}
const cookie=(name,value,age,{httpOnly=true,sameSite='Strict'}={})=>
 `${name}=${value}; Path=/; Max-Age=${age}; Secure; SameSite=${sameSite}${httpOnly?'; HttpOnly':''}`;

export class PrivateOidcBrowserStage {
 constructor({admission,controller,db,env,clientId,authorizationEndpoint,redirectUri,stageOrigin,flowSecret,now=Date.now}={}){
  if(!(admission instanceof IdentityAdmission)||!(controller instanceof StageCommercialController)||
      controller.admission!==admission||db!==admission.db||!db?.exec||!db?.prepare||
      !env||env.MMF_REAL_SEND_ENABLED!=='false'||env.MMF_COMMERCE_ENABLED!=='false'||
      env.MMF_CUSTOMER_API_ENABLED!=='false'||typeof now!=='function'||
      !flowSecret||Buffer.from(flowSecret).length!==32||clientId!==admission.options.audience)deny();
  const base=trustedHttps(stageOrigin,true),redirect=trustedHttps(redirectUri),endpoint=trustedHttps(authorizationEndpoint);
  if(redirectUri!==stageOrigin+'/private/oidc/callback'||
     endpoint.origin!==new URL(admission.options.issuer).origin||
     !authorizationEndpoint.startsWith(admission.options.issuer+'/'))deny();
  this.db=db;this.admission=admission;this.controller=controller;
  this.clientId=clientId;this.endpoint=endpoint.href;this.redirectUri=redirect.href;
  this.origin=base.origin;this.secret=Buffer.from(flowSecret);this.now=now;
  db.exec(`CREATE TABLE IF NOT EXISTS mmf_oidc_browser_pending(
    state_hash TEXT PRIMARY KEY, expires_ms INTEGER NOT NULL,
    consumed INTEGER NOT NULL DEFAULT 0 CHECK(consumed IN (0,1))) STRICT`);
 }
 #guard(origin){if(origin!==this.origin)deny()}
 #derive(label,token){return createHmac('sha256',this.secret).update(label+'\0'+token).digest('base64url')}
 #hash(state){return this.#derive('state',state)}
 #session(cookieHeader){return strictCookie(cookieHeader,SESSION_COOKIE,SESSION)}
 begin({origin}={}){
  this.#guard(origin);
  const state=randomBytes(32).toString('base64url');
  const verifier=this.#derive('pkce',state);
  const challenge=this.admission.issueChallenge();
  // The OIDC nonce in the signed provider token must be the admission-issued
  // one-time nonce; store neither PKCE verifier nor raw state in SQLite.
  const admissionNonce=challenge.nonce;
  this.db.prepare('INSERT INTO mmf_oidc_browser_pending(state_hash,expires_ms) VALUES(?,?)')
   .run(this.#hash(state),challenge.expiresAtMs);
  const u=new URL(this.endpoint);
  u.searchParams.set('response_type','code');u.searchParams.set('client_id',this.clientId);
  u.searchParams.set('redirect_uri',this.redirectUri);u.searchParams.set('scope','openid');
  u.searchParams.set('state',state);u.searchParams.set('nonce',admissionNonce);
  u.searchParams.set('code_challenge',b64sha(verifier));u.searchParams.set('code_challenge_method','S256');
  // Storing just a one-time nonce digest in the existing admission table
  // requires linking state to that nonce: encrypted, authenticated, bounded
  // cookie, rather than storing raw callback secrets in remote SQL.
  const nonceMac=this.#derive('nonce-bind',state+'\0'+admissionNonce);
  return Object.freeze({authorizationUrl:u.toString(),setCookies:Object.freeze([
   cookie(STATE_COOKIE,state+'.'+admissionNonce+'.'+nonceMac,300,{sameSite:'Lax'})
  ]),publicCustomerLoginEnabled:false});
 }
 async callback({origin,cookieHeader,state,code,exchangeCode}={}){
  try{
   this.#guard(origin);
   if(typeof state!=='string'||!TOKEN.test(state)||typeof code!=='string'||!CODE.test(code)||typeof exchangeCode!=='function')deny();
   const compound=strictCookie(cookieHeader,STATE_COOKIE,/^[A-Za-z0-9_.-]{130,200}$/);
   const pieces=compound.split('.');if(pieces.length!==3)deny();
   const [cookieState,nonce,mac]=pieces;
   if(!TOKEN.test(cookieState)||!TOKEN.test(nonce)||!TOKEN.test(mac)||!eq(state,cookieState)||
      !eq(mac,this.#derive('nonce-bind',state+'\0'+nonce)))deny();
   const used=this.db.prepare('UPDATE mmf_oidc_browser_pending SET consumed=1 WHERE state_hash=? AND consumed=0 AND expires_ms>=?')
    .run(this.#hash(state),this.now());
   if(used.changes!==1)deny();
   const result=await exchangeCode(Object.freeze({code,codeVerifier:this.#derive('pkce',state),
    clientId:this.clientId,redirectUri:this.redirectUri,signal:AbortSignal.timeout(8000)}));
   if(!result||typeof result!=='object'||typeof result.id_token!=='string'||
      result.id_token.length>8192)deny();
   const login=this.admission.acceptLogin({idToken:result.id_token,nonce});
   const age=Math.max(1,Math.min(900,Math.floor((login.expiresAtMs-this.now())/1000)));
   const csrf=this.#derive('csrf',login.sessionToken);
   return Object.freeze({setCookies:Object.freeze([
    cookie(STATE_COOKIE,'',0,{sameSite:'Lax'}),
    cookie(SESSION_COOKIE,login.sessionToken,age),
    cookie(CSRF_COOKIE,csrf,age,{httpOnly:false})
   ]),identityVerified:true,customerApiEnabled:false,realSendingEnabled:false,paymentsEnabled:false});
  }catch{deny()}
 }
 readDashboard({origin,cookieHeader,tenantId}={}){
  try{this.#guard(origin);return this.controller.getDashboard({sessionToken:this.#session(cookieHeader),tenantId})}
  catch{deny()}
 }
 logout({origin,cookieHeader,csrfHeader}={}){
  try{
   this.#guard(origin);
   const token=this.#session(cookieHeader);
   const tokenCsrf=strictCookie(cookieHeader,CSRF_COOKIE,TOKEN);
   if(!TOKEN.test(csrfHeader||'')||!eq(tokenCsrf,csrfHeader)||
      !eq(tokenCsrf,this.#derive('csrf',token)))deny();
   if(!this.admission.revokeSession(token))deny();
   return Object.freeze({revoked:true,clearCookies:Object.freeze([
    cookie(SESSION_COOKIE,'',0),cookie(CSRF_COOKIE,'',0,{httpOnly:false})
   ]),customerApiEnabled:false});
  }catch{deny()}
 }
}
