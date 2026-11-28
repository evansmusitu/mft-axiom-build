import {createHash} from 'node:crypto';
import {ACCOUNT,SOURCE_ACCOUNT,PIN,BUCKET,REPO,need,canonical} from './pins.mjs';
import {resourceProjection,referencedZoneIds,resolveZoneOwners} from './scope_policy.mjs';
import {OperatorHold} from './pins.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const KNOWN=['83eda64c33252d73b0ae28ebcb902d35d5aa081a7b43f77728924820021860f5','e2ca57fa6d971286e02a8f02050c53991ab79e3ccc8c958d46dbeaf8ed34f1a2','bf3d1b9b09d06a396f9e97846f6ed2c6de64e67184c3865d370610e6d0a925c6'];
const DECLARED_PRIVATE=['f0885fe1d8c056f3972b4e24ebec8c249300fb7d572bcbfa28a9f219996304fe','3faa5c18db7e0fabffe1a3721d889e1e1f115aef77043ccda82d5ed3fed7277a'];
const reader=n=>/ (Read|Read-Only)$/.test(n)||['Magic Firewall Packet Captures - Read PCAPs API','Workers Content Read-Only','Workers Metadata Read-Only'].includes(n);
export async function pages(t,path){
 const rows=[],ids=new Set();let total;
 for(let page=1;page<=5;page++){
  const r=await t.cf('GET',path(page)),a=r.data,i=r.result_info;
  need(Array.isArray(a)&&i&&i.page===page&&i.per_page===50&&i.count===a.length&&Number.isSafeInteger(i.total_count)&&i.total_count>=0&&i.total_count<=50&&(total===undefined||total===i.total_count),'A2OP_INVENTORY_PAGINATION_HOLD');total=i.total_count;
  for(const x of a){need(typeof x.id==='string'&&/^[a-f0-9]{32}$/.test(x.id)&&!ids.has(x.id),'A2OP_INVENTORY_ID_HOLD');ids.add(x.id);rows.push(x);}
  if(rows.length===total)return rows;need(rows.length<total&&a.length>0,'A2OP_INVENTORY_INCOMPLETE_HOLD');
 }need(false,'A2OP_INVENTORY_BUDGET_HOLD');
}
export function summarizeToken(token,context={}){
 need(token&&typeof token.id==='string'&&/^[a-f0-9]{32}$/.test(token.id)&&['active','disabled','expired'].includes(token.status)&&Array.isArray(token.policies)&&token.policies.length<=100,'A2OP_TOKEN_METADATA_HOLD');
 const policies=token.policies.map(p=>{
  need(['allow','deny'].includes(p.effect)&&p.resources&&typeof p.resources==='object'&&!Array.isArray(p.resources)&&Array.isArray(p.permission_groups)&&p.permission_groups.length<=2048,'A2OP_TOKEN_POLICY_HOLD');
  need(p.permission_groups.every(g=>typeof g?.name==='string'&&g.name.length<=200),'A2OP_PERMISSION_LABEL_HOLD');
  const nonRead=p.permission_groups.filter(g=>!reader(g.name));
  const scope=resourceProjection(p.resources,context?.zoneOwners);
  return {effect:p.effect,all_account_or_A2_resource:scope.a2_account_or_all_accounts,non_read_groups:nonRead.length,global_user_credential_admin:nonRead.length>0&&scope.user_credential_scope,unresolved_resource_scope:nonRead.length>0&&scope.unresolved_scope,a2_zone_or_bucket_resource:scope.a2_zone_or_bucket,global_zone_resource:scope.global_zone_scope};
 });
 return {token_identifier_sha256:hash('cloudflare-token-id\n'+token.id),status:token.status,policies,potential_A2_or_global_credential_admin_allow:policies.some(p=>p.effect==='allow'&&(((p.all_account_or_A2_resource||p.a2_zone_or_bucket_resource||p.global_zone_resource)&&p.non_read_groups>0)||p.global_user_credential_admin||p.unresolved_resource_scope))};
}
export class BoundaryHold extends OperatorHold{
 constructor(code,details){super(code);this.publicBoundaryDetails=details;}
}
export async function readBoundary(t){
 const r=await t.cf('GET','/user'),u=r.data;need(/^[a-f0-9]{32}$/.test(u?.id)&&u.two_factor_authentication_enabled===true&&hash('cloudflare-user-id\n'+u.id)==='29293f773babce484eb7b17af2b293a083d8311ea296ef8d3e0dac119e63c243','A2OP_OWNER_PRINCIPAL_OR_MFA_HOLD');
 if(t.credential.kind==='api_token'){
  const v=await t.cf('GET','/user/tokens/verify');need(v.data?.status==='active'&&/^[a-f0-9]{32}$/.test(v.data.id)&&!KNOWN.includes(hash('cloudflare-token-id\n'+v.data.id)),'A2OP_BUILD_CREDENTIAL_CANNOT_OPERATE_CEREMONY_HOLD');
 }
 const members=await pages(t,p=>`/accounts/${ACCOUNT}/members?page=${p}&per_page=50`);
 need(members.length===1&&members[0].status==='accepted'&&members[0].user?.id===u.id&&Array.isArray(members[0].roles)&&members[0].roles.some(x=>typeof x?.name==='string'&&/administrator/i.test(x.name)),'A2OP_OWNER_ACCOUNT_MEMBERSHIP_HOLD');
 const tokens=await pages(t,p=>`/user/tokens?page=${p}&per_page=50&include_expired=true`),accountTokens=await pages(t,p=>`/accounts/${ACCOUNT}/tokens?page=${p}&per_page=50&include_expired=true`);
 const sourceTokens=await pages(t,p=>`/accounts/${SOURCE_ACCOUNT}/tokens?page=${p}&per_page=50&include_expired=true`);
 const zone=await resolveZoneOwners(t,referencedZoneIds([...tokens,...accountTokens,...sourceTokens]));
 const summaries=[...tokens,...accountTokens,...sourceTokens].map(x=>summarizeToken(x,{zoneOwners:zone.owners})),map=new Map();
 for(const x of summaries){const old=map.get(x.token_identifier_sha256);need(!old||canonical(old)===canonical(x),'A2OP_DUPLICATE_TOKEN_POLICY_HOLD');map.set(x.token_identifier_sha256,x);}
 for(const id of KNOWN){const x=map.get(id);need(x?.status==='active'&&!x.potential_A2_or_global_credential_admin_allow,'A2OP_KNOWN_BUILD_POLICY_CHANGED_HOLD');}
 const extra=[...tokens,...accountTokens].map(x=>summarizeToken(x,{zoneOwners:zone.owners})).filter(x=>x.status==='active'&&x.potential_A2_or_global_credential_admin_allow);
 const unresolved=extra.filter(x=>!DECLARED_PRIVATE.includes(x.token_identifier_sha256));
 if(unresolved.length){
  const details={schema:'musitu.axiom.authority2.boundary-hold-details.v1',zone_ownership_readbacks:zone.observations,known_build_prerequisites_passed:true,preexisting_two_private_token_declaration_preserved:true,unapproved_active_token_projections:unresolved,current_provider_metadata_observed:true,effective_access_or_custody_qualified:false,gate3_closed:false,release_status:'NOT_RELEASE'};
  const onlyGlobalZones=unresolved.every(x=>x.policies.every(p=>p.effect!=='allow'||p.non_read_groups===0||(!p.all_account_or_A2_resource&&!p.a2_zone_or_bucket_resource&&!p.global_user_credential_admin&&!p.unresolved_resource_scope))&&x.policies.some(p=>p.effect==='allow'&&p.global_zone_resource&&p.non_read_groups>0));
  throw new BoundaryHold(onlyGlobalZones?'A2OP_GLOBAL_ZONE_WRITE_SCOPE_HOLD':'A2OP_NEW_UNRECONCILED_ADMIN_IDENTITY_HOLD',details);
 }
 const lock=await t.cf('GET',`/accounts/${ACCOUNT}/r2/buckets/${BUCKET}/lock`);
 need(Array.isArray(lock.data?.rules)&&lock.data.rules.some(x=>x.enabled===true&&x.condition?.type==='Indefinite'&&['','b27/',undefined].includes(x.prefix)),'A2OP_RETENTION_PREFLIGHT_HOLD');
 return {schema:'musitu.axiom.authority2.operator-boundary-observation.v1',account_id:ACCOUNT,principal_identifier_sha256:hash('cloudflare-user-id\n'+u.id),provider_MFA_enabled:true,one_authenticated_administrator_member:true,user_token_count:tokens.length,A2_account_token_count:accountTokens.length,known_build_token_policies:KNOWN.map(id=>map.get(id)),other_A2_write_identities:extra,zone_ownership_readbacks:zone.observations,owner_two_private_token_declaration_preserved:true,indefinite_b27_retention_observed:true,observed_at_utc:new Date().toISOString(),full_all_provider_policy_evaluation:false};
}
export function assertSameBoundary(a,b){need(canonical({...a,observed_at_utc:null})===canonical({...b,observed_at_utc:null}),'A2OP_BOUNDARY_DRIFT_HOLD');}
export async function freshBuildDenials(t,{wait,progress,readLog}){
 const old=(await t.gh('GET','/repos/'+REPO+'/actions/jobs/138679115528')).data;
 need(old?.id===138679115528&&old.run_id===45459847877&&old.head_sha==='a932c5f7b9a4bf40c9b0bf1af811015b9b88383b','A2OP_DENIAL_SOURCE_PIN_HOLD');
 const existing=(await t.gh('GET','/repos/'+REPO+'/actions/runs/45459847877/jobs?filter=latest&per_page=100')).data;
 need(Array.isArray(existing?.jobs)&&existing.jobs.length<=100&&Number.isSafeInteger(existing.total_count)&&existing.total_count===existing.jobs.length,'A2OP_DENIAL_JOB_INVENTORY_HOLD');
 const baseline=Math.max(old.run_attempt,...existing.jobs.filter(x=>x.name===old.name).map(x=>x.run_attempt));need(Number.isSafeInteger(baseline),'A2OP_DENIAL_ATTEMPT_HOLD');
 const started=Date.now();
 await t.gh('POST','/repos/'+REPO+'/actions/jobs/138679115528/rerun',{allowStatus:[201,202]});
 let job;
 while(Date.now()-started<600000){await wait(10000);const d=(await t.gh('GET','/repos/'+REPO+'/actions/runs/45459847877/jobs?filter=latest&per_page=100')).data;
  job=d?.jobs?.find(x=>x.name===old.name&&x.run_attempt>baseline&&x.head_sha===old.head_sha);
  if(job?.status==='completed')break;progress('Waiting for the existing bounded build-credential denial job.');}
 need(job?.conclusion==='success','A2OP_FRESH_DENIAL_JOB_NOT_PASSED_HOLD');const log=await readLog(job.id);
 const reports=[];for(const line of log.split('\n')){const i=line.indexOf('{"schema":"musitu.axiom.gate3.');if(i>=0){try{const x=t.parseJson(line.slice(i));if(x.bounded_worker_assets_r2_denial_tests_passed===true)reports.push(x);}catch{}}}
 need(reports.length===1,'A2OP_DENIAL_REPORT_MISSING_HOLD');const x=reports[0];
 need(x.target_account===ACCOUNT&&x.subject_identity_and_policy_stable===true&&x.preconditions_passed===true&&x.unexpected_write_observed===false&&Array.isArray(x.possible_orphan_bucket_names)&&x.possible_orphan_bucket_names.length===0&&x.retained_bucket_or_customer_state_targeted===false&&Date.parse(x.observed_at_utc)>=started-60000,'A2OP_DENIAL_REPORT_SCOPE_HOLD');
 return {run_id:45459847877,run_attempt:job.run_attempt,job_id:job.id,source_commit:old.head_sha,report:x,all_provider_denial_inferred:false};
}
