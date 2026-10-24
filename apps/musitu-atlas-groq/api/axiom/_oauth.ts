// Isolated owner-operated ATLAS Axiom OAuth 2.1 + PKCE session.
// EXPERIMENTAL / FAIL CLOSED until dedicated Cloudflare callback, client ID,
// encryption key and ATLAS_AXIOM_OAUTH_ENABLED are independently approved.
// No raw account key, OAuth token or PKCE verifier is sent to ATLAS React.
import {createHash,randomBytes,createCipheriv,createDecipheriv,timingSafeEqual} from 'node:crypto';
import {neon} from '@neondatabase/serverless';
import {deny} from './_contract.js';
import {enforceRuntimeRole} from './_ledger.js';

export const CALLBACK='https://musitu-atlas-ai-lab.vercel.app/api/axiom/capabilities';
const ISSUER='https://auth.mftintelligence.com';
const RESOURCE='https://mcp.mftintelligence.com';
const COOKIE='atlas_axiom_oauth_state';
const secureCookie=(value:string,age:number)=>
 `${COOKIE}=${encodeURIComponent(value)}; Path=/api/axiom/capabilities; Max-Age=${age}; HttpOnly; Secure; SameSite=Lax`;
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const rand=()=>randomBytes(32).toString('base64url');
const owner=()=>{
 const s=process.env.ATLAS_AXIOM_TENANT_ID||'atlas-private-owner';
 if(!/^[a-z0-9-]{3,64}$/.test(s))throw deny(503,'Unrecognized ATLAS tenant policy.');
 return s;
};
function db(){
 const uri=process.env.ATLAS_AXIOM_DATABASE_URL;
 if(!uri)throw deny(503,'Private Axiom ledger unavailable.');
 return neon(uri,{fetchOptions:{cache:'no-store'}});
}
function key():Buffer{
 const raw=process.env.ATLAS_AXIOM_OAUTH_DATA_KEY||'';
 const b=Buffer.from(raw,'base64url');
 if(b.length!==32||!raw||!/^[-_A-Za-z0-9]+$/.test(raw))
  throw deny(503,'Axiom OAuth encrypted storage is not configured.');
 return b;
}
function client():string{
 const id=process.env.ATLAS_AXIOM_OAUTH_CLIENT_ID||'';
 if(!/^musitu_dcr_[a-zA-Z0-9_-]{20,100}$/.test(id))throw deny(503,'ATLAS OAuth client registration is not completed.');
 return id;
}
export function oauthConfigured(){
 try{
  if(process.env.ATLAS_AXIOM_OAUTH_ENABLED!=='enabled')return false;
  client();key();
  return Boolean(process.env.ATLAS_AXIOM_DATABASE_URL);
 }catch{return false;}
}
function assertConfigured(){
 if(!oauthConfigured())throw deny(503,'Dedicated website OAuth is not activated by the MUSITU account owner.');
}
function seal(plain:string,domain:string){
 const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key(),iv);
 c.setAAD(Buffer.from(owner()+'|'+domain));
 const cipher=Buffer.concat([c.update(plain,'utf8'),c.final()]);
 return ['v1',iv.toString('base64url'),c.getAuthTag().toString('base64url'),cipher.toString('base64url')].join('.');
}
function unseal(encoded:string,domain:string){
 const parts=encoded.split('.');
 if(parts.length!==4||parts[0]!=='v1')throw deny(503,'Encrypted OAuth secret format not recognized.');
 try{
  const dec=createDecipheriv('aes-256-gcm',key(),Buffer.from(parts[1],'base64url'));
  dec.setAAD(Buffer.from(owner()+'|'+domain));
  dec.setAuthTag(Buffer.from(parts[2],'base64url'));
  return Buffer.concat([dec.update(Buffer.from(parts[3],'base64url')),dec.final()]).toString('utf8');
 }catch{throw deny(503,'OAuth secret authentication failed; refuse to use stored credential.');}
}
function cookieState(req:any){
 const raw=String(req.headers?.cookie||'');
 const found=raw.split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='));
 if(!found)return '';
 try{return decodeURIComponent(found.slice(COOKIE.length+1));}
 catch{return '';}
}
export async function beginOAuth(){
 assertConfigured();
 await enforceRuntimeRole();
 const tenant=owner(),state=rand(),verifier=rand();
 const challenge=createHash('sha256').update(verifier).digest('base64url');
 const sql=db();
 await sql`INSERT INTO atlas_axiom_oauth_flows(state_sha256,tenant_id,verifier_sealed,expires_at)
 VALUES(${hash(state)},${tenant},${seal(verifier,'pkce')},now()+interval '10 minutes')`;
 const qs=new URLSearchParams({
  response_type:'code',client_id:client(),redirect_uri:CALLBACK,
  resource:RESOURCE,scope:'axiom.execute',state,code_challenge:challenge,
  code_challenge_method:'S256'
 });
 return {authorizationUrl:ISSUER+'/oauth/authorize?'+qs.toString(),
  setCookie:secureCookie(state,600),expiresInSeconds:600};
}
type TokenResponse={access_token?:string;refresh_token?:string;token_type?:string;expires_in?:number;scope?:string;resource?:string};
async function exchange(fields:Record<string,string>):Promise<TokenResponse>{
 const r=await fetch(ISSUER+'/oauth/token',{
  method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'},
  body:new URLSearchParams({...fields,client_id:client(),resource:RESOURCE}),
  signal:AbortSignal.timeout(15000)
 });
 if(!r.ok)throw deny(503,'MUSITU OAuth authorization was not accepted. Reconnect using your existing account.');
 const body=await r.text();
 if(body.length>12000)throw deny(503,'Unexpected MUSITU OAuth response size.');
 let parsed:any;
 try{parsed=JSON.parse(body);}catch{throw deny(503,'Invalid MUSITU OAuth response format.');}
 if(parsed.token_type!=='Bearer'||typeof parsed.access_token!=='string'
 ||!parsed.access_token.startsWith('musitu_oauth_at_')||
 typeof parsed.refresh_token!=='string'||!parsed.refresh_token.startsWith('musitu_oauth_rt_')
 ||typeof parsed.expires_in!=='number'||parsed.expires_in<60||parsed.expires_in>7200
 ||!String(parsed.scope||'').split(/\s+/).includes('axiom.execute')
 ||String(parsed.scope||'').split(/\s+/).includes('billing.write')
 ||parsed.resource!==RESOURCE)
  throw deny(503,'MUSITU OAuth token, lifetime, audience or permission contract rejected.');
 return parsed;
}
export async function finishOAuth(req:any,code:string,state:string){
 assertConfigured();
 if(!/^musitu_oauth_code_[a-zA-Z0-9_-]{20,130}$/.test(code)||
 !/^[a-zA-Z0-9_-]{43}$/.test(state))throw deny(400,'Invalid OAuth callback parameters.');
 const cookie=cookieState(req),a=Buffer.from(hash(cookie),'hex'),b=Buffer.from(hash(state),'hex');
 if(cookie.length!==43||!timingSafeEqual(a,b))throw deny(403,'OAuth browser state mismatch.');
 await enforceRuntimeRole();
 const tenant=owner(),sql=db();
 // Consume before calling the issuer. Never replay a redeemed authorization code.
 const rows=await sql`UPDATE atlas_axiom_oauth_flows SET consumed_at=now()
 WHERE state_sha256=${hash(state)} AND tenant_id=${tenant}
 AND consumed_at IS NULL AND expires_at>now()
 RETURNING verifier_sealed`;
 if(rows.length!==1)throw deny(409,'This OAuth connection attempt has expired or was already consumed.');
 const verifier=unseal(String(rows[0].verifier_sealed),'pkce');
 const data=await exchange({grant_type:'authorization_code',code,code_verifier:verifier,redirect_uri:CALLBACK});
 const expires=Math.max(60,Math.min(Number(data.expires_in),7200));
 await sql`INSERT INTO atlas_axiom_oauth_sessions
 (tenant_id,client_id,access_sealed,refresh_sealed,scopes,expires_at,status,generation,updated_at)
 VALUES(${tenant},${client()},${seal(data.access_token!,'access')},
 ${seal(data.refresh_token!,'refresh')},${String(data.scope)},now()+${expires}*interval '1 second','ACTIVE',1,now())
 ON CONFLICT(tenant_id) DO UPDATE SET client_id=EXCLUDED.client_id,
 access_sealed=EXCLUDED.access_sealed,refresh_sealed=EXCLUDED.refresh_sealed,
 scopes=EXCLUDED.scopes,expires_at=EXCLUDED.expires_at,status='ACTIVE',
 lease_until=NULL,generation=atlas_axiom_oauth_sessions.generation+1,updated_at=now()`;
 return {connected:true,clearCookie:secureCookie('',0)};
}
export async function sessionStatus(){
 if(!oauthConfigured())return {configured:false,connected:false,status:'LOCKED'};
 const sql=db(),rows=await sql`SELECT status,expires_at,scopes
 FROM atlas_axiom_oauth_sessions WHERE tenant_id=${owner()} LIMIT 1`;
 const r=rows[0];
 return {configured:true,connected:Boolean(r?.status==='ACTIVE'),status:r?.status||'NOT_CONNECTED',
  expiresAt:r?.expires_at||null,approvedScope:typeof r?.scopes==='string'&&r.scopes.split(/\s+/).includes('axiom.execute')};
}
export async function oauthBearer():Promise<string>{
 assertConfigured();
 await enforceRuntimeRole();
 const sql=db(),tenant=owner();
 const rows=await sql`SELECT status,client_id,access_sealed,expires_at,scopes
 FROM atlas_axiom_oauth_sessions WHERE tenant_id=${tenant} LIMIT 1`;
 const entry=rows[0];
 if(!entry||entry.status!=='ACTIVE'||entry.client_id!==client()||
 !String(entry.scopes).split(/\s+/).includes('axiom.execute'))
  throw deny(503,'Owner must connect an entitled Axiom OAuth session first.');
 if(new Date(String(entry.expires_at)).getTime()>Date.now()+120000)
  return unseal(String(entry.access_sealed),'access');
 // Atomic reservation permits ONE refresh; network ambiguity requires new consent.
 const locked=await sql`UPDATE atlas_axiom_oauth_sessions SET status='REFRESHING',
 lease_until=now()+interval '45 seconds',generation=generation+1,updated_at=now()
 WHERE tenant_id=${tenant} AND status='ACTIVE' AND client_id=${client()}
 RETURNING refresh_sealed`;
 if(locked.length!==1)throw deny(503,'OAuth refresh is already in progress; no Axiom operation was dispatched.');
 try{
  const old=unseal(String(locked[0].refresh_sealed),'refresh');
  const data=await exchange({grant_type:'refresh_token',refresh_token:old});
  const expires=Math.max(60,Math.min(Number(data.expires_in),7200));
  const updated=await sql`UPDATE atlas_axiom_oauth_sessions
  SET access_sealed=${seal(data.access_token!,'access')},
  refresh_sealed=${seal(data.refresh_token!,'refresh')},
  scopes=${String(data.scope)},expires_at=now()+${expires}*interval '1 second',
  status='ACTIVE',lease_until=NULL,generation=generation+1,updated_at=now()
  WHERE tenant_id=${tenant} AND status='REFRESHING' RETURNING tenant_id`;
  if(updated.length!==1)throw deny(503,'Refreshed OAuth session could not be durably recorded.');
  return data.access_token!;
 }catch{
  // Do not automatically reuse old rotated tokens after ambiguous refresh.
  await sql`UPDATE atlas_axiom_oauth_sessions SET status='REAUTH_REQUIRED',
  lease_until=NULL,updated_at=now() WHERE tenant_id=${tenant} AND status='REFRESHING'`.catch(()=>{});
  throw deny(503,'OAuth session renewal is uncertain; reconnect Axiom instead of retrying compute.');
 }
}
