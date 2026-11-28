// Fixed GET-only build-metadata readback. No owner credential or signer is used.
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {OperatorTransport} from './transport.mjs';
import {ACCOUNT,SOURCE_ACCOUNT,need} from './pins.mjs';
import {pages,summarizeToken} from './boundary.mjs';
import {resolveZoneOwners} from './scope_policy.mjs';
import {parseIdentityJson} from '../../customer_control_plane/zitadel_provider_tokens_candidate.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const hex32=x=>typeof x==='string'&&/^[a-f0-9]{32}$/.test(x);
const knownReaders=new Set(['83eda64c33252d73b0ae28ebcb902d35d5aa081a7b43f77728924820021860f5','e2ca57fa6d971286e02a8f02050c53991ab79e3ccc8c958d46dbeaf8ed34f1a2','bf3d1b9b09d06a396f9e97846f6ed2c6de64e67184c3865d370610e6d0a925c6']);
const scopeTypes=new Set(['com.cloudflare.api.account','com.cloudflare.api.account.zone','com.cloudflare.api.user','com.cloudflare.edge.r2.bucket']);
const fixedCode=e=>typeof e?.code==='string'&&/^A2OP_[A-Z0-9_]+$/.test(e.code)?e.code:'A2OP_SCOPE_READBACK_UNKNOWN_HOLD';

export function projectCatalog(rows,requested){
 need(Array.isArray(rows)&&rows.length>0&&rows.length<=4096&&Array.isArray(requested)&&requested.every(hex32)&&new Set(requested).size===requested.length,'A2OP_SCOPE_CATALOG_SHAPE_HOLD');
 const byId=new Map();
 for(const row of rows){need(hex32(row?.id)&&!byId.has(row.id),'A2OP_SCOPE_CATALOG_ID_HOLD');byId.set(row.id,row);}
 return [...requested].sort().map(id=>{
  const group=byId.get(id),scopes=group?.scopes;
  const valid=Array.isArray(scopes)&&scopes.length>0&&scopes.length<=4&&scopes.every(s=>scopeTypes.has(s))&&new Set(scopes).size===scopes.length;
  return {permission_group_id:id,catalog_entry_observed:!!group,scope_metadata_valid:valid,scopes:valid?[...scopes].sort():[],effective_permission_verified:false};
 });
}

async function listZones(t){
 const rows=[],seen=new Set();let total;
 for(let page=1;page<=5;page++){
  const r=await t.cf('GET',`/zones?page=${page}&per_page=50`),a=r.data,i=r.result_info;
  need(Array.isArray(a)&&i?.page===page&&i.per_page===50&&i.count===a.length&&Number.isSafeInteger(i.total_count)&&i.total_count>=0&&i.total_count<=250&&(total===undefined||total===i.total_count),'A2OP_SCOPE_ZONE_PAGINATION_HOLD');total=i.total_count;
  for(const z of a){need(hex32(z?.id)&&hex32(z.account?.id)&&!seen.has(z.id),'A2OP_SCOPE_ZONE_ID_HOLD');seen.add(z.id);rows.push(z);}
  if(rows.length===total)return rows;
  need(rows.length<total&&a.length>0,'A2OP_SCOPE_ZONE_INCOMPLETE_HOLD');
 }
 need(false,'A2OP_SCOPE_ZONE_BUDGET_HOLD');
}

