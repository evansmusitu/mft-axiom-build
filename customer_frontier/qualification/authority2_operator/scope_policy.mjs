// Resource projection only; never an effective permission or custody certificate.
import {createHash} from 'node:crypto';
import {ACCOUNT,SOURCE_ACCOUNT,need} from './pins.mjs';
const id=x=>typeof x==='string'&&/^[a-f0-9]{32}$/.test(x);
const hash=x=>createHash('sha256').update(x).digest('hex');
export const accountClass=x=>x===ACCOUNT?'A2_ACCOUNT':x===SOURCE_ACCOUNT?'SOURCE_ACCOUNT':'OTHER_EXPLICIT_ACCOUNT';

export function resourceProjection(resources,zoneOwners=new Map()) {
 need(resources&&typeof resources==='object'&&!Array.isArray(resources)&&Object.keys(resources).length<=256,'A2OP_TOKEN_RESOURCE_SHAPE_HOLD');
 const result={a2_account_or_all_accounts:false,a2_zone_or_bucket:false,global_zone_scope:false,user_credential_scope:false,unresolved_scope:false};
 const keys=Object.keys(resources);if(!keys.length)result.unresolved_scope=true;
 for(const key of keys){
  const value=resources[key];let m;
  if(key==='*'&&value==='*'){result.a2_account_or_all_accounts=true;result.user_credential_scope=true;continue;}
  if(key==='com.cloudflare.api.account.*'&&value==='*'){result.a2_account_or_all_accounts=true;continue;}
  if((m=/^com\.cloudflare\.api\.account\.([a-f0-9]{32})$/.exec(key))){
   if(value==='*'){if(m[1]===ACCOUNT)result.a2_account_or_all_accounts=true;continue;}
   const nested=value&&typeof value==='object'&&!Array.isArray(value)?Object.keys(value):[];
   if(nested.length===1&&['com.cloudflare.api.account.zone.*','com.cloudflare.edge.r2.bucket.*'].includes(nested[0])&&value[nested[0]]==='*'){
    if(m[1]===ACCOUNT)result.a2_zone_or_bucket=true;continue;
   }
   result.unresolved_scope=true;continue;
  }
  if((m=/^com\.cloudflare\.api\.account\.zone\.([a-f0-9]{32})$/.exec(key))&&value==='*'){
   const owner=zoneOwners instanceof Map?zoneOwners.get(m[1]):undefined;
   if(!id(owner))result.unresolved_scope=true;else if(owner===ACCOUNT)result.a2_zone_or_bucket=true;
   continue;
  }
  // A snapshot with zero A2 zones cannot exclude future zone creation. Keep
  // every unapproved non-read all-zone grant held, regardless of that snapshot.
  if(key==='com.cloudflare.api.account.zone.*'&&value==='*'){result.global_zone_scope=true;continue;}
  if(/^com\.cloudflare\.api\.user\.(?:[a-f0-9]{32}|\*)$/.test(key)&&value==='*'){result.user_credential_scope=true;continue;}
  if((m=/^com\.cloudflare\.edge\.r2\.bucket\.([a-f0-9]{32})_(default|eu|fedramp|us)_([a-z0-9][a-z0-9.-]{1,61}[a-z0-9])$/.exec(key))&&value==='*'){
   if(m[1]===ACCOUNT)result.a2_zone_or_bucket=true;continue;
  }
  result.unresolved_scope=true;
 }
 return result;
}

export function referencedZoneIds(tokens){
 need(Array.isArray(tokens)&&tokens.length<=250,'A2OP_SCOPE_TOKEN_BUDGET_HOLD');const found=new Set();
 for(const token of tokens){
  need(token&&Array.isArray(token.policies)&&token.policies.length<=100,'A2OP_TOKEN_METADATA_HOLD');
  for(const p of token.policies){
   need(p?.resources&&typeof p.resources==='object'&&!Array.isArray(p.resources),'A2OP_TOKEN_POLICY_HOLD');
   for(const key of Object.keys(p.resources)){const m=/^com\.cloudflare\.api\.account\.zone\.([a-f0-9]{32})$/.exec(key);if(m)found.add(m[1]);}
  }
 }
 need(found.size<=32,'A2OP_ZONE_LOOKUP_BUDGET_HOLD');return [...found].sort();
}

export async function resolveZoneOwners(t,zoneIds){
 need(Array.isArray(zoneIds)&&zoneIds.length<=32&&zoneIds.every(id)&&new Set(zoneIds).size===zoneIds.length,'A2OP_ZONE_LOOKUP_SCOPE_HOLD');
 const owners=new Map(),observations=[];
 for(const zone of [...zoneIds].sort()){
  const r=await t.cf('GET','/zones/'+zone,{allowStatus:[200,403,404]});
  const row={zone_identifier_sha256:hash('cloudflare-zone-id\n'+zone),http_status:r.status,ownership_verified:false};
  if(r.status===200){
   need(r.data?.id===zone&&id(r.data.account?.id),'A2OP_ZONE_OWNER_METADATA_HOLD');
   owners.set(zone,r.data.account.id);Object.assign(row,{ownership_verified:true,owner_account_class:accountClass(r.data.account.id),owner_account_identifier_sha256:hash('cloudflare-account-id\n'+r.data.account.id)});
  }
  observations.push(row);
 }
 return {owners,observations};
}
