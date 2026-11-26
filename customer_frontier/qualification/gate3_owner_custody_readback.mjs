// Owner-local, GET-only provider inventory. No key creation, rotation or signing.
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseIdentityJson} from '../customer_control_plane/zitadel_provider_tokens_candidate.mjs';
const A2='67469478aa9349fa0a57fe3a72da200a',REPO='evansmusitu/mft-axiom-build',REPO_ID=1356837528;
const KNOWN=new Map([
 ['83eda64c33252d73b0ae28ebcb902d35d5aa081a7b43f77728924820021860f5','AXIOM_D1_RECOVERY_CF_API_TOKEN'],
 ['e2ca57fa6d971286e02a8f02050c53991ab79e3ccc8c958d46dbeaf8ed34f1a2','MUSITU_CLOUDFLARE_ADMIN_TOKEN'],
 ['bf3d1b9b09d06a396f9e97846f6ed2c6de64e67184c3865d370610e6d0a925c6','CLOUDFLARE_API_TOKEN']]);
const CF_REFS=[...KNOWN.values(),'CLOUDFLARE_GLOBAL_API_KEY','CLOUDFLARE_API_KEY','MUSITU_CF_STAGING_READ_TOKEN','CLOUDFLARE_EMAIL'];
const hex32=x=>typeof x==='string'&&/^[a-f0-9]{32}$/.test(x);
const hash=x=>createHash('sha256').update(x).digest('hex');
const fail=()=>{throw Error('OWNER_READBACK_INPUT_OR_SCOPE_INVALID');};
const safeString=(x,max=200)=>typeof x==='string'&&x.length>0&&x.length<=max&&!/[\x00-\x1f\x7f]/.test(x);
const cfPath=p=>['/user','/user/tokens/verify',`/accounts/${A2}/tokens/verify`,`/accounts/${A2}/r2/buckets/musitu-axiom-b27-highwater-a2/lock`,`/accounts/${A2}/workers/scripts/axiom-security-authority2-highwater/settings`].includes(p)||
 new RegExp('^(/user/tokens|/accounts/'+A2+'/tokens)\\?page=[1-5]&per_page=(10|50)&include_expired=true$').test(p)||
 new RegExp('^(/memberships|/accounts/'+A2+'/members)\\?page=[1-5]&per_page=50'+ '(?:&status=accepted)?$').test(p);
const ghPath=p=>p==='/repos/'+REPO||new RegExp('^/repos/'+REPO+'/(actions/(secrets|variables)|environments)\\?per_page=100&page=[1-5]$').test(p)||
 new RegExp('^/repos/'+REPO+'/environments/[^/?#]+/(secrets|variables)\\?per_page=100&page=[1-5]$').test(p);
