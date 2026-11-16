/** Rehearse the reviewed native upgrade only on the qualified production copy. */
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { TARGET, TARGET_BASE, ACCOUNT_BASE, fingerprint, storage } from './step2_prod_oauth_hosted_restore_20261114.mjs';
import { ACCOUNT, targetD1Plan, RecoveryStop } from './step2_create_restore_target_20261114.mjs';
import { NAME } from './step2_create_oauth_restore_target_20261114.mjs';
import { PLAN, PLAN_SHA256 } from './step2_reviewed_oauth_plan_20261114.mjs';
import { TENANT_CASES, SAFE_FAILURE_CODES } from './step2_prod_oauth_native_worker_20261114.mjs';
import { apiClient, edgeFetch, preview, snapshot, same, ensurePreviewSubdomain, result, PreviewStop,
  PRODUCTION_BASE, PRODUCTION_DATABASE, PREVIEW_A, PREVIEW_B } from './step2_prod_oauth_preview_transport_20261114.mjs';
export const FILE='prod_oauth_native_upgrade_20261114.json';
const sha=value=>createHash('sha256').update(value).digest('hex');
const check=(ok,code)=>{if(!ok)throw new PreviewStop(code);};
const VERSION_TABLE_HASH=sha('oauth_identity_schema_versions');
const OPERATIONS=['late-failure','apply-reviewed-plan','concurrent-reviewed-plan','read-after-upgrade','tenant-revocation-tests'];
const STATUSES=['REVIEWED_PLAN_LATE_FAILURE_ROLLED_BACK','REVIEWED_PLAN_APPLIED_IN_ONE_NATIVE_BATCH',
  'REVIEWED_PLAN_CONCURRENT_BATCHES_VERIFIED','UPGRADED_COPY_STATE_VERIFIED',
  'RECOVERED_OAUTH_TENANT_AND_REVOCATION_CHECKS_VERIFIED','RECOVERED_OAUTH_NATIVE_OPERATION_NOT_QUALIFIED'];
export function checkedReply(doc,tag) {
  const fields=['schema','status','statement_count','plan_sha256','foreign_keys','check_constraints','violations',
    'preview_instance_tag','release_status','tests','recovered_customer_rows_used','fixture_principals_only',
    'real_customer_login_qualified','failure_stage','failure_code','concurrent_batches'];
  check(doc && Object.keys(doc).every(key=>fields.includes(key)) &&
    doc.schema==='musitu.axiom.production-oauth-native-worker-result.v1' && STATUSES.includes(doc.status) &&
    doc.preview_instance_tag===tag && doc.release_status==='NOT_RELEASE','NATIVE_REPLY_NOT_QUALIFIED');
  if(doc.plan_sha256!==undefined)check(doc.plan_sha256===PLAN_SHA256 && doc.statement_count===89,'NATIVE_PLAN_REPLY_DRIFT');
  if(doc.status!=='RECOVERED_OAUTH_NATIVE_OPERATION_NOT_QUALIFIED')
    check(doc.plan_sha256===PLAN_SHA256&&doc.statement_count===89,'NATIVE_PLAN_REPLY_MISSING');
  if(doc.failure_stage!==undefined)check(OPERATIONS.includes(doc.failure_stage)&&SAFE_FAILURE_CODES.includes(doc.failure_code),'NATIVE_FAILURE_REPLY_UNREVIEWED');
  if(doc.tests!==undefined)check(Array.isArray(doc.tests)&&doc.tests.length<=TENANT_CASES.length&&doc.tests.every(row=>
    Object.keys(row).sort().join('|')==='name|result'&&TENANT_CASES.includes(row.name)&&row.result==='PASS'),'NATIVE_TEST_REPLY_UNREVIEWED');
  for(const [key,value]of[['foreign_keys',1],['check_constraints',0],['violations',0],['recovered_customer_rows_used',2],
    ['fixture_principals_only',true],['real_customer_login_qualified',false],['concurrent_batches',2]])
    if(doc[key]!==undefined)check(doc[key]===value,'NATIVE_REPLY_VALUE_UNREVIEWED');
  return doc;
}
export function expectedStateMatches(actual,expected) {
  if(!actual||!expected||!Array.isArray(actual.tables)||!Array.isArray(expected.tables)||actual.catalog_sha256!==expected.catalog_sha256||actual.total_rows!==expected.total_rows||
    actual.tables.length!==expected.tables.length||actual.integrity_check!==true||actual.foreign_key_check!==true)return false;
  return expected.tables.every(wanted=>{
    const found=actual.tables.find(row=>row.table_name_sha256===wanted.table_name_sha256);
    return found&&found.rows===wanted.rows&&(wanted.table_name_sha256===VERSION_TABLE_HASH||found.data_sha256===wanted.data_sha256);
  });
}
function persist(r){const bytes=Buffer.from(JSON.stringify(r,null,2)+'\n');writeFileSync(FILE,bytes,{mode:0o600});
  writeFileSync(FILE+'.sha256',sha(bytes)+'  '+FILE+'\n',{mode:0o600});}
