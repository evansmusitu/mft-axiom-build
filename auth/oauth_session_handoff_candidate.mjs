// NOT_RELEASE. Separately admitted named services; no public private-path dispatch.
// No customer creation, email matching, provider credential export or shared cookie.
import {readHandoffText,handoffFormContentType} from '../customer_frontier/customer_control_plane/oauth_handoff_contract_candidate.mjs';
import {sha256} from '../customer_frontier/customer_control_plane/identity_session.mjs';
import {ZITADEL_STAGING,parseIdentityJson} from '../customer_frontier/customer_control_plane/zitadel_provider_tokens_candidate.mjs';
export const HANDOFF_PORTAL=new URL(ZITADEL_STAGING.redirect_uri).origin;
export const HANDOFF_AUTH='https://auth.mftintelligence.com';
export const HANDOFF_PATH='/auth/oauth/authorize';
export const HANDOFF_COOKIE='__Host-axiom_oauth_flow';
const SESSION='__Host-axiom_customer',CONSENT='__Host-axiom_oauth_consent',TTL=300000;
const deny=()=>{throw Error('handoff_denied');};
export const handoffOpaque=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{43}$/.test(x);
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const flowId=x=>typeof x==='string'&&/^flow_[A-Za-z0-9_-]{32}$/.test(x);
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(x);
const random=()=>btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const result=(status,p={ok:false,error:'handoff_denied'})=>new Response(JSON.stringify(p),{status,headers:{'content-type':'application/json','cache-control':'no-store','referrer-policy':'no-referrer'}});
const keys=(p,want)=>p&&!Array.isArray(p)&&Object.keys(p).sort().join(',')===want.split(',').sort().join(',');
export function handoffCredential(request,name,required=true){
 if(request.headers.get('authorization'))deny();const raw=request.headers.get('cookie')||'';if(raw.length>8192)deny();
 const values=raw.split(';').map(x=>x.trim()).filter(x=>x.split('=',1)[0]===name).map(x=>x.slice(name.length+1));
 if(values.length>1||(required&&values.length!==1)||(values.length&&!handoffOpaque(values[0])))deny();return values[0];
}
function admitted(env){return env.OAUTH_HANDOFF_QUALIFIED==='qualified_private_binding'&&env.OAUTH_OWNERSHIP_QUALIFIED==='qualified_private_binding'&&
 env.CUSTOMER_IDENTITY_ISSUER===ZITADEL_STAGING.issuer&&env.OAUTH_IDENTITY_ISSUER===ZITADEL_STAGING.issuer&&
 ['OAUTH_HANDOFF_DB','IDP_SESSION_DB','CUSTOMER_DB','AXIOM_DB'].every(n=>typeof env[n]?.prepare==='function');}
