import test from 'node:test';
import assert from 'node:assert/strict';
import {ACCOUNT,SOURCE_ACCOUNT} from '../qualification/authority2_operator/pins.mjs';
import {summarizeToken,BoundaryHold} from '../qualification/authority2_operator/boundary.mjs';
import {resourceProjection,referencedZoneIds,resolveZoneOwners} from '../qualification/authority2_operator/scope_policy.mjs';
const zone='a'.repeat(32),other='b'.repeat(32);
const token=(resources,name='Workers Scripts Write',effect='allow')=>({id:'c'.repeat(32),status:'active',name:'PRIVATE_TOKEN_NAME',policies:[{effect,resources,permission_groups:[{name}]}]});
const risk=(resources,owners)=>summarizeToken(token(resources),{zoneOwners:owners}).potential_A2_or_global_credential_admin_allow;
const r2=(a,b='synthetic-backup')=>({['com.cloudflare.edge.r2.bucket.'+a+'_default_'+b]:'*'});
test('source-account R2 object grants are disjoint while every A2 bucket grant stays held',()=>{
 assert.equal(risk(r2(SOURCE_ACCOUNT)),false);assert.equal(risk(r2(ACCOUNT)),true);
 assert.equal(risk(r2(SOURCE_ACCOUNT,'musitu-axiom-b27-highwater-a2')),false);
 assert.equal(risk(r2(ACCOUNT,'musitu-axiom-b27-highwater-a2')),true);
});
test('named zones need fresh owner linkage; missing ownership and A2 ownership remain held',()=>{
 const r={['com.cloudflare.api.account.zone.'+zone]:'*'};
 assert.equal(risk(r),true);assert.equal(risk(r,new Map([[zone,SOURCE_ACCOUNT]])),false);
 assert.equal(risk(r,new Map([[zone,ACCOUNT]])),true);assert.equal(risk(r,new Map([[zone,'untrusted']])) ,true);
});
test('global-zone writes never pass because existing zones belong elsewhere or A2 currently has none',()=>{
 const r={'com.cloudflare.api.account.zone.*':'*'};
 for(const owners of [new Map(),new Map([[zone,SOURCE_ACCOUNT],[other,SOURCE_ACCOUNT]])])assert.equal(risk(r,owners),true);
 const p=resourceProjection(r);assert.equal(p.global_zone_scope,true);assert.equal(p.unresolved_scope,false);
});
test('documented nested zones and R2 buckets obey their explicit account; unknown nesting stays held',()=>{
 for(const child of ['com.cloudflare.api.account.zone.*','com.cloudflare.edge.r2.bucket.*']){
  assert.equal(risk({['com.cloudflare.api.account.'+SOURCE_ACCOUNT]:{[child]:'*'}}),false);
  assert.equal(risk({['com.cloudflare.api.account.'+ACCOUNT]:{[child]:'*'}}),true);
 }
 assert.equal(risk({['com.cloudflare.api.account.'+SOURCE_ACCOUNT]:{'*':'*'}}),true);
});
test('unsupported R2 selectors, jurisdiction and resource forms remain held',()=>{
 for(const resources of [r2(SOURCE_ACCOUNT,'*'),{'com.cloudflare.edge.r2.bucket.invalid':'*'},{['com.cloudflare.edge.r2.bucket.'+SOURCE_ACCOUNT+'_unknown_bucket']:'*'},{'com.cloudflare.api.zone.*':'*'}])assert.equal(risk(resources),true);
});
test('mixed grants cannot hide an A2 or credential-administration allow behind a disjoint resource',()=>{
 for(const resource of ['com.cloudflare.api.account.'+ACCOUNT,'com.cloudflare.api.account.*','com.cloudflare.api.user.*','*']){
  assert.equal(risk({...r2(SOURCE_ACCOUNT),[resource]:'*'}),true);
 }
 const t=token(r2(SOURCE_ACCOUNT));t.policies.push({effect:'allow',resources:{['com.cloudflare.api.account.'+ACCOUNT]:'*'},permission_groups:[{name:'Workers R2 Storage Write'}]});
 assert.equal(summarizeToken(t).potential_A2_or_global_credential_admin_allow,true);
});
test('a deny-only projection never grants authority and is not used to waive a separate allow',()=>{
 assert.equal(summarizeToken(token({'com.cloudflare.api.account.*':'*'},'Workers Scripts Write','deny')).potential_A2_or_global_credential_admin_allow,false);
 const t=token({'com.cloudflare.api.account.*':'*'});t.policies.push({...t.policies[0],effect:'deny'});
 assert.equal(summarizeToken(t).potential_A2_or_global_credential_admin_allow,true);
});
test('the supplied scope pattern reduces 18 synthetic candidates to four global-zone holds only after fresh zone mapping',()=>{
 const rows=[...Array.from({length:11},()=>token({['com.cloudflare.api.account.zone.'+zone]:'*'})),token({['com.cloudflare.api.account.zone.'+other]:'*'}),...Array.from({length:4},()=>token({'com.cloudflare.api.account.zone.*':'*'})),token(r2(SOURCE_ACCOUNT,'synthetic-backup-one')),token(r2(SOURCE_ACCOUNT,'synthetic-backup-two'))];
 assert.equal(rows.filter(t=>summarizeToken(t).potential_A2_or_global_credential_admin_allow).length,16);
 const owners=new Map([[zone,SOURCE_ACCOUNT],[other,SOURCE_ACCOUNT]]);
 assert.equal(rows.filter(t=>summarizeToken(t,{zoneOwners:owners}).potential_A2_or_global_credential_admin_allow).length,4);
});
test('zone references are bounded, deduplicated and independent of names',()=>{
 const r={['com.cloudflare.api.account.zone.'+zone]:'*'};
 assert.deepEqual(referencedZoneIds([token(r),token(r)]),[zone]);
 assert.throws(()=>referencedZoneIds([token(Object.fromEntries(Array.from({length:33},(_,i)=>['com.cloudflare.api.account.zone.'+i.toString(16).padStart(32,'0'),'*'])))]),/A2OP_ZONE_LOOKUP_BUDGET_HOLD/);
});
test('actual zone lookup projects owner classes and hashes without exposing names or identifiers',async()=>{
 const calls=[];const t={async cf(method,path){calls.push({method,path});return {status:200,data:{id:zone,name:'PRIVATE_ZONE_NAME',account:{id:SOURCE_ACCOUNT,name:'PRIVATE_ACCOUNT_NAME'}}};}};
 const r=await resolveZoneOwners(t,[zone]);assert.equal(r.owners.get(zone),SOURCE_ACCOUNT);
 assert.deepEqual(calls,[{method:'GET',path:'/zones/'+zone}]);assert.equal(r.observations[0].owner_account_class,'SOURCE_ACCOUNT');
 const text=JSON.stringify(r.observations);for(const value of [zone,SOURCE_ACCOUNT,'PRIVATE_ZONE_NAME','PRIVATE_ACCOUNT_NAME'])assert.equal(text.includes(value),false);
});
test('403/404 owner reads are unknown, never proof that a zone is outside A2',async()=>{
 for(const status of [403,404]){
  const r=await resolveZoneOwners({async cf(){return {status,data:{private:'ignored'}};}},[zone]);assert.equal(r.owners.has(zone),false);assert.equal(r.observations[0].ownership_verified,false);
  assert.equal(risk({['com.cloudflare.api.account.zone.'+zone]:'*'},r.owners),true);
 }
});
test('mismatched/malformed ownership and invalid lookup requests cannot create exclusions',async()=>{
 for(const data of [{id:other,account:{id:SOURCE_ACCOUNT}},{id:zone,account:{id:'invalid'}}]){
  const r=await resolveZoneOwners({async cf(){return {status:200,data};}},[zone]);assert.equal(r.owners.size,0);assert.equal(r.observations[0].ownership_verified,false);assert.equal(r.observations[0].readback_hold,'A2OP_ZONE_OWNER_METADATA_HOLD');assert.equal(r.observations[0].http_status,200);
 }
 await assert.rejects(resolveZoneOwners({async cf(){throw Error('MUST_NOT_CALL');}},['invalid']),/A2OP_ZONE_LOOKUP_SCOPE_HOLD/);
});
test('a refused or ambiguous zone lookup preserves a typed status without inventing ownership',async()=>{
 for(const status of [400,401,429,500,null]){
  const t={async cf(){throw Object.assign(Error('PRIVATE_PROVIDER_MESSAGE'),{code:'A2OP_PROVIDER_STATUS_HOLD',observedHttpStatus:status});}};
  const r=await resolveZoneOwners(t,[zone]);assert.equal(r.owners.size,0);assert.equal(r.observations[0].http_status,status);assert.equal(r.observations[0].ownership_verified,false);assert.equal(JSON.stringify(r.observations).includes('PRIVATE_PROVIDER_MESSAGE'),false);
 }
});
test('scope evidence does not include token names and a typed hold carries a reviewable projection',()=>{
 const projection=summarizeToken(token({'com.cloudflare.api.account.zone.*':'*'}));assert.equal(JSON.stringify(projection).includes('PRIVATE_TOKEN_NAME'),false);
 const e=new BoundaryHold('A2OP_GLOBAL_ZONE_WRITE_SCOPE_HOLD',{unapproved_active_token_projections:[projection],gate3_closed:false,release_status:'NOT_RELEASE'});
 assert.equal(e.code,'A2OP_GLOBAL_ZONE_WRITE_SCOPE_HOLD');assert.equal(e.publicBoundaryDetails.gate3_closed,false);
});
