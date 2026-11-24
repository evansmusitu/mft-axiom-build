// Offline only; synthetic credentials and provider fixtures, never real secrets.
import test from 'node:test';
import assert from 'node:assert/strict';
import {probeBuildCredentials} from '../qualification/gate3_build_credential_readonly_probe.mjs';
test('missing build credentials are unknown, not proof of removal or custody separation',async()=>{
 let calls=0;const r=await probeBuildCredentials({env:{},fetchImpl:()=>{calls++;throw Error('network_not_expected');}});
 assert.equal(calls,0);assert.equal(r.gate3_closed,false);assert.equal(r.build_credential_restrictions_verified,false);
 assert(r.credentials.every(x=>x.status==='NOT_AVAILABLE_IN_THIS_WORKFLOW_CONTEXT'));
});
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {A2} from '../qualification/gate3_build_credential_readonly_probe.mjs';
const key='K'.repeat(40),token='T'.repeat(40),email='synthetic@offline.test',id='a'.repeat(32);
const cf=result=>Response.json({success:true,errors:[],result});
const globalEnv={CLOUDFLARE_GLOBAL_API_KEY:key,CLOUDFLARE_EMAIL:email};
const tokenEnv={CLOUDFLARE_API_TOKEN:token};
function fake({membership=[],total=membership.length,status=200}={}){
 const calls=[];const fetchImpl=async req=>{
  calls.push(req);const u=new URL(req.url);
  assert.equal(u.origin,'https://api.cloudflare.com');assert.equal(req.method,'GET');assert.equal(req.redirect,'manual');assert.equal(req.body,null);assert.equal(req.headers.has('cookie'),false);
  if(status!==200)return new Response('untrusted token='+key,{status});
  if(u.pathname==='/client/v4/user')return cf({id:'b'.repeat(32),email:'private@never-output.test'});
  if(u.pathname==='/client/v4/memberships')return Response.json({success:true,errors:[],result:membership,result_info:{page:Number(u.searchParams.get('page')),count:membership.length,per_page:50,total_count:total}});
  if(u.pathname.endsWith('/tokens/verify'))return cf({id,status:'active',value:token});
  if(u.pathname.endsWith('/settings'))return cf({bindings:[{name:'HW_SIGNING_JWK',type:'secret_text',value:'PRIVATE_KEY_MUST_NOT_LEAK'}]});
  if(u.pathname.endsWith('/lock'))return cf({rules:[{enabled:true,prefix:'b27/',condition:{type:'Indefinite'},id:'private-rule-id'}]});
  throw Error('UNEXPECTED_ENDPOINT');
 };return {calls,fetchImpl};
}
const member=(account=A2,extra={})=>({account:{id:account,name:'PRIVATE_ACCOUNT_NAME'},status:'accepted',roles:['Account Administrator'],permissions:{organization:{write:true}},...extra});
function holds(r){for(const k of ['build_credential_inventory_exhaustive','build_credential_restrictions_verified','effective_write_denial_verified','independent_admin_separation_verified',
 'hosted_genesis_qualified','hosted_retirement_qualified','hosted_destructive_recovery_qualified','gate3_closed'])assert.equal(r[k],false,k);assert.equal(r.provider_write_requests,0);assert.equal(r.release_status,'NOT_RELEASE');}