function providerClient(credential,fetchImpl,timeoutMs){
 if(!Number.isInteger(timeoutMs)||timeoutMs<20||timeoutMs>10000)fail();
 const headers=credential.kind==='global_key'?{'x-auth-key':credential.secret,'x-auth-email':credential.email}:{authorization:'Bearer '+credential.secret};let count=0;
 const knownCodes=new Set(['ECONNRESET','ECONNREFUSED','ENOTFOUND','EAI_AGAIN','ETIMEDOUT','ENETUNREACH','EHOSTUNREACH','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','CERT_HAS_EXPIRED','DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE','ERR_TLS_CERT_ALTNAME_INVALID']);
 const transientCodes=new Set(['ECONNRESET','EAI_AGAIN','ETIMEDOUT','ENETUNREACH','EHOSTUNREACH','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT']);
 async function read(path){
  if(!cfPath(path)||++count>32)fail();const abort=new AbortController();let timer,reader,timedOut=false,httpStatus=null,size=0,phase='REQUEST_BUILD',media='NONE',shape,exceptionKind='NONE';
  const diagnostic=(codes=[])=>({phase,exception_kind:exceptionKind,timeout_ms:timeoutMs,body_bytes_received:Math.min(size,1048577),response_media_type:media,network_error_codes:codes,...(shape?{envelope_shape:shape}:{})});
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{timedOut=true;abort.abort();reject(Error('OWNER_READ_DEADLINE'));},timeoutMs);});
  try{
   const req=new Request('https://api.cloudflare.com/client/v4'+path,{method:'GET',headers:{accept:'application/json',...headers},redirect:'manual',credentials:'omit',cache:'no-store',signal:abort.signal});phase='FETCH_HEADERS';
   const r=await Promise.race([fetchImpl(req),deadline]);
   if(!Number.isInteger(r?.status)||r.status<100||r.status>599)fail();httpStatus=r.status;
   const type=r.headers?.get?.('content-type')||'';media=/^application\/json(?:\s*;|$)/i.test(type)?'JSON':/^text\/html(?:\s*;|$)/i.test(type)?'HTML':type?'OTHER':'NONE';
   if(r.status!==200){phase='HTTP_STATUS';try{void r.body?.cancel().catch(()=>{});}catch{}return {http_status:r.status,state:'PROVIDER_READ_UNAVAILABLE_NOT_ABSENCE',diagnostic:diagnostic(),retryable:[502,503,504].includes(r.status)};}
   phase='BODY_READ';
   reader=r.body?.getReader();if(!reader)fail();const parts=[];
   for(;;){const p=await Promise.race([reader.read(),deadline]);if(p.done)break;if(!(p.value instanceof Uint8Array)||(size+=p.value.length)>1048576)fail();parts.push(p.value);}
   const raw=new Uint8Array(size);let at=0;for(const p of parts){raw.set(p,at);at+=p.length;}
   phase='JSON_PARSE';const d=parseIdentityJson(new TextDecoder('utf-8',{fatal:true}).decode(raw));
   phase='ENVELOPE_CHECK';shape={success_type:typeof d?.success,success_is_true:d?.success===true,errors_kind:d?.errors===null?'NULL':Array.isArray(d?.errors)?'ARRAY':d?.errors===undefined?'ABSENT':typeof d.errors,errors_count:Array.isArray(d?.errors)?d.errors.length:null};
   if(d?.success!==true||!Array.isArray(d.errors)||d.errors.length)fail();phase='COMPLETE';return {http_status:200,state:'PROVIDER_READ_OBSERVED',data:d,diagnostic:diagnostic()};
  }catch(error){
   exceptionKind=['Error','TypeError','RangeError','AbortError','SyntaxError'].includes(error?.name)?error.name:'OTHER';
   const codes=[...new Set([error?.code,error?.cause?.code,...(Array.isArray(error?.cause?.errors)?error.cause.errors.slice(0,6).map(e=>e?.code):[])].filter(c=>knownCodes.has(c)))];
   const state=timedOut?'PROVIDER_READ_DEADLINE_UNKNOWN':phase==='JSON_PARSE'?'PROVIDER_JSON_INVALID_UNKNOWN':phase==='ENVELOPE_CHECK'?'PROVIDER_ENVELOPE_INVALID_UNKNOWN':phase==='BODY_READ'?'PROVIDER_BODY_READ_UNKNOWN':'PROVIDER_TRANSPORT_UNKNOWN';
   const tlsFailure=codes.some(c=>['CERT_HAS_EXPIRED','DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE','ERR_TLS_CERT_ALTNAME_INVALID'].includes(c));
   return {http_status:httpStatus,state,diagnostic:diagnostic(codes),retryable:!tlsFailure&&(timedOut||codes.some(c=>transientCodes.has(c)))};
  }
  finally{clearTimeout(timer);if(reader){try{void reader.cancel().catch(()=>{});}catch{}try{reader.releaseLock();}catch{}}}
 }
 return {get count(){return count;},async get(path){
  const first=await read(path);
  // Only the fixed owner-profile GET can retry, once. Refusals, malformed
  // JSON/envelopes and TLS failures do not justify changing auth or security.
  if(path==='/user'&&first.retryable){await new Promise(resolve=>setTimeout(resolve,200));const second=await read(path);return {...second,attempts:[pub(first),pub(second)]};}
  return {...first,attempts:[pub(first)]};
 }};
}
const pub=r=>({state:r.state,http_status:r.http_status,...(r.diagnostic?{diagnostic:r.diagnostic}:{}),...(r.attempts?{attempts:r.attempts}:{})});
async function cfPages(api,base,perPage,project){
 const rows=[],ids=new Set(),maxRows=base.endsWith('/tokens')?50:250;
 const out={complete:false,pages:0,rows,completeness_reason:'PAGE_BUDGET_EXHAUSTED',pagination_observations:[]};
 const number=n=>Number.isInteger(n)&&n>=0&&n<=1000000000?n:null;let priorTotal,priorSize;
 for(let page=1;page<=5;page++){
  const path=base+`?page=${page}&per_page=${perPage}`+(base.endsWith('/tokens')?'&include_expired=true':base==='/memberships'?'&status=accepted':'');
  const r=await api.get(path);out.last_read=pub(r);out.pages=page;const data=r.data,items=data?.result,info=data?.result_info;
  out.pagination_observations.push({requested_page:page,requested_per_page:perPage,returned_rows:Array.isArray(items)?items.length:null,reported_page:number(info?.page),reported_per_page:number(info?.per_page),reported_count:number(info?.count),reported_total_count:number(info?.total_count)});
  if(!Array.isArray(items)||items.length>perPage){out.completeness_reason='RESULT_SHAPE_OR_PAGE_SIZE_INVALID';return out;}
  if(!info||info.page!==page||info.count!==items.length||!Number.isInteger(info.per_page)||info.per_page<1||info.per_page>perPage||items.length>info.per_page||!Number.isInteger(info.total_count)||info.total_count<rows.length+items.length||info.total_count>maxRows){out.completeness_reason='PAGINATION_INVALID_OR_OVER_BUDGET';return out;}
  if(priorTotal!==undefined&&(priorTotal!==info.total_count||priorSize!==info.per_page)){out.completeness_reason='PAGINATION_CHANGED';return out;}
  priorTotal=info.total_count;priorSize=info.per_page;
  const pageIds=new Set();
  for(const item of items){if(!hex32(item?.id)||ids.has(item.id)||pageIds.has(item.id)){out.completeness_reason='DUPLICATE_OR_INVALID_IDENTIFIER';return out;}pageIds.add(item.id);}
  for(const item of items){ids.add(item.id);rows.push(project(item));}
  if(rows.length===info.total_count){out.complete=true;out.completeness_reason='COMPLETE_VALIDATED_PAGINATION';return out;}
  if(items.length===0){out.completeness_reason='EMPTY_PAGE_BEFORE_REPORTED_TOTAL';return out;}
 }
 return out;
}
function policySummary(policies){
 if(!Array.isArray(policies)||policies.length>100)return {metadata_available:false};
 const rows=[];
 for(const p of policies){
  if(!['allow','deny'].includes(p?.effect)||!p.resources||typeof p.resources!=='object'||Array.isArray(p.resources)||!Array.isArray(p.permission_groups)||p.permission_groups.length>2048)return {metadata_available:false};
  const keys=Object.keys(p.resources);let a2=false,all=false,unknown=false,read=0,write=0,other=0;
  for(const key of keys){if(key==='com.cloudflare.api.account.'+A2)a2=true;else if(key==='com.cloudflare.api.account.*')all=true;else if(!/^com\.cloudflare\.api\.account\.[a-f0-9]{32}$/.test(key))unknown=true;if(p.resources[key]!=='*')unknown=true;}
  for(const g of p.permission_groups){
   if(typeof g?.name!=='string'){other++;continue;}
   if(/ (Read|Read-Only)$/.test(g.name)||g.name==='Magic Firewall Packet Captures - Read PCAPs API')read++;
   else if(/ (Write|Edit|Admin|Editor|Revoke|Run|Send|Bind|Evaluate|Provisioning|Purge)$/.test(g.name))write++;else other++;
  }
  rows.push({effect:p.effect,explicit_a2_resource:a2,all_account_resource:all,unclassified_resource_scope:unknown,read_named_groups:read,potential_write_or_execute_named_groups:write,other_groups:other});
 }
 return {metadata_available:true,policies:rows,full_effective_policy_verified:false};
}
async function ghPages(ghGet,base,key){
 const rows=[],seen=new Set(),out={complete:false,rows,pages:0};
 for(let page=1;page<=5;page++){
  const r=await ghGet(base+`?per_page=100&page=${page}`);out.pages=page;out.last_state=r?.state||'GITHUB_METADATA_UNAVAILABLE';const d=r?.data,items=d?.[key];
  if(!Array.isArray(items)||items.length>100||!Number.isInteger(d.total_count)||d.total_count>500)return out;
  for(const row of items){if(!safeString(row?.name,100)||seen.has(row.name))return out;seen.add(row.name);rows.push(row.name);}
  if(rows.length===d.total_count){out.complete=true;return out;}if(items.length===0||rows.length>d.total_count)return out;
 }
 return out;
}
function githubClient(executable){
 let started=null,calls=0;
 return async path=>{
  if(!ghPath(path))fail();if(!safeString(executable,1024))return {state:'GITHUB_CLI_NOT_AVAILABLE'};
  started??=Date.now();if(++calls>80||Date.now()-started>=120000)return {state:'GITHUB_METADATA_BUDGET_EXHAUSTED_NOT_COMPLETE'};
  try{
   const childEnv=Object.fromEntries(Object.entries(process.env).filter(([key])=>!(/CLOUDFLARE|AXIOM_D1_RECOVERY|OWNER_CREDENTIAL/.test(key))));
   const r=spawnSync(executable,['api','--hostname','github.com','--method','GET',path],{encoding:'utf8',timeout:Math.max(1,Math.min(15000,120000-(Date.now()-started))),maxBuffer:1048576,windowsHide:true,env:{...childEnv,GH_PROMPT_DISABLED:'1',GH_DEBUG:''}});
   if(r.status!==0)return {state:'GITHUB_AUTH_OR_METADATA_PERMISSION_UNAVAILABLE'};
   return {state:'GITHUB_METADATA_OBSERVED',data:parseIdentityJson(r.stdout)};
  }catch{return {state:'GITHUB_METADATA_INVALID_OR_UNAVAILABLE'};}
 };
}
export async function collectOwnerCustodyReadback({credential,fetchImpl=globalThis.fetch,ghGet=githubClient(null),now=Date.now(),challenge,providerReadTimeoutMs=10000}={}){
 if(!credential||!['global_key','api_token'].includes(credential.kind)||typeof credential.secret!=='string'||!/^[A-Za-z0-9._~-]{16,200}$/.test(credential.secret)||
  (credential.kind==='global_key'&&(!safeString(credential.email,254)||!/^\S+@\S+\.\S+$/.test(credential.email)))||
  !challenge||challenge.schema!=='musitu.axiom.gate3.owner-custody-challenge.v1'||!hex32(challenge.nonce)||!(/^[a-f0-9]{40}$/.test(challenge.source_commit||''))||challenge.repository!==REPO||challenge.account_id!==A2||
  !Number.isFinite(Date.parse(challenge.issued_at_utc))||!Number.isFinite(Date.parse(challenge.expires_at_utc))||now<Date.parse(challenge.issued_at_utc)-60000||now>=Date.parse(challenge.expires_at_utc)||Date.parse(challenge.expires_at_utc)-Date.parse(challenge.issued_at_utc)!==172800000)fail();
 const protectedValues=new Set([credential.secret,...(credential.email?[credential.email]:[])]),privateMetadata={github_metadata_names:[],cloudflare_token_names:[]};
 const typed=(domain,value)=>hex32(value)&&![...protectedValues].some(s=>value.includes(s))?hash(domain+'\n'+value):null;
 const api=providerClient(credential,fetchImpl,providerReadTimeoutMs),profile=await api.get('/user'),user=profile.data?.result;
 const userId=typed('cloudflare-user-id',user?.id),report={schema:'musitu.axiom.gate3.owner-custody-provider-readback.v1',observed_at_utc:new Date(now).toISOString(),challenge_nonce:challenge.nonce,source_commit:challenge.source_commit,public_challenge_sha256:hash(JSON.stringify(challenge)),
  repository:REPO,account_id:A2,execution_origin:'OWNER_LOCAL_SOURCE_PATH_NOT_OS_ATTESTATION',private_credential_written_or_exported:false,
  profile_read:pub(profile),provider_principal_identifier_sha256:userId,provider_mfa_enabled:typeof user?.two_factor_authentication_enabled==='boolean'?user.two_factor_authentication_enabled:null,
  authentication_kind:credential.kind,collection_complete:false,independent_custody_automatically_qualified:false,credential_content_inventory_exhaustive:false,
  provider_get_requests:api.count,provider_write_requests:0,github_secret_values_requested:false,github_variable_values_exported:false,
  github:{repository_identity_verified:false,metadata_complete:false,scopes:[],state:'NOT_ATTEMPTED_OWNER_PRINCIPAL_REQUIRED'},
  gate3_closed:false,B27:'FAILED_IN_SYNTHETIC_ATTACK',release_status:'NOT_RELEASE'};
 const finish=(privatePart={})=>{report.provider_get_requests=api.count;
  const serialized=JSON.stringify({report,privateMetadata:privatePart});if([...protectedValues].some(s=>serialized.includes(s)))fail();
  return {report,privateMetadata:privatePart};};
 if(credential.kind==='api_token'){
  let verification=await api.get('/user/tokens/verify');if(!verification.data)verification=await api.get(`/accounts/${A2}/tokens/verify`);
  const id=typed('cloudflare-token-id',verification.data?.result?.id);report.owner_token_verification=pub(verification);report.owner_token_identifier_sha256=id;
  report.provider_get_requests=api.count;
  if(!id||verification.data?.result?.status!=='active'||KNOWN.has(id)){report.status=KNOWN.has(id)?'KNOWN_BUILD_CREDENTIAL_REJECTED_OWNER_ONLY_INPUT_REQUIRED':'OWNER_TOKEN_IDENTITY_UNQUALIFIED';return finish();}
 }
 if(!userId){report.status='OWNER_PRINCIPAL_PROVIDER_READBACK_REQUIRED';return finish();}
 const memberships=await cfPages(api,'/memberships',50,m=>({account_is_a2:m.account?.id===A2,status:m.status,administrator_role_observed:Array.isArray(m.roles)&&m.roles.some(x=>typeof x==='string'&&/^(account administrator|administrator|super administrator(?: - all privileges)?|owner)$/i.test(x))}));
 report.memberships=memberships;report.operator_a2_accepted_administrator_observed=memberships.rows.some(m=>m.account_is_a2&&m.status==='accepted'&&m.administrator_role_observed);
 report.account_members=await cfPages(api,`/accounts/${A2}/members`,50,m=>({member_identifier_sha256:typed('cloudflare-membership-id',m.id),status:['accepted','pending','rejected'].includes(m.status)?m.status:'UNKNOWN',
  is_authenticated_operator:m.user?.id===user.id||(typeof user.email==='string'&&[m.email,m.user?.email].some(e=>typeof e==='string'&&e.toLowerCase()===user.email.toLowerCase())),
  administrator_role_observed:Array.isArray(m.roles)&&m.roles.some(role=>/^(account administrator|administrator|super administrator(?: - all privileges)?|owner)$/i.test(role?.name||'')),
  any_role_write_permission_observed:Array.isArray(m.roles)&&m.roles.some(role=>role?.permissions&&Object.values(role.permissions).some(p=>p?.write===true)),modern_policies_present:Array.isArray(m.policies)}));
 const tokens=m=>{const id=typed('cloudflare-token-id',m.id);
  if(id&&safeString(m.name)&&![...protectedValues].some(s=>m.name.includes(s)))privateMetadata.cloudflare_token_names.push({token_identifier_sha256:id,name:m.name});
  return {token_identifier_sha256:id,known_build_reference:KNOWN.get(id)||null,status:['active','disabled','expired'].includes(m.status)?m.status:'UNKNOWN',...policySummary(m.policies)};};
 report.user_tokens=await cfPages(api,'/user/tokens',50,tokens);report.account_owned_tokens=await cfPages(api,`/accounts/${A2}/tokens`,50,tokens);
 const lock=await api.get(`/accounts/${A2}/r2/buckets/musitu-axiom-b27-highwater-a2/lock`),worker=await api.get(`/accounts/${A2}/workers/scripts/axiom-security-authority2-highwater/settings`);
 report.retention_read={...pub(lock),indefinite_b27_rule_observed:Array.isArray(lock.data?.result?.rules)&&lock.data.result.rules.some(r=>r?.enabled===true&&r.condition?.type==='Indefinite'&&[undefined,'','b27/'].includes(r.prefix))};report.authority_worker_read=pub(worker);
 const repo=await ghGet('/repos/'+REPO);
 report.github={repository_identity_verified:repo?.data?.id===REPO_ID&&repo.data.full_name===REPO,metadata_complete:false,scopes:[]};
 if(report.github.repository_identity_verified&&repo.data.owner?.type==='User'){
  const scopes=[['repository','/repos/'+REPO+'/actions']];
  const environments=await ghPages(ghGet,'/repos/'+REPO+'/environments','environments');report.github.environments={complete:environments.complete,count:environments.rows.length};
  if(environments.rows.length>20)environments.complete=false;
  for(const name of environments.rows.slice(0,20)){
   if([...protectedValues].some(s=>name.includes(s)))fail();
   scopes.push(['environment:'+hash('github-environment-name\n'+name),'/repos/'+REPO+'/environments/'+encodeURIComponent(name)]);
  }
  for(const [scope,base]of scopes){
   for(const kind of ['secrets','variables']){
    const p=await ghPages(ghGet,base+'/'+kind,kind),names=p.rows.filter(n=>![...protectedValues].some(s=>n.includes(s)));
    privateMetadata.github_metadata_names.push({scope,kind,names});
    report.github.scopes.push({scope,kind,complete:p.complete&&names.length===p.rows.length,count:names.length,known_cloudflare_references_present:CF_REFS.filter(ref=>names.includes(ref)),other_reference_count:names.filter(n=>!CF_REFS.includes(n)).length,last_state:p.last_state});
   }
  }
  report.github.organization_secret_scope='NOT_APPLICABLE_PERSONAL_REPOSITORY_OWNER';
  report.github.metadata_complete=environments.complete&&report.github.scopes.every(s=>s.complete);
 }else report.github.state='REPOSITORY_IDENTITY_OR_OWNER_SCOPE_UNQUALIFIED';
 report.provider_get_requests=api.count;report.provider_write_requests=0;report.github_secret_values_requested=false;report.github_variable_values_exported=false;
 report.collection_complete=report.operator_a2_accepted_administrator_observed&&memberships.complete&&report.account_members.complete&&report.user_tokens.complete&&report.account_owned_tokens.complete&&report.github.metadata_complete;
 report.status=report.collection_complete?'OWNER_PROVIDER_METADATA_COLLECTED_REVIEW_REQUIRED_NOT_RELEASE':'OWNER_PROVIDER_METADATA_PARTIAL_REVIEW_REQUIRED_NOT_RELEASE';
 return finish(privateMetadata);
}
async function main(){
 if(process.argv[2]==='--inspect'&&process.argv.length===3){process.stdout.write(JSON.stringify({status:'OWNER_CUSTODY_PUBLIC_SOURCE_INSPECTION_NOT_OWNER_EXECUTION',provider_requests:0,gate3_closed:false,release_status:'NOT_RELEASE'})+'\n');return;}
 if(process.platform!=='win32'||process.env.GITHUB_ACTIONS||process.env.CI||process.argv.length!==5||process.argv[4]!=='owner-local-v1'){process.stderr.write('OWNER_WINDOWS_LOCAL_CONTEXT_REQUIRED_HOLD\n');process.exitCode=2;return;}
 try{
  const root=resolve(process.argv[2]),challenge=parseIdentityJson(readFileSync(join(root,'challenge.json'),'utf8'));
  let input='';for await(const chunk of process.stdin){input+=chunk.toString('utf8');if(Buffer.byteLength(input)>8192)fail();}
  const credential=parseIdentityJson(input),result=await collectOwnerCustodyReadback({credential,ghGet:githubClient(process.argv[3]==='NONE'?null:process.argv[3]),challenge});
  const publicPath=join(root,'RETURN_ONLY','OWNER_CUSTODY_PROVIDER_READBACK.json');
  writeFileSync(publicPath,JSON.stringify(result.report,null,2)+'\n',{flag:'wx'});
  writeFileSync(join(root,'PRIVATE_GITHUB_METADATA_NAMES_DO_NOT_UPLOAD.json'),JSON.stringify(result.privateMetadata,null,2)+'\n',{flag:'wx'});
  process.stdout.write(JSON.stringify({status:result.report.status,public_receipt:publicPath,collection_complete:result.report.collection_complete,gate3_closed:false})+'\n');if(!result.report.collection_complete)process.exitCode=2;
 }catch{process.stderr.write('OWNER_CUSTODY_PROVIDER_READBACK_STOPPED_HOLD\n');process.exitCode=2;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
