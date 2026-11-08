// One-shot owner-alternate synthetic D1 only. Never sends customer/production data.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
const ACCOUNT='c954f0c842a486d0388c05b19cd21e47';
const TARGET='1eff7a3d-b22b-4264-a0b8-196edf70074f';
const TARGET_NAME='axiom-pr77-synthetic-only-20261108';
const OTHER_PROTECTED='e36972b3-850d-4273-b934-2fa67587d9f1';
const RUN='axiom-pr77-synthetic-20261108-01';
const SCRIPT='axiom-pr77-synthetic-20261108';
const SUBDOMAIN='mftaxiomdr-c954f0c8-20261108';
const PLAN_HASH='6946e796539e6787033e20f1d0afdcb5259a130ca77be6e3c5afb60b5dc9888a';
const API='https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT;
const BASEURL='https://'+SCRIPT+'.'+SUBDOMAIN+'.workers.dev';
const TOKEN=process.env.AXIOM_CUSTOMER_STAGING_CF_API_TOKEN||'';
const OWNER=randomBytes(24).toString('hex');
const OPERATOR=randomBytes(32).toString('hex');
const EPOCH=randomBytes(12).toString('hex');
const sha=v=>createHash('sha256').update(v).digest('hex');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const report={
 schema:'musitu.axiom.pr77_hosted_synthetic_d1_batch.v1',
 target_account_id:ACCOUNT,target_database_id:TARGET,target_name:TARGET_NAME,
 protected_restored_customer_d1:OTHER_PROTECTED,
 source_pr77_plan_sha256:PLAN_HASH,
 status:'UNQUALIFIED',phase:'NOT_STARTED',
 synthetic_only:true,seed_statements:41,
 bounded_actual_pr77_prefix:46,bounded_total_statements:48,full_statement_count:89,
 source_customer_data_accessed:false,production_oauth_changed:false,
 target_created_by_prior_independent_run:true,
 worker_uploaded:false,worker_owned:false,worker_deleted:false,
 expected_d1_ddl_rollback_qualified:false,full_89_atomic_batch_qualified:false,
 customer_identity_qualified:false,independent_custody_qualified:false,
 release_authority:false,provider_http:[]
};
const save=()=>writeFile('axiom-pr77-hosted-synthetic-batch-20261108.json',JSON.stringify(report,null,2)+'\n');
const fail=(reason)=>{throw Error(reason)};
function ensure(x,reason){if(!x)fail(reason)}
let attemptedUpload=false,workerConfirmed=false,mainOutcome='UNQUALIFIED';
async function cf(path,{method='GET',body,form,allow404=false}={}){
 ensure(TOKEN.length>5&&!TOKEN.includes('\n'),'SECRET_NOT_AVAILABLE');
 const url=API+path;
 ensure(url.startsWith(API+'/'),'UNAPPROVED_CLOUDFLARE_ACCOUNT_PATH');
 const opt={method,headers:{Authorization:'Bearer '+TOKEN,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},body:form||(body?JSON.stringify(body):undefined),redirect:'error',signal:AbortSignal.timeout(20000)};
 const r=await fetch(url,opt);
 report.provider_http.push({surface:'control',method,status:r.status});
 if(allow404&&r.status===404)return null;
 const raw=await r.text();
 ensure(raw.length<150000,'CF_RESPONSE_LIMIT');
 const obj=JSON.parse(raw);
 ensure(r.status>=200&&r.status<300&&obj?.success===true,'CF_RESPONSE_REJECTED');
 return obj.result;
}
async function worker(path,method='GET'){
 const r=await fetch(BASEURL+path,{method,headers:{Authorization:'Bearer '+OPERATOR},redirect:'error',signal:AbortSignal.timeout(method==='POST'?90000:12000)});
 report.provider_http.push({surface:'synthetic_worker',method,status:r.status});
 const raw=await r.text();
 ensure(raw.length<30000,'WORKER_RESPONSE_LIMIT');
 return {status:r.status,data:JSON.parse(raw)};
}
function owned(settings){
 const arr=settings?.bindings;
 return Array.isArray(arr) &&
   arr.some(x=>x.type==='d1'&&x.name==='DB'&&(x.id||x.database_id)===TARGET) &&
   arr.some(x=>x.type==='plain_text'&&x.name==='OWNER'&&x.text===OWNER) &&
   arr.some(x=>x.type==='plain_text'&&x.name==='RUN'&&x.text===RUN) &&
   arr.every(x=>['DB','OWNER','RUN','EPOCH','EXPIRES','TOKEN'].includes(x.name));
}
function baseline(x){
 return x?.status==='SYNTHETIC_OBSERVATION'&&x.user_tables===8&&x.indexes===1&&x.triggers===21&&x.customers===2&&x.foreign_key_violations===0&&x.guard_tables===0&&x.v2_version_rows===0&&typeof x.schema_sha256==='string'&&/^[a-f0-9]{64}$/.test(x.schema_sha256);
}
async function run(){
 try{
  report.phase='IMMUTABLE_GENERATED_FIXTURE';
  const fx=JSON.parse(await readFile('pr77-synthetic-fixture-20261108.json','utf8'));
  ensure(fx?.origin==='SYNTHETIC_ONLY'&&fx.plan_sha256===PLAN_HASH&&fx.seed?.length===41&&fx.plan?.length===89,'SYNTHETIC_OR_REVIEWED_PLAN_DRIFT');
  const src=await readFile('customer_frontier/qualification/pr77_synthetic_d1_worker_20261108.mjs','utf8');
  ensure(src.includes("const EXPECTED_PLAN='"+PLAN_HASH+"'"),'WORKER_SOURCE_DRIFT');
  report.worker_source_sha256=sha(src);
  report.phase='CLOUDFLARE_PREDEPLOY_READ_ONLY';
  const metadata=await cf('/d1/database/'+TARGET);
  ensure(metadata?.uuid===TARGET&&metadata?.name===TARGET_NAME,'WRONG_D1_UUID_OR_NAME');
  const original=await cf('/d1/database/'+OTHER_PROTECTED);
  ensure(original?.uuid===OTHER_PROTECTED&&original?.name==='axiom-disposable-dr-target-20261108','PROTECTED_RECOVERY_COPY_MISSING');
  const sd=await cf('/workers/subdomain');
  ensure(sd?.subdomain===SUBDOMAIN,'WRONG_WORKERS_DEV_NAMESPACE');
  ensure(await cf('/workers/scripts/'+SCRIPT+'/settings',{allow404:true})===null,'WORKER_SCRIPT_NAME_NOT_EMPTY');
  const sql="SELECT type,name FROM sqlite_master WHERE type IN ('table','index','trigger','view') AND name NOT GLOB 'sqlite_*'";
  const queried=await cf('/d1/database/'+TARGET+'/query',{method:'POST',body:{sql,params:[]}});
  ensure(Array.isArray(queried)&&queried.length===1&&queried[0]?.success===true&&queried[0]?.meta?.changed_db===false&&queried[0]?.meta?.changes===0&&queried[0]?.meta?.rows_written===0&&
    Array.isArray(queried[0]?.results)&&queried[0].results.every(x=>['_cf_KV','_cf_METADATA'].includes(x.name)),'TARGET_NOT_EMPTY_OR_SELECT_ZERO_WRITE_UNCONFIRMED');
  report.phase='ONE_WORKER_UPLOAD_ATTEMPT';
  const metadataBody={main_module:'worker.mjs',compatibility_date:'2026-11-08',bindings:[
   {type:'d1',name:'DB',id:TARGET},
   {type:'plain_text',name:'RUN',text:RUN},
   {type:'plain_text',name:'OWNER',text:OWNER},
   {type:'plain_text',name:'EPOCH',text:EPOCH},
   {type:'plain_text',name:'EXPIRES',text:String(Date.now()+240000)},
   {type:'secret_text',name:'TOKEN',text:OPERATOR}
  ]};
  const form=new FormData();
  form.set('metadata',new Blob([JSON.stringify(metadataBody)],{type:'application/json'}));
  form.set('worker.mjs',new Blob(['globalThis.__AXIOM_PR77_SYNTHETIC__='+JSON.stringify(fx)+';\n'+src],{type:'application/javascript+module'}),'worker.mjs');
  attemptedUpload=true;
  await cf('/workers/scripts/'+SCRIPT,{method:'PUT',form});
  report.worker_uploaded=true;
  const settings=await cf('/workers/scripts/'+SCRIPT+'/settings');
  ensure(owned(settings),'NEW_WORKER_BINDINGS_UNQUALIFIED_DO_NOT_CLEAN_FOREIGN');
  workerConfirmed=true;report.worker_owned=true;
  await cf('/workers/scripts/'+SCRIPT+'/subdomain',{method:'POST',body:{enabled:true,previews_enabled:false}});
  let active=false;
  for(let i=0;i<12;i++){try{const h=await worker('/health');if(h.status===200&&h.data.run_id===RUN&&h.data.epoch===EPOCH){active=true;break}}catch{}await pause(800)}
  ensure(active,'WORKER_HEALTH_UNAVAILABLE');
  report.phase='SYNTHETIC_SEED_ONCE';
  const seed=await worker('/seed','POST');
  ensure(seed.status===200&&seed.data.status==='SYNTHETIC_SEED_BATCH_ACCEPTED'&&seed.data.statements===41,'SYNTHETIC_SEED_NOT_CONFIRMED_DO_NOT_RETRY');
  report.seed_applied=true;
  const first=await worker('/observe');
  ensure(first.status===200&&baseline(first.data),'SYNTHETIC_BASELINE_UNEXPECTED');
  report.baseline_schema_sha256=first.data.schema_sha256;
  report.phase='ACTUAL_PR77_46_PREFIX_48_FORCED_CHECK';
  const bounded=await worker('/bounded-rollback','POST');
  report.bounded_result=bounded.data?.status||'UNKNOWN';
  report.bounded_failure_kind=bounded.data?.failure_kind||'UNKNOWN';
  ensure(bounded.status===200&&bounded.data.status==='PR77_PREFIX_INTENTIONAL_CHECK_ABORT'&&bounded.data.failure_kind==='intended_constraint_abort','BOUNDED_PR77_NOT_QUALIFIED_NO_RETRY');
  const afterBounded=await worker('/observe');
  ensure(afterBounded.status===200&&baseline(afterBounded.data)&&afterBounded.data.schema_sha256===first.data.schema_sha256,'BOUNDED_ROLLBACK_FAILED_OR_DRIFT');
  report.expected_d1_ddl_rollback_qualified=true;
  report.phase='ACTUAL_FULL_89_PR77_SINGLE_BATCH_ONCE';
  const full=await worker('/full-89','POST');
  report.full_result=full.data?.status||'UNKNOWN';
  report.full_failure_kind=full.data?.failure_kind||null;
  ensure(full.status===200,'FULL_BATCH_HTTP_OUTCOME_UNKNOWN_NO_RETRY');
  const afterFull=await worker('/observe');
  ensure(afterFull.status===200&&afterFull.data.foreign_key_violations===0&&afterFull.data.customers===2,'POST_FULL_DATA_OR_FK_CORRUPTION');
  if(full.data.status==='FULL_89_SYNTHETIC_BATCH_ACCEPTED'){
   ensure(afterFull.data.guard_tables===0&&afterFull.data.v2_version_rows===1,'FULL_89_VERSION_NOT_COMMITTED');
   report.full_89_atomic_batch_qualified=true;
   report.status='HOSTED_FULL_89_PR77_SYNTHETIC_BATCH_AND_BOUNDED_ROLLBACK_PASS';
  }else{
   ensure(full.data.status==='FULL_89_BATCH_NOT_QUALIFIED','FULL_BATCH_RESULT_NOT_CLASSIFIED');
   ensure(baseline(afterFull.data)&&afterFull.data.schema_sha256===first.data.schema_sha256,'FULL_89_FAILURE_PARTIAL_COMMIT_OR_DRIFT');
   report.status='BOUNDED_PR77_HOSTED_ROLLBACK_PASS_FULL_89_BATCH_BLOCKED';
  }
  report.phase='HOSTED_PROVIDER_RESULTS_OBSERVED';
  mainOutcome=report.status;
 }catch{
  report.status='HOSTED_PR77_SYNTHETIC_UNQUALIFIED_FAIL_CLOSED';
  report.phase='ERROR_REQUIRES_INDEPENDENT_READBACK';
  mainOutcome=report.status;
 }finally{
  if(attemptedUpload){
   try{
    const state=await cf('/workers/scripts/'+SCRIPT+'/settings',{allow404:true});
    if(state!==null){
      ensure(owned(state),'WORKER_OWNER_NOT_VERIFIED_NO_DELETE');
      await cf('/workers/scripts/'+SCRIPT,{method:'DELETE'});
    }
    const gone=await cf('/workers/scripts/'+SCRIPT+'/settings',{allow404:true});
    ensure(gone===null,'SCRIPT_DELETE_NOT_CONFIRMED');
    report.worker_deleted=true;
   }catch{report.cleanup_status='OWNED_WORKER_CLEANUP_UNQUALIFIED';}
  }
  if(report.worker_deleted && mainOutcome==='HOSTED_FULL_89_PR77_SYNTHETIC_BATCH_AND_BOUNDED_ROLLBACK_PASS')report.phase='QUALIFIED_SYNTHETIC_ONLY_WORKER_REMOVED';
  if(report.worker_deleted && mainOutcome==='BOUNDED_PR77_HOSTED_ROLLBACK_PASS_FULL_89_BATCH_BLOCKED')report.phase='PARTIAL_SYNTHETIC_QUALIFICATION_WORKER_REMOVED';
  await save();
  console.log(JSON.stringify(report));
  if(!report.worker_deleted||!report.full_89_atomic_batch_qualified)process.exitCode=1;
 }
}
await run();
