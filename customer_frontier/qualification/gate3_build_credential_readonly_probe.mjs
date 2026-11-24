// Fixed-origin, bounded GET-only observations of EXISTING build-held credentials.
// This can falsify custody separation; it can never qualify it or issue authority.
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {parseIdentityJson} from '../customer_control_plane/zitadel_provider_tokens_candidate.mjs';
export const A2='67469478aa9349fa0a57fe3a72da200a';
const SOURCE_ACCOUNT='93f395f5121954671f92fffa453d6b61',BASE='https://api.cloudflare.com/client/v4';
const WORKER=`/accounts/${A2}/workers/scripts/axiom-security-authority2-highwater/settings`;
const LOCK=`/accounts/${A2}/r2/buckets/musitu-axiom-b27-highwater-a2/lock`;
const TOKEN_REFS=['AXIOM_D1_RECOVERY_CF_API_TOKEN','MUSITU_CLOUDFLARE_ADMIN_TOKEN','CLOUDFLARE_API_TOKEN','MUSITU_CF_STAGING_READ_TOKEN'];
const KEY_REFS=['CLOUDFLARE_GLOBAL_API_KEY','CLOUDFLARE_API_KEY'];
const hex32=x=>typeof x==='string'&&/^[a-f0-9]{32}$/.test(x);
const sha=x=>createHash('sha256').update(x).digest('hex');
const tokenDetailsPath=path=>/^\/user\/tokens\/[a-f0-9]{32}$/.test(path)||new RegExp('^/accounts/('+A2+'|'+SOURCE_ACCOUNT+')/tokens/[a-f0-9]{32}$').test(path);
const permitted=path=>tokenDetailsPath(path)||['/user','/user/tokens/verify',`/accounts/${A2}/tokens/verify`,`/accounts/${SOURCE_ACCOUNT}/tokens/verify`,WORKER,LOCK].includes(path)||/^\/memberships\?page=[1-5]&per_page=50&status=accepted$/.test(path);
const secretValue=x=>typeof x==='string'&&/^[A-Za-z0-9._~-]{16,200}$/.test(x);
const noGo=()=>{throw Error('READONLY_PROBE_HOLD');};
function client(fetchImpl,timeoutMs){
 if(!Number.isInteger(timeoutMs)||timeoutMs<20||timeoutMs>10000)noGo();let calls=0;
 return {count:()=>calls,async get(path,auth){
  if(!permitted(path))noGo();calls++;const abort=new AbortController();let timer;
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(Error('DEADLINE'));},timeoutMs);});
  try{
   const r=await Promise.race([fetchImpl(new Request(BASE+path,{method:'GET',redirect:'manual',cache:'no-store',credentials:'omit',signal:abort.signal,
    headers:{accept:'application/json',...auth}})),deadline]);
   if(!Number.isInteger(r?.status))return {state:'INVALID_RESPONSE_UNKNOWN',http_status:null};
   const metadata={http_status:r.status,state:r.status===200?'HTTP_200':r.status>=300&&r.status<400?'REDIRECT_NOT_FOLLOWED_UNKNOWN':'HTTP_NON200_NOT_WRITE_DENIAL'};
   if(r.status!==200){try{void r.body?.cancel().catch(()=>{});}catch{}return metadata;}
   const reader=r.body?.getReader();if(!reader)return {...metadata,state:'INVALID_BODY_UNKNOWN'};
   const chunks=[];let size=0,complete=false;
   try{
    for(;;){const p=await Promise.race([reader.read(),deadline]);if(p.done){complete=true;break;}if(!(p.value instanceof Uint8Array))noGo();
     size+=p.value.byteLength;if(size>131072)noGo();chunks.push(p.value);}
   }finally{if(!complete)try{void reader.cancel().catch(()=>{});}catch{}try{reader.releaseLock();}catch{}}
   const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
   const data=parseIdentityJson(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
   if(data?.success!==true||!Array.isArray(data.errors)||data.errors.length!==0||!Object.hasOwn(data,'result'))return {...metadata,state:'INVALID_PROVIDER_ENVELOPE_UNKNOWN'};
   return {...metadata,state:'PROVIDER_GET_OBSERVED_NOT_POLICY',data};
  }catch{return {state:'UNAVAILABLE_OR_INVALID_UNKNOWN',http_status:null};}
  finally{clearTimeout(timer);}
 }};
}
const publicRead=r=>({state:r.state,http_status:r.http_status});
async function resourceReads(api,headers){
 const worker=await api.get(WORKER,headers),lock=await api.get(LOCK,headers);
 const w=worker.data?.result,l=lock.data?.result;
 const result={worker_settings:publicRead(worker),bucket_lock:publicRead(lock)};
 if(w&&Array.isArray(w.bindings))result.worker_settings={...result.worker_settings,binding_count:w.bindings.length,
  expected_binding_names_present:['HIGHWATER_STATE','HIGHWATER_WORM','HW_CONFIG_JSON','HW_ROLE_TOKEN_SHA256_JSON','HW_SIGNING_JWK'].every(name=>w.bindings.some(b=>b?.name===name))};
 if(l&&Array.isArray(l.rules))result.bucket_lock={...result.bucket_lock,indefinite_b27_rule_observed:l.rules.some(r=>r?.enabled===true&&r.condition?.type==='Indefinite'&&[undefined,'','b27/'].includes(r.prefix))};
 return result;
}
async function verifyToken(api,token,protectedValues,verifiedIds,reference){
 const headers={authorization:'Bearer '+token},attempts=[];
 for(const [scope,path]of [['user','/user/tokens/verify'],['account_a2',`/accounts/${A2}/tokens/verify`],['account_source',`/accounts/${SOURCE_ACCOUNT}/tokens/verify`]]){
  const r=await api.get(path,headers);attempts.push({scope,...publicRead(r)});const t=r.data?.result;
  if(t&&hex32(t.id)&&!protectedValues.has(t.id)&&['active','disabled','expired'].includes(t.status)){
   verifiedIds.set(reference,{scope,id:t.id});
   const details=await tokenPolicy(api,headers,scope,t.id);
   return {attempts,token_identifier_sha256:sha('cloudflare-token-id\n'+t.id),token_status:t.status,verification_scope:scope,policy_metadata:details};
  }
 }
 return {attempts,token_identifier_sha256:null,token_status:'UNKNOWN'};
}
async function tokenPolicy(api,headers,scope,id){
 const prefix=scope==='user'?'/user':scope==='account_a2'?'/accounts/'+A2:'/accounts/'+SOURCE_ACCOUNT;
 const r=await api.get(prefix+'/tokens/'+id,headers),p=r.data?.result;
 const out={...publicRead(r),policy_metadata_observed:false,effective_write_denial_verified:false,effective_policy_resolution_verified:false};
 const hold=reason=>({...out,projection_hold_reason:reason});
 if(!p)return hold('NO_VALID_RESULT');
 if(p.id!==id)return hold('TOKEN_IDENTIFIER_MISMATCH');
 if(Object.hasOwn(p,'value'))return hold('UNEXPECTED_VALUE_FIELD');
 if(!Array.isArray(p.policies))return hold('POLICY_ARRAY_UNAVAILABLE');
 if(p.policies.length<1||p.policies.length>100)return hold('POLICY_COUNT_UNSUPPORTED');
 const rows=[];
 for(const policy of p.policies){
  if(!['allow','deny'].includes(policy?.effect))return hold('POLICY_EFFECT_UNSUPPORTED');
  if(!policy.resources||Array.isArray(policy.resources)||typeof policy.resources!=='object')return hold('RESOURCE_MAP_UNSUPPORTED');
  if(!Array.isArray(policy.permission_groups))return {...hold('PERMISSION_GROUP_ARRAY_UNSUPPORTED'),permission_groups_shape:policy.permission_groups===undefined?'MISSING':policy.permission_groups===null?'NULL':'OTHER_TYPE'};
  if(policy.permission_groups.length>100)return hold('PERMISSION_GROUP_COUNT_UNSUPPORTED');
  const resources=Object.keys(policy.resources);if(resources.length<1||resources.length>100)return hold('RESOURCE_COUNT_UNSUPPORTED');
  let explicit=false,all=false,unknown=false;
  for(const resource of resources){
   if(resource==='com.cloudflare.api.account.'+A2)explicit=true;
   else if(resource==='com.cloudflare.api.account.*')all=true;
   else if(!/^com\.cloudflare\.api\.account\.[a-f0-9]{32}$/.test(resource))unknown=true;
   if(policy.resources[resource]!=='*')unknown=true;
  }
  let read=0,write=0,unclassified=0;
  for(const group of policy.permission_groups){
   if(!hex32(group?.id))return hold('PERMISSION_GROUP_IDENTIFIER_UNSUPPORTED');
   if(group.name!==undefined&&(typeof group.name!=='string'||group.name.length>200))return hold('PERMISSION_GROUP_NAME_UNSUPPORTED');
   if(group.name===undefined)unclassified++;
   else if(/ Read$/.test(group.name))read++;
   else if(/ (Write|Edit)$/.test(group.name))write++;
   else unclassified++;
  }
  rows.push({effect:policy.effect,explicit_a2_resource:explicit,all_account_resource:all,unclassified_resource_scope:unknown,empty_permission_groups:policy.permission_groups.length===0,read_named_groups:read,write_named_groups:write,unclassified_groups:unclassified});
 }
 return {...out,policy_metadata_observed:true,policies:rows,
  potential_a2_write_allow_policy_observed:rows.some(p=>p.effect==='allow'&&(p.explicit_a2_resource||p.all_account_resource||p.unclassified_resource_scope)&&p.write_named_groups>0),
  limit:'Names/resources are observations, not a complete policy evaluator or custody/denial proof'};
}
async function memberships(api,headers){
 const result={state:'MEMBERSHIP_READ_INCOMPLETE_UNKNOWN',pages:0,complete:false,a2_accepted_membership_observed:null,
  a2_administrator_role_observed:false,a2_any_reported_write_permission:false,independent_custody_qualified:false};
 const seen=new Set();let totalSeen=0,targetCount=0,targetWrites=false,admin=false;
 for(let page=1;page<=5;page++){
  const r=await api.get(`/memberships?page=${page}&per_page=50&status=accepted`,headers);result.pages=page;result.last_http_status=r.http_status;
  if(!r.data||!Array.isArray(r.data.result)||r.data.result.length>50)return result;
  const rows=r.data.result,info=r.data.result_info;
  for(const member of rows){
   if(!hex32(member?.account?.id)||seen.has(member.account.id)||member.status!=='accepted')return result;
   seen.add(member.account.id);totalSeen++;
   if(member.account.id===A2){
    targetCount++;result.a2_accepted_membership_observed=true;
    const roles=Array.isArray(member.roles)?member.roles:[];
    admin=roles.some(x=>typeof x==='string'&&['administrator','account administrator','super administrator','super administrator - all privileges','owner'].includes(x.toLowerCase()));
    const grants=member.permissions&&typeof member.permissions==='object'?Object.values(member.permissions):[];
    targetWrites=grants.some(x=>x&&typeof x==='object'&&x.write===true);
    result.a2_administrator_role_observed=admin;result.a2_any_reported_write_permission=targetWrites;
    result.modern_membership_policies_present=Array.isArray(member.policies);
   }
  }
  if(!info||info.page!==page||info.count!==rows.length||!Number.isInteger(info.per_page)||info.per_page<1||info.per_page>50||rows.length>info.per_page||
   !Number.isInteger(info.total_count)||info.total_count<totalSeen||info.total_count>250)return result;
  if(totalSeen===info.total_count){result.complete=true;result.state='COMPLETE_PROVIDER_MEMBERSHIP_READBACK_NOT_CUSTODY';result.a2_accepted_membership_observed=targetCount===1;return result;}
  if(rows.length===0)return result;
 }
 return result;
}
export async function probeBuildCredentials({env=process.env,fetchImpl=globalThis.fetch,timeoutMs=5000}={}){
 const api=client(fetchImpl,timeoutMs),credentials=[],verifiedIds=new Map();
 const protectedValues=new Set([...TOKEN_REFS,...KEY_REFS,'CLOUDFLARE_EMAIL'].map(k=>env[k]).filter(x=>typeof x==='string'&&x.length));
 for(const reference of TOKEN_REFS){
  const value=env[reference];if(!value){credentials.push({reference,type:'API_TOKEN',status:'NOT_AVAILABLE_IN_THIS_WORKFLOW_CONTEXT'});continue;}
  if(!secretValue(value)){credentials.push({reference,type:'API_TOKEN',status:'LOCAL_FORMAT_UNSUPPORTED_UNKNOWN'});continue;}
  const verification=await verifyToken(api,value,protectedValues,verifiedIds,reference),reads=await resourceReads(api,{authorization:'Bearer '+value});
  credentials.push({reference,type:'API_TOKEN',status:'GET_OBSERVATIONS_ONLY_NOT_PERMISSION_QUALIFICATION',verification,...reads});
 }
 // Existing build-held metadata credential only; one exact verified user-token ID.
 // Never enumerate tokens, add privileges, export identifiers or accept this as independent proof.
 const recovery=credentials.find(c=>c.reference==='AXIOM_D1_RECOVERY_CF_API_TOKEN'),target=verifiedIds.get('AXIOM_D1_RECOVERY_CF_API_TOKEN');
 const admin=credentials.find(c=>c.reference==='MUSITU_CLOUDFLARE_ADMIN_TOKEN'),reader=verifiedIds.get('MUSITU_CLOUDFLARE_ADMIN_TOKEN');
 if(recovery?.verification?.policy_metadata?.http_status===403&&target?.scope==='user'&&reader?.scope==='user'&&admin?.verification?.policy_metadata?.http_status===200){
  recovery.verification.existing_build_metadata_reader={reference:'MUSITU_CLOUDFLARE_ADMIN_TOKEN',
   policy_metadata:await tokenPolicy(api,{authorization:'Bearer '+env.MUSITU_CLOUDFLARE_ADMIN_TOKEN},target.scope,target.id)};
 }
 for(const reference of KEY_REFS){
  const value=env[reference],email=env.CLOUDFLARE_EMAIL;
  if(!value||!email){credentials.push({reference,type:'GLOBAL_KEY',status:'NOT_AVAILABLE_IN_THIS_WORKFLOW_CONTEXT'});continue;}
  if(!secretValue(value)||typeof email!=='string'||!/^\S+@\S+\.\S+$/.test(email)||email.length>254){credentials.push({reference,type:'GLOBAL_KEY',status:'LOCAL_FORMAT_UNSUPPORTED_UNKNOWN'});continue;}
  const headers={'x-auth-key':value,'x-auth-email':email},user=await api.get('/user',headers),id=user.data?.result?.id;
  const identity={...publicRead(user),principal_identifier_sha256:hex32(id)&&!protectedValues.has(id)?sha('cloudflare-user-id\n'+id):null};
  credentials.push({reference,type:'GLOBAL_KEY',status:'GET_OBSERVATIONS_ONLY_NOT_PERMISSION_QUALIFICATION',principal:identity,
   memberships:await memberships(api,headers),...await resourceReads(api,headers)});
 }
 return {schema:'musitu.axiom.gate3.build-credential-readonly-observation.v1',observed_at_utc:new Date().toISOString(),
  status:'BUILDER_GET_OBSERVATIONS_ONLY_CUSTODY_HOLD',account_id:A2,execution_origin:'BUILD_CONTROLLED_NOT_INDEPENDENT_OPERATOR',credentials,
  provider_get_requests:api.count(),provider_write_requests:0,credential_values_exported:false,
  build_global_key_a2_administrative_membership_observed:credentials.some(c=>c.type==='GLOBAL_KEY'&&c.memberships?.a2_accepted_membership_observed===true&&
   (c.memberships.a2_administrator_role_observed===true||c.memberships.a2_any_reported_write_permission===true)),
  build_credential_inventory_exhaustive:false,build_credential_restrictions_verified:false,effective_write_denial_verified:false,
  independent_admin_separation_verified:false,hosted_genesis_qualified:false,hosted_retirement_qualified:false,hosted_destructive_recovery_qualified:false,
  gate3_closed:false,B27:'FAILED_IN_SYNTHETIC_ATTACK',release_status:'NOT_RELEASE'};
}
async function main(){
 if(process.argv.length!==2||process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_REPOSITORY!=='evansmusitu/mft-axiom-build'||
  process.env.GITHUB_REF!=='refs/heads/build/axiom-gate3-provider-preflight-20261124'||process.env.AXIOM_G3_READONLY_PROVIDER_PROBE!=='qualified_get_only'){
  process.stderr.write('BUILD_READONLY_CONTEXT_REQUIRED_HOLD\n');process.exitCode=2;return;
 }
 try{process.stdout.write(JSON.stringify(await probeBuildCredentials())+'\n');}
 catch{process.stderr.write('BUILD_PROVIDER_READONLY_OBSERVATION_UNAVAILABLE_HOLD\n');process.exitCode=2;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
