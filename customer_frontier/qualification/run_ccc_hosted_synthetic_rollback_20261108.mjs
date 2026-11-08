/** Pinned, one-shot hosted synthetic D1 atomic rollback probe with owned Worker cleanup.
 * Writes ONLY an intentionally failing atomic D1 batch with a unique synthetic table.
 * Never touches existing customer rows, production OAuth, billing or arbitrary Workers.
 */
import {createHash,randomBytes} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
const ACCOUNT='93f395f5121954671f92fffa453d6b61';
const DB='ccc473f1-fbb5-4b8d-8a24-45f3696ac10f';
const NAME_SHA='7e98510fc457a669c29dd85ab1d87cc758fe0ba74d0833c20863b53d599b5b36';
const BASE_SHA='e0a8f47429b1479d7dd2037633e8ca309645fb65fe345335801fc8653b49b7a1';
const RUN='axiom-ccc-rollback-20261108-01';
const SQL="SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type IN ('table','index','trigger','view') AND name NOT GLOB 'sqlite_*' ORDER BY type,name";
const sha=v=>createHash('sha256').update(v).digest('hex');
const canonical=rows=>JSON.stringify(rows.map(row=>Object.fromEntries(Object.keys(row).sort().map(k=>[k,row[k]])))).replace(/[\u0080-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
const required=(condition,reason)=>{if(!condition)throw Error(reason);};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const report={schema:'musitu.axiom.ccc_hosted_synthetic_rollback_driver.v1',database_id:DB,
 source_sha:process.env.AXIOM_CHECKOUT_SHA,run_id:RUN,phase:'NOT_ATTEMPTED',
 catalog_sha256:BASE_SHA,initial_catalog_verified:false,rollback_verified:false,
 after_catalog_verified:false,temporary_worker_removed:false,probe_table_persisted:null,
 d1_intended_nonpersistent_batch:true,customer_records_read:0,production_oauth_changed:false,
 full_hosted_restore_qualified:false,release_authority:false,transport:[],error:null};
let deployedAttempted=false, workerBase;
const owner=randomBytes(24).toString('hex'), bearer=randomBytes(32).toString('hex'), epoch=randomBytes(12).toString('hex');
const token=process.env.CLOUDFLARE_API_TOKEN;
async function cf(path,{method='GET',body,form,allow404=false}={}){
 const allowed=[
  '/d1/database/'+DB,'/d1/database/'+DB+'/query','/workers/scripts/'+RUN+'/settings',
  '/workers/scripts/'+RUN,'/workers/scripts/'+RUN+'/subdomain','/workers/subdomain'
 ];
 required(allowed.includes(path),'control_path_not_admitted');
 required(['GET','POST','PUT','DELETE'].includes(method),'method_not_admitted');
 required(report.transport.length<30,'control_request_budget');
 const response=await fetch('https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+path,{
  method,headers:{Authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},
  body:form||(body?JSON.stringify(body):undefined),redirect:'error',signal:AbortSignal.timeout(20000)});
 report.transport.push({kind:'cloudflare_control',method,status:response.status});
 if(allow404&&response.status===404)return null;
 const raw=await response.text();required(raw.length<2_000_000,'control_response_too_large');
 const data=JSON.parse(raw);required(response.status>=200&&response.status<300&&data.success===true,'cloudflare_control_rejected');
 return data.result;
}
async function catalog(){
 const responses=await cf('/d1/database/'+DB+'/query',{method:'POST',body:{sql:SQL,params:[]}});
 required(Array.isArray(responses)&&responses.length===1&&responses[0]?.success===true,'catalog_unavailable');
 const {meta,results}=responses[0];
 required(meta?.changed_db===false&&meta?.changes===0&&meta?.rows_written===0,'read_only_zero_writes_unconfirmed');
 required(Array.isArray(results)&&results.length===78,'catalog_object_count_drift');
 required(sha(canonical(results))===BASE_SHA,'catalog_hash_drift');
 return results;
}
async function requestWorker(path,method){
 const response=await fetch(workerBase+path,{method,headers:{Authorization:'Bearer '+bearer},redirect:'error',signal:AbortSignal.timeout(method==='POST'?75000:10000)});
 report.transport.push({kind:'synthetic_worker',method,status:response.status});
 const raw=await response.text();required(raw.length<16384,'worker_response_oversize');
 return {status:response.status,data:JSON.parse(raw)};
}
async function main(){
 const save=()=>writeFile('ccc-hosted-rollback-result.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});
 try{
  required(/^[0-9a-f]{40}$/.test(process.env.AXIOM_CHECKOUT_SHA||'')&&typeof token==='string'&&token.length>0,'input_missing');
  const meta=await cf('/d1/database/'+DB);
  required(meta?.uuid===DB&&typeof meta.name==='string'&&sha(meta.name)===NAME_SHA,'database_identity_mismatch');
  required(Number.isSafeInteger(meta.file_size)&&meta.file_size>0&&meta.file_size<16777216,'database_size_unknown');
  await catalog();report.initial_catalog_verified=true;
  required(await cf('/workers/scripts/'+RUN+'/settings',{allow404:true})===null,'worker_name_not_exclusive');
  const sub=await cf('/workers/subdomain');
  required(/^[a-z0-9-]{1,63}$/.test(sub?.subdomain||''),'invalid_workers_subdomain');
  workerBase='https://'+RUN+'.'+sub.subdomain+'.workers.dev';
  const workerSource=await readFile(new URL('./ccc_synthetic_rollback_worker_20261108.mjs',import.meta.url));
  const bindings=[
   {type:'d1',name:'DB',database_id:DB},
   ...Object.entries({RUN,OWNERSHIP:owner,EPOCH:epoch,EXPIRES:String(Date.now()+180000)}).map(([name,text])=>({type:'plain_text',name,text})),
   {type:'secret_text',name:'TOKEN',text:bearer}
  ];
  const form=new FormData();
  form.set('metadata',new Blob([JSON.stringify({main_module:'worker.mjs',compatibility_date:'2026-07-01',bindings})],{type:'application/json'}));
  form.set('worker.mjs',new Blob([workerSource],{type:'application/javascript+module'}),'worker.mjs');
  deployedAttempted=true;report.phase='TEMPORARY_WORKER_PENDING';
  await cf('/workers/scripts/'+RUN,{method:'PUT',form});
  await cf('/workers/scripts/'+RUN+'/subdomain',{method:'POST',body:{enabled:true,previews_enabled:false}});
  let healthy=false;
  for(let i=0;i<12;i++){
   try{const r=await requestWorker('/health','GET');if(r.status===200&&r.data.run_id===RUN&&r.data.epoch===epoch){healthy=true;break;}}
   catch{}
   await pause(750);
  }
  required(healthy,'temporary_worker_unreachable');
  report.phase='SYNTHETIC_ROLLBACK_PENDING';await save();
  const r=await requestWorker('/qualify','POST');
  required(r.status===200&&r.data?.rolled_back===true&&r.data?.schema_catalog_sha256===BASE_SHA&&r.data?.catalog_objects===78&&r.data?.foreign_keys_check_passed===true,'synthetic_batch_unverified');
  report.rollback_verified=true;
  await catalog();report.after_catalog_verified=true;
  report.probe_table_persisted=false;
  report.phase='SYNTHETIC_ROLLBACK_VERIFIED';await save();
 }catch(error){
  report.error='synthetic_rollback_failed_require_independent_reconciliation';
  report.phase='UNKNOWN_OR_FAILED';process.exitCode=1;
 }finally{
  if(deployedAttempted)try{
   const current=await cf('/workers/scripts/'+RUN+'/settings',{allow404:true});
   if(current!==null){
    required(Array.isArray(current.bindings),'worker_settings_unavailable');
    required(current.bindings.some(x=>x.name==='DB'&&x.type==='d1'&&(x.id||x.database_id)===DB),'foreign_worker_database_binding');
    required(current.bindings.some(x=>x.name==='OWNERSHIP'&&x.text===owner),'foreign_worker_ownership');
    required(current.bindings.some(x=>x.name==='RUN'&&x.text===RUN),'foreign_worker_run');
    await cf('/workers/scripts/'+RUN,{method:'DELETE'});
   }
   required(await cf('/workers/scripts/'+RUN+'/settings',{allow404:true})===null,'temporary_worker_cleanup_not_confirmed');
   report.temporary_worker_removed=true;
  }catch{
   report.error='temporary_worker_cleanup_not_confirmed';report.phase='UNKNOWN_OR_FAILED';process.exitCode=1;
  }
  await save();
  console.log(JSON.stringify(report));
 }
}
await main();
