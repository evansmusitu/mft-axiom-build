import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {collectOwnerCustodyReadback} from '../qualification/gate3_owner_custody_readback.mjs';
const A2='67469478aa9349fa0a57fe3a72da200a',REPO='evansmusitu/mft-axiom-build',secret='OWNER_PRIVATE_CREDENTIAL_'.repeat(2),email='owner@private.invalid',userId='b'.repeat(32);
const now=Date.parse('2026-11-24T15:00:00Z'),challenge={schema:'musitu.axiom.gate3.owner-custody-challenge.v1',nonce:'1'.repeat(32),source_commit:'1'.repeat(40),repository:REPO,account_id:A2,issued_at_utc:new Date(now-1000).toISOString(),expires_at_utc:new Date(now-1000+172800000).toISOString()};
const cf=(result,info)=>Response.json({success:true,errors:[],result,...(info?{result_info:info}:{})});
const page=(rows,perPage)=>cf(rows,{page:1,count:rows.length,per_page:perPage,total_count:rows.length});
const credential={kind:'global_key',email,secret};
function fake(options={}){
 const requests=[],ghPaths=[];
 const fetchImpl=async req=>{
  requests.push(req);assert.equal(req.method,'GET');assert.equal(new URL(req.url).origin,'https://api.cloudflare.com');assert.equal(req.redirect,'manual');assert.equal(req.body,null);assert.equal(req.headers.has('cookie'),false);
  const path=new URL(req.url).pathname;
  if(path==='/client/v4/user')return cf({id:userId,email,two_factor_authentication_enabled:true,private_reflection:secret});
  if(path.endsWith('/tokens/verify'))return cf({id:options.buildCredential?'c'.repeat(32):'e'.repeat(32),status:'active'});
  if(path.endsWith('/memberships'))return page([{id:'a'.repeat(32),account:{id:A2,name:'PRIVATE_ACCOUNT'},status:'accepted',roles:['Account Administrator']}],50);
  if(path.endsWith('/members'))return options.incompletePage?cf([]):page([{id:'d'.repeat(32),user:{id:userId,email},status:'accepted',roles:[{name:'Account Administrator',permissions:{organization:{write:true}}}]}],50);
  if(path.endsWith('/tokens'))return page([{id:'e'.repeat(32),name:'PRIVATE_TOKEN_NAME',value:'MUST_NOT_COPY',status:'active',policies:[{effect:'allow',resources:{['com.cloudflare.api.account.'+A2]:'*'},permission_groups:[{name:'Workers Scripts Read'}]}]}],10);
  if(path.endsWith('/lock'))return cf({rules:[{enabled:true,prefix:'b27/',condition:{type:'Indefinite'}}]});
  if(path.endsWith('/settings'))return new Response(null,{status:404});
  throw Error(secret);
 };
 const ghGet=async path=>{
  ghPaths.push(path);
  if(options.noGitHub)return {state:'GITHUB_AUTH_OR_METADATA_PERMISSION_UNAVAILABLE'};
  if(path==='/repos/'+REPO)return {state:'GITHUB_METADATA_OBSERVED',data:{id:options.wrongRepo?1:1356837528,full_name:REPO,owner:{type:'User'}}};
  if(path.includes('/environments?'))return {state:'GITHUB_METADATA_OBSERVED',data:{total_count:1,environments:[{name:'OWNER_PRIVATE_ENV'}]}};
  const kind=path.includes('/variables?')?'variables':'secrets';
  return {state:'GITHUB_METADATA_OBSERVED',data:{total_count:1,[kind]:[{name:kind==='secrets'?'CLOUDFLARE_GLOBAL_API_KEY':'PRIVATE_METADATA_NAME',value:secret}]}};
 };return {fetchImpl,ghGet,requests,ghPaths};
}
const collect=(f,extra={})=>collectOwnerCustodyReadback({credential,fetchImpl:f.fetchImpl,ghGet:f.ghGet,now,challenge,...extra});
test('owner-local provider and GitHub metadata collection remains GET-only and is not automatic custody acceptance',async()=>{
 const f=fake(),{report,privateMetadata}=await collect(f);assert.equal(report.collection_complete,true);assert.equal(report.provider_mfa_enabled,true);assert.equal(report.operator_a2_accepted_administrator_observed,true);
 assert.equal(report.independent_custody_automatically_qualified,false);assert.equal(report.credential_content_inventory_exhaustive,false);assert.equal(report.gate3_closed,false);
 const output=JSON.stringify({report,privateMetadata});for(const v of [secret,email,'PRIVATE_ACCOUNT','MUST_NOT_COPY'])assert(!output.includes(v));
 assert(!JSON.stringify(report).includes('PRIVATE_TOKEN_NAME'));assert(privateMetadata.cloudflare_token_names.some(r=>r.name==='PRIVATE_TOKEN_NAME'));
 assert(!JSON.stringify(report).includes('OWNER_PRIVATE_ENV'));assert(!JSON.stringify(report).includes('PRIVATE_METADATA_NAME'));assert(JSON.stringify(privateMetadata).includes('PRIVATE_METADATA_NAME'));
});
test('missing GitHub metadata authorization stays incomplete rather than proving no alternatives exist',async()=>{
 const f=fake({noGitHub:true}),{report}=await collect(f);assert.equal(report.collection_complete,false);assert.equal(report.github.metadata_complete,false);assert.equal(report.credential_content_inventory_exhaustive,false);
});
test('repository identity drift stops private GitHub inventory reads',async()=>{
 const f=fake({wrongRepo:true}),{report}=await collect(f);assert.equal(report.github.repository_identity_verified,false);assert.deepEqual(f.ghPaths,['/repos/'+REPO]);assert.equal(report.collection_complete,false);
});
test('missing CF pagination metadata cannot certify an empty member inventory',async()=>{
 const f=fake({incompletePage:true}),{report}=await collect(f);assert.equal(report.account_members.complete,false);assert.equal(report.collection_complete,false);
});
test('expired owner inventory challenge is refused before provider access without repeating signer proof',async()=>{
 const f=fake();await assert.rejects(collect(f,{now:Date.parse(challenge.expires_at_utc)}));assert.equal(f.requests.length,0);
});
test('an API token whose verification is unavailable cannot be called an independent owner credential',async()=>{
 const f=fake(),{report}=await collect(f,{credential:{kind:'api_token',secret},fetchImpl:async req=>req.url.endsWith('/tokens/verify')?new Response(null,{status:403}):f.fetchImpl(req)});
 assert.equal(report.status,'OWNER_TOKEN_IDENTITY_UNQUALIFIED');assert.equal(report.collection_complete,false);assert(!JSON.stringify(report).includes(secret));
});
test('a valid owner API-token identifier uses a typed digest and never exports the identifier',async()=>{
 const f=fake(),{report}=await collect(f,{credential:{kind:'api_token',secret}});assert.equal(report.owner_token_identifier_sha256,createHash('sha256').update('cloudflare-token-id\n'+'e'.repeat(32)).digest('hex'));
 assert(!JSON.stringify(report).includes('e'.repeat(32)));assert.equal(report.gate3_closed,false);
});
test('credential-reflecting provider identifiers do not become credential hashes',async()=>{
 const ownSecret='f'.repeat(32),f=fake(),{report}=await collect(f,{credential:{kind:'global_key',email,secret:ownSecret},fetchImpl:async()=>cf({id:ownSecret,email})});
 assert.equal(report.provider_principal_identifier_sha256,null);assert.equal(report.collection_complete,false);assert(!JSON.stringify(report).includes(ownSecret));
});
test('CLI inspection requires no credentials and actual collection refuses outside owner Windows context',()=>{
 const path=fileURLToPath(new URL('../qualification/gate3_owner_custody_readback.mjs',import.meta.url));
 const good=spawnSync(process.execPath,[path,'--inspect'],{encoding:'utf8'});assert.equal(good.status,0);assert.equal(JSON.parse(good.stdout).provider_requests,0);
 const bad=spawnSync(process.execPath,[path,'ROOT','NONE','owner-local-v1'],{encoding:'utf8',env:{...process.env,GITHUB_ACTIONS:'true'}});assert.equal(bad.status,2);assert.match(bad.stderr,/OWNER_WINDOWS_LOCAL_CONTEXT_REQUIRED_HOLD/);
});
test('a bounded50-row token request collects12 tokens without an unnecessary second page',async()=>{
 const f=fake(),seen=[];
 const {report}=await collect(f,{fetchImpl:async req=>{
  const u=new URL(req.url);if(u.pathname==='/client/v4/user/tokens'){
   seen.push(u);assert.equal(u.searchParams.get('per_page'),'50');
   return page(Array.from({length:12},(_,i)=>({id:(i+1).toString(16).padStart(32,'0'),status:'active',policies:[]})),50);
  }return f.fetchImpl(req);
 }});
 assert.equal(seen.length,1);assert.equal(report.user_tokens.rows.length,12);assert.equal(report.user_tokens.complete,true);assert.equal(report.collection_complete,true);
 assert.equal(report.independent_custody_automatically_qualified,false);
});
test('pagination failure diagnostics distinguish duplicate identifiers and never certify a partial list',async()=>{
 const f=fake();let pages=0;
 const {report}=await collect(f,{fetchImpl:async req=>{
  if(new URL(req.url).pathname==='/client/v4/user/tokens'){
   pages++;const ids=pages===1?['1','2']:['3','2'];
   return cf(ids.map(i=>({id:i.padStart(32,'0'),status:'active',policies:[]})),{page:pages,count:2,per_page:2,total_count:4});
  }return f.fetchImpl(req);
 }});
 assert.equal(report.user_tokens.complete,false);assert.equal(report.user_tokens.completeness_reason,'DUPLICATE_OR_INVALID_IDENTIFIER');
 assert.equal(report.user_tokens.pages,2);assert.equal(report.collection_complete,false);assert.equal(report.credential_content_inventory_exhaustive,false);
 assert.equal(report.user_tokens.pagination_observations.length,2);
});
test('changing totals, oversized inventories and missing pagination stay explicitly unqualified',async()=>{
 for(const variant of ['changed_total','oversized','missing']){
  const f=fake();let pages=0;
  const {report}=await collect(f,{fetchImpl:async req=>{
   if(new URL(req.url).pathname==='/client/v4/user/tokens'){
    pages++;const rows=[{id:pages.toString(16).padStart(32,'0'),status:'active',policies:[]}];
    return variant==='missing'?cf(rows):cf(rows,{page:pages,count:1,per_page:1,total_count:variant==='oversized'?51:pages===1?2:3});
   }return f.fetchImpl(req);
  }});
  assert.equal(report.user_tokens.complete,false);assert.equal(report.collection_complete,false);
  assert.equal(report.user_tokens.completeness_reason,variant==='changed_total'?'PAGINATION_CHANGED':variant==='oversized'?'PAGINATION_INVALID_OR_OVER_BUDGET':'PAGINATION_INVALID_OR_OVER_BUDGET');
 }
});
test('a transient profile connection reset is retried once with both safe outcomes retained',async()=>{
 const f=fake();let calls=0;
 const {report}=await collect(f,{fetchImpl:async req=>{
  if(new URL(req.url).pathname==='/client/v4/user'&&++calls===1)throw Object.assign(Error(secret),{cause:{code:'ECONNRESET',private_host:secret}});
  return f.fetchImpl(req);
 }});
 assert.equal(calls,2);assert.equal(report.collection_complete,true);assert.equal(report.profile_read.attempts.length,2);
 assert.deepEqual(report.profile_read.attempts[0].diagnostic.network_error_codes,['ECONNRESET']);assert.equal(report.profile_read.attempts[1].http_status,200);assert(!JSON.stringify(report).includes(secret));
});
test('profile401 and403 refusals are not retried and retain counts and unattempted GitHub state',async()=>{
 for(const status of [401,403]){const f=fake();let calls=0;
  const {report}=await collect(f,{fetchImpl:async()=>{calls++;return new Response(null,{status});}});
  assert.equal(calls,1);assert.equal(report.profile_read.http_status,status);assert.equal(report.provider_get_requests,1);assert.equal(report.provider_write_requests,0);
  assert.equal(report.github.state,'NOT_ATTEMPTED_OWNER_PRINCIPAL_REQUIRED');assert.equal(report.collection_complete,false);assert.equal(f.ghPaths.length,0);
 }
});
test('invalid JSON after HTTP200 retains the observed status and no private body',async()=>{
 const f=fake(),{report}=await collect(f,{fetchImpl:async()=>new Response('{'+secret,{headers:{'content-type':'application/json'}})});
 assert.equal(report.profile_read.http_status,200);assert.equal(report.profile_read.diagnostic.phase,'JSON_PARSE');
 assert(report.profile_read.diagnostic.body_bytes_received>0);
 assert.equal(report.profile_read.state,'PROVIDER_JSON_INVALID_UNKNOWN');assert.equal(report.profile_read.attempts.length,1);assert.equal(report.collection_complete,false);assert(!JSON.stringify(report).includes(secret));
});
test('an invalid profile envelope reports only type diagnostics and never relaxes acceptance',async()=>{
 const f=fake(),{report}=await collect(f,{fetchImpl:async()=>Response.json({success:true,errors:null,result:{id:userId,email,private_echo:secret}})});
 assert.equal(report.profile_read.http_status,200);assert.equal(report.profile_read.diagnostic.phase,'ENVELOPE_CHECK');assert.equal(report.profile_read.diagnostic.envelope_shape.errors_kind,'NULL');
 assert.equal(report.provider_principal_identifier_sha256,null);assert.equal(report.collection_complete,false);assert(!JSON.stringify(report).includes(secret));
});
test('TLS errors expose only fixed error codes and never trigger insecure fallback or retries',async()=>{
 const f=fake();let calls=0;
 const {report}=await collect(f,{fetchImpl:async()=>{calls++;throw Object.assign(Error(secret),{cause:{code:'CERT_HAS_EXPIRED',hostname:secret}});}});
 assert.equal(calls,1);assert.deepEqual(report.profile_read.diagnostic.network_error_codes,['CERT_HAS_EXPIRED']);assert.equal(report.profile_read.http_status,null);
 assert.equal(report.collection_complete,false);assert(!JSON.stringify(report).includes(secret));
});
test('a header timeout has two bounded profile attempts and never starts inventory reads',async()=>{
 const f=fake();let calls=0;const start=Date.now();
 const {report}=await collect(f,{providerReadTimeoutMs:20,fetchImpl:()=>{calls++;return new Promise(()=>{});}});
 assert.equal(calls,2);assert(Date.now()-start<1500);assert.equal(report.profile_read.state,'PROVIDER_READ_DEADLINE_UNKNOWN');assert.equal(report.profile_read.diagnostic.phase,'FETCH_HEADERS');
 assert.equal(report.provider_get_requests,2);assert.equal(report.profile_read.attempts.length,2);assert.equal(report.collection_complete,false);assert.equal(f.ghPaths.length,0);
});
test('a body timeout retains HTTP200 and stays unqualified after the bounded retry',async()=>{
 const f=fake(),{report}=await collect(f,{providerReadTimeoutMs:20,fetchImpl:async()=>new Response(new ReadableStream({start(){}}),{status:200,headers:{'content-type':'application/json'}})});
 assert.equal(report.profile_read.http_status,200);assert.equal(report.profile_read.state,'PROVIDER_READ_DEADLINE_UNKNOWN');assert.equal(report.profile_read.diagnostic.phase,'BODY_READ');
 assert.equal(report.profile_read.attempts.length,2);assert.equal(report.collection_complete,false);
});
test('a transient HTTP503 profile response can recover without hiding its first outcome',async()=>{
 const f=fake();let calls=0;
 const {report}=await collect(f,{fetchImpl:async req=>new URL(req.url).pathname==='/client/v4/user'&&++calls===1?new Response(null,{status:503}):f.fetchImpl(req)});
 assert.equal(calls,2);assert.equal(report.profile_read.attempts[0].http_status,503);assert.equal(report.profile_read.attempts[1].http_status,200);assert.equal(report.collection_complete,true);
 assert.equal(report.independent_custody_automatically_qualified,false);assert.equal(report.gate3_closed,false);
});
