import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyAuthority2InitializerRetirement} from './authority2-initializer-retirement.mjs';
const account='67469478aa9349fa0a57fe3a72da200a',token='r'.repeat(40);
const version='11111111-1111-4111-8111-111111111111',etag='opaque-provider-upload-etag';
const bindings=[{name:'HIGHWATER_STATE',type:'durable_object_namespace',class_name:'Authority2Highwater'},
 {name:'HIGHWATER_WORM',type:'r2_bucket',bucket_name:'musitu-axiom-b27-highwater-a2'},
 ...['HW_CONFIG_JSON','HW_ROLE_TOKEN_SHA256_JSON','HW_SIGNING_JWK'].map(name=>({name,type:'secret_text'}))];
function fixture(){
 const deployment={id:'22222222-2222-4222-8222-222222222222',strategy:'percentage',
  versions:[{version_id:version,percentage:100}],created_on:'2026-11-15T10:00:00Z'};
 const state={deployment,bindings:structuredClone(bindings),version:{id:version,
  resources:{bindings:structuredClone(bindings),script:{etag,handlers:['fetch'],
   named_handlers:[{name:'Authority2Highwater',handlers:['fetch']}]}}},
  schedules:{schedules:[]},subdomain:{enabled:false,previews_enabled:false}};
 let reads=0;const calls=[];
 const fetchImpl=async(url,init)=>{
  const u=new URL(url);assert.equal(u.origin,'https://api.cloudflare.com');
  assert.ok(u.pathname.startsWith('/client/v4/accounts/'+account+'/workers/scripts/axiom-security-authority2-highwater/'));
  assert.equal(init.method,'GET');assert.equal(init.redirect,'manual');assert.equal(init.credentials,'omit');
  assert.equal(init.headers.authorization,'Bearer '+token);calls.push(u.pathname);
  let result;
  if(u.pathname.endsWith('/deployments')){reads++;result={deployments:[state.deployment]};
   if(state.changeDeployment&&reads===2)result={deployments:[{...state.deployment,id:'33333333-3333-4333-8333-333333333333'}]};}
  else if(u.pathname.endsWith('/settings'))result={bindings:state.bindings};
  else if(u.pathname.endsWith('/versions/'+version))result=state.version;
  else if(u.pathname.endsWith('/schedules'))result=state.schedules;
  else if(u.pathname.endsWith('/subdomain'))result=state.subdomain;
  else throw Error('unexpected endpoint');
  return Response.json({success:true,errors:[],result});
 };
 return {state,calls,args:{account_id:account,token,expected_version_id:version,expected_script_etag:etag,fetchImpl}};
}
test('retirement checks exact version/bindings, absent cron/handlers and disabled preview with six GETs',async()=>{
 const f=fixture(),r=await verifyAuthority2InitializerRetirement(f.args);
 assert.equal(f.calls.length,6);assert.equal(r.provider_writes,0);assert.equal(r.release_eligible,false);
 assert.equal(r.source_bytes_independently_qualified,false);assert.equal(r.custom_route_absence_qualified,false);
});
test('retirement refuses leftover capability, source-pin drift, public preview and mid-read deployment changes',async t=>{
 for(const label of ['settings-secret','version-secret','scheduler','extra-export','cron','public','preview',
  'wrong-etag','wrong-version','unknown-handlers','changed-deployment'])await t.test(label,async()=>{
   const f=fixture(),s=f.state;
   if(label==='settings-secret')s.bindings.push({name:'HW_GENESIS_CONTROL_TOKEN',type:'secret_text'});
   if(label==='version-secret')s.version.resources.bindings.push({name:'HW_GENESIS_CONTROL_TOKEN',type:'secret_text'});
   if(label==='scheduler')s.version.resources.script.handlers.push('scheduled');
   if(label==='extra-export')s.version.resources.script.named_handlers.push({name:'Initializer',handlers:['fetch']});
   if(label==='cron')s.schedules.schedules.push({cron:'* * * * *'});
   if(label==='public')s.subdomain.enabled=true;
   if(label==='preview')s.subdomain.previews_enabled=true;
   if(label==='wrong-etag')s.version.resources.script.etag='swapped';
   if(label==='wrong-version')s.deployment.versions[0].version_id='44444444-4444-4444-8444-444444444444';
   if(label==='unknown-handlers')delete s.version.resources.script.handlers;
   if(label==='changed-deployment')s.changeDeployment=true;
   await assert.rejects(verifyAuthority2InitializerRetirement(f.args));
  });
});
test('retirement refuses unapproved identity or missing public version pins before any provider operation',async t=>{
 for(const label of ['account','token','version','etag'])await t.test(label,async()=>{
  const f=fixture();
  if(label==='account')f.args.account_id='f'.repeat(32);
  if(label==='token')f.args.token=undefined;
  if(label==='version')f.args.expected_version_id=undefined;
  if(label==='etag')f.args.expected_script_etag=undefined;
  await assert.rejects(verifyAuthority2InitializerRetirement(f.args));assert.equal(f.calls.length,0);
 });
});
test('retirement response stall cannot keep an operator observation pending forever',{timeout:3000},async()=>{
 const f=fixture(),normal=f.args.fetchImpl;let count=0;
 f.args.timeoutMs=200;f.args.fetchImpl=async(...a)=>{
  count++;if(count===3)return new Response(new ReadableStream({start(){}}));return normal(...a);};
 await assert.rejects(verifyAuthority2InitializerRetirement(f.args),/AMBIGUOUS_HOLD/);
});
