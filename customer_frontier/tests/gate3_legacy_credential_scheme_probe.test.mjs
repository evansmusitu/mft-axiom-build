import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {observeLegacyCredentialSchemes} from '../qualification/gate3_legacy_credential_scheme_probe.mjs';
const A2='67469478aa9349fa0a57fe3a72da200a',SOURCE='93f395f5121954671f92fffa453d6b61',USER='b'.repeat(32),TOKEN='c'.repeat(32);
const digest=(domain,id)=>createHash('sha256').update(domain+'\n'+id).digest('hex');
const env={CLOUDFLARE_GLOBAL_API_KEY:'K'.repeat(40),MUSITU_CLOUDFLARE_ADMIN_TOKEN:'R'.repeat(40),CLOUDFLARE_EMAIL:'owner@private.invalid'};
const owner={schema:'musitu.axiom.gate3.owner-custody-provider-readback.v1',repository:'evansmusitu/mft-axiom-build',account_id:A2,collection_complete:true,observed_at_utc:'2026-11-26T04:23:47.830Z',provider_principal_identifier_sha256:digest('cloudflare-user-id',USER),user_tokens:{rows:[{token_identifier_sha256:digest('cloudflare-token-id',TOKEN),policies:[{effect:'allow',all_account_resource:true,potential_write_or_execute_named_groups:2}]}]}};
const cf=result=>Response.json({success:true,errors:[],result});
const denied=()=>Response.json({success:false,errors:[{code:10000,message:'PRIVATE_PROVIDER_MESSAGE'}],result:null},{status:403});
function fixture(options={}){
 const requests=[];
 const fetchImpl=async req=>{
  requests.push(req);assert.equal(req.method,'GET');assert.equal(req.redirect,'manual');assert.equal(req.body,null);assert.equal(req.headers.has('cookie'),false);
  const u=new URL(req.url),path=u.pathname.replace('/client/v4','');assert.equal(u.origin,'https://api.cloudflare.com');
  if(path==='/user'&&req.headers.get('authorization')==='Bearer '+env.MUSITU_CLOUDFLARE_ADMIN_TOKEN)return cf({id:options.wrongReader?'d'.repeat(32):USER,email:options.differentEmail?'verified@private.invalid':env.CLOUDFLARE_EMAIL});
  if(path==='/user'&&req.headers.has('x-auth-key'))return options.globalWorks?cf({id:USER,email:env.CLOUDFLARE_EMAIL}):denied();
  if(path.endsWith('/tokens/verify')){
   if(options.noBearer)return denied();
   if(options.sourceOnly&&!path.includes(SOURCE))return denied();
   return cf({id:options.reflectedId||TOKEN,status:'active'});
  }
  if(path.endsWith('/tokens/'+TOKEN))return cf({id:TOKEN,name:'PRIVATE_TOKEN_NAME',policies:[{effect:'allow',resources:{'com.cloudflare.api.account.*':'*'},permission_groups:[{name:'Workers Scripts Write'},{name:'Workers R2 Storage Write'}]}]});
  throw Error(env.CLOUDFLARE_GLOBAL_API_KEY);
 };return {requests,fetchImpl};
}
const run=(f,extra={})=>observeLegacyCredentialSchemes({env,ownerReceipt:owner,fetchImpl:f.fetchImpl,...extra});
const holds=r=>{assert.equal(r.gate3_closed,false);assert.equal(r.global_key_custody_qualified,false);assert.equal(r.independent_operator_custody_qualified,false);assert.equal(r.all_provider_write_denial_verified,false);assert.equal(r.B27,'FAILED_IN_SYNTHETIC_ATTACK');assert.equal(r.release_status,'NOT_RELEASE');};
test('an existing legacy reference used as bearer can match a broad owner token without exporting its value',async()=>{
 const f=fixture(),r=await run(f),s=r.subjects[0];assert.equal(s.global_key_attempts[0].http_status,403);assert.equal(s.bearer_token_status,'active');
 assert.equal(s.bearer_token_identifier_sha256,digest('cloudflare-token-id',TOKEN));assert.equal(s.owner_snapshot_all_account_write_named_allow,true);assert.equal(s.current_metadata.potential_a2_or_all_account_write_named_allow,true);assert.equal(r.build_legacy_reference_matches_broad_owner_token,true);
 const out=JSON.stringify(r);for(const value of [...Object.values(env),'PRIVATE_TOKEN_NAME','PRIVATE_PROVIDER_MESSAGE',TOKEN,USER])assert(!out.includes(value));holds(r);
});
test('a global-key principal match is observed independently of bearer failure and is never an auto-pass',async()=>{
 const f=fixture({globalWorks:true,noBearer:true}),r=await run(f);assert.equal(r.build_global_key_matches_owner_principal,true);assert.equal(r.subjects[0].bearer_token_identifier_sha256,null);assert.equal(r.subjects[0].revocation_verified,false);holds(r);
});
test('failed schemes cannot establish revocation, effective denial or absence',async()=>{
 const f=fixture({noBearer:true}),r=await run(f);assert.equal(r.subjects[0].state,'NO_CREDENTIAL_IDENTITY_QUALIFIED_NOT_REVOCATION_PROOF');assert.equal(r.subjects[1].state,'NOT_AVAILABLE_IN_THIS_CONTEXT_NOT_ABSENCE');assert.equal(r.build_credential_inventory_exhaustive,false);holds(r);
});
test('only the recorded email and one different provider-verified email can be tried',async()=>{
 const f=fixture({differentEmail:true}),r=await run(f);assert.equal(r.subjects[0].global_key_attempts.length,2);assert(!JSON.stringify(r).includes('verified@private.invalid'));holds(r);
});
test('a metadata-reader principal mismatch prevents current policy detail reads',async()=>{
 const f=fixture({wrongReader:true}),r=await run(f);assert.equal(r.metadata_reader.matches_owner_principal,false);assert.equal(r.subjects[0].current_metadata,undefined);assert(!f.requests.some(q=>q.url.endsWith('/tokens/'+TOKEN)));holds(r);
});
test('a credential reflected as a provider identifier is never hashed or exported',async()=>{
 const ownSecret='c'.repeat(32),f=fixture({reflectedId:ownSecret}),r=await run(f,{env:{...env,CLOUDFLARE_GLOBAL_API_KEY:ownSecret}});assert.equal(r.subjects[0].bearer_token_identifier_sha256,null);assert(!JSON.stringify(r).includes(digest('cloudflare-token-id',ownSecret)));holds(r);
});
test('account-source verification uses only pinned fallbacks and does not infer independent custody',async()=>{
 const f=fixture({sourceOnly:true}),r=await run(f);assert.equal(r.subjects[0].verification_scope,'account_source');assert.equal(r.subjects[0].bearer_verification_attempts.length,3);holds(r);
});
test('redirects cannot forward credentials and hanging reads have a bounded deadline',async()=>{
 const f=fixture();const redirected=await run(f,{fetchImpl:async req=>{assert.equal(req.redirect,'manual');return new Response(null,{status:302,headers:{location:'https://private.invalid/'+env.CLOUDFLARE_GLOBAL_API_KEY}});}});assert.equal(redirected.subjects[0].bearer_token_identifier_sha256,null);assert(!JSON.stringify(redirected).includes('private.invalid'));holds(redirected);
 const start=Date.now(),slow=await run(f,{timeoutMs:20,fetchImpl:()=>new Promise(()=>{})});assert(Date.now()-start<1500);assert.equal(slow.subjects[0].bearer_token_identifier_sha256,null);holds(slow);
});
test('duplicate JSON and oversized bodies cannot qualify any identity or leak body content',async()=>{
 const f=fixture();for(const text of ['{"success":false,"success":true,"errors":[],"result":{"id":"'+TOKEN+'","status":"active"}}','x'.repeat(131073)]){
  const r=await run(f,{fetchImpl:async()=>new Response(text,{status:200})});assert.equal(r.subjects[0].bearer_token_identifier_sha256,null);assert.equal(r.metadata_reader.matches_owner_principal,false);holds(r);
 }
});
test('CLI refuses outside its isolated push context before provider or snapshot access',()=>{
 const p=fileURLToPath(new URL('../qualification/gate3_legacy_credential_scheme_probe.mjs',import.meta.url));const r=spawnSync(process.execPath,[p],{encoding:'utf8',env:{...process.env,GITHUB_ACTIONS:'false'}});assert.equal(r.status,2);assert.match(r.stderr,/LEGACY_SCHEME_CONTEXT_REQUIRED_HOLD/);
});
