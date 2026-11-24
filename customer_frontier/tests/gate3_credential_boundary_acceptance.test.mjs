// Synthetic provider contracts only. Hosted evidence is captured separately.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runCredentialBoundaryAcceptance} from '../qualification/gate3_credential_boundary_acceptance.mjs';
const A2='67469478aa9349fa0a57fe3a72da200a',SOURCE='93f395f5121954671f92fffa453d6b61';
const nonce='0123456789abcdef0123456789abcdef';
const env={AXIOM_D1_RECOVERY_CF_API_TOKEN:'R'.repeat(40),MUSITU_CLOUDFLARE_ADMIN_TOKEN:'A'.repeat(40),CLOUDFLARE_API_TOKEN:'S'.repeat(40),CLOUDFLARE_GLOBAL_API_KEY:'K'.repeat(40),CLOUDFLARE_EMAIL:'stale@private.invalid'};
const saved=JSON.parse(readFileSync(new URL('../evidence/gate3_provider_preflight_20261124_not_release/ACTUAL_OWNER_EDIT_REGISTRY_READBACK_141230Z.json',import.meta.url),'utf8'));
const cf=(result,status=200)=>Response.json({success:true,errors:[],result},{status});
const refused=status=>Response.json({success:false,errors:[{code:10000,message:'PRIVATE_PROVIDER_MESSAGE'}],result:null},{status});
function fixture(options={}){
 const requests=[],buckets=new Set();let preflights=0;
 const preflightFn=async()=>{preflights++;const r=structuredClone(saved);if(options.inactive&&preflights===1)r.credentials[0].verification.token_status='disabled';
  if(options.changedAfter&&preflights>1)r.credentials[0].verification.token_identifier_sha256='0'.repeat(64);return r;};
 const fetchImpl=async req=>{
  const u=new URL(req.url),path=u.pathname.replace('/client/v4',''),method=req.method;requests.push(req);
  assert.equal(u.origin,'https://api.cloudflare.com');assert.equal(req.redirect,'manual');assert.equal(req.headers.has('cookie'),false);
  const auth=req.headers.get('authorization');
  if(path==='/user'){
   if(auth==='Bearer '+env.MUSITU_CLOUDFLARE_ADMIN_TOKEN)return cf({id:'b'.repeat(32),email:'owner@private.invalid'});
   if(options.globalActive&&req.headers.get('x-auth-email')==='owner@private.invalid')return cf({id:'b'.repeat(32),email:'owner@private.invalid'});
   return refused(403);
  }
  if(path.startsWith('/memberships'))return Response.json({success:true,errors:[],result:[{account:{id:A2,name:'PRIVATE_ACCOUNT'},status:'accepted',roles:['Account Administrator']}],result_info:{page:1,count:1,per_page:50,total_count:1}});
  if(path.endsWith('/subdomain/edge-preview'))return options.noTargetSession&&path.includes(A2)?refused(403):cf({token:'PRIVATE_PREVIEW_SESSION_TOKEN'});
  if(path.endsWith('/edge-preview')&&method==='POST'){
   const form=await req.clone().formData(),metadata=JSON.parse(await form.get('metadata').text());
   assert.deepEqual(metadata.bindings,[]);assert.equal(metadata.main_module,'worker.mjs');
   assert.match(await form.get('worker.mjs').text(),/status:404/);
   if(path.includes(SOURCE))return options.previewControlFail?refused(400):cf({preview_token:'PRIVATE_PREVIEW_RESULT_TOKEN'});
   return options.workerUnexpected?cf({preview_token:'PRIVATE_UNEXPECTED_PREVIEW'}):refused(options.denialStatus||403);
  }
  if(/\/r2\/buckets$/.test(path)&&method==='POST'){
   const body=await req.clone().json();assert.deepEqual(Object.keys(body),['name']);assert.match(body.name,/^axiom-g3-(ctrl|deny)-[a-f0-9]{32}(?:-[0-2])?$/);
   if(path.includes(SOURCE)){if(options.r2ControlFail)return refused(400);buckets.add(body.name);return cf({name:body.name});}
   if(options.r2Unexpected){buckets.add(body.name);return cf({name:body.name});}
   return refused(options.denialStatus||403);
  }
  const m=path.match(/\/r2\/buckets\/([a-z0-9-]+)(\/domains\/managed)?$/);
  if(m){const name=m[1];assert.match(name,/^axiom-g3-(ctrl|deny)-[a-f0-9]{32}(?:-[0-2])?$/);
   if(m[2])return cf({enabled:false});
   if(method==='DELETE'){if(options.cleanupFail)return refused(403);assert(buckets.has(name));buckets.delete(name);return cf({});}
   return buckets.has(name)?cf({name}):refused(404);
  }
  throw Error('UNEXPECTED_NETWORK_OPERATION '+path);
 };return {requests,buckets,fetchImpl,preflightFn};
}
const run=(f,extra={})=>runCredentialBoundaryAcceptance({env,nonce,fetchImpl:f.fetchImpl,preflightFn:f.preflightFn,...extra});
function holds(r){for(const k of ['global_key_custody_verified','alternative_credential_inventory_exhaustive','independent_operator_custody_qualified','gate3_closed','hosted_genesis_qualified','hosted_destructive_recovery_qualified'])assert.equal(r[k],false,k);assert.equal(r.B27,'FAILED_IN_SYNTHETIC_ATTACK');assert.equal(r.release_status,'NOT_RELEASE');}
test('valid source controls and six real-endpoint authorization denials qualify only the bounded checks',async()=>{
 const f=fixture(),r=await run(f);assert.equal(r.bounded_write_denial_tests_passed,true);assert.equal(r.subjects.length,3);
 assert(r.subjects.every(s=>s.worker_preview.denial_verified&&s.r2_bucket_create.denial_verified));assert.equal(f.buckets.size,0);holds(r);
});
test('global key is checked against the provider-verified principal without exporting email or credential values',async()=>{
 const f=fixture({globalActive:true}),r=await run(f);assert.equal(r.global_custody.global_key_a2_administrator_membership_observed,true);
 const out=JSON.stringify(r);for(const privateValue of [...Object.values(env),'owner@private.invalid','PRIVATE_PREVIEW_SESSION_TOKEN','PRIVATE_PREVIEW_RESULT_TOKEN','PRIVATE_PROVIDER_MESSAGE','PRIVATE_ACCOUNT'])assert(!out.includes(privateValue));holds(r);
});
test('inactive or mismatched subjects cannot trigger canary mutation attempts',async()=>{
 const f=fixture({inactive:true}),r=await run(f);assert.equal(r.bounded_write_denial_tests_passed,false);assert(!f.requests.some(x=>x.method!=='GET'));holds(r);
});
test('401,404,429,500 responses cannot be promoted to effective authorization denial',async()=>{
 for(const status of [401,404,429,500]){const f=fixture({denialStatus:status}),r=await run(f);assert.equal(r.bounded_write_denial_tests_passed,false);holds(r);}
});
test('failed positive controls leave the affected endpoint tests unqualified',async()=>{
 const f=fixture({previewControlFail:true,r2ControlFail:true}),r=await run(f);assert.equal(r.bounded_write_denial_tests_passed,false);
 assert(!f.requests.some(x=>x.method==='POST'&&x.url.includes(A2)));holds(r);
});
test('missing Authority2 upload session prevents a malformed Worker request from being called a denial',async()=>{
 const f=fixture({noTargetSession:true}),r=await run(f);assert.equal(r.bounded_write_denial_tests_passed,false);assert(!f.requests.some(x=>x.method==='POST'&&x.url.includes(A2)&&x.url.endsWith('/edge-preview')));holds(r);
});
test('an unexpected private bucket creation fails denial and cleans only its acknowledged new empty name',async()=>{
 const f=fixture({r2Unexpected:true}),r=await run(f);assert.equal(r.bounded_write_denial_tests_passed,false);assert.equal(f.buckets.size,0);assert.equal(r.unexpected_write_observed,true);holds(r);
});
test('failed cleanup is retained as a blocker with its exact disposable name',async()=>{
 const f=fixture({cleanupFail:true}),r=await run(f);assert.equal(r.bounded_write_denial_tests_passed,false);assert(r.possible_orphan_bucket_names.length>0);holds(r);
});
test('provider identifier drift after denied calls invalidates the acceptance',async()=>{
 const f=fixture({changedAfter:true}),r=await run(f);assert.equal(r.bounded_write_denial_tests_passed,false);assert.equal(r.subject_identity_and_policy_stable,false);holds(r);
});
test('bad nonce values are refused before any network request',async()=>{
 for(const bad of ['../retained','musitu-axiom-b27-highwater-a2','A'.repeat(32),'0'.repeat(33)]){const f=fixture();await assert.rejects(run(f,{nonce:bad}));assert.equal(f.requests.length,0);}
});
test('untrusted transport errors never leak secrets and never become denied writes',async()=>{
 const f=fixture(),r=await run(f,{timeoutMs:20,fetchImpl:async()=>{throw Error(env.CLOUDFLARE_API_TOKEN);}});assert(!JSON.stringify(r).includes(env.CLOUDFLARE_API_TOKEN));assert.equal(r.bounded_write_denial_tests_passed,false);holds(r);
});
test('CLI refuses outside its exact isolated push context before provider access',()=>{
 const path=fileURLToPath(new URL('../qualification/gate3_credential_boundary_acceptance.mjs',import.meta.url));
 const r=spawnSync(process.execPath,[path],{encoding:'utf8',env:{...process.env,GITHUB_ACTIONS:'false'}});assert.equal(r.status,2);assert.match(r.stderr,/BOUNDARY_CONTEXT_REQUIRED_HOLD/);
});
test('all mutation requests remain outside retained buckets, authority scripts, D1, tokens and routing settings',async()=>{
 const f=fixture();await run(f);
 for(const req of f.requests.filter(x=>x.method!=='GET')){
  assert(!/highwater|\/d1\/|\/tokens|\/lock|\/routes|\/deployments|\/versions|\/settings|\/secrets/.test(req.url));
  assert(['POST','DELETE'].includes(req.method));
 }
});
test('redirects cannot forward credentials and cannot supply a successful control or denial',async()=>{
 const f=fixture(),r=await run(f,{fetchImpl:async req=>{assert.equal(req.redirect,'manual');assert.equal(new URL(req.url).origin,'https://api.cloudflare.com');return new Response(null,{status:302,headers:{location:'https://not-allowed.invalid/'+env.CLOUDFLARE_API_TOKEN}});}});
 assert.equal(r.bounded_write_denial_tests_passed,false);assert(!JSON.stringify(r).includes('not-allowed.invalid'));holds(r);
});
test('hanging fetches have a real deadline and cannot become qualified failures',async()=>{
 const f=fixture(),start=Date.now(),r=await run(f,{timeoutMs:20,fetchImpl:()=>new Promise(()=>{})});assert(Date.now()-start<1500);assert.equal(r.bounded_write_denial_tests_passed,false);holds(r);
});
test('duplicate JSON and reflected credentials in a purported403 body cannot qualify denial',async()=>{
 const f=fixture(),r=await run(f,{fetchImpl:async req=>{
  if(req.method==='POST'&&req.url.includes(A2))return new Response('{"success":false,"success":true,"errors":[{"code":10000,"message":"'+env.CLOUDFLARE_API_TOKEN+'"}]}',{status:403});
  return f.fetchImpl(req);
 }});assert.equal(r.bounded_write_denial_tests_passed,false);assert(!JSON.stringify(r).includes(env.CLOUDFLARE_API_TOKEN));holds(r);
});
test('global-key membership absence is not inferred from an incomplete provider page',async()=>{
 const f=fixture({globalActive:true}),r=await run(f,{fetchImpl:async req=>req.url.includes('/memberships?')?cf([]):f.fetchImpl(req)});
 const key=r.global_custody.keys.find(k=>k.reference==='CLOUDFLARE_GLOBAL_API_KEY');assert.equal(key.memberships.complete,false);assert.equal(key.memberships.a2_membership_observed,null);holds(r);
});
