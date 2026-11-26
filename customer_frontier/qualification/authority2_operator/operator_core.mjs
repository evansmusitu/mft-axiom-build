import {createHash,randomBytes,createPrivateKey,createPublicKey,sign,verify} from 'node:crypto';
import {readFileSync,lstatSync,writeFileSync} from 'node:fs';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {ACCOUNT,SCRIPT,BUCKET,PIN,REPO,CHECKPOINT_REPO,CHECKPOINT_ID,SERVING_SHA,INITIALIZER_SHA,SPKI_SHA,canonical,need,OperatorHold,HEX64} from './pins.mjs';
import {WORKER_ROOT,readBoundedBody} from './transport.mjs';
import {readBoundary,assertSameBoundary,freshBuildDenials} from './boundary.mjs';
import {observePrivateSchedule} from './tail.mjs';
import {publishGithubCheckpoint,verifyGithubCheckpoint} from './approved-anchor.mjs';
import {verifyAuthority2InitializerRetirement} from './approved-retirement.mjs';
export const hash=x=>createHash('sha256').update(x).digest('hex');
export const nonce=()=>randomBytes(32).toString('hex');
const TEMPORARY=['HW_GENESIS_CONTROL_JSON','HW_GENESIS_CONTROL_TOKEN','HW_GENESIS_GITHUB_READ_TOKEN'];
export function scheduleWindow(now=Date.now()){
 need(Number.isSafeInteger(now)&&now>=0,'A2OP_CLOCK_HOLD');
 // Cron propagation can take15 minutes. Stage it17+ minutes ahead; the
 // approved execution window itself remains strictly below15 minutes.
 const target=Math.ceil(now/60000)*60000+17*60000,d=new Date(target);
 return {cron:`${d.getUTCMinutes()} ${d.getUTCHours()} ${d.getUTCDate()} ${d.getUTCMonth()+1} *`,not_before_ms:target-120000,not_after_ms:target+720000,scheduled_ms:target};
}
export function eventPlan(){let prev='0'.repeat(64);return Array.from({length:4},(_,sequence)=>{const e={ledger_id:PIN.ledger_id,namespace:PIN.namespace,sequence,previous_sequence:sequence-1,previous_head:prev,head:nonce(),event_digest:nonce(),artifact_sha256:nonce(),action_sha256:nonce()};prev=e.head;return e;});}
export function operatorKey(path,passphrase,work){
 const p=resolve(path),rel=relative(resolve(work),p);need(rel.startsWith('..')||isAbsolute(rel),'A2OP_PRIVATE_KEY_OUTSIDE_PACKET_REQUIRED_HOLD');const stat=lstatSync(p);need(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>80&&stat.size<16384,'A2OP_ENCRYPTED_KEY_FILE_HOLD');
 const raw=readFileSync(p),pw=Buffer.from(passphrase,'utf8');let key;
 try{need(/^-----BEGIN ENCRYPTED PRIVATE KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END ENCRYPTED PRIVATE KEY-----\r?\n?$/.test(raw.toString('ascii'))&&pw.length>0&&pw.length<=256,'A2OP_ENCRYPTED_PKCS8_REQUIRED_HOLD');key=createPrivateKey({key:raw,format:'pem',passphrase:pw});}catch{throw new OperatorHold('A2OP_SIGNER_DECRYPTION_OR_PIN_HOLD');}finally{raw.fill(0);pw.fill(0);}
 need(key.asymmetricKeyType==='ed25519'&&hash(createPublicKey(key).export({format:'der',type:'spki'}))===SPKI_SHA,'A2OP_SIGNER_DECRYPTION_OR_PIN_HOLD');
 const jwk=key.export({format:'jwk'});need(jwk.x===PIN.public_key_jwk.x,'A2OP_SIGNER_DECRYPTION_OR_PIN_HOLD');return {key,jwk};
}
export function publicEnvelope(envelope,phase,n,genesis){
 need(envelope&&typeof envelope.signature==='string'&&verify(null,Buffer.from(canonical(envelope.payload)),createPublicKey({key:PIN.public_key_jwk,format:'jwk'}),Buffer.from(envelope.signature,'base64url')),'A2OP_HOSTED_SIGNATURE_HOLD');
 return validateHostedPayload(envelope.payload,phase,n,genesis);
}
export function validateHostedPayload(p,phase,n,genesis){
 const expected=phase==='HOSTED_CASES'?['actual_genesis_DO_and_R2_barrier_correspond','actual_indefinite_retention_enforced','actual_signed_bootstrap_and_separate_readback','consumed_sequence_replay_denied','distinct_read_and_write_roles_enforced','actual_stale_DO_restore_cannot_reissue_permission','operator_snapshot_recovery_verified_against_R2_and_immutable_GitHub','actual_R2_commit_with_injected_lost_ack_retains_pending','operator_pending_reconciliation_emits_no_dispatch_and_replay_denied','injected_caller_abort_after_actual_external_commit_never_returns_permit']:phase==='REVOCATION'?['provider_backed_old_role_credentials_denied','new_roles_operate_and_consumed_sequence_still_denied']:[];
 need(expected.length>0&&p?.schema==='musitu.axiom.authority2.hosted-disposable-results.v1'&&canonical(p.pin)===canonical(PIN)&&p.phase===phase&&p.nonce===n&&p.genesis_sha256===genesis&&p.private_hosted_tests_completed===true&&p.independent_review_still_required===true&&p.B27==='FAILED_IN_SYNTHETIC_ATTACK'&&p.gate3_closed===false&&p.release_status==='NOT_RELEASE'&&p.fault_origin==='OPERATOR_CONTROLLED_INJECTION_ON_ACTUAL_PROVIDER_STATE'&&Array.isArray(p.cases)&&p.cases.length===expected.length&&p.cases.every((x,i)=>x.name===expected[i]&&x.status==='PASS'),'A2OP_HOSTED_RESULTS_INCOMPLETE_HOLD');return p;
}
export class PrivateOperatorRunner{
 constructor({transport,work,payload,key,githubReadToken,ask,progress,wait,observe=observePrivateSchedule,readLog,sourceApprovalSha=null}){
  this.t=transport;this.work=work;this.payload=payload;this.key=key;this.githubReadToken=githubReadToken;this.ask=ask;this.progress=progress;this.wait=wait;this.observe=observe;this.readLog=readLog;
  this.secrets={HW_CONFIG_JSON:canonical(PIN),HW_SIGNING_JWK:canonical(key.jwk),HW_ROLE_TOKEN_SHA256_JSON:null};this.roles={read:nonce(),write:nonce()};this.setRoleRegistry();
  this.created=false;this.journal=[];this.sourceRef=payload.source_commit;this.privateValues=[transport.credential.secret,transport.credential.email,transport.githubToken,githubReadToken,key.jwk.d,this.roles.read,this.roles.write].filter(Boolean);
  this.report={schema:'musitu.axiom.authority2.owner-operator-execution.v1',source_commit:this.sourceRef,approved_source_commit:payload.approved_source_commit,approved_config_sha256:payload.approved_config_sha256,started_at_utc:new Date().toISOString(),account_id:ACCOUNT,pin:PIN,execution_origin:'OWNER_WINDOWS_OPERATOR_NOT_BUILDER_CI',phases:[],operator_acceptance_is_human_decision_not_OS_attestation:true,gate3_closed:false,B27:'FAILED_IN_SYNTHETIC_ATTACK',parity_superiority:'NOT_CERTIFIED',unavailable_final_usage:'UNKNOWN',release_status:'NOT_RELEASE'};
  this.report.new_automation_payload_approval_sha256=sourceApprovalSha;this.report.operator_decisions=[];
  this.t.journal=async row=>{this.journal.push({...row,at_utc:new Date().toISOString()});const p={schema:'musitu.axiom.authority2.operator-request-journal.v1',source_commit:this.sourceRef,pin:PIN,rows:this.journal,gate3_closed:false,release_status:'NOT_RELEASE'};this.writePublic('OPERATOR_PROVIDER_REQUEST_JOURNAL.json',{payload:p,public_key_jwk:PIN.public_key_jwk,signature_base64url:sign(null,Buffer.from('MUSITU_AXIOM_OWNER_OPERATOR_JOURNAL_V1\n'+canonical(p)),this.key.key).toString('base64url')});};
 }
 setRoleRegistry(){this.secrets.HW_ROLE_TOKEN_SHA256_JSON=canonical({read:hash(this.roles.read),write:hash(this.roles.write)});}
 writePublic(name,data){need(/^[A-Z0-9_]+\.json$/.test(name),'A2OP_OUTPUT_NAME_HOLD');const text=JSON.stringify(data,null,2)+'\n';need(!this.privateValues.some(x=>typeof x==='string'&&x.length>0&&text.includes(x)),'A2OP_PUBLIC_REDACTION_HOLD');writeFileSync(join(this.work,'RETURN_ONLY',name),text,{mode:0o600});}
 async approval(kind,publicValue){const digest=hash(canonical(publicValue));need(await this.ask({kind,digest,details:publicValue})===digest,'A2OP_OPERATOR_APPROVAL_REQUIRED_HOLD');this.report.operator_decisions.push({kind,digest,details:publicValue,approved_at_utc:new Date().toISOString()});this.writePublic('OWNER_OPERATOR_EXECUTION_RECEIPT.json',{schema:'musitu.axiom.authority2.owner-signed-operator-results.v1',payload:this.report,public_key_jwk:PIN.public_key_jwk,signature_base64url:sign(null,Buffer.from('MUSITU_AXIOM_OWNER_OPERATOR_RECEIPT_V1\n'+canonical(this.report)),this.key.key).toString('base64url')});return digest;}
 async confirmNoIngress(){
  const s=(await this.t.cf('GET',WORKER_ROOT+'/subdomain')).data;need(s?.enabled===false&&s.previews_enabled===false,'A2OP_PUBLIC_INGRESS_NOT_DISABLED_HOLD');
  const domains=(await this.t.cf('GET',`/accounts/${ACCOUNT}/workers/domains`)).data;need(Array.isArray(domains)&&domains.every(x=>x.service!==SCRIPT&&x.script!==SCRIPT),'A2OP_CUSTOM_DOMAIN_PRESENT_HOLD');
  let complete=false;
  for(let page=1;page<=5;page++){
   const r=await this.t.cf('GET',`/zones?account.id=${ACCOUNT}&page=${page}&per_page=50`);need(Array.isArray(r.data)&&r.result_info?.page===page&&Number.isSafeInteger(r.result_info.total_count)&&r.result_info.total_count<=50,'A2OP_ZONE_INVENTORY_HOLD');
   for(const z of r.data){need(/^[a-f0-9]{32}$/.test(z.id)&&z.account?.id===ACCOUNT,'A2OP_ZONE_ACCOUNT_HOLD');const routes=(await this.t.cf('GET','/zones/'+z.id+'/workers/routes')).data;need(Array.isArray(routes)&&routes.every(x=>x.script!==SCRIPT),'A2OP_CUSTOM_ROUTE_PRESENT_HOLD');}
   if(page*50>=r.result_info.total_count){complete=true;break;}
  }need(complete,'A2OP_ZONE_INVENTORY_HOLD');
 }
 async sourceEvidence(expectedSha,uploadEtag){
  const settings=(await this.t.cf('GET',WORKER_ROOT+'/settings')).data,deploy=(await this.t.cf('GET',WORKER_ROOT+'/deployments')).data;
  const ds=deploy.deployments;need(Array.isArray(ds)&&ds.length>0&&Array.isArray(ds[0].versions)&&ds[0].versions.length===1&&ds[0].versions[0].percentage===100,'A2OP_SINGLE_ACTIVE_VERSION_HOLD');
  const versionId=ds[0].versions[0].version_id;need(typeof versionId==='string'&&/^[a-f0-9-]{36}$/.test(versionId),'A2OP_VERSION_ID_HOLD');
  const version=(await this.t.cf('GET',WORKER_ROOT+'/versions/'+versionId)).data;need(version?.id===versionId&&typeof version.resources?.script?.etag==='string'&&typeof uploadEtag==='string'&&uploadEtag.length>0&&uploadEtag===version.resources.script.etag,'A2OP_VERSION_UPLOAD_ETAG_BINDING_HOLD');
  const r=await this.t.cf('GET',WORKER_ROOT+'/content',{raw:true,limit:524288});let candidates=[];
  const type=r.headers.get('content-type')||'';
  if(type.toLowerCase().startsWith('multipart/form-data')){const form=await new Response(r.data,{headers:{'content-type':type}}).formData();for(const [name,value]of form){if(name==='metadata')continue;need(typeof value!=='string'&&typeof value.arrayBuffer==='function','A2OP_SOURCE_PART_HOLD');candidates.push(new Uint8Array(await value.arrayBuffer()));}}
  else candidates=[r.data];
  need(candidates.length===1&&hash(candidates[0])===expectedSha,'A2OP_DEPLOYED_BYTES_MISMATCH_HOLD');await this.confirmNoIngress();
  const beforeAgain=(await this.t.cf('GET',WORKER_ROOT+'/deployments')).data;need(canonical(beforeAgain)===canonical(deploy),'A2OP_DEPLOYMENT_DRIFT_HOLD');
  return {version_id:versionId,script_etag:version.resources.script.etag,bundle_sha256:expectedSha,bindings:settings.bindings,deployment_id:ds[0].id};
 }
 async upload(kind,temporary={}){
  const value=this.payload.bundles[kind];need(value&&typeof value.base64==='string'&&hash(Buffer.from(value.base64,'base64'))===value.sha256,'A2OP_EMBEDDED_BUNDLE_HASH_HOLD');
  if(kind==='serving')need(value.sha256===SERVING_SHA,'A2OP_SERVING_PIN_HOLD');if(kind==='initializer')need(value.sha256===INITIALIZER_SHA,'A2OP_INITIALIZER_PIN_HOLD');
  const values={...this.secrets,...temporary},bindings=[{type:'durable_object_namespace',name:'HIGHWATER_STATE',class_name:'Authority2Highwater'},{type:'r2_bucket',name:'HIGHWATER_WORM',bucket_name:BUCKET},...Object.entries(values).map(([name,text])=>({type:'secret_text',name,text}))];
  const metadata={main_module:'authority2.js',compatibility_date:'2026-07-01',bindings,keep_bindings:[],logpush:false,...(!this.created?{migrations:{new_tag:'a2-sqlite-v1',steps:[{new_sqlite_classes:['Authority2Highwater']}]}}:{})};
  const form=new FormData();form.set('metadata',new Blob([JSON.stringify(metadata)],{type:'application/json'}));form.set('authority2.js',new Blob([Buffer.from(value.base64,'base64')],{type:'application/javascript+module'}),'authority2.js');
  // Once a creation is attempted, cleanup is mandatory even after lost ACK.
  this.created=true;const uploaded=await this.t.cf('PUT',WORKER_ROOT,{body:form});
  await this.t.cf('POST',WORKER_ROOT+'/subdomain',{body:{enabled:false,previews_enabled:false}});
  const evidence=await this.sourceEvidence(value.sha256,uploaded.data?.etag);const names=evidence.bindings.map(x=>x.name).sort();need(canonical(names)===canonical(bindings.map(x=>x.name).sort()),'A2OP_BINDING_SET_MISMATCH_HOLD');
  this.report.phases.push({phase:'UPLOAD_'+kind.toUpperCase(),version_id_sha256:hash(evidence.version_id),source_sha256:value.sha256,private_bindings_verified:true,public_ingress_disabled:true});return evidence;
 }
 async retire(){
  const oldCleanup=this.t.cleanupMode;this.t.cleanupMode=true;try{
  await this.t.cf('PUT',WORKER_ROOT+'/schedules',{body:[]});const evidence=await this.upload('serving');
  const metadata=await verifyAuthority2InitializerRetirement({account_id:ACCOUNT,token:'OPERATOR_TRANSPORT_HANDLE_NOT_A_CREDENTIAL_0000',expected_version_id:evidence.version_id,expected_script_etag:evidence.script_etag,fetchImpl:async(url,options)=>{need(options?.method==='GET','A2OP_RETIREMENT_METHOD_HOLD');const u=new URL(url);need(u.origin==='https://api.cloudflare.com'&&u.pathname.startsWith('/client/v4/'),'A2OP_RETIREMENT_HOST_HOLD');const r=await this.t.cf('GET',u.pathname.slice('/client/v4'.length));return Response.json({success:true,errors:[],result:r.data});}});
  await this.confirmNoIngress();this.report.phases.push({phase:'RETIRE_TEMPORARY_CONTROLLER',metadata,source_bytes_verified:true,custom_routes_and_domains_absent:true});return evidence;
  }finally{this.t.cleanupMode=oldCleanup;}
 }
 async scheduled(kind,phase,control,window){
  need(Date.now()<window.not_before_ms-60000,'A2OP_STAGING_WINDOW_EXPIRED_HOLD');
  await this.upload(kind,{HW_GENESIS_CONTROL_JSON:canonical(control),HW_GENESIS_CONTROL_TOKEN:this.controlToken,HW_GENESIS_GITHUB_READ_TOKEN:this.githubReadToken});
  await this.t.cf('PUT',WORKER_ROOT+'/schedules',{body:[{cron:window.cron}]});
  const schedules=(await this.t.cf('GET',WORKER_ROOT+'/schedules')).data;need(Array.isArray(schedules?.schedules)&&schedules.schedules.length===1&&schedules.schedules[0].cron===window.cron,'A2OP_CRON_READBACK_HOLD');
  const attachAt=window.scheduled_ms-240000;
  while(Date.now()<attachAt){this.progress('The private one-shot trigger is staged. Keeping its approved window while Cloudflare propagates the schedule.');await this.wait(Math.min(30000,attachAt-Date.now()));}
  let observation;
  try{observation=await this.observe(this.t,{...window,phase,parseJson:this.t.parseJson});}
  finally{await this.t.cf('PUT',WORKER_ROOT+'/schedules',{body:[]});}
  return observation;
 }
 async anchorReadTest(pin,githubOwnerToken){
  need(this.githubReadToken!==githubOwnerToken,'A2OP_CHECKPOINT_READER_MUST_BE_DISTINCT_HOLD');
  const root='/repos/'+CHECKPOINT_REPO;const tag='ax-a2-read-scope-'+this.nonce;
  const body={tag,message:'Disposable operator read-boundary canary; no reference is created.',object:pin.target_commitish,type:'commit'};
  const control=await this.t.gh('POST',root+'/git/tags',{body,allowStatus:[201]});need(typeof control.data?.sha==='string'&&/^[a-f0-9]{40}$/.test(control.data.sha),'A2OP_GITHUB_WRITE_CONTROL_HOLD');
  const denied=await this.t.gh('POST',root+'/git/tags',{body,token:this.githubReadToken,allowStatus:[403,201]});need(denied.status===403,'A2OP_CHECKPOINT_READER_HAS_WRITE_HOLD');
  return {bounded_contents_write_denial_http_status:403,valid_owner_write_control:true,git_reference_created:false,unrelated_checkpoint_records_changed:false,all_GitHub_permissions_evaluated:false};
 }
 async ownerWriteControl(){
  // This is an empty asset-session capability check, not a script upload. No
  // asset bytes, reference, deployment or public route is created or used.
  const root=`/accounts/${ACCOUNT}/workers/scripts/axiom-a2-op-authcheck-${nonce().slice(0,32)}`;
  const before=await this.t.cf('GET',root+'/settings',{allowStatus:[200,404]});need(before.status===404,'A2OP_ADMIN_CONTROL_PREEXISTS_HOLD');
  const r=await this.t.cf('POST',root+'/assets-upload-session',{body:{manifest:{'/gate3-empty-proof.txt':{hash:'e3b0c44298fc1c149afbf4c8996fb924',size:0}}}});
  need(typeof r.data?.jwt==='string'&&r.data.jwt.length>20&&r.data.jwt.length<32768,'A2OP_OWNER_WRITE_CONTROL_HOLD');
  // Never use, hash or export the returned capability. Its original provider
  // response remains only in the encrypted owner-PC evidence archive.
  const after=await this.t.cf('GET',root+'/settings',{allowStatus:[200,404]});need(after.status===404,'A2OP_ADMIN_CONTROL_STATE_CHANGED_HOLD');
  return {scope:'FRESH_EMPTY_ASSET_SESSION_ON_FIXED_A2_ACCOUNT',http_status:200,canary_script_absent_before_and_after:true,asset_bytes_uploaded:false,capability_used_or_exported:false,all_provider_write_authority_inferred:false};
 }
 async liveSourceGate(){
  const root='/repos/'+REPO,main=(await this.t.gh('GET',root+'/branches/main')).data;
  need(main?.commit?.sha==='c3c5aaab90e94f1ca84ac9903f9d481c23c4f350','A2OP_LIVE_MAIN_DRIFT_HOLD');
  for(const [number,sha]of [[1,'8fc1fbb7c5ebbcc1604ecf24c5f4594f2d5667e3'],[192,this.payload.approved_source_commit],[251,this.sourceRef]]){
   const pr=(await this.t.gh('GET',root+'/pulls/'+number)).data;
   need(pr?.number===number&&pr.state==='open'&&pr.draft===true&&pr.merged===false&&pr.head?.sha===sha,'A2OP_LIVE_PR_DRIFT_HOLD');
  }
  const runs=(await this.t.gh('GET',root+'/actions/runs?head_sha='+this.sourceRef+'&per_page=100')).data;
  need(Array.isArray(runs?.workflow_runs)&&runs.total_count<=100,'A2OP_SOURCE_CI_INVENTORY_HOLD');
  const candidates=runs.workflow_runs.filter(r=>r.path==='.github/workflows/axiom-a2-owner-online-operator-20261126.yml'&&r.head_sha===this.sourceRef).sort((a,b)=>b.id-a.id),run=candidates[0];
  need(run?.status==='completed'&&run.conclusion==='success'&&Number.isSafeInteger(run.id),'A2OP_SOURCE_CI_NOT_PASSED_HOLD');
  const jobs=(await this.t.gh('GET',root+'/actions/runs/'+run.id+'/jobs?filter=latest&per_page=100')).data;
  need(Array.isArray(jobs?.jobs)&&jobs.total_count===2&&jobs.jobs.length===2&&['local-runtime-and-build','native-windows-public-validation'].every(n=>jobs.jobs.some(j=>j.name===n&&j.conclusion==='success')),'A2OP_NATIVE_SOURCE_CI_NOT_PASSED_HOLD');
  return {main:main.commit.sha,PR1_preserved:true,approved_source_commit:this.payload.approved_source_commit,operator_source_commit:this.sourceRef,native_public_validation_run:run.id,hosted_proof_inferred_from_CI:false};
 }
 async cleanupOnly(previousJournal){
  const e=previousJournal,p=e?.payload;
  need(p?.schema==='musitu.axiom.authority2.operator-request-journal.v1'&&p.source_commit===this.sourceRef&&canonical(p.pin)===canonical(PIN)&&Array.isArray(p.rows)&&p.rows.some(x=>x.provider==='cf'&&x.method==='PUT'&&x.path===WORKER_ROOT)&&typeof e.signature_base64url==='string'&&verify(null,Buffer.from('MUSITU_AXIOM_OWNER_OPERATOR_JOURNAL_V1\n'+canonical(p)),createPublicKey({key:PIN.public_key_jwk,format:'jwk'}),Buffer.from(e.signature_base64url,'base64url')),'A2OP_OWNED_JOURNAL_REQUIRED_HOLD');
  const r=await this.t.cf('GET',WORKER_ROOT+'/content',{raw:true,limit:524288});let content=r.data;const type=r.headers.get('content-type')||'';
  if(type.startsWith('multipart/form-data')){const f=await new Response(content,{headers:{'content-type':type}}).formData(),a=[];for(const [n,v]of f){if(n!=='metadata'){need(typeof v!=='string','A2OP_CLEANUP_SOURCE_PART_HOLD');a.push(new Uint8Array(await v.arrayBuffer()));}}need(a.length===1,'A2OP_CLEANUP_SOURCE_PART_HOLD');content=a[0];}
  need(Object.values(this.payload.bundles).some(b=>b.sha256===hash(content)),'A2OP_UNREVIEWED_CURRENT_SOURCE_CANNOT_REPLACE_HOLD');
  await this.approval('RETIRE_OWNED_TEMPORARY_CONTROLS_ONLY',{source_commit:this.sourceRef,pin:PIN,current_bundle_sha256:hash(content),scope:'Remove cron and temporary settings, restore exact serving source with the existing signer, rotate test role credentials. Preserve all DO/R2/checkpoint state; no initializer or destructive test.'});
  this.created=true;await this.retire();this.report.status='OWNED_TEMPORARY_CONTROLS_RETIRED_NOT_GENESIS_OR_HOSTED_ACCEPTANCE';this.report.cleanup_only=true;
  this.report.completed_at_utc=new Date().toISOString();const envelope={schema:'musitu.axiom.authority2.owner-signed-operator-results.v1',payload:this.report,public_key_jwk:PIN.public_key_jwk,signature_base64url:sign(null,Buffer.from('MUSITU_AXIOM_OWNER_OPERATOR_RECEIPT_V1\n'+canonical(this.report)),this.key.key).toString('base64url')};this.writePublic('OWNER_OPERATOR_EXECUTION_RECEIPT.json',envelope);return {status:this.report.status,success:true,cleanup_only:true,gate3_closed:false,release_status:'NOT_RELEASE'};
 }
 async run(){
  let success=false,code;
  try{
   this.report.live_source_before=await this.liveSourceGate();
   const before=await readBoundary(this.t);this.report.boundary_before=before;
   // A successful account-scoped inventory, rather than404 alone, proves the
   // intended script is absent. Existing authority state is never overwritten.
   let missing=true,complete=false;
   for(let page=1;page<=5;page++){const r=await this.t.cf('GET',`/accounts/${ACCOUNT}/workers/scripts?page=${page}&per_page=100`);need(Array.isArray(r.data)&&r.result_info?.page===page&&Number.isSafeInteger(r.result_info.total_count)&&r.result_info.total_count<=500,'A2OP_SCRIPT_INVENTORY_HOLD');if(r.data.some(x=>x.id===SCRIPT))missing=false;if(page*100>=r.result_info.total_count){complete=true;break;}}
   need(complete&&missing,'A2OP_EXISTING_AUTHORITY_REQUIRES_INDEPENDENT_RESUME_HOLD');
   const denials=await freshBuildDenials(this.t,{wait:this.wait,progress:this.progress,readLog:this.readLog});this.report.fresh_scoped_build_denials=denials;
   const after=await readBoundary(this.t);assertSameBoundary(before,after);this.report.boundary_after=after;
   await this.approval('INDEPENDENT_OPERATOR_BOUNDARY_ACCEPTANCE',{observations:after,denial_job_id:denials.job_id,denial_scope:'Worker assets upload-session and R2 bucket creation for three pinned active build credentials',limits:'Does not prove every provider method or OS/hardware attestation. Existing two-token builder-inaccessibility declaration is retained. Review actual private credential custody before accepting.'});
   this.report.owner_A2_write_control=await this.ownerWriteControl();
   const repo=(await this.t.gh('GET','/repos/'+CHECKPOINT_REPO)).data;need(repo?.id===CHECKPOINT_ID&&repo.full_name===CHECKPOINT_REPO&&repo.private===true,'A2OP_CHECKPOINT_REPOSITORY_HOLD');
   const branch=(await this.t.gh('GET','/repos/'+CHECKPOINT_REPO+'/branches/main')).data;need(/^[a-f0-9]{40}$/.test(branch?.commit?.sha),'A2OP_CHECKPOINT_TARGET_HOLD');
   this.nonce=nonce();this.controlToken=nonce();this.privateValues.push(this.controlToken);const events=eventPlan();const anchorPin={repository:CHECKPOINT_REPO,repository_id:CHECKPOINT_ID,namespace:PIN.namespace,target_commitish:branch.commit.sha};
   this.report.checkpoint_read_boundary=await this.anchorReadTest(anchorPin,this.t.githubToken);
   const genesis={schema:'musitu.axiom.authority2.pre-genesis-commitment.v1',ledger_sequence:0,kind:'AUTHORITY2_PREGENESIS',...PIN,reviewed_bundle_sha256:SERVING_SHA,genesis_nonce:this.nonce,initial_sequence:-1,initial_head:'0'.repeat(64)};
   const genesisSha=hash(canonical(genesis)),genesisPin={...anchorPin,namespace:PIN.namespace+'-pre'};
   // Check all five exact checkpoint tags before publishing anything. A prior
   // record means HOLD, never delete/recreate or repurpose an old namespace.
   for(const [p,seq]of [[genesisPin,0],...[0,1,2,3].map(s=>[anchorPin,s])]){const tag=p.namespace+'-'+String(seq).padStart(12,'0');const r=await this.t.gh('GET','/repos/'+CHECKPOINT_REPO+'/releases/tags/'+tag,{allowStatus:[200,404]});need(r.status===404,'A2OP_EXISTING_QUALIFICATION_NAMESPACE_HOLD');}
   const window=scheduleWindow();await this.approval('FRESH_GENESIS_AND_DISPOSABLE_HOSTED_TEST_PLAN',{genesis,genesis_sha256:genesisSha,anchor_pin:genesisPin,window,events,new_harness_sha256:this.payload.bundles.harness.sha256,destructive_scope:'Only the fixed disposable qualification DO and newly created retention canaries. Stale DO snapshot injection and separately verified recovery; actual R2 writes with injected lost ACK/caller abort; provider-backed role rotation. No existing R2 history or checkpoint deletion. All runtime and temporary control retirement is required.',source_commit:this.sourceRef});
   this.report.live_source_at_write=await this.liveSourceGate();
   need(Date.now()<window.not_before_ms-300000,'A2OP_GENESIS_APPROVAL_WINDOW_EXPIRED_BEFORE_CHECKPOINT_HOLD');
   const genesisProof=await publishGithubCheckpoint({pin:genesisPin,token:this.t.githubToken,payload:genesis,fetchImpl:(...a)=>this.t.approvedFetch(...a)});
   await verifyGithubCheckpoint({pin:genesisPin,token:this.githubReadToken,payload:{...genesis,anchor:genesisProof},fetchImpl:(...a)=>this.t.approvedFetch(...a)});
   const anchorPayloads=events.map((e,i)=>({kind:'DISPOSABLE_HOSTED_QUALIFICATION_EVENT',ledger_sequence:i,...e})),anchors=[];
   for(const e of anchorPayloads){const p=await publishGithubCheckpoint({pin:anchorPin,token:this.t.githubToken,payload:e,fetchImpl:(...a)=>this.t.approvedFetch(...a)});await verifyGithubCheckpoint({pin:anchorPin,token:this.githubReadToken,payload:{...e,anchor:p},fetchImpl:(...a)=>this.t.approvedFetch(...a)});anchors.push(p);}
   this.report.genesis_commitment={commitment:genesis,sha256:genesisSha,anchor_pin:genesisPin,anchor:genesisProof,operator_exact_hash_approved:true};this.writePublic('OWNER_OPERATOR_EXECUTION_RECEIPT.json',this.report);
   const init={schema:'musitu.axiom.authority2.private-genesis-control.v1',approved_cron:window.cron,not_before_ms:window.not_before_ms,not_after_ms:window.not_after_ms,expected_commitment_sha256:genesisSha,anchor_pin:genesisPin,commitment:genesis,anchor_proof:genesisProof};
   const initialized=await this.scheduled('initializer','GENESIS',init,window);this.report.phases.push({phase:'ACTUAL_PRIVATE_GENESIS_SCHEDULE',...initialized});await this.retire();
   const hostedWindow=scheduleWindow(),hosted={schema:'musitu.axiom.authority2.private-hosted-plan.v1',phase:'HOSTED_CASES',nonce:this.nonce,genesis_sha256:genesisSha,events,anchors,anchor_payloads:anchorPayloads,anchor_pin:anchorPin,read_token:this.roles.read,write_token:this.roles.write,...hostedWindow};
   const actual=await this.scheduled('harness','HOSTED_CASES',hosted,hostedWindow);publicEnvelope(actual.envelope,'HOSTED_CASES',this.nonce,genesisSha);this.report.phases.push({phase:'ACTUAL_HOSTED_DISPOSABLE_CASES',...actual});await this.retire();
   const old={...this.roles};this.roles={read:nonce(),write:nonce()};this.privateValues.push(this.roles.read,this.roles.write);this.setRoleRegistry();
   const revokeWindow=scheduleWindow(),revoke={...hosted,...revokeWindow,phase:'REVOCATION',old_read_token:old.read,old_write_token:old.write,read_token:this.roles.read,write_token:this.roles.write};
   const revoked=await this.scheduled('harness','REVOCATION',revoke,revokeWindow);publicEnvelope(revoked.envelope,'REVOCATION',this.nonce,genesisSha);this.report.phases.push({phase:'ACTUAL_PROVIDER_BACKED_ROLE_REVOCATION',...revoked});await this.retire();
   need(!this.t.privateArchiveFailed,'A2OP_PRIVATE_EVIDENCE_INCOMPLETE_HOLD');success=true;this.report.status='OWNER_OPERATOR_HOSTED_SEQUENCE_COMPLETED_INDEPENDENT_REVIEW_REQUIRED_NOT_RELEASE';
  }catch(e){code=typeof e?.code==='string'&&/^(A2OP|A2QUAL|ANCHOR|A2_RETIREMENT|WORKER|ACTIVE_DEPLOYMENT)_[A-Z0-9_]{1,100}$/.test(e.code)?e.code:'A2OP_EXECUTION_UNCONFIRMED_HOLD';this.report.status=code;}
  finally{
   if(this.created&&!success){try{await this.retire();this.report.failure_cleanup='TEMPORARY_CONTROLS_RETIRED_SOURCE_RESTORED_STATE_PRESERVED';}catch{this.report.failure_cleanup='UNCONFIRMED_OPERATOR_REVIEW_REQUIRED';}}
   this.report.completed_at_utc=new Date().toISOString();this.report.provider_request_counts={Cloudflare:this.t.cfCount,GitHub:this.t.ghCount,mutations:this.t.mutations};this.report.original_provider_responses_encrypted_on_owner_PC=true;this.report.private_original_evidence_complete=!this.t.privateArchiveFailed;
   this.report.private_genesis_and_hosted_sequence_completed=success;this.report.independent_final_acceptance_required=true;
   const signature=sign(null,Buffer.from('MUSITU_AXIOM_OWNER_OPERATOR_RECEIPT_V1\n'+canonical(this.report)),this.key.key).toString('base64url');
   const envelope={schema:'musitu.axiom.authority2.owner-signed-operator-results.v1',payload:this.report,public_key_jwk:PIN.public_key_jwk,signature_base64url:signature};this.writePublic('OWNER_OPERATOR_EXECUTION_RECEIPT.json',envelope);
  }return {status:this.report.status,success,receipt:'OWNER_OPERATOR_EXECUTION_RECEIPT.json',gate3_closed:false,release_status:'NOT_RELEASE'};
 }
}
