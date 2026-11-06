import {readFile,writeFile} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
const ACCOUNT='93f395f5121954671f92fffa453d6b61',DB='ccc473f1-fbb5-4b8d-8a24-45f3696ac10f',RUN='axiom-customer-d1-20261106-01';
const HASH='06cfe6adfed21dc718ce0f0cdd53521a05e8bee8d1f0e95fccd7e823575ed80c';
const sha=x=>createHash('sha256').update(x).digest('hex');
const assert=(ok,code)=>{if(!ok)throw Error(code);};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 const report={schema:'musitu.axiom.actual_customer_d1_batch.v1',source_sha:process.env.AXIOM_CHECKOUT_SHA,database_id:DB,run_id:RUN,plan_sha256:HASH,customer_schema_applied:false,schema_application_outcome:'NOT_ATTEMPTED',temporary_worker_removed:false,production_oauth_changed:false,release_authority:false,hosted_restore_qualified:false,customer_acceptance_qualified:false,transport:[]};
 const ownership=randomBytes(24).toString('hex');let token=randomBytes(32).toString('hex'),epoch=randomBytes(12).toString('hex'),attempted=false,baseUrl;
 const save=()=>writeFile('customer-hosted-batch-result.json',JSON.stringify(report,null,2)+'\n');
 report.worker_ownership_sha256=sha(ownership);await save();
 async function cf(path,{method='GET',body,form,allow404=false}={}){
  const r=await fetch('https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+path,{method,headers:{Authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN,...(body?{'content-type':'application/json'}:{})},body:form||(body?JSON.stringify(body):undefined),redirect:'error',signal:AbortSignal.timeout(20000)});
  report.transport.push({surface:'control',method,status:r.status});if(allow404&&r.status===404)return null;
  const raw=await r.text();assert(raw.length<2_000_000,'response_limit');const data=JSON.parse(raw);assert(r.status>=200&&r.status<300&&data.success===true,'control_rejected');return data.result;
 }
 const owned=s=>s?.bindings?.some(b=>b.name==='DB'&&b.type==='d1'&&(b.id||b.database_id)===DB)&&s.bindings.some(b=>b.name==='OWNERSHIP'&&b.text===ownership)&&s.bindings.some(b=>b.name==='RUN'&&b.text===RUN);
 async function request(path,method='GET',credential=token){
  const r=await fetch(baseUrl+path,{method,headers:{Authorization:'Bearer '+credential},redirect:'error',signal:AbortSignal.timeout(path==='/qualify'?90000:10000)});report.transport.push({surface:'qualifier',method,status:r.status});
  const text=await r.text();assert(text.length<65536,'qualifier_response_limit');return {status:r.status,data:JSON.parse(text)};
 }
 try{
  assert(/^[0-9a-f]{40}$/.test(process.env.AXIOM_CHECKOUT_SHA||'')&&process.env.CLOUDFLARE_API_TOKEN,'inputs_required');
  const raw=await readFile(new URL('./customer-hosted-plan-20261106.json',import.meta.url));assert(sha(raw)===HASH,'plan_drift');const plan=JSON.parse(raw);
  const worker=await readFile(new URL('./customer_hosted_batch_worker.mjs',import.meta.url),'utf8');
  const metadata=await cf('/d1/database/'+DB);assert(metadata.uuid===DB&&sha(metadata.name)==='7e98510fc457a669c29dd85ab1d87cc758fe0ba74d0833c20863b53d599b5b36','database_identity_drift');
  assert(await cf('/workers/scripts/'+RUN+'/settings',{allow404:true})===null,'existing_worker_must_not_be_replaced');
  const sub=await cf('/workers/subdomain');assert(/^[a-z0-9-]{1,63}$/.test(sub?.subdomain||''),'invalid_subdomain');baseUrl='https://'+RUN+'.'+sub.subdomain+'.workers.dev';
  async function deploy(){
   const bindings=[{type:'d1',name:'DB',database_id:DB},...Object.entries({RUN,OWNERSHIP:ownership,EPOCH:epoch,EXPIRES:String(Date.now()+180000),PLAN_HASH:HASH}).map(([name,text])=>({type:'plain_text',name,text})),{type:'secret_text',name:'TOKEN',text:token}];
   const f=new FormData();f.set('metadata',new Blob([JSON.stringify({main_module:'worker.mjs',compatibility_date:'2026-07-01',bindings})],{type:'application/json'}));f.set('worker.mjs',new Blob(['globalThis.__AXIOM_CUSTOMER_PLAN='+JSON.stringify(plan)+';\n'+worker],{type:'application/javascript+module'}),'worker.mjs');attempted=true;
   await cf('/workers/scripts/'+RUN,{method:'PUT',form:f});await cf('/workers/scripts/'+RUN+'/subdomain',{method:'POST',body:{enabled:true,previews_enabled:false}});
   for(let i=0;i<12;i++){try{const h=await request('/health');if(h.status===200&&h.data.epoch===epoch)return;}catch{}await pause(750);}throw Error('new_epoch_unavailable');
  }
  await deploy();report.migration_attempted=true;report.customer_schema_applied=null;report.schema_application_outcome='UNKNOWN';await save();const result=await request('/qualify','POST');assert(result.status===200&&result.data.atomic_customer_ddl_rollback===true&&result.data.customer_schema_applied===true,'qualification_unknown_requires_readback');Object.assign(report,result.data);report.schema_application_outcome='APPLIED_AND_VERIFIED';await save();
  const old=token;token=randomBytes(32).toString('hex');epoch=randomBytes(12).toString('hex');await deploy();const oldResponse=await request('/health','GET',old);assert(oldResponse.status===401,'old_operator_not_revoked');const recovered=await request('/verify');assert(recovered.status===200&&recovered.data.epoch===epoch&&recovered.data.schema_survived_redeployment,'restart_readback_failed');report.schema_survived_redeployment=true;report.temporary_operator_rotation_confirmed=true;
 }catch{report.error='qualification_or_deployment_failed_reconcile_actual_schema';process.exitCode=1;}
 finally{
  if(attempted)try{const current=await cf('/workers/scripts/'+RUN+'/settings',{allow404:true});if(current!==null){assert(owned(current),'foreign_worker_cleanup_denied');await cf('/workers/scripts/'+RUN,{method:'DELETE'});}assert(await cf('/workers/scripts/'+RUN+'/settings',{allow404:true})===null,'worker_cleanup_unconfirmed');report.temporary_worker_removed=true;}catch{report.cleanup_error='owned_worker_cleanup_unconfirmed';process.exitCode=1;}
  await save();console.log(JSON.stringify(report));
 }
}
await main();
