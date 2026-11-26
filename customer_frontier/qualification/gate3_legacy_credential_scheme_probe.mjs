// Existing build-held legacy references only. Fixed-host GETs; never custody proof.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {parseIdentityJson} from '../customer_control_plane/zitadel_provider_tokens_candidate.mjs';
const A2='67469478aa9349fa0a57fe3a72da200a',SOURCE='93f395f5121954671f92fffa453d6b61';
const OWNER_PATH=new URL('../evidence/gate3_owner_provider_readback_20261124/OWNER_CUSTODY_PROVIDER_READBACK_20261126_042347Z_COMPLETE_METADATA.json',import.meta.url);
const OWNER_SHA='fad4a419c0c8c9b47d3b132f00ad1b9a3c573ea8fd0c85913f74d58c19989365';
const REFS=['CLOUDFLARE_GLOBAL_API_KEY','CLOUDFLARE_API_KEY'],HELD=[...REFS,'MUSITU_CLOUDFLARE_ADMIN_TOKEN','CLOUDFLARE_EMAIL'];
const hex32=x=>typeof x==='string'&&/^[a-f0-9]{32}$/.test(x),hex64=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const secret=x=>typeof x==='string'&&/^[A-Za-z0-9._~-]{16,200}$/.test(x);
const mail=x=>typeof x==='string'&&x.length<=254&&/^\S+@\S+\.\S+$/.test(x);
const hash=x=>createHash('sha256').update(x).digest('hex');
const stop=()=>{throw Error('LEGACY_SCHEME_READ_SCOPE_HOLD');};
const pub=r=>({state:r.state,http_status:r.http_status});
const bearer=x=>({authorization:'Bearer '+x});
function projection(policies){
 if(!Array.isArray(policies)||policies.length>100)return {metadata_observed:false};
 const rows=[];for(const p of policies){
  if(!['allow','deny'].includes(p?.effect)||!p.resources||typeof p.resources!=='object'||Array.isArray(p.resources)||!Array.isArray(p.permission_groups)||p.permission_groups.length>2048)return {metadata_observed:false};
  const keys=Object.keys(p.resources);let read=0,write=0,other=0;
  for(const g of p.permission_groups){if(typeof g?.name!=='string'){other++;continue;}
   if(/ (Read|Read-Only)$/.test(g.name)||g.name==='Magic Firewall Packet Captures - Read PCAPs API')read++;
   else if(/ (Write|Edit|Admin|Editor|Revoke|Run|Send|Bind|Evaluate|Provisioning|Purge)$/.test(g.name))write++;else other++;
  }
  rows.push({effect:p.effect,explicit_a2_resource:keys.includes('com.cloudflare.api.account.'+A2)&&p.resources['com.cloudflare.api.account.'+A2]==='*',all_account_resource:keys.includes('com.cloudflare.api.account.*')&&p.resources['com.cloudflare.api.account.*']==='*',read_named_groups:read,write_named_groups:write,other_groups:other});
 }
 return {metadata_observed:true,policies:rows,potential_a2_or_all_account_write_named_allow:rows.some(p=>p.effect==='allow'&&(p.explicit_a2_resource||p.all_account_resource)&&p.write_named_groups>0),full_effective_policy_verified:false};
}
export async function observeLegacyCredentialSchemes({env=process.env,fetchImpl=globalThis.fetch,ownerReceipt,timeoutMs=10000}={}){
 if(!ownerReceipt||ownerReceipt.schema!=='musitu.axiom.gate3.owner-custody-provider-readback.v1'||ownerReceipt.repository!=='evansmusitu/mft-axiom-build'||ownerReceipt.account_id!==A2||ownerReceipt.collection_complete!==true||!hex64(ownerReceipt.provider_principal_identifier_sha256)||!Array.isArray(ownerReceipt.user_tokens?.rows)||ownerReceipt.user_tokens.rows.length>50||!Number.isInteger(timeoutMs)||timeoutMs<20||timeoutMs>10000)stop();
 const protectedValues=HELD.map(k=>env[k]).filter(v=>typeof v==='string'&&v),clearId=id=>hex32(id)&&!protectedValues.some(v=>v.includes(id)||id.includes(v));
 let count=0;
 const allowed=path=>['/user','/user/tokens/verify',`/accounts/${A2}/tokens/verify`,`/accounts/${SOURCE}/tokens/verify`].includes(path)||/^\/user\/tokens\/[a-f0-9]{32}$/.test(path)||new RegExp('^/accounts/('+A2+'|'+SOURCE+')/tokens/[a-f0-9]{32}$').test(path);
 async function get(path,headers){
  if(!allowed(path)||++count>16||Object.hasOwn(headers,'cookie')||(Object.hasOwn(headers,'authorization')===Object.hasOwn(headers,'x-auth-key')))stop();
  const abort=new AbortController();let timer,reader,status=null;
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(Error('DEADLINE'));},timeoutMs);});
  try{
   const r=await Promise.race([fetchImpl(new Request('https://api.cloudflare.com/client/v4'+path,{method:'GET',redirect:'manual',credentials:'omit',cache:'no-store',signal:abort.signal,headers:{accept:'application/json',...headers}})),deadline]);
   if(!Number.isInteger(r?.status)||r.status<100||r.status>599)stop();status=r.status;
   if(status!==200){try{void r.body?.cancel().catch(()=>{});}catch{}return {http_status:status,state:status>=300&&status<400?'REDIRECT_NOT_FOLLOWED_UNKNOWN':'NON200_NOT_WRITE_DENIAL'};}
   reader=r.body?.getReader();if(!reader)stop();const chunks=[];let size=0;
   for(;;){const p=await Promise.race([reader.read(),deadline]);if(p.done)break;if(!(p.value instanceof Uint8Array)||(size+=p.value.length)>131072)stop();chunks.push(p.value);}
   const raw=new Uint8Array(size);let at=0;for(const p of chunks){raw.set(p,at);at+=p.length;}
   const d=parseIdentityJson(new TextDecoder('utf-8',{fatal:true}).decode(raw));
   if(d?.success!==true||!Array.isArray(d.errors)||d.errors.length||!Object.hasOwn(d,'result'))stop();
   return {http_status:status,state:'PROVIDER_GET_OBSERVED',data:d};
  }catch{return {http_status:status,state:'TRANSPORT_BODY_OR_ENVELOPE_UNKNOWN'};}
  finally{clearTimeout(timer);if(reader){try{void reader.cancel().catch(()=>{});}catch{}try{reader.releaseLock();}catch{}}}
 }
 const r={schema:'musitu.axiom.gate3.existing-legacy-scheme-observation.v1',observed_at_utc:new Date().toISOString(),execution_origin:'BUILD_CONTROLLED_NOT_INDEPENDENT_OPERATOR',account_id:A2,owner_metadata_observed_at_utc:ownerReceipt.observed_at_utc,subjects:[],provider_write_requests:0,credential_values_or_value_hashes_exported:false,build_credential_inventory_exhaustive:false,global_key_custody_qualified:false,independent_operator_custody_qualified:false,all_provider_write_denial_verified:false,gate3_closed:false,B27:'FAILED_IN_SYNTHETIC_ATTACK',parity_superiority:'NOT_CERTIFIED',unavailable_final_usage:'UNKNOWN',release_status:'NOT_RELEASE'};
 const reader=secret(env.MUSITU_CLOUDFLARE_ADMIN_TOKEN)?await get('/user',bearer(env.MUSITU_CLOUDFLARE_ADMIN_TOKEN)):{http_status:null,state:'METADATA_READER_UNAVAILABLE'};
 const profile=reader.data?.result,principal=clearId(profile?.id)&&mail(profile?.email)?profile:null;
 r.metadata_reader={...pub(reader),matches_owner_principal:!!principal&&hash('cloudflare-user-id\n'+principal.id)===ownerReceipt.provider_principal_identifier_sha256};
 r.configured_email_matches_metadata_principal=principal?env.CLOUDFLARE_EMAIL===principal.email:null;
 for(const reference of REFS){
  const value=env[reference],row={reference,global_key_attempts:[],bearer_verification_attempts:[],bearer_token_identifier_sha256:null,bearer_token_status:'UNKNOWN',revocation_verified:false};r.subjects.push(row);
  if(!secret(value)){row.state=value?'LOCAL_FORMAT_UNSUPPORTED_UNKNOWN':'NOT_AVAILABLE_IN_THIS_CONTEXT_NOT_ABSENCE';continue;}
  const emails=[];if(mail(env.CLOUDFLARE_EMAIL))emails.push(['recorded_ci_email',env.CLOUDFLARE_EMAIL]);if(principal&&principal.email!==env.CLOUDFLARE_EMAIL)emails.push(['provider_verified_principal_email',principal.email]);
  for(const [variant,email]of emails){const p=await get('/user',{'x-auth-key':value,'x-auth-email':email});const id=p.data?.result?.id;
   row.global_key_attempts.push({variant,...pub(p),principal_identifier_sha256:clearId(id)?hash('cloudflare-user-id\n'+id):null,matches_owner_principal:clearId(id)&&hash('cloudflare-user-id\n'+id)===ownerReceipt.provider_principal_identifier_sha256});
  }
  for(const [scope,path]of [['user','/user/tokens/verify'],['account_a2',`/accounts/${A2}/tokens/verify`],['account_source',`/accounts/${SOURCE}/tokens/verify`]]){
   const v=await get(path,bearer(value));row.bearer_verification_attempts.push({scope,...pub(v)});const t=v.data?.result;
   if(!clearId(t?.id)||!['active','disabled','expired'].includes(t.status))continue;
   const idHash=hash('cloudflare-token-id\n'+t.id);row.bearer_token_identifier_sha256=idHash;row.bearer_token_status=t.status;row.verification_scope=scope;
   const known=ownerReceipt.user_tokens.rows.find(x=>x.token_identifier_sha256===idHash);
   row.owner_user_token_inventory_match=!!known;row.owner_snapshot_all_account_write_named_allow=!!known&&known.policies?.some(p=>p.effect==='allow'&&(p.all_account_resource||p.explicit_a2_resource)&&p.potential_write_or_execute_named_groups>0)===true;
   if(r.metadata_reader.matches_owner_principal){
    const prefix=scope==='user'?'/user':scope==='account_a2'?'/accounts/'+A2:'/accounts/'+SOURCE;
    const details=await get(prefix+'/tokens/'+t.id,bearer(env.MUSITU_CLOUDFLARE_ADMIN_TOKEN)),d=details.data?.result;
    row.current_metadata={...pub(details),...(d?.id===t.id&&!Object.hasOwn(d,'value')?projection(d.policies):{metadata_observed:false})};
   }
   break;
  }
  row.state=row.bearer_token_status!=='UNKNOWN'?'BEARER_IDENTITY_OBSERVED_NOT_CUSTODY':row.global_key_attempts.some(a=>a.principal_identifier_sha256)?'GLOBAL_KEY_PRINCIPAL_OBSERVED_NOT_CUSTODY':'NO_CREDENTIAL_IDENTITY_QUALIFIED_NOT_REVOCATION_PROOF';
 }
 r.provider_get_requests=count;
 r.build_legacy_reference_matches_broad_owner_token=r.subjects.some(s=>s.bearer_token_status==='active'&&s.owner_snapshot_all_account_write_named_allow);
 r.build_global_key_matches_owner_principal=r.subjects.some(s=>s.global_key_attempts.some(a=>a.matches_owner_principal));
 r.status='EXISTING_LEGACY_SCHEMES_GET_OBSERVATIONS_CUSTODY_HOLD';
 if(protectedValues.some(v=>JSON.stringify(r).includes(v)))stop();return r;
}
async function main(){
 if(process.argv.length!==2||process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_EVENT_NAME!=='push'||process.env.GITHUB_REPOSITORY!=='evansmusitu/mft-axiom-build'||process.env.GITHUB_REF!=='refs/heads/build/axiom-gate3-custody-denial-20261124'||process.env.AXIOM_G3_LEGACY_SCHEMES_GET_ONLY!=='existing_legacy_schemes_get_only'){process.stderr.write('LEGACY_SCHEME_CONTEXT_REQUIRED_HOLD\n');process.exitCode=2;return;}
 try{const raw=readFileSync(OWNER_PATH);if(hash(raw)!==OWNER_SHA)stop();const owner=parseIdentityJson(raw.toString('utf8'));const result=await observeLegacyCredentialSchemes({ownerReceipt:owner});result.owner_metadata_file_sha256=OWNER_SHA;process.stdout.write(JSON.stringify(result)+'\n');}
 catch{process.stderr.write('LEGACY_SCHEME_OBSERVATION_UNAVAILABLE_HOLD\n');process.exitCode=2;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