test('global key with A2 administrator membership is an observed counterexample, never a custody pass',async()=>{
 const f=fake({membership:[member()]}),r=await probeBuildCredentials({env:globalEnv,fetchImpl:f.fetchImpl});
 assert.equal(r.build_global_key_a2_administrative_membership_observed,true);holds(r);
 const c=r.credentials.find(c=>c.type==='GLOBAL_KEY'&&c.reference==='CLOUDFLARE_GLOBAL_API_KEY');assert.equal(c.memberships.complete,true);assert.equal(c.memberships.a2_administrator_role_observed,true);
});
test('token identifier digest is typed and no bearer, email, private binding or unrelated account name is exported',async()=>{
 const f=fake({membership:[member()]}),r=await probeBuildCredentials({env:{...globalEnv,...tokenEnv},fetchImpl:f.fetchImpl});
 const c=r.credentials.find(c=>c.reference==='CLOUDFLARE_API_TOKEN');assert.equal(c.verification.token_identifier_sha256,createHash('sha256').update('cloudflare-token-id\n'+id).digest('hex'));
 const text=JSON.stringify(r);for(const secret of [key,token,email,id,'private@never-output.test','PRIVATE_KEY_MUST_NOT_LEAK','PRIVATE_ACCOUNT_NAME','private-rule-id'])assert(!text.includes(secret));holds(r);
});
test('complete membership readback without A2 does not prove exhaustive credential restriction',async()=>{
 const f=fake({membership:[member('c'.repeat(32))]}),r=await probeBuildCredentials({env:globalEnv,fetchImpl:f.fetchImpl});
 assert.equal(r.credentials.find(c=>c.reference==='CLOUDFLARE_GLOBAL_API_KEY').memberships.a2_accepted_membership_observed,false);holds(r);
});
test('unavailable pagination metadata cannot establish absence of membership',async()=>{
 const f=fake();const r=await probeBuildCredentials({env:globalEnv,fetchImpl:async req=>new URL(req.url).pathname.endsWith('/memberships')?cf([]):f.fetchImpl(req)});
 const c=r.credentials.find(c=>c.reference==='CLOUDFLARE_GLOBAL_API_KEY');assert.equal(c.memberships.complete,false);assert.equal(c.memberships.a2_accepted_membership_observed,null);holds(r);
});
test('membership on the second page is not missed',async()=>{
 const f=fake(),r=await probeBuildCredentials({env:globalEnv,fetchImpl:async req=>{
  const u=new URL(req.url);if(!u.pathname.endsWith('/memberships'))return f.fetchImpl(req);const page=Number(u.searchParams.get('page'));
  return Response.json({success:true,errors:[],result:[member(page===1?'c'.repeat(32):A2)],result_info:{page,count:1,per_page:1,total_count:2}});
 }});assert.equal(r.build_global_key_a2_administrative_membership_observed,true);holds(r);
});
test('repeated or excessive pages remain incomplete rather than certifying separation',async()=>{
 for(const total of [2,251]){const f=fake({membership:[member('c'.repeat(32))],total}),r=await probeBuildCredentials({env:globalEnv,fetchImpl:f.fetchImpl});
  const c=r.credentials.find(c=>c.reference==='CLOUDFLARE_GLOBAL_API_KEY');assert.equal(c.memberships.complete,false);holds(r);assert(f.calls.length<=8);}
});
test('denied read-only GET is not a successful write-denial test',async()=>{
 for(const status of [401,403,404,429,500]){const f=fake({status}),r=await probeBuildCredentials({env:tokenEnv,fetchImpl:f.fetchImpl});holds(r);assert(!JSON.stringify(r).includes(key));}
});
test('redirects are never followed and cannot expose credentials to another host',async()=>{
 const calls=[];const r=await probeBuildCredentials({env:tokenEnv,fetchImpl:async req=>{calls.push(req);return new Response(null,{status:302,headers:{location:'https://forbidden.invalid/?secret='+token}});}});
 assert(calls.every(r=>new URL(r.url).origin==='https://api.cloudflare.com'));assert(!JSON.stringify(r).includes('forbidden.invalid'));assert(!JSON.stringify(r).includes(token));holds(r);
});
test('transport errors containing authentication material are never printed or exported',async()=>{
 const r=await probeBuildCredentials({env:tokenEnv,fetchImpl:async()=>{throw Error('Authorization: Bearer '+token+' '+email);}});const raw=JSON.stringify(r);assert(!raw.includes(token));assert(!raw.includes(email));holds(r);
});
test('provider success=false, duplicate JSON keys and reflected messages cannot become metadata',async()=>{
 for(const text of [JSON.stringify({success:false,errors:[{message:token}],result:{id,status:'active'}}),'{"success":true,"errors":[],"result":{},"result":{"id":"'+id+'","status":"active"}}']){
  const r=await probeBuildCredentials({env:tokenEnv,fetchImpl:async()=>new Response(text)});assert(!JSON.stringify(r).includes(token));holds(r);
 }
});
test('oversized response streams are cancelled before parsing',async()=>{
 let cancelled=0;const r=await probeBuildCredentials({env:tokenEnv,fetchImpl:async()=>new Response(new ReadableStream({pull(c){c.enqueue(new Uint8Array(131073));},cancel(){cancelled++;}}))});
 assert.equal(cancelled,5);holds(r);
});
test('a fetcher ignoring AbortSignal is bounded by an actual deadline',async()=>{
 const before=Date.now(),r=await probeBuildCredentials({env:tokenEnv,timeoutMs:20,fetchImpl:()=>new Promise(()=>{})});assert(Date.now()-before<1000);holds(r);
});
test('a response stream that never finishes is bounded by the same deadline',async()=>{
 const before=Date.now(),r=await probeBuildCredentials({env:tokenEnv,timeoutMs:20,fetchImpl:async()=>new Response(new ReadableStream({start(){}}))});assert(Date.now()-before<1000);holds(r);
});
test('account-owned token verification uses the pinned account endpoint without broadening access',async()=>{
 const f=fake(),r=await probeBuildCredentials({env:tokenEnv,fetchImpl:async req=>new URL(req.url).pathname==='/client/v4/user/tokens/verify'?new Response(null,{status:403}):f.fetchImpl(req)});
 assert.equal(r.credentials.find(c=>c.reference==='CLOUDFLARE_API_TOKEN').verification.verification_scope,'account_a2');holds(r);
});
test('malformed local credential and missing companion email cannot issue requests',async()=>{
 let calls=0;const r=await probeBuildCredentials({env:{CLOUDFLARE_API_TOKEN:'bad\n'+token,CLOUDFLARE_GLOBAL_API_KEY:key},fetchImpl:()=>{calls++;throw Error('unexpected');}});assert.equal(calls,0);assert(!JSON.stringify(r).includes(token));holds(r);
});
test('global and token authentication are isolated per request',async()=>{
 const f=fake();await probeBuildCredentials({env:{...globalEnv,...tokenEnv},fetchImpl:f.fetchImpl});
 for(const req of f.calls){const bearer=req.headers.has('authorization'),global=req.headers.has('x-auth-key');assert.notEqual(bearer,global);assert.equal(req.headers.has('x-auth-email'),global);}
});
test('a server-reflected credential cannot be exported as an identifier digest',async()=>{
 const secret='c'.repeat(32);const r=await probeBuildCredentials({env:{CLOUDFLARE_API_TOKEN:secret},fetchImpl:async()=>cf({id:secret,status:'active'})});
 assert.equal(r.credentials.find(c=>c.reference==='CLOUDFLARE_API_TOKEN').verification.token_identifier_sha256,null);assert(!JSON.stringify(r).includes(secret));holds(r);
});
test('local CLI execution refuses before any provider request',()=>{
 const path=fileURLToPath(new URL('../qualification/gate3_build_credential_readonly_probe.mjs',import.meta.url));
 const r=spawnSync(process.execPath,[path],{encoding:'utf8',env:{...process.env,GITHUB_ACTIONS:'false',CLOUDFLARE_API_TOKEN:token}});assert.equal(r.status,2);assert.match(r.stderr,/BUILD_READONLY_CONTEXT_REQUIRED_HOLD/);assert(!r.stderr.includes(token));
});
test('probe workflow is branch-restricted, read-only and excludes signer/initializer/recovery capabilities',()=>{
 const source=readFileSync(new URL('../../.github/workflows/axiom-gate3-build-credential-get-observation-20261124.yml',import.meta.url),'utf8');
 assert.match(source,/permissions: \{contents: read\}/);assert.match(source,/github\.event_name == 'push'/);assert.match(source,/refs\/heads\/build\/axiom-gate3-provider-preflight-20261124/);
 assert(!/id-token:|contents: write|pull_request_target|HW_SIGNING|GENESIS_CONTROL|toJSON\(secrets\)/.test(source));
});
test('an identifier equal to another protected credential is also rejected',async()=>{
 const other='c'.repeat(32),r=await probeBuildCredentials({env:{...tokenEnv,AXIOM_D1_RECOVERY_CF_API_TOKEN:other},fetchImpl:async()=>cf({id:other,status:'active'})});
 for(const c of r.credentials.filter(c=>c.verification))assert.equal(c.verification.token_identifier_sha256,null);
 assert(!JSON.stringify(r).includes(other));holds(r);
});
