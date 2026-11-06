// Isolated STAGING candidate. No route/config deployment or live admission here.
// Its host-only cookie cannot authenticate the production OAuth origin.
import {ZITADEL_STAGING,parseIdentityJson,exchangeZitadelAuthorizationCode,verifyZitadelCodeTokens} from './zitadel_provider_tokens_candidate.mjs';
import {sha256} from './identity_session.mjs';
const ORIGIN=new URL(ZITADEL_STAGING.redirect_uri).origin;
const FLOW_COOKIE='__Host-axiom_login',SESSION_COOKIE='__Host-axiom_customer';
const TTL=300000,encoder=new TextEncoder();
const deny=()=>{throw Error('identity_denied');};
const opaque=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{43}$/.test(x);
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const b64=x=>btoa(Array.from(x,b=>String.fromCharCode(b)).join('')).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const random=()=>b64(crypto.getRandomValues(new Uint8Array(32)));
function decode(s){
 if(typeof s!=='string'||!/^[A-Za-z0-9_-]+$/.test(s)||s.length%4===1)deny();
 const bytes=Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));
 if(b64(bytes)!==s)deny();return bytes;
}
function timeSource(clock){
 let last=0;return ()=>{const n=clock();if(!Number.isSafeInteger(n)||n<last)deny();last=n;return n;};
}
function admitted(env,privateBinding=false){
 if(env.CUSTOMER_IDP_STAGING_ADMITTED!=='qualified_staging'||!env.IDP_SESSION_DB?.prepare||!env.IDP_SESSION_DB?.batch||
  (privateBinding&&env.CUSTOMER_IDP_BINDING_ADMITTED!=='qualified_private_binding'))return false;
 return true;
}
function primary(db){return typeof db.withSession==='function'?db.withSession('first-primary'):db;}
function response(status,body='Unable to complete sign-in.',extra={}){
 return new Response(body,{status,headers:{'cache-control':'no-store','pragma':'no-cache','referrer-policy':'no-referrer',
  'x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; frame-ancestors 'none'",...extra}});
}
function redirect(location,cookies){const r=response(303,'', {location});for(const c of cookies)r.headers.append('set-cookie',c);return r;}
const cookie=(name,value,maxAge)=>`${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
function credential(request,name,required=true){
 if(request.headers.get('authorization'))deny();
 const raw=request.headers.get('cookie')||'';if(raw.length>8192)deny();
 const values=raw.split(';').map(x=>x.trim()).filter(x=>x.split('=',1)[0]===name).map(x=>x.slice(name.length+1));
 if(values.length>1||(required&&values.length!==1)||(values.length&&!opaque(values[0])))deny();
 return values[0];
}
async function flowKey(env){
 if(!opaque(env.CUSTOMER_IDP_FLOW_KEY))deny();
 const bytes=decode(env.CUSTOMER_IDP_FLOW_KEY);if(bytes.length!==32)deny();
 return crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['encrypt','decrypt']);
}
const aad=(state,browser)=>encoder.encode(JSON.stringify(['axiom-idp-flow-v1',ORIGIN,state,browser]));
async function seal(key,payload,state,browser){
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(state,browser)},key,encoder.encode(JSON.stringify(payload)));
 return b64(iv)+'.'+b64(new Uint8Array(encrypted));
}
async function unseal(key,flow){
 if(flow.sealed_payload.length>4096)deny();const parts=flow.sealed_payload.split('.');if(parts.length!==2)deny();
 const iv=decode(parts[0]);if(iv.length!==12)deny();
 const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:aad(flow.state_hash,flow.browser_hash)},key,decode(parts[1]));
 const p=parseIdentityJson(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 if(!opaque(p?.nonce)||!opaque(p?.verifier)||Object.keys(p).length!==2)deny();return p;
}
function query(url,allowed){
 for(const key of url.searchParams.keys())if(!allowed.includes(key)||url.searchParams.getAll(key).length!==1)deny();
}
async function start(request,url,env,now){
 query(url,['intent']);if(url.searchParams.has('intent')&&!['login','register'].includes(url.searchParams.get('intent')))deny();
 const key=await flowKey(env),db=primary(env.IDP_SESSION_DB),state=random(),browser=random(),nonce=random(),verifier=random();
 const stateHash=await sha256(state),browserHash=await sha256(browser),created=now();
 const payload=await seal(key,{nonce,verifier},stateHash,browserHash);
 await db.prepare('INSERT INTO customer_idp_flows_v1(state_hash,browser_hash,sealed_payload,created_at_ms,expires_at_ms) VALUES(?,?,?,?,?)')
  .bind(stateHash,browserHash,payload,created,created+TTL).run();
 const dest=new URL(ZITADEL_STAGING.issuer+'/oauth/v2/authorize');
 dest.search=new URLSearchParams({client_id:ZITADEL_STAGING.client_id,redirect_uri:ZITADEL_STAGING.redirect_uri,response_type:'code',
  scope:'openid email',state,nonce,code_challenge:b64(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(verifier)))),
  code_challenge_method:'S256',max_age:'300'}).toString();
 return redirect(dest.href,[cookie(FLOW_COOKIE,browser,300)]);
}
async function callback(request,url,env,now,fetcher){
 query(url,['state','code','error','error_description','error_uri','iss','session_state']);
 const state=url.searchParams.get('state');if(!opaque(state))deny();
 const browser=credential(request,FLOW_COOKIE),oldSession=credential(request,SESSION_COOKIE,false);
 const stateHash=await sha256(state),browserHash=await sha256(browser),db=primary(env.IDP_SESSION_DB),claimed=now();
 // One winner before any provider call. Wrong-browser requests cannot consume it.
 const flow=await db.prepare(`UPDATE customer_idp_flows_v1 SET status='processing',used_at_ms=?
  WHERE state_hash=? AND browser_hash=? AND status='pending' AND expires_at_ms>? AND created_at_ms<=? RETURNING *`)
  .bind(claimed,stateHash,browserHash,claimed,claimed).first();
 if(!flow)deny();
 try{
  if(url.searchParams.has('error')||!url.searchParams.has('code')||(url.searchParams.has('iss')&&url.searchParams.get('iss')!==ZITADEL_STAGING.issuer))deny();
  const secret=await unseal(await flowKey(env),flow);
  const tokens=await exchangeZitadelAuthorizationCode({code:url.searchParams.get('code'),code_verifier:secret.verifier},{fetcher});
  const p=await verifyZitadelCodeTokens({...tokens,expected_nonce:secret.nonce},{fetcher,clock:now});
  const created=now(),expires=Math.min(p.token_expires_at_ms,p.auth_time_ms+TTL);
  if(created>=flow.expires_at_ms||created<flow.used_at_ms||p.auth_time_ms>created||expires<=created)deny();
  const raw=random(),hash=await sha256(raw),statements=[];
  if(oldSession)statements.push(db.prepare("UPDATE customer_idp_sessions_v1 SET status='revoked',session_version=session_version+1 WHERE session_hash=? AND status='active'").bind(await sha256(oldSession)));
  statements.push(db.prepare(`INSERT INTO customer_idp_sessions_v1(session_hash,flow_hash,issuer,subject,auth_time_ms,created_at_ms,expires_at_ms)
   VALUES(?,?,?,?,?,?,?)`).bind(hash,stateHash,p.issuer,p.subject,p.auth_time_ms,created,expires));
  statements.push(db.prepare("UPDATE customer_idp_flows_v1 SET status='complete' WHERE state_hash=? AND status='processing' AND used_at_ms=?").bind(stateHash,flow.used_at_ms));
  const result=await db.batch(statements);
  if(result.length!==statements.length||result.at(-1)?.meta?.changes!==1||result.at(-2)?.meta?.changes!==1)deny();
  return redirect(ORIGIN+'/',[cookie(SESSION_COOKIE,raw,Math.floor((expires-created)/1000)),cookie(FLOW_COOKIE,'',0)]);
 }catch{
  // Ambiguous provider redemption is never retried, including worker crashes.
  await db.prepare("UPDATE customer_idp_flows_v1 SET status='failed' WHERE state_hash=? AND status='processing'").bind(stateHash).run();
  return response(400,undefined,{'set-cookie':cookie(FLOW_COOKIE,'',0)});
 }
}
async function logout(request,env){
 if(request.headers.get('origin')!==ORIGIN)deny();const raw=credential(request,SESSION_COOKIE);
 await primary(env.IDP_SESSION_DB).prepare("UPDATE customer_idp_sessions_v1 SET status='revoked',session_version=session_version+1 WHERE session_hash=? AND status='active'")
  .bind(await sha256(raw)).run();
 return redirect(ORIGIN+'/',[cookie(SESSION_COOKIE,'',0),cookie(FLOW_COOKIE,'',0)]);
}
export async function handleIdentityBrowser(request,env,{clock=Date.now,fetcher=globalThis.fetch}={}){
 const url=new URL(request.url);
 if(url.origin!==ORIGIN||!['/auth/start','/auth/callback','/auth/logout'].includes(url.pathname))return response(404,'Not found.');
 if(!admitted(env))return response(503);
 const allowed=url.pathname==='/auth/logout'?'POST':'GET';if(request.method!==allowed)return response(405,undefined,{allow:allowed});
 try{
  const now=timeSource(clock);
  if(url.pathname==='/auth/start')return await start(request,url,env,now);
  if(url.pathname==='/auth/callback')return await callback(request,url,env,now,fetcher);
  return await logout(request,env);
 }catch{return response(400);}
}
async function body(request){
 if(request.headers.get('content-type')!=='application/json'||!request.body)deny();
 const reader=request.body.getReader();let size=0;const chunks=[];
 try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>8192){await reader.cancel();deny();}chunks.push(value);}}
 finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let i=0;for(const chunk of chunks){bytes.set(chunk,i);i+=chunk.length;}
 return parseIdentityJson(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
async function active(db,hash,now){
 const p=await db.prepare(`SELECT s.* FROM customer_idp_sessions_v1 s JOIN customer_idp_flows_v1 f ON f.state_hash=s.flow_hash
  WHERE s.session_hash=? AND s.status='active' AND f.status='complete' AND s.expires_at_ms>? AND s.created_at_ms<=? AND s.auth_time_ms<=?`)
  .bind(hash,now,now,now).first();
 if(!p||p.issuer!==ZITADEL_STAGING.issuer||p.expires_at_ms-p.auth_time_ms>TTL)deny();return p;
}
// Only the named Worker service entrypoint calls this. Never dispatch by a public
// URL/header. Assertions are for this origin; cross-origin OAuth remains closed.
export async function handleIdentityBinding(request,env,{clock=Date.now}={}){
 const url=new URL(request.url);
 if(url.origin!=='https://axiom-internal'||url.pathname!=='/session/verify'||url.search)return response(404,'Not found.');
 if(!admitted(env,true)||!env.CUSTOMER_DB?.prepare)return response(503);
 if(request.method!=='POST')return response(405);
 try{
  const p=await body(request);
  if(!p||Array.isArray(p)||Object.keys(p).sort().join(',')!=='audience,challenge,purpose,request_sha256'||
   p.audience!=='customer-control-plane'||p.purpose!=='customer-session'||request.headers.get('x-axiom-audience')!==p.audience||
   !hex(p.challenge)||!hex(p.request_sha256))deny();
  const raw=credential(request,SESSION_COOKIE),hash=await sha256(raw),now=timeSource(clock),db=primary(env.IDP_SESSION_DB);
  const session=await active(db,hash,now());
  // An independently recorded canonical account mapping is required. No email,
  // browser tenant or provider role can select or create the production UUID.
  const rows=await primary(env.CUSTOMER_DB).prepare(`SELECT l.tenant_id,l.customer_id FROM canonical_customer_links l
   JOIN identities i ON i.id=l.identity_id JOIN memberships m ON m.identity_id=i.id AND m.tenant_id=l.tenant_id
   JOIN tenants t ON t.id=m.tenant_id WHERE i.issuer=? AND i.external_sub=? AND l.status='active' AND m.status='active' AND t.status='active'`)
   .bind(session.issuer,session.subject).all();
  if(rows.results?.length!==1||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(rows.results[0].customer_id))deny();
  const current=now(),fresh=await active(db,hash,current);if(fresh.session_version!==session.session_version)deny();
  const proof={issuer:session.issuer,subject:session.subject,tenant_id:rows.results[0].tenant_id,audience:p.audience,
   authenticated:true,verified:true,email_verified:true,mfa_verified:true,revoked:false,session_id:hash,session_version:fresh.session_version,
   state_verified:true,nonce_verified:true,pkce_method:'S256',issued_at_ms:session.created_at_ms,auth_time_ms:session.auth_time_ms,
   verified_at_ms:current,expires_at_ms:session.expires_at_ms,challenge:p.challenge,request_sha256:p.request_sha256};
  return response(200,JSON.stringify(proof),{'content-type':'application/json'});
 }catch{return response(401);}
}
