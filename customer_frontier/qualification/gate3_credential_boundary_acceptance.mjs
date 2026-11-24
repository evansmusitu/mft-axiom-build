// Separately scoped credential-boundary acceptance. No authority/customer state.
// Positive controls use new empty private buckets and binding-free previews only.
import {createHash,randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseIdentityJson} from '../customer_control_plane/zitadel_provider_tokens_candidate.mjs';
import {probeBuildCredentials,A2} from './gate3_build_credential_readonly_probe.mjs';
const SOURCE='93f395f5121954671f92fffa453d6b61',BASE='https://api.cloudflare.com/client/v4';
const SUBJECTS=['AXIOM_D1_RECOVERY_CF_API_TOKEN','MUSITU_CLOUDFLARE_ADMIN_TOKEN','CLOUDFLARE_API_TOKEN'];
const EXPECTED=['83eda64c33252d73b0ae28ebcb902d35d5aa081a7b43f77728924820021860f5','e2ca57fa6d971286e02a8f02050c53991ab79e3ccc8c958d46dbeaf8ed34f1a2','bf3d1b9b09d06a396f9e97846f6ed2c6de64e67184c3865d370610e6d0a925c6'];
const KEY_REFS=['CLOUDFLARE_GLOBAL_API_KEY','CLOUDFLARE_API_KEY'];
const REFLECTED_REFS=[...SUBJECTS,...KEY_REFS,'MUSITU_CF_STAGING_READ_TOKEN','CLOUDFLARE_EMAIL'];
const hex32=x=>typeof x==='string'&&/^[a-f0-9]{32}$/.test(x);
const bearer=x=>typeof x==='string'&&/^[A-Za-z0-9._~-]{16,200}$/.test(x);
const mail=x=>typeof x==='string'&&x.length<=254&&/^\S+@\S+\.\S+$/.test(x);
const capability=x=>typeof x==='string'&&x.length>=6&&x.length<=16000&&!/[\r\n\x00-\x1f]/.test(x);
const digest=x=>createHash('sha256').update(x).digest('hex');
const stop=()=>{throw Error('BOUNDARY_INPUT_OR_REQUEST_OUTSIDE_SCOPE');};
const auth=token=>({authorization:'Bearer '+token});
const publicResponse=r=>({http_status:r.http_status,state:r.state,provider_error_codes:r.error_codes||[]});
const skipped=reason=>({state:reason,denial_verified:false});
const sealedSource='export default {async fetch(){return new Response(null,{status:404});}};\n';
function previewForm(){
 const f=new FormData();
 f.set('metadata',new Blob([JSON.stringify({main_module:'worker.mjs',compatibility_date:'2026-11-24',bindings:[]})],{type:'application/json'}));
 f.set('worker.mjs',new Blob([sealedSource],{type:'application/javascript+module'}),'worker.mjs');
 f.set('wrangler-session-config',JSON.stringify({workers_dev:true,minimal_mode:false}));
 return f;
}
function transport(fetchImpl,nonce,timeoutMs){
 if(!hex32(nonce)||!Number.isInteger(timeoutMs)||timeoutMs<20||timeoutMs>10000)stop();
 const control='axiom-g3-ctrl-'+nonce,worker='axiom-g3-deny-'+nonce;
 const buckets=[control,...[0,1,2].map(i=>worker+'-'+i)],counts={GET:0,POST:0,DELETE:0};
 const permitted=(method,path,body,headers)=>{
  if(method==='GET'&&body===undefined&&(path==='/user'||/^\/memberships\?page=[1-5]&per_page=50&status=accepted$/.test(path)))return true;
  for(const account of [SOURCE,A2]){
   const prefix='/accounts/'+account;
   for(const name of buckets){
    const bucket=prefix+'/r2/buckets/'+name;
    if(method==='GET'&&body===undefined&&[bucket,bucket+'/domains/managed'].includes(path))return true;
    if(method==='DELETE'&&path===bucket&&body===undefined)return true;
   }
   if(method==='POST'&&path===prefix+'/r2/buckets'&&body&&Object.keys(body).join('|')==='name'&&buckets.includes(body.name))return true;
   const preview=prefix+'/workers/scripts/'+(account===SOURCE?control:worker);
   if(method==='GET'&&path===preview+'/subdomain/edge-preview'&&body===undefined)return true;
   if(method==='POST'&&path===preview+'/edge-preview'&&body instanceof FormData&&capability(headers['cf-preview-upload-config-token']))return true;
  }
  return false;
 };
 const api=async(method,path,headers,body)=>{
  if(!permitted(method,path,body,headers)||Object.values(counts).reduce((a,b)=>a+b,0)>=80)stop();
  const global=Object.hasOwn(headers,'x-auth-key'),token=Object.hasOwn(headers,'authorization');
  if(global===token||Object.hasOwn(headers,'cookie'))stop();counts[method]++;
  const abort=new AbortController();let timer,reader;
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(Error('DEADLINE'));},timeoutMs);});
  try{
   const multipart=body instanceof FormData;
   const req=new Request(BASE+path,{method,redirect:'manual',cache:'no-store',credentials:'omit',signal:abort.signal,
    headers:{accept:'application/json',...headers,...(body!==undefined&&!multipart?{'content-type':'application/json'}:{})},
    ...(body===undefined?{}:{body:multipart?body:JSON.stringify(body)})});
   const r=await Promise.race([fetchImpl(req),deadline]);
   if(!Number.isInteger(r?.status))return {http_status:null,state:'INVALID_RESPONSE_UNKNOWN'};
   if(r.status>=300&&r.status<400){try{void r.body?.cancel().catch(()=>{});}catch{}return {http_status:r.status,state:'REDIRECT_NOT_FOLLOWED_UNKNOWN'};}
   reader=r.body?.getReader();if(!reader)return {http_status:r.status,state:'INVALID_BODY_UNKNOWN'};
   const chunks=[];let size=0;
   for(;;){const p=await Promise.race([reader.read(),deadline]);if(p.done)break;
    if(!(p.value instanceof Uint8Array)||(size+=p.value.byteLength)>131072)stop();chunks.push(p.value);}
   const raw=new Uint8Array(size);let at=0;for(const part of chunks){raw.set(part,at);at+=part.length;}
   const d=parseIdentityJson(new TextDecoder('utf-8',{fatal:true}).decode(raw));
   if(!d||!Array.isArray(d.errors)||![true,false].includes(d.success))return {http_status:r.status,state:'INVALID_PROVIDER_ENVELOPE_UNKNOWN'};
   const error_codes=[...new Set(d.errors.map(e=>e?.code).filter(n=>Number.isInteger(n)&&n>=0&&n<=999999999))].slice(0,10);
   if(d.success===true&&d.errors.length===0&&r.status>=200&&r.status<300&&Object.hasOwn(d,'result'))return {http_status:r.status,state:'VALID_PROVIDER_SUCCESS',valid:true,result:d.result,pagination:d.result_info,error_codes};
   if(d.success===false&&d.errors.length>0&&error_codes.length>0&&r.status>=400)return {http_status:r.status,state:'VALID_PROVIDER_REJECTION',rejected:true,error_codes};
   return {http_status:r.status,state:'INCONSISTENT_PROVIDER_RESPONSE_UNKNOWN',error_codes};
  }catch{return {http_status:null,state:'TRANSPORT_OR_BODY_OUTCOME_UNKNOWN'};}
  finally{clearTimeout(timer);if(reader){try{void reader.cancel().catch(()=>{});}catch{}try{reader.releaseLock();}catch{}}}
 };
 return {api,counts,control,worker,buckets};
}
async function membershipRead(api,headers){
 const out={complete:false,a2_membership_observed:null,a2_administrator_role_observed:false,a2_any_reported_write_permission:false},seen=new Set();let total=0;
 for(let page=1;page<=5;page++){
  const r=await api('GET',`/memberships?page=${page}&per_page=50&status=accepted`,headers);
  out.last_http_status=r.http_status;
  if(!r.valid||!Array.isArray(r.result)||r.result.length>50)return out;
  for(const m of r.result){
   if(!hex32(m?.account?.id)||seen.has(m.account.id)||m.status!=='accepted')return out;
   seen.add(m.account.id);total++;
   if(m.account.id===A2){
    out.a2_membership_observed=true;out.a2_administrator_role_observed=Array.isArray(m.roles)&&m.roles.some(x=>typeof x==='string'&&['administrator','account administrator','super administrator','super administrator - all privileges','owner'].includes(x.toLowerCase()));
    out.a2_any_reported_write_permission=!!m.permissions&&typeof m.permissions==='object'&&Object.values(m.permissions).some(p=>p&&typeof p==='object'&&p.write===true);
    out.modern_membership_policies_present=Array.isArray(m.policies);
   }
  }
  const info=r.pagination;out.pages=page;out.rows_observed=total;
  if(!info||info.page!==page||info.count!==r.result.length||!Number.isInteger(info.per_page)||info.per_page<1||info.per_page>50||r.result.length>info.per_page||
   !Number.isInteger(info.total_count)||info.total_count<total||info.total_count>250)return out;
  if(total===info.total_count){out.complete=true;out.a2_membership_observed=seen.has(A2);return out;}
  if(r.result.length===0)return out;
 }
 return out;
}
async function globalCustodyRead(api,env){
 const protectedValues=new Set(REFLECTED_REFS.map(k=>env[k]).filter(x=>typeof x==='string'&&x));
 const profile=bearer(env.MUSITU_CLOUDFLARE_ADMIN_TOKEN)?await api('GET','/user',auth(env.MUSITU_CLOUDFLARE_ADMIN_TOKEN)):{state:'METADATA_TOKEN_UNAVAILABLE',http_status:null};
 const owner=profile.valid&&hex32(profile.result?.id)&&!protectedValues.has(profile.result.id)&&mail(profile.result?.email)?profile.result:null;
 const keys=[];
 for(const reference of KEY_REFS){
  const key=env[reference],row={reference,verified_principal_identifier_sha256:null,attempts:[],revocation_verified:false,custody_qualified:false};keys.push(row);
  if(!bearer(key)){row.state='NOT_AVAILABLE_OR_FORMAT_UNSUPPORTED_IN_THIS_CONTEXT';continue;}
  const variants=[];if(mail(env.CLOUDFLARE_EMAIL))variants.push(['recorded_ci_email',env.CLOUDFLARE_EMAIL]);
  if(owner&&owner.email!==env.CLOUDFLARE_EMAIL)variants.push(['provider_verified_metadata_principal_email',owner.email]);
  for(const [variant,email]of variants){
   const headers={'x-auth-key':key,'x-auth-email':email},r=await api('GET','/user',headers);
   row.attempts.push({variant,...publicResponse(r)});
   if(r.valid&&hex32(r.result?.id)&&!protectedValues.has(r.result.id)){
    row.verified_principal_identifier_sha256=digest('cloudflare-user-id\n'+r.result.id);row.state='PRINCIPAL_GET_VERIFIED_NOT_CUSTODY';
    row.matches_metadata_token_principal=!!owner&&r.result.id===owner.id;row.memberships=await membershipRead(api,headers);break;
   }
  }
  row.state??='NO_PRINCIPAL_VERIFIED_FOR_TESTED_IDENTITIES_NOT_REVOCATION_PROOF';
 }
 return {execution_origin:'BUILD_CONTROLLED_NOT_INDEPENDENT_OPERATOR',metadata_principal_get:publicResponse(profile),
  metadata_principal_identifier_sha256:owner?digest('cloudflare-user-id\n'+owner.id):null,
  recorded_ci_email_matches_metadata_principal:owner?owner.email===env.CLOUDFLARE_EMAIL:null,keys,
  global_key_a2_administrator_membership_observed:keys.some(k=>k.memberships?.a2_membership_observed===true&&(k.memberships?.a2_administrator_role_observed===true||k.memberships?.a2_any_reported_write_permission===true)),
  alternative_reference_availability:{MUSITU_CF_STAGING_READ_TOKEN:!!env.MUSITU_CF_STAGING_READ_TOKEN,CLOUDFLARE_API_KEY:!!env.CLOUDFLARE_API_KEY},
  exhaustive_inventory:false,independent_custody_qualified:false};
}
const subject=(r,ref)=>r?.credentials?.find(c=>c.reference===ref);
const policy=c=>c?.verification?.existing_build_metadata_reader?.policy_metadata||c?.verification?.policy_metadata;
function preconditions(r,env){
 if(r?.schema!=='musitu.axiom.gate3.build-credential-readonly-observation.v1'||r.account_id!==A2)return false;
 for(let i=0;i<SUBJECTS.length;i++){
  const c=subject(r,SUBJECTS[i]);if(!bearer(env[SUBJECTS[i]])||c?.verification?.token_status!=='active'||c.verification.token_identifier_sha256!==EXPECTED[i]||policy(c)?.policy_metadata_observed!==true)return false;
  if(i<2&&policy(c).policies.some(p=>p.write_named_groups!==0||p.documented_non_read_groups!==0||p.registry_unresolved_nonstandard_groups!==0))return false;
  if(policy(c).potential_a2_write_allow_policy_observed||policy(c).potential_a2_documented_non_read_allow_policy_observed)return false;
 }
 return true;
}
const projection=r=>JSON.stringify(SUBJECTS.map(ref=>{const c=subject(r,ref);return {reference:ref,status:c?.verification?.token_status,identifier:c?.verification?.token_identifier_sha256,policy:policy(c)};}));
async function previewSession(api,account,name,headers){
 const r=await api('GET',`/accounts/${account}/workers/scripts/${name}/subdomain/edge-preview`,headers);
 return {public:publicResponse(r),token:r.valid&&capability(r.result?.token)?r.result.token:null};
}
async function previewWrite(api,account,name,headers,token){
 return api('POST',`/accounts/${account}/workers/scripts/${name}/edge-preview`,{...headers,'cf-preview-upload-config-token':token},previewForm());
}
const denied=r=>r.http_status===403&&r.rejected===true;
const created=(r,name)=>r.valid===true&&r.result?.name===name;
async function deleteAcknowledgedEmptyBucket(api,account,name,headers){
 // Cloudflare DELETE refuses objects, multipart uploads or notification rules.
 // No force/delete-object/retention endpoint exists in this allowlist.
 const r=await api('DELETE',`/accounts/${account}/r2/buckets/${name}`,headers);
 const read=await api('GET',`/accounts/${account}/r2/buckets/${name}`,headers);
 return {...publicResponse(r),deletion_acknowledged:r.valid===true,readback:publicResponse(read),removed:read.http_status===404&&read.rejected===true};
}
export async function runCredentialBoundaryAcceptance({env=process.env,fetchImpl=globalThis.fetch,nonce=randomBytes(16).toString('hex'),timeoutMs=5000,preflightFn=probeBuildCredentials}={}){
 const {api,counts,control,worker}=transport(fetchImpl,nonce,timeoutMs);
 const r={schema:'musitu.axiom.gate3.credential-boundary-acceptance.v1',observed_at_utc:new Date().toISOString(),nonce,
  target_account:A2,positive_control_account:SOURCE,control_bucket_name:control,preview_canary_name:worker,
  subjects:[],controls:{},possible_orphan_bucket_names:[],unexpected_write_observed:false,subject_identity_and_policy_stable:false,
  bounded_write_denial_tests_passed:false,all_provider_write_denial_verified:false,global_key_custody_verified:false,alternative_credential_inventory_exhaustive:false,provider_write_attempts:0,
  independent_operator_custody_qualified:false,gate3_closed:false,hosted_genesis_qualified:false,hosted_retirement_qualified:false,hosted_destructive_recovery_qualified:false,
  B27:'FAILED_IN_SYNTHETIC_ATTACK',parity_superiority:'NOT_CERTIFIED',unavailable_final_usage:'UNKNOWN',release_status:'NOT_RELEASE'};
 let before,after;try{before=await preflightFn({env,fetchImpl,timeoutMs});}catch{}
 r.global_custody=await globalCustodyRead(api,env);
 r.preconditions_passed=preconditions(before,env);
 if(!r.preconditions_passed){r.status='PINNED_ACTIVE_SUBJECT_AND_CURRENT_POLICY_PRECONDITION_HOLD';r.boundary_request_counts=counts;return r;}
 const source=auth(env.CLOUDFLARE_API_TOKEN),metadata=auth(env.MUSITU_CLOUDFLARE_ADMIN_TOKEN);
 const sourceSession=await previewSession(api,SOURCE,control,source),targetSession=await previewSession(api,A2,worker,metadata);
 r.controls.worker_source_session=sourceSession.public;r.controls.worker_target_session=targetSession.public;
 if(sourceSession.token){
  const p=await previewWrite(api,SOURCE,control,source,sourceSession.token);
  r.controls.worker_preview={...publicResponse(p),passed:p.valid===true&&capability(p.result?.preview_token),deployment_performed:false,bindings:0,preview_invoked:false};
 }else r.controls.worker_preview={state:'SOURCE_PREVIEW_SESSION_UNAVAILABLE',passed:false};
 const bucketPath=`/accounts/${SOURCE}/r2/buckets/${control}`,missing=await api('GET',bucketPath,source);
 r.controls.r2_bucket={before:publicResponse(missing),passed:false,cleanup_verified:false};
 let uncertain=false;
 if(missing.http_status===404&&missing.rejected){
  const made=await api('POST',`/accounts/${SOURCE}/r2/buckets`,source,{name:control});
  Object.assign(r.controls.r2_bucket,{creation:publicResponse(made),created:created(made,control)});
  if(created(made,control)){
   const privateDomain=await api('GET',bucketPath+'/domains/managed',source);
   r.controls.r2_bucket.private_managed_domain_disabled=privateDomain.valid===true&&privateDomain.result?.enabled===false;
   const cleanup=await deleteAcknowledgedEmptyBucket(api,SOURCE,control,source);r.controls.r2_bucket.cleanup=cleanup;r.controls.r2_bucket.cleanup_verified=cleanup.removed;
   r.controls.r2_bucket.passed=cleanup.removed&&r.controls.r2_bucket.private_managed_domain_disabled;
   if(!cleanup.removed)r.possible_orphan_bucket_names.push(control);
  }else if(made.http_status===null||(made.http_status>=200&&made.http_status<300)){uncertain=true;r.possible_orphan_bucket_names.push(control);}
 }
 if(!uncertain&&r.possible_orphan_bucket_names.length===0){
  for(let i=0;i<SUBJECTS.length;i++){
   const reference=SUBJECTS[i],headers=auth(env[reference]),row={reference,provider_token_identifier_sha256:EXPECTED[i],worker_preview:skipped('VALID_WORKER_CONTROL_OR_TARGET_SESSION_UNAVAILABLE'),r2_bucket_create:skipped('VALID_R2_CONTROL_UNAVAILABLE')};r.subjects.push(row);
   if(r.controls.worker_preview.passed&&targetSession.token){
    const attempted=await previewWrite(api,A2,worker,headers,targetSession.token);
    row.worker_preview={...publicResponse(attempted),denial_verified:denied(attempted),valid_positive_control:true,valid_target_session:true};
    if(attempted.valid){r.unexpected_write_observed=true;row.worker_preview.state='UNEXPECTED_PRIVATE_PREVIEW_CREATED_DENIAL_FAILED';break;}
   }
   if(r.controls.r2_bucket.passed){
    const name=worker+'-'+i,absent=await api('GET',`/accounts/${A2}/r2/buckets/${name}`,metadata);
    if(absent.http_status===404&&absent.rejected){
     const attempted=await api('POST',`/accounts/${A2}/r2/buckets`,headers,{name});
     row.r2_bucket_create={...publicResponse(attempted),canary_bucket_name:name,denial_verified:denied(attempted),valid_positive_control:true,precreation_absence_observed:true};
     if(created(attempted,name)){
      r.unexpected_write_observed=true;row.r2_bucket_create.cleanup=await deleteAcknowledgedEmptyBucket(api,A2,name,headers);
      if(!row.r2_bucket_create.cleanup.removed)r.possible_orphan_bucket_names.push(name);break;
     }
     if(attempted.http_status===null||(attempted.http_status>=200&&attempted.http_status<300)){r.possible_orphan_bucket_names.push(name);break;}
    }else row.r2_bucket_create=skipped('TARGET_CANARY_ABSENCE_NOT_VERIFIED');
   }
  }
 }
 try{after=await preflightFn({env,fetchImpl,timeoutMs});}catch{}
 r.subject_identity_and_policy_stable=preconditions(after,env)&&projection(before)===projection(after);
 r.bounded_write_denial_tests_passed=r.subject_identity_and_policy_stable&&!r.unexpected_write_observed&&r.possible_orphan_bucket_names.length===0&&r.subjects.length===3&&r.subjects.every(s=>s.worker_preview.denial_verified&&s.r2_bucket_create.denial_verified);
 r.status=r.bounded_write_denial_tests_passed?'BOUNDED_WORKER_PREVIEW_AND_R2_CREATE_DENIALS_PASSED_CUSTODY_HOLD':'BOUNDED_DENIAL_TESTS_PARTIAL_OR_FAILED_CUSTODY_HOLD';
 r.preflight_get_requests=before.provider_get_requests;r.postflight_get_requests=after?.provider_get_requests??null;r.boundary_request_counts={...counts};
 r.provider_write_attempts=counts.POST+counts.DELETE;r.authority_worker_changed=false;r.retained_bucket_or_customer_state_targeted=false;
 return r;
}
async function main(){
 if(process.argv.length!==2||process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_EVENT_NAME!=='push'||process.env.GITHUB_REPOSITORY!=='evansmusitu/mft-axiom-build'||
  process.env.GITHUB_REF!=='refs/heads/build/axiom-gate3-custody-denial-20261124'||process.env.AXIOM_G3_WRITE_DENIAL_RUN!=='bounded_disposable_canaries_v1'){
  process.stderr.write('BOUNDARY_CONTEXT_REQUIRED_HOLD\n');process.exitCode=2;return;
 }
 try{const result=await runCredentialBoundaryAcceptance();process.stdout.write(JSON.stringify(result)+'\n');
  if(!result.bounded_write_denial_tests_passed)process.exitCode=2;
 }catch{process.stderr.write('CREDENTIAL_BOUNDARY_OUTCOME_UNKNOWN_HOLD\n');process.exitCode=2;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
