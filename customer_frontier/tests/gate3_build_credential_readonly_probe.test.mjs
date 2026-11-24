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
function policyResponse({resource='com.cloudflare.api.account.'+A2,name='Workers Scripts Read',extra={}}={}){
 return cf({id,name:'PRIVATE_TOKEN_NAME',status:'active',policies:[{effect:'allow',resources:{[resource]:'*'},permission_groups:[{id:'d'.repeat(32),name}]}],...extra});
}
test('self-policy GET projects A2 resource/read classifications without exporting raw policy identifiers or token names',async()=>{
 const f=fake(),r=await probeBuildCredentials({env:tokenEnv,fetchImpl:async req=>/\/tokens\/[a-f0-9]{32}$/.test(new URL(req.url).pathname)?policyResponse():f.fetchImpl(req)});
 const p=r.credentials.find(c=>c.reference==='CLOUDFLARE_API_TOKEN').verification.policy_metadata;
 assert.equal(p.policy_metadata_observed,true);assert.equal(p.policies[0].explicit_a2_resource,true);assert.equal(p.policies[0].read_named_groups,1);assert.equal(p.potential_a2_write_allow_policy_observed,false);
 assert(!JSON.stringify(r).includes('PRIVATE_TOKEN_NAME'));assert(!JSON.stringify(r).includes('d'.repeat(32)));holds(r);
});
test('an explicit write allow in policy metadata is observed without claiming effective-policy or custody acceptance',async()=>{
 const f=fake(),r=await probeBuildCredentials({env:tokenEnv,fetchImpl:async req=>/\/tokens\/[a-f0-9]{32}$/.test(new URL(req.url).pathname)?policyResponse({name:'Workers Scripts Write'}):f.fetchImpl(req)});
 const p=r.credentials.find(c=>c.reference==='CLOUDFLARE_API_TOKEN').verification.policy_metadata;
 assert.equal(p.potential_a2_write_allow_policy_observed,true);assert.deepEqual(p.policies[0].write_capability_codes,['WORKER_SOURCE_WRITE']);assert.equal(p.effective_policy_resolution_verified,false);holds(r);
});
test('unclassified resource scope stays explicit rather than being assumed to exclude Authority2',async()=>{
 const f=fake(),r=await probeBuildCredentials({env:tokenEnv,fetchImpl:async req=>/\/tokens\/[a-f0-9]{32}$/.test(new URL(req.url).pathname)?policyResponse({resource:'com.cloudflare.api.account.zone.*'}):f.fetchImpl(req)});
 const p=r.credentials.find(c=>c.reference==='CLOUDFLARE_API_TOKEN').verification.policy_metadata;assert.equal(p.policies[0].unclassified_resource_scope,true);holds(r);
});
test('denied or malformed self-policy metadata does not become a read-only permission certificate',async()=>{
 for(const response of [new Response(null,{status:403}),policyResponse({extra:{id:'0'.repeat(32)}}),policyResponse({extra:{value:token}})]){
  const f=fake(),r=await probeBuildCredentials({env:tokenEnv,fetchImpl:async req=>/\/tokens\/[a-f0-9]{32}$/.test(new URL(req.url).pathname)?response.clone():f.fetchImpl(req)});
  const p=r.credentials.find(c=>c.reference==='CLOUDFLARE_API_TOKEN').verification.policy_metadata;assert.equal(p.policy_metadata_observed,false);assert(!JSON.stringify(r).includes(token));holds(r);
 }
});
test('account-source token details use the source account endpoint rather than a guessed user-token policy',async()=>{
 const f=fake(),urls=[];const r=await probeBuildCredentials({env:tokenEnv,fetchImpl:async req=>{
  const u=new URL(req.url);urls.push(u.pathname);
  if(u.pathname.endsWith('/tokens/verify')&&!u.pathname.includes('/93f395f5121954671f92fffa453d6b61/'))return new Response(null,{status:401});
  if(/\/tokens\/[a-f0-9]{32}$/.test(u.pathname))return policyResponse({resource:'com.cloudflare.api.account.93f395f5121954671f92fffa453d6b61'});
  return f.fetchImpl(req);
 }});
 assert(urls.includes('/client/v4/accounts/93f395f5121954671f92fffa453d6b61/tokens/'+id));
 assert.equal(r.credentials.find(c=>c.reference==='CLOUDFLARE_API_TOKEN').verification.policy_metadata.policies[0].explicit_a2_resource,false);holds(r);
});
test('optional missing permission-group names are unclassified, never inferred to be read-only',async()=>{
 const f=fake(),r=await probeBuildCredentials({env:tokenEnv,fetchImpl:async req=>/\/tokens\/[a-f0-9]{32}$/.test(new URL(req.url).pathname)?policyResponse({extra:{policies:[{effect:'allow',resources:{['com.cloudflare.api.account.'+A2]:'*'},permission_groups:[{id:'d'.repeat(32)}]}]}}):f.fetchImpl(req)});
 const p=r.credentials.find(c=>c.reference==='CLOUDFLARE_API_TOKEN').verification.policy_metadata;
 assert.equal(p.policy_metadata_observed,true);assert.equal(p.policies[0].unclassified_groups,1);assert.equal(p.policies[0].read_named_groups,0);holds(r);
});
test('policy projection failures export only fixed reason enums and no response field content',async()=>{
 for(const [extra,reason] of [[{value:token},'UNEXPECTED_VALUE_FIELD'],[{policies:undefined},'POLICY_ARRAY_UNAVAILABLE'],[{policies:[]},'POLICY_COUNT_UNSUPPORTED']]){
  const f=fake(),r=await probeBuildCredentials({env:tokenEnv,fetchImpl:async req=>/\/tokens\/[a-f0-9]{32}$/.test(new URL(req.url).pathname)?policyResponse({extra}):f.fetchImpl(req)});
  const p=r.credentials.find(c=>c.reference==='CLOUDFLARE_API_TOKEN').verification.policy_metadata;
  assert.equal(p.projection_hold_reason,reason);assert(!JSON.stringify(r).includes(token));holds(r);
 }
});
test('empty provider permission-group arrays remain visible and do not certify a read-only grant',async()=>{
 const f=fake(),r=await probeBuildCredentials({env:tokenEnv,fetchImpl:async req=>/\/tokens\/[a-f0-9]{32}$/.test(new URL(req.url).pathname)?policyResponse({extra:{policies:[{effect:'deny',resources:{['com.cloudflare.api.account.'+A2]:'*'},permission_groups:[]}]}}):f.fetchImpl(req)});
 const p=r.credentials.find(c=>c.reference==='CLOUDFLARE_API_TOKEN').verification.policy_metadata;assert.equal(p.policy_metadata_observed,true);
 assert.equal(p.policies[0].empty_permission_groups,true);assert.equal(p.effective_policy_resolution_verified,false);holds(r);
});
test('a missing permission-group array emits its fixed shape without guessing permissions',async()=>{
 const f=fake(),r=await probeBuildCredentials({env:tokenEnv,fetchImpl:async req=>/\/tokens\/[a-f0-9]{32}$/.test(new URL(req.url).pathname)?policyResponse({extra:{policies:[{effect:'allow',resources:{['com.cloudflare.api.account.'+A2]:'*'}}]}}):f.fetchImpl(req)});
 const p=r.credentials.find(c=>c.reference==='CLOUDFLARE_API_TOKEN').verification.policy_metadata;assert.equal(p.permission_groups_shape,'MISSING');assert.equal(p.policy_metadata_observed,false);holds(r);
});
test('an existing build metadata token may read only the exact previously provider-verified recovery token policy',async()=>{
 const recoveryId='b'.repeat(32),adminId='c'.repeat(32),recoveryToken='R'.repeat(40),adminToken='A'.repeat(40),calls=[],f=fake();
 const r=await probeBuildCredentials({env:{AXIOM_D1_RECOVERY_CF_API_TOKEN:recoveryToken,MUSITU_CLOUDFLARE_ADMIN_TOKEN:adminToken},fetchImpl:async req=>{
  const path=new URL(req.url).pathname,auth=req.headers.get('authorization');calls.push({path,auth});
  if(path.endsWith('/tokens/verify'))return cf({id:auth==='Bearer '+recoveryToken?recoveryId:adminId,status:'active'});
  if(path.endsWith('/tokens/'+recoveryId)&&auth==='Bearer '+recoveryToken)return new Response(null,{status:403});
  if(/\/tokens\/[a-f0-9]{32}$/.test(path))return policyResponse({extra:{id:path.endsWith(recoveryId)?recoveryId:adminId}});
  return f.fetchImpl(req);
 }});
 const p=r.credentials.find(c=>c.reference==='AXIOM_D1_RECOVERY_CF_API_TOKEN').verification.existing_build_metadata_reader;
 assert.equal(p.reference,'MUSITU_CLOUDFLARE_ADMIN_TOKEN');assert.equal(p.policy_metadata.policy_metadata_observed,true);
 assert.equal(calls.filter(x=>x.path.endsWith('/tokens/'+recoveryId)&&x.auth==='Bearer '+adminToken).length,1);
 assert(!JSON.stringify(r).includes(recoveryId));assert(!JSON.stringify(r).includes(adminToken));holds(r);
});
test('large provider permission groups remain bounded and project fixed capability codes without dumping names',async()=>{
 const f=fake(),groups=Array.from({length:201},()=>({id:'d'.repeat(32),name:'UNRECOGNIZED_PROVIDER_CONTENT Write'}));
 const r=await probeBuildCredentials({env:tokenEnv,fetchImpl:async req=>/\/tokens\/[a-f0-9]{32}$/.test(new URL(req.url).pathname)?policyResponse({extra:{policies:[{effect:'allow',resources:{'com.cloudflare.api.account.*':'*'},permission_groups:groups}]}}):f.fetchImpl(req)});
 const p=r.credentials.find(c=>c.reference==='CLOUDFLARE_API_TOKEN').verification.policy_metadata;assert.equal(p.policy_metadata_observed,true);assert.equal(p.policies[0].permission_group_count,201);
 assert.deepEqual(p.policies[0].write_capability_codes,['OTHER_WRITE_NAMED']);assert(!JSON.stringify(r).includes('UNRECOGNIZED_PROVIDER_CONTENT'));holds(r);
});
test('documented read/report labels preserve original unclassified counters without becoming custody proof',async()=>{
 const names=['Account Security Center Insights','Magic Firewall Packet Captures - Read PCAPs API','Zero Trust Report'],f=fake();
 const r=await probeBuildCredentials({env:tokenEnv,fetchImpl:async req=>/\/tokens\/[a-f0-9]{32}$/.test(new URL(req.url).pathname)?policyResponse({extra:{policies:[{effect:'allow',resources:{'com.cloudflare.api.account.*':'*'},permission_groups:names.map(name=>({id:'d'.repeat(32),name}))}]}}):f.fetchImpl(req)});
 const p=r.credentials.find(c=>c.reference==='CLOUDFLARE_API_TOKEN').verification.policy_metadata,row=p.policies[0];
 assert.equal(row.unclassified_groups,3);assert.equal(row.documented_nonstandard_read_groups,2);assert.equal(row.documented_reporting_groups,1);assert.equal(row.unmapped_nonstandard_groups,0);
 assert.deepEqual(row.nonstandard_capability_codes,['ACCOUNT_SECURITY_INSIGHTS_READ','PCAP_READ','ZERO_TRUST_REPORT']);assert.equal(p.effective_policy_resolution_verified,false);holds(r);
});
test('non-Read suffixes which revoke, purge, execute or write cannot be relabeled as read-only',async()=>{
 for(const name of ['Access: Apps Revoke','Cache Purge','AI Gateway Run','Magic Firewall Packet Captures - Write PCAPs API']){
  const f=fake(),r=await probeBuildCredentials({env:tokenEnv,fetchImpl:async req=>/\/tokens\/[a-f0-9]{32}$/.test(new URL(req.url).pathname)?policyResponse({name}):f.fetchImpl(req)});
  const p=r.credentials.find(c=>c.reference==='CLOUDFLARE_API_TOKEN').verification.policy_metadata;
  assert.equal(p.policies[0].documented_non_read_groups,1);assert.equal(p.potential_a2_documented_non_read_allow_policy_observed,true);holds(r);
 }
});
test('unknown names and omitted names remain unmapped without reflected content in the public result',async()=>{
 for(const name of ['PRIVATE_UNRECOGNIZED_PERMISSION',undefined]){
  const f=fake(),r=await probeBuildCredentials({env:tokenEnv,fetchImpl:async req=>/\/tokens\/[a-f0-9]{32}$/.test(new URL(req.url).pathname)?policyResponse({extra:{policies:[{effect:'allow',resources:{'com.cloudflare.api.account.*':'*'},permission_groups:[{id:'d'.repeat(32),...(name?{name}:{})}]}]}}):f.fetchImpl(req)});
  const row=r.credentials.find(c=>c.reference==='CLOUDFLARE_API_TOKEN').verification.policy_metadata.policies[0];
  assert.equal(row.unmapped_nonstandard_groups,1);assert.equal(row.documented_nonstandard_read_groups,0);assert(!JSON.stringify(r).includes('PRIVATE_UNRECOGNIZED_PERMISSION'));holds(r);
 }
});
test('nonstandard names are exported only when matched by public registry ID and name',async()=>{
 const name='Public Registry Fixture',f=fake(),groupId='d'.repeat(32);
 for(const match of [true,false]){
  const r=await probeBuildCredentials({env:{MUSITU_CLOUDFLARE_ADMIN_TOKEN:token},fetchImpl:async req=>{
   const path=new URL(req.url).pathname;if(path.endsWith('/tokens/permission_groups'))return cf([{id:match?groupId:'e'.repeat(32),name}]);
   if(/\/tokens\/[a-f0-9]{32}$/.test(path))return policyResponse({name});return f.fetchImpl(req);
  }});
  const row=r.credentials.find(c=>c.reference==='MUSITU_CLOUDFLARE_ADMIN_TOKEN').verification.policy_metadata.policies[0];
  assert.deepEqual(row.provider_registered_nonstandard_permission_names,match?[name]:[]);assert.equal(row.registry_unresolved_nonstandard_groups,match?0:1);
  assert.equal(row.unclassified_groups,1);holds(r);
 }
});
test('a registry name containing protected authentication material is not exported',async()=>{
 const f=fake(),r=await probeBuildCredentials({env:{MUSITU_CLOUDFLARE_ADMIN_TOKEN:token},fetchImpl:async req=>{
  const path=new URL(req.url).pathname;if(path.endsWith('/tokens/permission_groups'))return cf([{id:'d'.repeat(32),name:'Reflected '+token}]);
  if(/\/tokens\/[a-f0-9]{32}$/.test(path))return policyResponse({name:'Reflected '+token});return f.fetchImpl(req);
 }});
 assert.equal(r.public_permission_registry.public_groups_observed,0);assert(!JSON.stringify(r).includes(token));holds(r);
});
test('duplicate public registry identifiers and mismatched names remain unresolved',async()=>{
 const f=fake();for(const entries of [[{id:'d'.repeat(32),name:'First'},{id:'d'.repeat(32),name:'Second'}],[{id:'d'.repeat(32),name:'Different public name'}]]){
  const r=await probeBuildCredentials({env:{MUSITU_CLOUDFLARE_ADMIN_TOKEN:token},fetchImpl:async req=>{
   const path=new URL(req.url).pathname;if(path.endsWith('/tokens/permission_groups'))return cf(entries);
   if(/\/tokens\/[a-f0-9]{32}$/.test(path))return policyResponse({name:'Private unregistered metadata'});return f.fetchImpl(req);
  }});
  const row=r.credentials.find(c=>c.reference==='MUSITU_CLOUDFLARE_ADMIN_TOKEN').verification.policy_metadata.policies[0];
  assert.deepEqual(row.provider_registered_nonstandard_permission_names,[]);assert.equal(row.registry_unresolved_nonstandard_groups,1);assert(!JSON.stringify(r).includes('Private unregistered metadata'));holds(r);
 }
});
