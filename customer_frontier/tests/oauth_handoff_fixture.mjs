// Entirely synthetic local fixture. No actual owner evidence or network traffic.
import assert from 'node:assert/strict';
import {webcrypto,createHash,randomBytes} from 'node:crypto';
import {setupContinuity,customer} from './oauth_continuity_fixture.mjs';
import {openTestDB} from '../customer_control_plane/sqlite_d1_test_adapter.mjs';
import {handleIdentityBrowser,handleIdentityBinding} from '../customer_control_plane/zitadel_session_broker_candidate.mjs';
import {ZITADEL_STAGING} from '../customer_control_plane/zitadel_provider_tokens_candidate.mjs';
import {handleOAuthHandoffPrivate,handleOAuthHandoffBrowser,HANDOFF_AUTH,HANDOFF_PORTAL,HANDOFF_PATH} from '../../auth/oauth_session_handoff_candidate.mjs';
import {stagingIdentityRoute} from '../customer_control_plane/staging_identity_frontdoor.mjs';
import oauth from '../../auth/axiom_keyless_oauth_worker_candidate.mjs';
import customerAPI from '../customer_control_plane/worker.mjs';
export const principal={issuer:ZITADEL_STAGING.issuer,subject:'local-handoff-person',tenant_id:'tenant-handoff'};
export {customer,HANDOFF_AUTH as auth,HANDOFF_PORTAL as portal,HANDOFF_PATH as path};
export const sha=x=>createHash('sha256').update(x).digest('hex');
export const cookie=(r,name)=>r.headers.getSetCookie().find(x=>x.startsWith(name+'='))?.split(';')[0];
export const input=(html,name)=>new RegExp('name="'+name+'" value="([A-Za-z0-9_-]+)"').exec(html)?.[1];
export const redirect='https://chatgpt.com/connector/oauth/axiom',verifier='V'.repeat(43),resource='https://mcp.mftintelligence.com';
const keys=await webcrypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
export const jwk={...await webcrypto.subtle.exportKey('jwk',keys.publicKey),kid:'synthetic-handoff-key',use:'sig',alg:'RS256'};
const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
export async function providerResponse(request,f){
 f.providerCalls.push({method:request.method,url:request.url});
 if(request.url===principal.issuer+'/oauth/v2/token'){
  f.exchanges++;const form=new URLSearchParams(await request.text());assert.equal(form.get('code'),'synthetic-code');
  assert.equal(form.get('client_id'),ZITADEL_STAGING.client_id);assert.equal(form.get('redirect_uri'),ZITADEL_STAGING.redirect_uri);
  assert.equal(form.has('client_secret'),false);assert.equal(request.headers.has('cookie'),false);
  assert.equal(createHash('sha256').update(form.get('code_verifier')).digest('base64url'),f.authorize.searchParams.get('code_challenge'));
  const n=Math.floor(Date.now()/1000),body={iss:principal.issuer,sub:principal.subject,aud:ZITADEL_STAGING.client_id,
   nonce:f.authorize.searchParams.get('nonce'),iat:n,auth_time:n-10,exp:n+3600,amr:['pwd','mfa'],...f.providerPatch};
  const message=encode({alg:'RS256',kid:jwk.kid})+'.'+encode(body),sig=await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,Buffer.from(message));
  return Response.json({id_token:message+'.'+Buffer.from(sig).toString('base64url'),access_token:'synthetic-access-token',token_type:'Bearer'});
 }
 if(request.url===ZITADEL_STAGING.jwks_uri)return Response.json({keys:[jwk]});
 if(request.url===ZITADEL_STAGING.userinfo_endpoint)return Response.json({sub:principal.subject,email:'local@synthetic.invalid',email_verified:true});
 throw Error('EXTERNAL_NETWORK_NOT_ADMITTED');
}
export function ownershipSQL(db){return db.prepare(`INSERT INTO oauth_handoff_ownership_v1(issuer,subject_sha256,tenant_id,customer_id,canonical_proof_sha256,oauth_witness_sha256,decision_id,acceptance_sha256,accepted_at_ms,expires_at_ms)
 VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(principal.issuer,sha(principal.issuer+'\n'+principal.subject),principal.tenant_id,customer,'a'.repeat(64),'a'.repeat(64),
 'synthetic-only-ownership-decision','b'.repeat(64),Date.now()-1000,Date.now()+86400000);}
export function setupHandoff(t,{owned=true}={}){
 const seed=setupContinuity({principal}),idp=openTestDB(new URL('../customer_control_plane/zitadel_session_broker_candidate.sql',import.meta.url)),
 handoffs=openTestDB(new URL('../../auth/oauth_session_handoff_candidate.sql',import.meta.url));
 const f={...seed,idp,handoffs,providerCalls:[],exchanges:0,providerPatch:{},offset:0,privateRequests:[],authorize:null};
 f.env={...seed.env,IDP_SESSION_DB:idp,OAUTH_HANDOFF_DB:handoffs,OAUTH_HANDOFF_QUALIFIED:'qualified_private_binding',
  OAUTH_OWNERSHIP_QUALIFIED:'qualified_private_binding',CUSTOMER_IDP_STAGING_ADMITTED:'qualified_staging',CUSTOMER_IDP_BINDING_ADMITTED:'qualified_private_binding',
  CUSTOMER_IDP_ROUTE_ADMITTED:'qualified_private_binding',CUSTOMER_OAUTH_HANDOFF_ROUTE_ADMITTED:'qualified_private_binding',CUSTOMER_IDP_FLOW_KEY:randomBytes(32).toString('base64url')};
 f.private=async request=>{f.privateRequests.push(request.clone());return handleOAuthHandoffPrivate(request,f.env,{clock:()=>Date.now()+f.offset});};
 f.env.OAUTH_SESSION_VERIFIER={fetch:r=>f.private(r)};
 f.env.OAUTH_HANDOFF_INSPECTOR={fetch:r=>handleOAuthHandoffPrivate(r,f.env,{clock:()=>Date.now()+f.offset,inspectOnly:true})};
 f.env.CUSTOMER_IDP_BROWSER={fetch:r=>handleIdentityBrowser(r,f.env,{fetcher:r=>providerResponse(r,f),clock:()=>Date.now()+f.offset})};
 f.env.CUSTOMER_OAUTH_HANDOFF_BROWSER={fetch:r=>handleOAuthHandoffBrowser(r,f.env,{clock:()=>Date.now()+f.offset})};
 f.env.IDENTITY_VERIFIER={fetch:r=>handleIdentityBinding(r,f.env)};
 if(owned){const insert=ownershipSQL(handoffs);insert._stmt.run(...insert._args());}
 f.fetch=request=>new URL(request.url).origin===HANDOFF_AUTH?oauth.fetch(request,f.env):customerAPI.fetch(request,f.env);
 f.start=async()=>{
  const q=new URLSearchParams({response_type:'code',client_id:'chatgpt-client',redirect_uri:redirect,resource,scope:'openid email axiom.execute',
   state:'S'.repeat(32),code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
  const r=await f.fetch(new Request(HANDOFF_AUTH+'/oauth/authorize?'+q));assert.equal(r.status,200,await r.clone().text());
  const html=await r.text(),href=/href="([^"]+)"/.exec(html)[1];
  return {id:new URL(href).searchParams.get('handoff'),href,oauthCookie:cookie(r,'__Host-axiom_oauth_flow'),html};
 };
 f.login=async h=>{
  const route=await f.fetch(new Request(h.href));assert.equal(route.status,303);const start=await f.fetch(new Request(route.headers.get('location')));
  assert.equal(start.status,303,await start.clone().text());f.authorize=new URL(start.headers.get('location'));
  const callback=new Request(ZITADEL_STAGING.redirect_uri+'?state='+f.authorize.searchParams.get('state')+'&code=synthetic-code',
   {headers:{cookie:cookie(start,'__Host-axiom_login')}});
  const r=await f.fetch(callback);assert.equal(r.status,303,await r.clone().text());assert.equal(r.headers.get('location'),h.href);
  return cookie(r,'__Host-axiom_customer');
 };
 f.consent=async(h,session)=>{
  const r=await f.fetch(new Request(h.href,{headers:{cookie:session}}));assert.equal(r.status,200,await r.clone().text());
  const html=await r.text();return {csrf:input(html,'csrf'),consentCookie:cookie(r,'__Host-axiom_oauth_consent'),html};
 };
 f.approve=async(h,session,c)=>f.fetch(new Request(h.href,{method:'POST',headers:{cookie:session+'; '+c.consentCookie,origin:HANDOFF_PORTAL,'content-type':'application/x-www-form-urlencoded'},
  body:new URLSearchParams({csrf:c.csrf,consent:'approve'})}));
 f.complete=(h,html,patch={})=>f.fetch(new Request(HANDOFF_AUTH+'/oauth/authorize',{method:'POST',headers:{cookie:h.oauthCookie,origin:HANDOFF_PORTAL,'content-type':'application/x-www-form-urlencoded',...patch},
  body:new URLSearchParams({auth_mode:'verified_handoff',flow_id:input(html,'flow_id'),handoff_id:input(html,'handoff_id'),handoff_grant:input(html,'handoff_grant')})}));
 f.exchange=code=>f.fetch(new Request(HANDOFF_AUTH+'/oauth/token',{method:'POST',body:new URLSearchParams({grant_type:'authorization_code',client_id:'chatgpt-client',resource,
  code,redirect_uri:redirect,code_verifier:verifier})}));
 f.approved=async()=>{const h=await f.start(),session=await f.login(h),c=await f.consent(h,session),r=await f.approve(h,session,c);
  assert.equal(r.status,200,await r.clone().text());return {h,session,c,html:await r.text()};};
 t?.after(()=>{seed.close();idp.close();handoffs.close();});return f;
}