export async function observeScopes(t,targets){
 need(targets&&Array.isArray(targets.zone_identifier_sha256)&&targets.zone_identifier_sha256.length<=32&&targets.zone_identifier_sha256.every(x=>/^[a-f0-9]{64}$/.test(x))&&new Set(targets.zone_identifier_sha256).size===targets.zone_identifier_sha256.length,'A2OP_SCOPE_TARGETS_HOLD');
 const report={schema:'musitu.axiom.authority2.build-scope-readback.v1',observed_at_utc:new Date().toISOString(),execution_origin:'EXISTING_BUILD_METADATA_CREDENTIAL_NOT_INDEPENDENT_OPERATOR',original_provider_responses_retained:false,scope_projection_only:true,accessible_zone_inventory_complete:false,absence_of_other_A2_zones_qualified:false,current_policy_inventory_complete:false,zone_ownership_complete:false,permission_catalog_matches_complete:false,independent_custody_qualified:false,effective_write_denial_verified:false,gate3_closed:false,B27:'FAILED_IN_SYNTHETIC_ATTACK',parity_superiority:'NOT_CERTIFIED',unavailable_final_usage:'UNKNOWN',release_status:'NOT_RELEASE'};
 let owners=new Map();
 try{const catalog=(await t.cf('GET','/user/tokens/permission_groups')).data;report.permission_groups=projectCatalog(catalog,targets.permission_group_ids);report.permission_catalog_matches_complete=report.permission_groups.every(x=>x.catalog_entry_observed&&x.scope_metadata_valid);}
 catch(e){report.catalog_hold=fixedCode(e);}
 try{
  const zones=await listZones(t);const wanted=new Set(targets.zone_identifier_sha256),selected=zones.filter(z=>wanted.has(hash('cloudflare-zone-id\n'+z.id)));
  const readback=await resolveZoneOwners(t,selected.map(z=>z.id));owners=readback.owners;report.zone_ownership_readbacks=readback.observations;
  report.zone_ownership_complete=selected.length===wanted.size&&readback.observations.every(x=>x.ownership_verified);
  report.accessible_zone_inventory_complete=true;report.accessible_zone_count=zones.length;
  // An accessible inventory is not proof that no inaccessible A2 zone exists.
  report.accessible_A2_zone_count=zones.filter(z=>z.account.id===ACCOUNT).length;report.absence_of_other_A2_zones_qualified=false;
 }catch(e){report.zone_hold=fixedCode(e);}
 try{
  const inventories=[];
  for(const [name,path]of [['USER',p=>`/user/tokens?page=${p}&per_page=50&include_expired=true`],['A2_ACCOUNT',p=>`/accounts/${ACCOUNT}/tokens?page=${p}&per_page=50&include_expired=true`],['SOURCE_ACCOUNT',p=>`/accounts/${SOURCE_ACCOUNT}/tokens?page=${p}&per_page=50&include_expired=true`]]){
   const tokens=await pages(t,path);inventories.push({inventory:name,count:tokens.length,tokens:tokens.map(token=>summarizeToken(token,{zoneOwners:owners}))});
  }
  report.current_token_inventory=inventories;report.current_policy_inventory_complete=true;
 }catch(e){report.inventory_hold=fixedCode(e);}
 report.status=report.current_policy_inventory_complete&&report.zone_ownership_complete&&report.permission_catalog_matches_complete?'FRESH_METADATA_OBSERVED_INDEPENDENT_ACCEPTANCE_REQUIRED_NOT_RELEASE':'PARTIAL_SCOPE_READBACK_HOLD';
 return report;
}

export async function main(){
 let secret;
 try{
  need(process.env.GITHUB_ACTIONS==='true'&&process.env.AXIOM_A2_SCOPE_READBACK==='1'&&process.env.GITHUB_REPOSITORY==='evansmusitu/mft-axiom-build'&&process.env.GITHUB_REF==='refs/heads/build/axiom-a2-scope-boundary-20261128','A2OP_SCOPE_READBACK_CONTEXT_HOLD');
  secret=process.env.MUSITU_CLOUDFLARE_ADMIN_TOKEN;need(typeof secret==='string'&&/^[A-Za-z0-9._~-]{16,200}$/.test(secret),'A2OP_EXISTING_METADATA_CREDENTIAL_UNAVAILABLE_HOLD');
  const parse=raw=>{const data=parseIdentityJson(raw);need(!raw.includes(secret),'A2OP_PRIVATE_VALUE_REFLECTION_HOLD');return data;};
  const t=new OperatorTransport({credential:{kind:'api_token',secret},githubToken:'',parseJson:parse,fetchImpl:request=>{need(request.method==='GET'&&new URL(request.url).origin==='https://api.cloudflare.com','A2OP_READBACK_GET_ONLY_HOLD');return fetch(request);}});
  const v=(await t.cf('GET','/user/tokens/verify')).data;
  need(v?.status==='active'&&hex32(v.id)&&knownReaders.has(hash('cloudflare-token-id\n'+v.id)),'A2OP_EXISTING_METADATA_IDENTITY_MISMATCH_HOLD');
  const targets=parseIdentityJson(readFileSync(new URL('./scope_probe_targets.json',import.meta.url),'utf8'));
  const report=await observeScopes(t,targets);report.source_commit=process.env.GITHUB_SHA;need(/^[a-f0-9]{40}$/.test(report.source_commit),'A2OP_READBACK_SOURCE_HOLD');report.provider_requests=t.cfCount;report.provider_mutations=t.mutations;
  const text=JSON.stringify(report,null,2)+'\n';need(!text.includes(secret)&&t.mutations===0,'A2OP_PUBLIC_REDACTION_OR_MUTATION_HOLD');
  writeFileSync('A2_SCOPE_PROVIDER_READBACK.json',text,{flag:'wx',mode:0o600});console.log(text);
  if(report.status==='PARTIAL_SCOPE_READBACK_HOLD')process.exitCode=2;
 }catch(e){console.log(JSON.stringify({schema:'musitu.axiom.authority2.build-scope-readback.v1',status:fixedCode(e),provider_mutations:0,gate3_closed:false,release_status:'NOT_RELEASE'}));process.exitCode=2;}
 finally{secret=null;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