async function json(request){if(request.headers.get('content-type')!=='application/json')deny();return parseIdentityJson(await readHandoffText(request));}
function nowValue(clock){const now=clock();if(!Number.isSafeInteger(now))deny();return now;}
async function currentFlow(env,id,now){
 if(!flowId(id))deny();const flow=await env.AXIOM_DB.prepare(`SELECT f.*,c.redirect_uris_json FROM oauth_authorization_flows f
 JOIN oauth_clients c ON c.client_id=f.client_id WHERE f.id=? AND f.used_at IS NULL`).bind(id).first();
 if(!flow||!Number.isFinite(Date.parse(flow.created_at))||Date.parse(flow.created_at)>now||Date.parse(flow.expires_at)<=now||
  !Number.isFinite(Date.parse(flow.expires_at))||Date.parse(flow.expires_at)-Date.parse(flow.created_at)>600000||
  flow.resource!=='https://mcp.mftintelligence.com'||!hex(flow.nonce_hash)||!/^[A-Za-z0-9_-]{43}$/.test(flow.code_challenge)||
  typeof flow.state!=='string'||flow.state.length<16||flow.state.length>1024||typeof flow.client_id!=='string'||flow.client_id.length>200)deny();
 const dest=new URL(flow.redirect_uri);
 if(dest.origin!=='https://chatgpt.com'||dest.username||dest.password||dest.hash||
  !(dest.pathname.startsWith('/connector/oauth/')||dest.pathname==='/connector_platform_oauth_redirect')||
  !JSON.parse(flow.redirect_uris_json).includes(flow.redirect_uri))deny();
 const scopes=flow.scope.split(' ');if(!scopes.length||new Set(scopes).size!==scopes.length||scopes.some(s=>!['openid','email','axiom.execute','billing.read','billing.write'].includes(s)))deny();
 const digest=await sha256(JSON.stringify(['axiom-oauth-handoff-flow-v1',flow.id,flow.client_id,flow.redirect_uri,flow.state,flow.resource,flow.scope,
  flow.code_challenge,flow.nonce_hash,flow.created_at,flow.expires_at]));return {...flow,digest};
}
async function handoff(env,id,now){
 if(!handoffOpaque(id))deny();const row=await env.OAUTH_HANDOFF_DB.prepare('SELECT * FROM oauth_session_handoffs_v1 WHERE id=?').bind(id).first();
 if(!row||row.created_at_ms>now||row.expires_at_ms<=now||row.status==='redeemed')deny();
 const flow=await currentFlow(env,row.flow_id,now);if(flow.digest!==row.flow_sha256||flow.nonce_hash!==row.browser_sha256)deny();return {row,flow};
}
async function identity(env,hash,now){
 const s=await env.IDP_SESSION_DB.prepare(`SELECT s.* FROM customer_idp_sessions_v1 s JOIN customer_idp_flows_v1 f ON f.state_hash=s.flow_hash
 WHERE s.session_hash=? AND s.status='active' AND f.status='complete' AND s.created_at_ms<=? AND s.expires_at_ms>? AND s.auth_time_ms<=?`).bind(hash,now,now,now).first();
 if(!s||s.issuer!==ZITADEL_STAGING.issuer||s.expires_at_ms-s.auth_time_ms>TTL||now-s.auth_time_ms>TTL)deny();
 const rows=await env.CUSTOMER_DB.prepare(`SELECT l.*,i.issuer,i.external_sub FROM canonical_customer_links l JOIN identities i ON i.id=l.identity_id
 JOIN memberships m ON m.identity_id=i.id AND m.tenant_id=l.tenant_id JOIN tenants t ON t.id=m.tenant_id
 WHERE i.issuer=? AND i.external_sub=? AND l.status='active' AND m.status='active' AND t.status='active'`).bind(s.issuer,s.subject).all();
 if(rows.results?.length!==1)deny();const c=rows.results[0],subhash=await sha256(s.issuer+'\n'+s.subject);
 if(!uuid(c.customer_id)||!hex(c.proof_sha256))deny();
 const o=await env.AXIOM_DB.prepare(`SELECT l.* FROM oauth_identity_links l JOIN customers c ON c.id=l.customer_id
 WHERE l.issuer=? AND l.subject_sha256=? AND l.state='active' AND c.status='active'`).bind(s.issuer,subhash).first();
 if(!o||o.customer_id!==c.customer_id||o.tenant_id!==c.tenant_id||!hex(o.witness_sha256))deny();
 const a=await env.OAUTH_HANDOFF_DB.prepare(`SELECT * FROM oauth_handoff_ownership_v1 WHERE issuer=? AND subject_sha256=? AND status='accepted'
 AND accepted_at_ms<=? AND expires_at_ms>?`).bind(s.issuer,subhash,now,now).first();
 if(!a||a.customer_id!==c.customer_id||a.tenant_id!==c.tenant_id||a.canonical_proof_sha256!==c.proof_sha256||
  a.oauth_witness_sha256!==o.witness_sha256||!hex(a.acceptance_sha256)||typeof a.decision_id!=='string'||a.decision_id.length<12)deny();
 const mapping=await sha256(JSON.stringify(['axiom-oauth-handoff-mapping-v1',s.issuer,subhash,c.customer_id,c.tenant_id,c.proof_sha256,
  o.witness_sha256,a.decision_id,a.acceptance_sha256,a.accepted_at_ms,a.expires_at_ms]));return {session:s,tenant:c.tenant_id,mapping};
}
async function boundIdentity(env,row,now){
 const p=await identity(env,row.session_hash,now);
 if(p.session.session_version!==row.session_version||p.mapping!==row.mapping_sha256)deny();return p;
}
async function create(env,p,now){
 if(!keys(p,'flow_id,nonce_hash')||!hex(p.nonce_hash))deny();const flow=await currentFlow(env,p.flow_id,now);if(flow.nonce_hash!==p.nonce_hash)deny();
 const id=random(),expires=Math.min(now+TTL,Date.parse(flow.expires_at));
 const saved=await env.OAUTH_HANDOFF_DB.prepare(`INSERT INTO oauth_session_handoffs_v1(id,flow_id,flow_sha256,browser_sha256,created_at_ms,expires_at_ms)
 SELECT ?,?,?,?,?,? WHERE (SELECT count(*) FROM oauth_session_handoffs_v1)<1024`).bind(id,flow.id,flow.digest,p.nonce_hash,now,expires).run();
 if(saved?.meta?.changes!==1)deny();return result(201,{handoff_id:id,flow_id:flow.id,expires_at_ms:expires});
}
// Called ONLY through the separately admitted OAuthSessionHandoffService.
export async function handleOAuthHandoffPrivate(request,env,{clock=Date.now,inspectOnly=false}={}){
 const u=new URL(request.url),paths=inspectOnly?['/oauth/handoff/inspect']:['/oauth/handoff/create','/identity/verify-oauth-session'];
 if(u.origin!=='https://axiom-internal'||!paths.includes(u.pathname)||u.search)return result(404);
 if(!admitted(env))return result(503);if(request.method!=='POST')return result(405);
 try{
  const p=await json(request),now=nowValue(clock);
  if(inspectOnly){if(!keys(p,'handoff_id'))deny();const {row}=await handoff(env,p.handoff_id,now);if(row.status!=='requested')deny();return result(200,{handoff_id:row.id,expires_at_ms:row.expires_at_ms});}
  if(u.pathname==='/oauth/handoff/create')return await create(env,p,now);
  if(!keys(p,'audience,purpose,challenge,request_sha256,flow_id,handoff_id,handoff_grant')||p.audience!=='axiom-chatgpt-oauth'||
   p.purpose!=='oauth-existing-customer-link'||request.headers.get('x-axiom-audience')!==p.audience||!hex(p.challenge)||!hex(p.request_sha256)||!handoffOpaque(p.handoff_grant))deny();
  const browser=handoffCredential(request,HANDOFF_COOKIE),{row}=await handoff(env,p.handoff_id,now);
  if(row.status!=='approved'||row.flow_id!==p.flow_id||row.browser_sha256!==await sha256(browser)||row.grant_sha256!==await sha256('axiom-oauth-handoff-grant-v1\n'+p.handoff_grant))deny();
  await boundIdentity(env,row,now);
  // Consume before any proof leaves this service; an ambiguous result is terminal.
  const consumed=await env.OAUTH_HANDOFF_DB.prepare(`UPDATE oauth_session_handoffs_v1 SET status='redeemed',redeemed_at_ms=?
   WHERE id=? AND status='approved' AND grant_sha256=? AND expires_at_ms>?`).bind(now,row.id,row.grant_sha256,now).run();
  if(consumed?.meta?.changes!==1)deny();
  const current=nowValue(clock),p2=await boundIdentity(env,row,current);if((await currentFlow(env,row.flow_id,current)).digest!==row.flow_sha256)deny();const s=p2.session;
  return result(200,{issuer:s.issuer,subject:s.subject,tenant_id:p2.tenant,audience:p.audience,authenticated:true,verified:true,
   email_verified:true,mfa_verified:true,revoked:false,session_id:s.session_hash,session_version:s.session_version,
   state_verified:true,nonce_verified:true,pkce_method:'S256',issued_at_ms:s.created_at_ms,auth_time_ms:s.auth_time_ms,
   verified_at_ms:current,expires_at_ms:Math.min(s.expires_at_ms,row.expires_at_ms),challenge:p.challenge,request_sha256:p.request_sha256,
   production_qualified:true,flow_id:row.flow_id});
 }catch{return result(401);}
}
// Browser service emits bounded JSON. A separate ingress renders fixed HTML and
// filters every field/header; private HTML and cookies are never forwarded.
export async function handleOAuthHandoffBrowser(request,env,{clock=Date.now}={}){
 const u=new URL(request.url);if(u.origin!==HANDOFF_PORTAL||u.pathname!==HANDOFF_PATH)return result(404);
 if(!admitted(env))return result(503);if(!['GET','POST'].includes(request.method))return result(405);
 try{
  if([...u.searchParams.keys()].some(k=>k!=='handoff')||u.searchParams.getAll('handoff').length!==1)deny();
  const id=u.searchParams.get('handoff'),now=nowValue(clock),{row,flow}=await handoff(env,id,now);
  if(request.method==='GET'){
   if(row.status!=='requested'&&row.status!=='consent')deny();
   const raw=handoffCredential(request,SESSION,false);
   if(!raw){if(row.status!=='requested')deny();return result(200,{kind:'login',handoff_id:id});}
   const hash=await sha256(raw),p=await identity(env,hash,now);let csrf;
   if(row.status==='requested'){
    csrf=random();const saved=await env.OAUTH_HANDOFF_DB.prepare(`UPDATE oauth_session_handoffs_v1 SET status='consent',session_hash=?,session_version=?,mapping_sha256=?,consent_sha256=?
     WHERE id=? AND status='requested' AND expires_at_ms>?`).bind(hash,p.session.session_version,p.mapping,await sha256(csrf),id,now).run();
    if(saved?.meta?.changes!==1)deny();
   }else{
    csrf=handoffCredential(request,CONSENT);if(row.session_hash!==hash||row.session_version!==p.session.session_version||row.mapping_sha256!==p.mapping||row.consent_sha256!==await sha256(csrf))deny();
   }
   return result(200,{kind:'consent',handoff_id:id,csrf,scope:flow.scope,expires_at_ms:Math.min(row.expires_at_ms,p.session.expires_at_ms)});
  }
  if(request.headers.get('origin')!==HANDOFF_PORTAL||!handoffFormContentType(request))deny();
  const f=new URLSearchParams(await readHandoffText(request));if([...f.keys()].length!==2||f.getAll('consent').length!==1||f.get('consent')!=='approve'||f.getAll('csrf').length!==1)deny();
  const csrf=handoffCredential(request,CONSENT),raw=handoffCredential(request,SESSION);
  if(row.status!=='consent'||!handoffOpaque(f.get('csrf'))||f.get('csrf')!==csrf||await sha256(csrf)!==row.consent_sha256||await sha256(raw)!==row.session_hash)deny();
  await boundIdentity(env,row,now);const grant=random(),digest=await sha256('axiom-oauth-handoff-grant-v1\n'+grant);
  const saved=await env.OAUTH_HANDOFF_DB.prepare(`UPDATE oauth_session_handoffs_v1 SET status='approved',grant_sha256=?,approved_at_ms=?
   WHERE id=? AND status='consent' AND consent_sha256=? AND expires_at_ms>?`).bind(digest,now,id,row.consent_sha256,now).run();
  if(saved?.meta?.changes!==1)deny();await boundIdentity(env,row,nowValue(clock));
  return result(200,{kind:'complete',handoff_id:id,flow_id:row.flow_id,grant});
 }catch{return result(401);}
}
