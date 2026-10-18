import {randomBytes,createHash} from 'node:crypto';
import {EncryptJWT,jwtDecrypt} from 'jose';
import {database} from './database.mjs';
import {identityConfig,assertIdentityFlow,providerLogoutUrl,ZITADEL_MAX_AUTH_AGE_SECONDS} from './identity-policy.mjs';
import {createIdentityProvider} from './identity-provider.mjs';
const COOKIE='__Host-musitu-session',FLOW='__Host-musitu-flow';
let providerCache;
const hash=s=>createHash('sha256').update(s).digest('hex');
function config(){return identityConfig(process.env);}
function key(){const b=Buffer.from(process.env.SESSION_ENCRYPTION_KEY||'','base64');if(b.length!==32)throw Error('SESSION_KEY_NOT_CONFIGURED');return b;}
async function seal(payload,seconds){return new EncryptJWT(payload).setProtectedHeader({alg:'dir',enc:'A256GCM'}).setIssuedAt().setExpirationTime(Math.floor(Date.now()/1000)+seconds).encrypt(key());}
async function unseal(token){return (await jwtDecrypt(token,key(),{keyManagementAlgorithms:['dir'],contentEncryptionAlgorithms:['A256GCM'],maxTokenAge:'1h'})).payload;}
function cookies(req,name){return (req.headers.get('cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1);}
export function sessionCookie(value,age=3600,name=COOKIE){return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;}
function provider(cfg=config()){
 const fingerprint=JSON.stringify(cfg);
 if(providerCache?.fingerprint!==fingerprint)providerCache={fingerprint,service:createIdentityProvider(cfg)};
 return providerCache.service;
}
async function validate(accessToken){return provider().verifyAccess(accessToken);}
async function sessionRow(raw,work){
 if(typeof raw!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(raw))throw Error('SESSION_REQUIRED');
 const c=await database().pool.connect();let discard;
 try{await c.query('BEGIN');await c.query("SELECT set_config('app.session_hash',$1,true)",[hash(raw)]);const result=await work(c,hash(raw));await c.query('COMMIT');return result;}
 catch(e){try{await c.query('ROLLBACK');}catch(f){discard=f;}throw e;}finally{c.release(discard);}
}
export async function authenticate(req){
 const row=await sessionRow(cookies(req,COOKIE),async c=>(await c.query("SELECT encrypted_payload FROM musitu_identity.sessions WHERE revoked=false AND expires_at>now()")).rows[0]);
 if(!row)throw Error('SESSION_REVOKED');
 const data=await unseal(row.encrypted_payload),claims=await provider().verifySession(data);
 return {subject:claims.sub};
}
export async function identityAction(req,action,{onStage=()=>{}}={}){
 onStage('CONFIGURATION');
 const cfg=config();
 if(action==='login'&&req.method==='GET'){
  onStage('DISCOVERY');
  await provider(cfg).qualifyDiscovery();
  const state=randomBytes(32).toString('base64url'),nonce=randomBytes(32).toString('base64url'),verifier=randomBytes(32).toString('base64url');
  const target=new URL(cfg.endpoints.authorization);
  target.search=new URLSearchParams({client_id:cfg.client,redirect_uri:cfg.origin+'/auth/callback',response_type:'code',scope:'openid profile',state,nonce,code_challenge:Buffer.from(hash(verifier),'hex').toString('base64url'),code_challenge_method:'S256'}).toString();
  if(cfg.provider==='zitadel')target.searchParams.set('max_age',String(ZITADEL_MAX_AUTH_AGE_SECONDS));
  onStage('SESSION_ENCRYPTION');
  return new Response(null,{status:302,headers:{location:target.href,'set-cookie':sessionCookie(await seal({purpose:'login',state,nonce,verifier},600),600,FLOW),'cache-control':'no-store'}});
 }
 if(action==='callback'&&req.method==='GET'){
  onStage('FLOW_VALIDATION');
  const u=new URL(req.url),flow=await unseal(cookies(req,FLOW));
  assertIdentityFlow(flow,'login',u.searchParams.get('state'));
  if(!u.searchParams.get('code'))throw Error('OIDC_STATE_REJECTED');
  onStage('DISCOVERY');
  await provider(cfg).qualifyDiscovery();
  onStage('TOKEN_EXCHANGE');
  const tokens=await provider(cfg).exchange(u.searchParams.get('code'),flow.verifier);
  onStage('TOKEN_TYPE');
  if(tokens.token_type?.toLowerCase()!=='bearer')throw Error('OIDC_TOKEN_TYPE_REJECTED');
  onStage('ACCESS_VALIDATION');
  const accessClaims=await validate(tokens.access_token);
  onStage('ID_VALIDATION');
  await provider(cfg).verifyId(tokens.id_token,flow,accessClaims);
  onStage('TOKEN_EXPIRATION');
  if(!Number.isSafeInteger(tokens.expires_in)||tokens.expires_in<1||tokens.expires_in>86400)throw Error('OIDC_EXPIRATION_REJECTED');
  const proof=cfg.provider==='zitadel'?{idToken:tokens.id_token,nonce:flow.nonce}:{};
  onStage('SESSION_ENCRYPTION');
  const raw=randomBytes(32).toString('base64url'),encrypted=await seal({accessToken:tokens.access_token,...proof},Math.min(3600,tokens.expires_in));
  onStage('SESSION_PERSISTENCE');
  await sessionRow(raw,async(c,h)=>c.query('INSERT INTO musitu_identity.sessions(token_hash,encrypted_payload,expires_at) VALUES($1,$2,now()+($3::int * interval \'1 second\'))',[h,encrypted,Math.min(3600,tokens.expires_in)]));
  const headers=new Headers({location:'/', 'cache-control':'no-store'});headers.append('set-cookie',sessionCookie(raw,Math.min(3600,tokens.expires_in)));headers.append('set-cookie',sessionCookie('',0,FLOW));
  onStage('COMPLETE');
  return new Response(null,{status:302,headers});
 }
 if(action==='logout'&&req.method==='POST'){
  if(req.headers.get('origin')!==cfg.origin)throw Error('ORIGIN_REJECTED');
  await sessionRow(cookies(req,COOKIE),async c=>c.query('UPDATE musitu_identity.sessions SET revoked=true'));
  // Commit local revocation before redirecting; a failed/cancelled provider flow
  // must never restore the application's session.
  const state=randomBytes(32).toString('base64url');
  const headers=new Headers({location:providerLogoutUrl(cfg,state),'cache-control':'no-store','referrer-policy':'no-referrer'});
  headers.append('set-cookie',sessionCookie('',0));
  headers.append('set-cookie',sessionCookie(await seal({purpose:'logout',state},600),600,FLOW));
  return new Response(null,{status:303,headers});
 }
 if(action==='logged-out'&&req.method==='GET'){
  const flow=await unseal(cookies(req,FLOW));
  assertIdentityFlow(flow,'logout',new URL(req.url).searchParams.get('state'));
  const headers=new Headers({location:'/', 'cache-control':'no-store','referrer-policy':'no-referrer'});
  headers.append('set-cookie',sessionCookie('',0));headers.append('set-cookie',sessionCookie('',0,FLOW));
  return new Response(null,{status:303,headers});
 }
 return new Response('NOT_FOUND',{status:404});
}
