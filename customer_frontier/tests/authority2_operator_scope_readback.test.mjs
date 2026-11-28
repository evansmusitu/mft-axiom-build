import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,verify} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {ACCOUNT,SOURCE_ACCOUNT,canonical} from '../qualification/authority2_operator/pins.mjs';
import {cfAllowed,OperatorTransport} from '../qualification/authority2_operator/transport.mjs';
import {observeScopes,projectCatalog} from '../qualification/authority2_operator/scope_readback.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const zone='a'.repeat(32),group='b'.repeat(32),privateName='PRIVATE_PROVIDER_NAME_NEVER_EXPORT';
const targets={zone_identifier_sha256:[hash('cloudflare-zone-id\n'+zone)],permission_group_ids:[group]};
const page=rows=>({status:200,data:rows,result_info:{page:1,per_page:50,count:rows.length,total_count:rows.length}});
function fake({owner=SOURCE_ACCOUNT,inventoryDenied=false,zoneMalformed=false,listOmitsZone=false,zoneDenied=false}={}){
 const calls=[];
 return {calls,async cf(method,path){
  calls.push({method,path});assert.equal(method,'GET');
  if(path==='/user/tokens/permission_groups')return {status:200,data:[{id:group,name:privateName,scopes:['com.cloudflare.api.account.zone']}]};
  if(path==='/zones?page=1&per_page=50')return page(listOmitsZone?[]:[{id:zone,name:privateName,account:{id:owner,name:privateName}}]);
  if(path==='/zones/'+zone)return zoneDenied?{status:403,data:{private:privateName}}:{status:200,data:{id:zone,account:{id:zoneMalformed?'invalid':owner,name:privateName}}};
  if(path==='/user/tokens?page=1&per_page=50&include_expired=true'){
   if(inventoryDenied)throw Object.assign(Error(privateName),{code:'A2OP_PROVIDER_STATUS_HOLD'});
   return page([{id:'c'.repeat(32),status:'active',name:privateName,policies:[{effect:'allow',resources:{['com.cloudflare.api.account.zone.'+zone]:'*'},permission_groups:[{name:'DNS Write'}]}]}]);
  }
  if(path===`/accounts/${ACCOUNT}/tokens?page=1&per_page=50&include_expired=true`||path===`/accounts/${SOURCE_ACCOUNT}/tokens?page=1&per_page=50&include_expired=true`)return page([]);
  throw Error('UNEXPECTED_TEST_ROUTE');
 }};
}
test('scope readback observes only fixed GET surfaces and exports neither private names nor raw IDs',async()=>{
 const t=fake(),r=await observeScopes(t,targets);
 assert.equal(r.status,'FRESH_METADATA_OBSERVED_INDEPENDENT_ACCEPTANCE_REQUIRED_NOT_RELEASE');
 assert.equal(r.current_policy_inventory_complete,true);assert.equal(r.zone_ownership_complete,true);assert.equal(r.permission_catalog_matches_complete,true);
 assert.equal(r.current_token_inventory[0].tokens[0].potential_A2_or_global_credential_admin_allow,false);
 for(const s of [privateName,zone,SOURCE_ACCOUNT,'c'.repeat(32)])assert.equal(JSON.stringify(r).includes(s),false);
 assert.equal(r.gate3_closed,false);assert.equal(r.effective_write_denial_verified,false);assert.equal(r.independent_custody_qualified,false);assert.equal(r.absence_of_other_A2_zones_qualified,false);
 assert.ok(t.calls.every(c=>c.method==='GET'&&cfAllowed(c.method,c.path)));
});
test('a zone actually owned by A2 stays an active token risk after successful metadata collection',async()=>{
 const r=await observeScopes(fake({owner:ACCOUNT}),targets);assert.equal(r.current_token_inventory[0].tokens[0].potential_A2_or_global_credential_admin_allow,true);
 assert.equal(r.accessible_A2_zone_count,1);assert.equal(r.gate3_closed,false);
});
test('a zone omitted from the accessible list is looked up directly from current token metadata once',async()=>{
 const t=fake({listOmitsZone:true}),r=await observeScopes(t,targets);
 assert.equal(r.accessible_zone_count,0);assert.equal(r.zone_ownership_complete,true);
 assert.equal(r.current_token_inventory[0].tokens[0].potential_A2_or_global_credential_admin_allow,false);
 assert.equal(t.calls.filter(x=>x.path==='/zones/'+zone).length,1);assert.equal(r.absence_of_other_A2_zones_qualified,false);
});
test('an omitted zone with direct 403 stays unresolved rather than being classified outside A2',async()=>{
 const t=fake({listOmitsZone:true,zoneDenied:true}),r=await observeScopes(t,targets);
 assert.equal(r.status,'PARTIAL_SCOPE_READBACK_HOLD');assert.equal(r.zone_ownership_complete,false);
 assert.equal(r.current_token_inventory[0].tokens[0].potential_A2_or_global_credential_admin_allow,true);
 assert.equal(t.calls.filter(x=>x.path==='/zones/'+zone).length,1);
});
test('missing token-list permission produces an explicit partial hold without losing independent zone/catalog observations',async()=>{
 const t=fake({inventoryDenied:true}),r=await observeScopes(t,targets);
 assert.equal(r.status,'PARTIAL_SCOPE_READBACK_HOLD');assert.equal(r.inventory_hold,'A2OP_PROVIDER_STATUS_HOLD');
 assert.equal(r.zone_ownership_complete,true);assert.equal(r.permission_catalog_matches_complete,true);assert.equal(r.current_policy_inventory_complete,false);
 assert.equal(t.calls.filter(c=>c.path.startsWith('/user/tokens?')).length,1);assert.equal(JSON.stringify(r).includes(privateName),false);
});
test('malformed ownership cannot exclude a token and does not turn a zero count into absence proof',async()=>{
 const r=await observeScopes(fake({zoneMalformed:true}),targets);assert.equal(r.status,'PARTIAL_SCOPE_READBACK_HOLD');assert.equal(r.zone_ownership_complete,false);
 assert.equal(r.current_token_inventory[0].tokens[0].potential_A2_or_global_credential_admin_allow,true);assert.equal(r.absence_of_other_A2_zones_qualified,false);
});
test('catalog entries are matched by ID/scopes, never by cosmetic or private labels',()=>{
 const r=projectCatalog([{id:group,name:privateName,scopes:['com.cloudflare.edge.r2.bucket']}],[group]);
 assert.deepEqual(r[0].scopes,['com.cloudflare.edge.r2.bucket']);assert.equal(JSON.stringify(r).includes(privateName),false);assert.equal(r[0].effective_permission_verified,false);
 const missing=projectCatalog([{id:group,scopes:['unsupported']}],['d'.repeat(32),group]);assert.ok(missing.every(x=>!x.scope_metadata_valid));
 assert.throws(()=>projectCatalog([{id:group},{id:group}],[group]),/A2OP_SCOPE_CATALOG_ID_HOLD/);
});
test('new metadata routes do not add writes or accept alternate hosts, query punctuation or path escapes',()=>{
 for(const p of ['/zones/'+zone,'/zones?page=1&per_page=50','/user/tokens/permission_groups'])assert.equal(cfAllowed('GET',p),true);
 for(const p of ['/zones/'+zone,'/zones?page=1&per_page=50','/user/tokens/permission_groups'])for(const method of ['POST','PUT','PATCH','DELETE'])assert.equal(cfAllowed(method,p),false);
 for(const p of ['/zones?page=0&per_page=50','/zones?page=6&per_page=50','/zones?page=1&per_page=100','/zones/../user','https://attacker.invalid/zones'])assert.equal(cfAllowed('GET',p),false);
});
test('transport retains only typed HTTP evidence when a zone response is refused',async()=>{
 const t=new OperatorTransport({credential:{kind:'api_token',secret:'SYNTHETIC_METADATA_CREDENTIAL'},githubToken:'',fetchImpl:async()=>Response.json({success:false,errors:[{message:'PRIVATE_PROVIDER_REASON'}]},{status:400})});
 await assert.rejects(t.cf('GET','/zones/'+zone),e=>e.code==='A2OP_PROVIDER_STATUS_HOLD'&&e.observedHttpStatus===400&&e.responseComplete===true&&!e.message.includes('PRIVATE_PROVIDER_REASON'));
});
test('CLI refuses other contexts before reading a credential or performing provider requests',()=>{
 const file=new URL('../qualification/authority2_operator/scope_readback.mjs',import.meta.url);
 const r=spawnSync(process.execPath,[file.pathname],{encoding:'utf8',env:{...process.env,AXIOM_A2_SCOPE_READBACK:'0',MUSITU_CLOUDFLARE_ADMIN_TOKEN:'PRIVATE_VALUE_NOT_TO_BE_READ'}});
 assert.equal(r.status,2);const out=JSON.parse(r.stdout);assert.equal(out.status,'A2OP_SCOPE_READBACK_CONTEXT_HOLD');assert.equal(out.provider_mutations,0);assert.equal(r.stdout.includes('PRIVATE_VALUE_NOT_TO_BE_READ'),false);
});
test('typed scope failure is preserved inside the signed synthetic execution receipt before any mutation',{skip:!process.env.A2_OPERATOR_STAGE},async()=>{
 const stage=process.env.A2_OPERATOR_STAGE;
 const {PrivateOperatorRunner}=await import(pathToFileURL(join(stage,'operator_core.mjs')));
 const {BoundaryHold}=await import(pathToFileURL(join(stage,'boundary.mjs')));
 const root=mkdtempSync(join(tmpdir(),'a2-scope-failure-receipt-'));mkdirSync(join(root,'RETURN_ONLY'));
 try{
  const pair=generateKeyPairSync('ed25519'),jwk=pair.privateKey.export({format:'jwk'});
  const transport={credential:{secret:'SYNTHETIC_CF_VALUE_ONLY'},githubToken:'SYNTHETIC_GH_VALUE_ONLY',cfCount:0,ghCount:0,mutations:0,privateArchiveFailed:false};
  const runner=new PrivateOperatorRunner({transport,work:root,payload:{source_commit:'0'.repeat(40),approved_source_commit:'68799a41a367865649b833de649edcb26f77c0d3',approved_config_sha256:'bc09d63349f611a71f0eef6c1ad1d00bd861454aeab7c41f9565056758f2f8e3'},key:{key:pair.privateKey,jwk},ask:async()=>{throw Error('MUST_NOT_APPROVE');},progress:()=>{},wait:async()=>{}});
  const details={schema:'musitu.axiom.authority2.boundary-hold-details.v1',unapproved_active_token_projections:[],gate3_closed:false,release_status:'NOT_RELEASE'};
  runner.liveSourceGate=async()=>{throw new BoundaryHold('A2OP_GLOBAL_ZONE_WRITE_SCOPE_HOLD',details);};
  const result=await runner.run(),receipt=JSON.parse(readFileSync(join(root,'RETURN_ONLY','OWNER_OPERATOR_EXECUTION_RECEIPT.json')));
  assert.equal(result.success,false);assert.equal(receipt.payload.status,'A2OP_GLOBAL_ZONE_WRITE_SCOPE_HOLD');assert.deepEqual(receipt.payload.boundary_hold_details,details);
  assert.equal(receipt.payload.provider_request_counts.mutations,0);assert.equal(receipt.payload.private_genesis_and_hosted_sequence_completed,false);
  assert.equal(verify(null,Buffer.from('MUSITU_AXIOM_OWNER_OPERATOR_RECEIPT_V1\n'+canonical(receipt.payload)),pair.publicKey,Buffer.from(receipt.signature_base64url,'base64url')),true);
 }finally{rmSync(root,{recursive:true,force:true});}
});