export async function rehearse({productionToken,recoveryToken,baselineReceipt,preflightReceipt,workerSource,planSource,
  api=apiClient({production:productionToken,recovery:recoveryToken}),edge=edgeFetch,transfer=storage,inspect=fingerprint,
  save=persist,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
  const r={schema:'musitu.axiom.production-oauth-copy-native-upgrade.v1',observed_at_utc:new Date().toISOString(),
    source_database:PRODUCTION_DATABASE,recovery_account:ACCOUNT,recovery_database:TARGET,
    source_mutation_routes_available:false,production_oauth_migrated:false,permanent_worker_deployment_performed:false,
    real_customer_login_qualified:false,owner_production_backup_decryption_pending:true,gate2_closed:false,
    native_invocation_attempted:false,cleanup_parity_verified:false,cleanup_fk_enforcement_verified:false,
    preview_workers_absent_after_cleanup:false,source_data_unchanged:false,release_status:'NOT_RELEASE',status:'PREFLIGHT_PENDING'};
  const record=()=>save(r);record();let origin,previewAttempted=false;
  const snap=(options)=>snapshot(api,transfer,inspect,pause,options);
  try{
    check(baselineReceipt?.target_database===TARGET&&baselineReceipt.source_database===PRODUCTION_DATABASE&&
      baselineReceipt.target_account===ACCOUNT&&baselineReceipt.hosted_schema_and_data_parity===true&&
      baselineReceipt.rollback_outcome==='SCHEMA_AND_ALL_TABLE_DATA_RESTORED'&&baselineReceipt.source_data_unchanged===true&&
      baselineReceipt.hosted_fk_observation?.enforcement===1,'QUALIFIED_COPY_BACKUP_REQUIRED');
    check(preflightReceipt?.status==='PRODUCTION_OAUTH_COPY_LOCAL_UPGRADE_PREFLIGHT_PASSED'&&
      same(preflightReceipt.memory_preflight.baseline,baselineReceipt.baseline)&&
      preflightReceipt.memory_preflight.plan_sha256===PLAN_SHA256&&preflightReceipt.memory_preflight.statement_count===89,
    'REAL_DATA_PREFLIGHT_NOT_QUALIFIED');
    check(PLAN.length===89&&sha(JSON.stringify(PLAN.slice(0,-3)))===PLAN_SHA256,'REVIEWED_PLAN_SOURCE_DRIFT');
    check(typeof workerSource==='string'&&workerSource.length>1000&&workerSource.length<25000&&
      typeof planSource==='string'&&planSource.length>1000&&planSource.length<250000,'PREVIEW_MODULE_SIZE_UNQUALIFIED');
    r.worker_source_sha256=sha(workerSource);r.public_plan_module_sha256=sha(planSource);r.plan_sha256=PLAN_SHA256;r.statement_count=89;
    const source=result(await api('production','GET',PRODUCTION_BASE));
    check(source?.uuid===PRODUCTION_DATABASE&&source.file_size>0&&source.file_size<=8000000,'PRODUCTION_IDENTITY_UNQUALIFIED');
    check(result(await api('recovery','GET',ACCOUNT_BASE))?.id===ACCOUNT,'RECOVERY_ACCOUNT_DRIFT');
    Object.assign(r,targetD1Plan(await api('recovery','GET',ACCOUNT_BASE+'/subscriptions')));
    const catalog=await api('recovery','GET',ACCOUNT_BASE+'/d1/database?page=1&per_page=100'),databases=result(catalog);
    check(Array.isArray(databases)&&databases.length===2&&catalog.result_info?.total_count===2&&
      databases.some(row=>row.uuid===TARGET&&row.name===NAME)&&databases.some(row=>row.uuid==='be760b23-2ed1-47aa-92aa-9042ce917bb9'&&
      row.name==='axiom-idp-step1-disposable-restore-20261114-704a7351'),'RECOVERY_DATABASE_CATALOG_DRIFT');
    const workers=result(await api('recovery','GET',ACCOUNT_BASE+'/workers/scripts'));
    const pages=await api('recovery','GET',ACCOUNT_BASE+'/pages/projects?page=1&per_page=10');
    check(Array.isArray(workers)&&workers.length===0&&Array.isArray(result(pages))&&pages.result.length===0&&
      pages.result_info?.total_count===0,'RECOVERY_ACCOUNT_HAS_CONSUMERS');
    const detail=result(await api('recovery','GET',TARGET_BASE));check(detail?.uuid===TARGET&&detail.name===NAME,'RECOVERY_TARGET_DRIFT');
    r.baseline=await snap();check(same(r.baseline,baselineReceipt.baseline),'RECOVERED_BASELINE_DRIFT');
    origin=result(await api('recovery','GET',TARGET_BASE+'/time_travel/bookmark'))?.bookmark;
    check(typeof origin==='string'&&/^[A-Za-z0-9-]{16,256}$/.test(origin),'ROLLBACK_BOOKMARK_INVALID');r.rollback_bookmark_sha256=sha(origin);
    await ensurePreviewSubdomain(api,r,record);
    const challenge=randomBytes(32).toString('hex'),tagA=randomBytes(16).toString('hex'),tagB=randomBytes(16).toString('hex');
    previewAttempted=true;r.status='PRIVATE_MIGRATION_PREVIEW_STARTING';record();
    const a=await preview(api,edge,PREVIEW_A,workerSource,planSource,challenge,tagA);r.preview_a_optional_exchange_fallback=a.exchangeFallback;
    const invoke=async(session,operation,tag)=>{
      r.current_operation=operation;r.native_invocation_attempted=true;record();
      return checkedReply(await edge('https://'+session.host+'/gate2/prod-oauth',{method:'POST',
        headers:{'cf-workers-preview-token':session.token,Authorization:'Bearer '+challenge,'Content-Type':'application/json'},
        body:JSON.stringify({operation})}),tag);
    };
    r.late_failure=await invoke(a,'late-failure',tagA);
    check(r.late_failure.status==='REVIEWED_PLAN_LATE_FAILURE_ROLLED_BACK','NATIVE_LATE_FAILURE_NOT_QUALIFIED');
    r.after_late_failure=await snap();check(same(r.after_late_failure,r.baseline),'LATE_FAILURE_CHANGED_RECOVERED_DATA_OR_SCHEMA');record();
    r.native_application=await invoke(a,'apply-reviewed-plan',tagA);
    check(r.native_application.status==='REVIEWED_PLAN_APPLIED_IN_ONE_NATIVE_BATCH','NATIVE_APPLICATION_NOT_QUALIFIED');
    r.after_upgrade=await snap();check(expectedStateMatches(r.after_upgrade,preflightReceipt.memory_preflight.expected_after_upgrade),
      'NATIVE_MIGRATION_SCHEMA_OR_CUSTOMER_DATA_MISMATCH');r.original_customer_data_preserved=true;record();
    await pause(1200);r.idempotent_reapply=await invoke(a,'apply-reviewed-plan',tagA);
    check(r.idempotent_reapply.status==='REVIEWED_PLAN_APPLIED_IN_ONE_NATIVE_BATCH','IDEMPOTENT_NATIVE_APPLICATION_NOT_QUALIFIED');
    r.after_idempotent=await snap();check(same(r.after_idempotent,r.after_upgrade),'IDEMPOTENT_REAPPLY_CHANGED_STATE');r.idempotency_verified=true;record();
    r.concurrent_application=await invoke(a,'concurrent-reviewed-plan',tagA);
    check(r.concurrent_application.status==='REVIEWED_PLAN_CONCURRENT_BATCHES_VERIFIED'&&r.concurrent_application.concurrent_batches===2,
      'CONCURRENT_NATIVE_APPLICATION_NOT_QUALIFIED');
    r.after_concurrent=await snap();check(same(r.after_concurrent,r.after_upgrade),'CONCURRENT_REAPPLY_CHANGED_STATE');r.concurrent_batches_verified=true;record();
    const b=await preview(api,edge,PREVIEW_B,workerSource,planSource,challenge,tagB);r.preview_b_optional_exchange_fallback=b.exchangeFallback;
    r.fresh_preview=await invoke(b,'read-after-upgrade',tagB);check(r.fresh_preview.status==='UPGRADED_COPY_STATE_VERIFIED','FRESH_PREVIEW_STATE_NOT_QUALIFIED');
    r.tenant_revocation=await invoke(b,'tenant-revocation-tests',tagB);
    check(r.tenant_revocation.status==='RECOVERED_OAUTH_TENANT_AND_REVOCATION_CHECKS_VERIFIED'&&
      r.tenant_revocation.recovered_customer_rows_used===2&&r.tenant_revocation.tests?.length===TENANT_CASES.length&&
      TENANT_CASES.every(name=>r.tenant_revocation.tests.some(row=>row.name===name&&row.result==='PASS')),
    'RECOVERED_OAUTH_TENANT_OR_REVOCATION_NOT_QUALIFIED');
    r.status='MIGRATION_AND_TENANT_CHECKS_PASSED_CLEANUP_REQUIRED';
  }catch(error){
    r.status='PRODUCTION_OAUTH_COPY_NATIVE_REHEARSAL_STOPPED';
    r.error=error instanceof PreviewStop||error instanceof RecoveryStop?error.code:'SANITIZED_NATIVE_REHEARSAL_FAILURE';
    if(error instanceof PreviewStop&&error.api_operation){r.refused_api_operation=error.api_operation;r.provider_error_codes=error.provider_error_codes??[];}
    if(error instanceof PreviewStop&&error.edge_transport_reason)r.edge_transport_reason=error.edge_transport_reason;
  }finally{
    if(r.native_invocation_attempted&&origin){
      r.rollback_attempted=true;record();
      try{await api('recovery','POST',TARGET_BASE+'/time_travel/restore?bookmark='+origin);r.rollback_acknowledged=true;}
      catch{r.rollback_error='ROLLBACK_ACKNOWLEDGEMENT_UNCONFIRMED';}
      try{r.after_cleanup=await snap();check(same(r.after_cleanup,r.baseline),'CLEANUP_BASELINE_MISMATCH');r.cleanup_parity_verified=true;
        const fk=result(await api('recovery','POST',TARGET_BASE+'/query',{sql:'PRAGMA foreign_keys'}));
        const violations=result(await api('recovery','POST',TARGET_BASE+'/query',{sql:'PRAGMA foreign_key_check'}));
        check(fk?.[0]?.results?.[0]?.foreign_keys===1&&violations?.[0]?.success===true&&violations[0].results?.length===0,'CLEANUP_FOREIGN_KEYS_UNQUALIFIED');
        r.cleanup_fk_enforcement_verified=true;
      }catch{r.cleanup_error='FULL_BASELINE_OR_FOREIGN_KEY_CLEANUP_UNCONFIRMED';}
      try{r.final_source=await snap({role:'production',base:PRODUCTION_BASE});check(same(r.final_source,baselineReceipt.baseline),'FINAL_SOURCE_DRIFT');r.source_data_unchanged=true;}
      catch{r.source_verification_error='FINAL_SOURCE_COMPARISON_UNCONFIRMED';}
    }
    if(previewAttempted){
      try{let rows=result(await api('recovery','GET',ACCOUNT_BASE+'/workers/scripts'));
        check(Array.isArray(rows)&&rows.every(row=>[PREVIEW_A,PREVIEW_B].includes(row.id)),'UNEXPECTED_WORKER_CATALOG_CHANGE');
        for(const row of rows){try{await api('recovery','DELETE',ACCOUNT_BASE+'/workers/scripts/'+row.id);}catch{r.preview_delete_acknowledgement_unknown=true;}}
        rows=result(await api('recovery','GET',ACCOUNT_BASE+'/workers/scripts'));check(Array.isArray(rows)&&rows.length===0,'PREVIEW_CLEANUP_UNCONFIRMED');
        r.preview_workers_absent_after_cleanup=true;
      }catch{r.preview_cleanup_error='PREVIEW_WORKER_CATALOG_REQUIRES_RECONCILIATION';}
    }
    if(r.status==='MIGRATION_AND_TENANT_CHECKS_PASSED_CLEANUP_REQUIRED'&&r.cleanup_parity_verified&&r.cleanup_fk_enforcement_verified&&
      r.source_data_unchanged&&r.preview_workers_absent_after_cleanup)r.status='PRODUCTION_OAUTH_COPY_MIGRATION_TENANT_REVOCATION_AND_ROLLBACK_QUALIFIED';
    else if(r.native_invocation_attempted&&(!r.cleanup_parity_verified||!r.cleanup_fk_enforcement_verified)||r.preview_cleanup_error)
      r.status='PRODUCTION_OAUTH_COPY_NATIVE_CLEANUP_REQUIRES_RECONCILIATION';
    else if(r.status==='MIGRATION_AND_TENANT_CHECKS_PASSED_CLEANUP_REQUIRED')r.status='PRODUCTION_OAUTH_COPY_FINAL_SOURCE_COMPARISON_UNQUALIFIED';
    record();
  }
  return r;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const loadPinned=(name,hash)=>{const b=readFileSync(new URL('../evidence/hosted_recovery_20261114/'+name,import.meta.url));check(sha(b)===hash,'EVIDENCE_PIN_MISMATCH');return JSON.parse(b);};
  const baselineReceipt=loadPinned('prod_oauth_hosted_restore_parity_rollback_passed_20261114.json','7c4bb77d2b717bd7126543dafc4ac4cd44d68d2b530d7c111b58448efa4463ae');
  const preflightReceipt=loadPinned('prod_oauth_real_data_local_upgrade_preflight_passed_20261114.json','419e55d542c7ae559bbc5781c08c1c114f83c27ec427d0b8f5902c0a8cea010f');
  const workerSource=readFileSync(new URL('./step2_prod_oauth_native_worker_20261114.mjs',import.meta.url),'utf8');
  const planSource=readFileSync(new URL('./step2_reviewed_oauth_plan_20261114.mjs',import.meta.url),'utf8');
  const r=await rehearse({productionToken:process.env.CLOUDFLARE_API_TOKEN,recoveryToken:process.env.AXIOM_D1_RECOVERY_CF_API_TOKEN,
    baselineReceipt,preflightReceipt,workerSource,planSource});console.log(r.status);if(r.error)console.log('error='+r.error);
  process.exitCode=r.status==='PRODUCTION_OAUTH_COPY_MIGRATION_TENANT_REVOCATION_AND_ROLLBACK_QUALIFIED'?0:2;
}
