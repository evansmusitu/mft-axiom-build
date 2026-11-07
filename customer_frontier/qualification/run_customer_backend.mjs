import {readFile,writeFile} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import {dirname,resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DB,RUN,LIMITS} from './customer_acceptance_contract.mjs';
const ACCOUNT='93f395f5121954671f92fffa453d6b61';
const HASH='06cfe6adfed21dc718ce0f0cdd53521a05e8bee8d1f0e95fccd7e823575ed80c';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),entry='customer_frontier/qualification/customer_backend_acceptance_worker.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
const assert=(v,c)=>{if(!v)throw Error(c);};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const report={schema:'musitu.axiom.controlled_customer_backend.v1',source_sha:process.env.AXIOM_CHECKOUT_SHA,database_id:DB,run_id:RUN,fixture_attempted:false,backend_outcome:'NOT_ATTEMPTED',fixture_authority_disabled:null,temporary_worker_removed:false,...LIMITS,transport:[]};
const save=()=>writeFile('customer-backend-result.json',JSON.stringify(report,null,2)+'\n');
const ownership=randomBytes(24).toString('hex'),fixtureA=randomBytes(32).toString('base64url'),fixtureB=randomBytes(32).toString('base64url');
let token=randomBytes(32).toString('hex'),epoch=randomBytes(12).toString('hex'),attempted=false,baseUrl;
report.worker_ownership_sha256=sha(ownership);await save();
async function cf(path,{method='GET',body,form,allow404=false}={}){
 const r=await fetch('https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+path,{method,headers:{authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN,...(body?{'content-type':'application/json'}:{})},body:form||(body?JSON.stringify(body):undefined),redirect:'error',signal:AbortSignal.timeout(20000)});
 report.transport.push({surface:'control',method,status:r.status});if(allow404&&r.status===404)return null;
 const raw=await r.text();assert(raw.length<2000000,'response_limit');const data=JSON.parse(raw);assert(r.ok&&data.success===true,'control_rejected');return data.result;
}
async function request(path,method='POST',credential=token){
 const r=await fetch(baseUrl+path,{method,headers:{authorization:'Bearer '+credential},redirect:'error',signal:AbortSignal.timeout(path==='/health'?10000:60000)});report.transport.push({surface:'qualifier',method,status:r.status});const raw=await r.text();assert(raw.length<65536,'qualifier_limit');return {status:r.status,data:JSON.parse(raw)};
}
const owned=s=>s?.bindings?.some(b=>b.name==='DB'&&b.type==='d1'&&(b.id||b.database_id)===DB)&&s.bindings.some(b=>b.name==='RUN'&&b.text===RUN)&&s.bindings.some(b=>b.name==='OWNERSHIP'&&b.text===ownership);
try{
 assert(/^[0-9a-f]{40}$/.test(process.env.AXIOM_CHECKOUT_SHA||'')&&process.env.CLOUDFLARE_API_TOKEN,'inputs_required');
 const manifest=JSON.parse(await readFile(new URL('./customer-backend-source-manifest.json',import.meta.url),'utf8'));
 for(const item of manifest.files){assert(/^customer_frontier\/[a-zA-Z0-9_./-]+$/.test(item.path)&&!item.path.includes('..'),'manifest_path');assert(sha(await readFile(resolve(root,item.path)))===item.sha256,'source_drift');}
 const raw=await readFile(new URL('./customer-hosted-plan-20261106.json',import.meta.url));assert(sha(raw)===HASH,'plan_drift');
 const modules=new Map();
 async function collect(path){
  if(modules.has(path))return;assert(path.startsWith('customer_frontier/')&&!path.includes('..'),'module_path');
  const contents=await readFile(resolve(root,path),'utf8');assert(manifest.files.some(f=>f.path===path&&f.sha256===sha(contents)),'module_not_reviewed');modules.set(path,contents);
  for(const m of contents.matchAll(/from\s+['"]([^'"]+)['"]/g)){assert(m[1].startsWith('.'),'external_module');await collect(relative(root,resolve(root,dirname(path),m[1])));}
 }
 await collect(entry);modules.set(entry,'globalThis.__AXIOM_CUSTOMER_PLAN='+raw.toString('utf8')+';\n'+modules.get(entry));
 const metadata=await cf('/d1/database/'+DB);assert(metadata.uuid===DB&&sha(metadata.name)==='7e98510fc457a669c29dd85ab1d87cc758fe0ba74d0833c20863b53d599b5b36','database_identity_drift');
 assert(await cf('/workers/scripts/'+RUN+'/settings',{allow404:true})===null,'existing_worker_must_not_be_replaced');
 const sub=await cf('/workers/subdomain');assert(/^[a-z0-9-]{1,63}$/.test(sub?.subdomain||''),'subdomain_invalid');baseUrl='https://'+RUN+'.'+sub.subdomain+'.workers.dev';
 async function deploy(){
  const bindings=[{type:'d1',name:'DB',database_id:DB},...Object.entries({RUN,OWNERSHIP:ownership,EPOCH:epoch,EXPIRES:String(Date.now()+180000)}).map(([name,text])=>({type:'plain_text',name,text})),...Object.entries({TOKEN:token,FIXTURE_A:fixtureA,FIXTURE_B:fixtureB}).map(([name,text])=>({type:'secret_text',name,text}))];
  const form=new FormData();form.set('metadata',new Blob([JSON.stringify({main_module:entry,compatibility_date:'2026-07-01',bindings})],{type:'application/json'}));for(const [path,contents] of modules)form.set(path,new Blob([contents],{type:'application/javascript+module'}),path);
  attempted=true;await cf('/workers/scripts/'+RUN,{method:'PUT',form});await cf('/workers/scripts/'+RUN+'/subdomain',{method:'POST',body:{enabled:true,previews_enabled:false}});
  for(let i=0;i<12;i++){try{const h=await request('/health','GET');if(h.status===200&&h.data.epoch===epoch)return;}catch{}await pause(750);}throw Error('epoch_unavailable');
 }
 await deploy();report.fixture_attempted=true;report.backend_outcome='UNKNOWN';await save();
 const first=await request('/qualify');assert(first.status===200&&first.data.phase==='SEEDED','fixture_seed_not_confirmed');
 for(const [path,phase] of [['/projects','PROJECTS_DONE'],['/isolation','ISOLATION_DONE'],['/budget','BUDGET_DONE'],['/finish/0','FINISH_DONE_0'],['/finish/1','FINISH_DONE_1'],['/finish/2','FINISH_DONE_2'],['/finish/3','AWAITING_RESTART']]){
  const result=await request(path);assert(result.status===200&&result.data.phase===phase,'backend_phase_not_confirmed');Object.assign(report,result.data);await save();
 }
 report.backend_outcome='AWAITING_RESTART';await save();
 const old=token;token=randomBytes(32).toString('hex');epoch=randomBytes(12).toString('hex');await deploy();assert((await request('/health','GET',old)).status===401,'operator_rotation_failed');
 const recovered=await request('/verify');assert(recovered.status===200&&recovered.data.epoch===epoch&&recovered.data.session_budget_restart===true,'restart_not_confirmed');Object.assign(report,recovered.data);await save();
 const last=await request('/revoke');assert(last.status===200&&last.data.phase==='PASS_DISABLED'&&last.data.fixture_authority_disabled===true,'revocation_not_confirmed');Object.assign(report,last.data);report.backend_outcome='PASS_CONTROLLED_FIXTURES_ONLY';report.temporary_operator_rotation_confirmed=true;
}catch{report.error='controlled_backend_not_confirmed_requires_readback';process.exitCode=1;}
finally{
 if(attempted){
  if(report.fixture_attempted)try{const disabled=await request('/disable');if(disabled.status===200&&disabled.data.fixture_authority_disabled===true)report.fixture_authority_disabled=true;}catch{}
  try{const settings=await cf('/workers/scripts/'+RUN+'/settings',{allow404:true});if(settings!==null){assert(owned(settings),'foreign_worker_cleanup_denied');await cf('/workers/scripts/'+RUN,{method:'DELETE'});}assert(await cf('/workers/scripts/'+RUN+'/settings',{allow404:true})===null,'worker_cleanup_unconfirmed');report.temporary_worker_removed=true;}catch{report.cleanup_error='owned_worker_cleanup_unconfirmed';process.exitCode=1;}
 }
 await save();console.log(JSON.stringify(report));
}
