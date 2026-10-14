import {randomBytes,createHash} from 'node:crypto';
import {EncryptJWT,jwtDecrypt,createRemoteJWKSet,jwtVerify} from 'jose';
import {database} from './database.mjs';
const COOKIE='__Host-musitu-session',FLOW='__Host-musitu-flow';
let keys;
const hash=s=>createHash('sha256').update(s).digest('hex');
function config(){
 const issuer=process.env.OIDC_ISSUER,client=process.env.OIDC_CLIENT_ID,secret=process.env.OIDC_CLIENT_SECRET,origin=process.env.APP_ORIGIN;
 if(!issuer||!client||!secret||!origin)throw Error('IDENTITY_NOT_CONFIGURED');
 const u=new URL(issuer),o=new URL(origin);
 if(u.protocol!=='https:'||u.search||u.hash||u.username||u.password||!/^\/realms\/[^/]+$/.test(u.pathname)||o.protocol!=='https:'||o.origin!==origin)throw Error('IDENTITY_CONFIGURATION_REJECTED');
 return {issuer,client,secret,origin,audience:process.env.OIDC_AUDIENCE||client};
}
function key(){const b=Buffer.from(process.env.SESSION_ENCRYPTION_KEY||'','base64');if(b.length!==32)throw Error('SESSION_KEY_NOT_CONFIGURED');return b;}
async function seal(payload,seconds){return new EncryptJWT(payload).setProtectedHeader({alg:'dir',enc:'A256GCM'}).setIssuedAt().setExpirationTime(Math.floor(Date.now()/1000)+seconds).encrypt(key());}
async function unseal(token){return (await jwtDecrypt(token,key(),{keyManagementAlgorithms:['dir'],contentEncryptionAlgorithms:['A256GCM'],maxTokenAge:'1h'})).payload;}
function cookies(req,name){return (req.headers.get('cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1);}
export function sessionCookie(value,age=3600,name=COOKIE){return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;}
async function boundedJson(url,options){
 const r=await fetch(url,{...options,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(5000)});
 if(!r.ok||!/application\/json/.test(r.headers.get('content-type')||''))throw Error('IDENTITY_PROVIDER_UNAVAILABLE');
 const reader=r.body.getReader();let size=0,parts=[];
 try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536)throw Error('IDENTITY_RESPONSE_LIMIT');parts.push(Buffer.from(value));}}
 finally{await reader.cancel().catch(()=>{});}
 return JSON.parse(Buffer.concat(parts).toString('utf8'));
}
async function validate(accessToken){
 const cfg=config();keys??=createRemoteJWKSet(new URL(cfg.issuer+'/protocol/openid-connect/certs'),{timeoutDuration:3000,cooldownDuration:30000,cacheMaxAge:300000});
 const {payload}=await jwtVerify(accessToken,keys,{issuer:cfg.issuer,audience:cfg.audience,algorithms:['RS256'],maxTokenAge:'10m',requiredClaims:['sub','iat','exp']});
 if(payload.azp!==cfg.client)throw Error('TOKEN_CLIENT_REJECTED');
 // Online introspection on EVERY protected request: no stale success cache.
 const p=await boundedJson(cfg.issuer+'/protocol/openid-connect/token/introspect',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:accessToken,client_id:cfg.client,client_secret:cfg.secret})});
 if(p.active!==true||p.sub!==payload.sub||p.exp<=Math.floor(Date.now()/1000))throw Error('SESSION_REVOKED');
 return payload;
}
async function sessionRow(raw,work){
 if(typeof raw!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(raw))throw Error('SESSION_REQUIRED');
 const c=await database().pool.connect();let discard;
 try{await c.query('BEGIN');await c.query("SELECT set_config('app.session_hash',$1,true)",[hash(raw)]);const result=await work(c,hash(raw));await c.query('COMMIT');return result;}
 catch(e){try{await c.query('ROLLBACK');}catch(f){discard=f;}throw e;}finally{c.release(discard);}
}
export async function authenticate(req){
 const row=await sessionRow(cookies(req,COOKIE),async c=>(await c.query("SELECT encrypted_payload FROM musitu_identity.sessions WHERE revoked=false AND expires_at>now()")).rows[0]);
 if(!row)throw Error('SESSION_REVOKED');
 const data=await unseal(row.encrypted_payload),claims=await validate(data.accessToken);
 return {subject:claims.sub};
}
export async function identityAction(req,action){
 const cfg=config();
 if(action==='login'&&req.method==='GET'){
  const state=randomBytes(32).toString('base64url'),nonce=randomBytes(32).toString('base64url'),verifier=randomBytes(32).toString('base64url');
  const target=new URL(cfg.issuer+'/protocol/openid-connect/auth');
  target.search=new URLSearchParams({client_id:cfg.client,redirect_uri:cfg.origin+'/auth/callback',response_type:'code',scope:'openid profile',state,nonce,code_challenge:Buffer.from(hash(verifier),'hex').toString('base64url'),code_challenge_method:'S256'}).toString();
  return new Response(null,{status:302,headers:{location:target.href,'set-cookie':sessionCookie(await seal({state,nonce,verifier},600),600,FLOW),'cache-control':'no-store'}});
 }
 if(action==='callback'&&req.method==='GET'){
  const u=new URL(req.url),flow=await unseal(cookies(req,FLOW));
  if(!u.searchParams.get('code')||u.searchParams.get('state')!==flow.state)throw Error('OIDC_STATE_REJECTED');
  const tokens=await boundedJson(cfg.issuer+'/protocol/openid-connect/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code:u.searchParams.get('code'),client_id:cfg.client,client_secret:cfg.secret,redirect_uri:cfg.origin+'/auth/callback',code_verifier:flow.verifier})});
  await validate(tokens.access_token);
  const id=(await jwtVerify(tokens.id_token,keys,{issuer:cfg.issuer,audience:cfg.client,algorithms:['RS256'],requiredClaims:['sub','exp','iat','nonce']})).payload;
  if(id.nonce!==flow.nonce)throw Error('OIDC_NONCE_REJECTED');
  const raw=randomBytes(32).toString('base64url'),encrypted=await seal({accessToken:tokens.access_token,refreshToken:tokens.refresh_token},Math.min(3600,tokens.expires_in));
  await sessionRow(raw,async(c,h)=>c.query('INSERT INTO musitu_identity.sessions(token_hash,encrypted_payload,expires_at) VALUES($1,$2,now()+($3::int * interval \'1 second\'))',[h,encrypted,Math.min(3600,tokens.expires_in)]));
  const headers=new Headers({location:'/', 'cache-control':'no-store'});headers.append('set-cookie',sessionCookie(raw,Math.min(3600,tokens.expires_in)));headers.append('set-cookie',sessionCookie('',0,FLOW));
  return new Response(null,{status:302,headers});
 }
 if(action==='logout'&&req.method==='POST'){
  if(req.headers.get('origin')!==cfg.origin)throw Error('ORIGIN_REJECTED');
  await sessionRow(cookies(req,COOKIE),async c=>c.query('UPDATE musitu_identity.sessions SET revoked=true'));
  return new Response(null,{status:303,headers:{location:'/', 'set-cookie':sessionCookie('',0),'cache-control':'no-store'}});
 }
 return new Response('NOT_FOUND',{status:404});
}
