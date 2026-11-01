/** Provider-origin metadata only; never requests inference or changes roles. */
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {ACCOUNT_ID} from './workers-ai-free-preflight.mjs';
import {inspectProviderGates} from './provider-gates-readonly-20261101.mjs';
const digest=value=>createHash('sha256').update('axiom-authority-audit-v1:'+String(value)).digest('hex');
const knownBoolean=value=>typeof value==='boolean'?value:'NOT_EXPOSED';
export function sanitizedMember(member){
  return {member_sha256:typeof member.id==='string'?digest(member.id):null,user_sha256:typeof member.user?.id==='string'?digest(member.user.id):null,
    status:['accepted','pending','invited'].includes(member.status)?member.status:'UNKNOWN',
    roles:(Array.isArray(member.roles)?member.roles:[]).map(role=>({id_sha256:typeof role.id==='string'?digest(role.id):null,name:typeof role.name==='string'?role.name.slice(0,100):null})),
    mfa_enabled:knownBoolean(member.user?.two_factor_authentication_enabled),private_identity_values_retained:false};
}
export async function readAuthorityRoles({token,fetchImpl=fetch}={}){
  const result={account_id:ACCOUNT_ID,observed_at:new Date().toISOString(),remote_writes:0,independent_custody_proven:false,checks:{}};
  async function get(path){
    if(!(path==='/user'||path===`/accounts/${ACCOUNT_ID}`||path.startsWith(`/accounts/${ACCOUNT_ID}/members?`)))throw Error('read-only authority path rejected');
    const response=await fetchImpl('https://api.cloudflare.com/client/v4'+path,{method:'GET',headers:{authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(20000)}),data=await response.json();
    if(!response.ok||data.success!==true)throw Object.assign(new Error('provider role metadata unavailable'),{http_status:response.status,codes:(data.errors??[]).map(e=>e.code)});
    return data;
  }
  const capture=async(name,action)=>{try{result.checks[name]={status:'OBSERVED',value:await action()};}catch(e){result.checks[name]={status:'UNAVAILABLE',http_status:e.http_status??null,codes:e.codes??null};}};
  await capture('account',async()=>{const {result:a}=await get(`/accounts/${ACCOUNT_ID}`);return {id:a.id,name:a.name,account_matches_known_production:a.id===ACCOUNT_ID,enforce_twofactor:knownBoolean(a.settings?.enforce_twofactor),independent_custody_proven:false};});
  await capture('members',async()=>{
    const members=[];for(let page=1;page<=10;page++){
      const data=await get(`/accounts/${ACCOUNT_ID}/members?per_page=50&page=${page}`);if(!Array.isArray(data.result))throw Error('member list missing');members.push(...data.result.map(sanitizedMember));
      if(data.result.length<50||data.result_info?.total_pages&&page>=data.result_info.total_pages)return {count:members.length,members,pagination_exhausted:true};
    }throw Error('member inventory pagination bound reached');
  });
  await capture('token_actor',async()=>{const {result:u}=await get('/user');return {user_sha256:typeof u.id==='string'?digest(u.id):null,mfa_enabled:knownBoolean(u.two_factor_authentication_enabled),private_identity_values_retained:false};});
  return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  if(process.env.GITHUB_REPOSITORY!=='evansmusitu/mft-axiom-build'||process.env.GITHUB_RUN_ATTEMPT!=='1')throw Error('authorized one-shot repository runner required');
  const out=resolve('qualification/whole-system-20261029/gates09-results');mkdirSync(out,{recursive:true});
  const token=process.env.CLOUDFLARE_API_TOKEN;if(!token?.trim())throw Error('existing Cloudflare credential required');
  const end=new Date().toISOString().replace(/\.\d{3}Z$/,'Z');
  const provider=await inspectProviderGates({token,savedWindow:{start:'2026-11-01T15:40:00Z',end},observe:r=>writeFileSync(resolve(out,'provider-readback.json'),JSON.stringify(r,null,2)+'\n')});
  const authority=await readAuthorityRoles({token});writeFileSync(resolve(out,'authority-roles.json'),JSON.stringify(authority,null,2)+'\n');
  const summary={schema:'musitu.axiom.gates09-readonly.v1',source_sha:process.env.AXIOM_ACCEPTANCE_SOURCE_SHA,observed_at:new Date().toISOString(),inference_calls:0,remote_writes:0,
    provider_abort:provider.checks.saved_request_rows?.value?.classification??null,authority_checks:Object.fromEntries(Object.entries(authority.checks).map(([name,value])=>[name,value.status])),
    independent_verifier_accepted:false,independent_custody_proven:false,anti_rollback_certified:false,release_authorized:false};
  writeFileSync(resolve(out,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
}
